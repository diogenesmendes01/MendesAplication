"use server";

import { prisma } from "@/lib/prisma";
import { chatCompletion, getEnvProviderConfig } from "./provider";
import type { AiMessage, ProviderConfig } from "./provider";
import { getToolsForChannel } from "./tools";
import { executeTool } from "./tool-executor";
import type { ToolContext, ReclameAquiResponse } from "./tool-executor";
import { decrypt } from "@/lib/encryption";
import {
  logUsage,
  checkAndReserveSpend,
  rollbackSpendReservation,
} from "./cost-tracker";
import { MODEL_PRICING, FALLBACK_PRICING, DEFAULT_MODELS } from "./pricing";
import { getBrlUsdRateSync } from "./exchange-rate";
import { logger, createChildLogger } from "@/lib/logger";
import type { Logger } from "pino";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Conservative estimated cost per LLM iteration (in BRL) used to pre-reserve
 * budget before the actual call. The real cost is reconciled in onUsage().
 * Set high enough to prevent overshoot but low enough to not block legitimate
 * requests. ~R$0.05 covers most GPT-4o-mini / Claude Haiku iterations.
 */
const ESTIMATED_COST_PER_ITERATION_BRL = 0.05;

// ─── Result types ─────────────────────────────────────────────────────────────

export interface AgentResult {
  responded: boolean;
  escalated: boolean;
  iterations: number;
  error?: string;
  /** Reclame Aqui dual response — only present when channel is RECLAMEAQUI */
  raResponse?: ReclameAquiResponse;
}

export interface DryRunResult {
  response: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostBrl: number;
  error?: string;
  /** Reclame Aqui dual response — only present when channel is RECLAMEAQUI */
  raResponse?: ReclameAquiResponse;
}

// ─── Internal loop result ────────────────────────────────────────────────────

interface AgentLoopResult {
  responded: boolean;
  escalated: boolean;
  iterations: number;
  error?: string;
  /** Final response text — only meaningful in dry-run mode */
  finalResponse: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Reclame Aqui dual response — only present when channel is RECLAMEAQUI */
  raResponse?: ReclameAquiResponse;
}

// ─── Core agent loop ──────────────────────────────────────────────────────────

/**
 * Shared agent loop used by both `runAgent` (production) and
 * `runAgentDryRun` (simulation). Keeping the loop in one place ensures
 * that bug fixes and feature changes automatically apply to both modes.
 *
 * @param dryRun   When true: accumulates tokens in memory, does NOT write DB.
 *                 When false: logs usage to DB via `onUsage`.
 * @param onUsage  Called after each LLM call with raw token counts.
 *                 In production this persists to `ai_usage_logs`.
 *                 In dry-run this accumulates totals locally.
 */
async function runAgentLoop(options: {
  messages: AiMessage[];
  tools: ReturnType<typeof getToolsForChannel>;
  providerConfig: ProviderConfig;
  toolContext: ToolContext;
  maxIterations: number;
  timeout: number;
  startTime: number;
  dryRun: boolean;
  onUsage: (inputTokens: number, outputTokens: number) => Promise<void>;
  /** Identifies the ticket or "simulation" — used only for logging */
  contextId: string;
/** Child logger with traceId/companyId/ticketId already bound */
  log: Logger;
  /** Pre-iteration budget check — returns false to stop the loop */
  onBudgetCheck?: () => Promise<boolean>;
}): Promise<AgentLoopResult> {
  const {
    messages,
    tools,
    providerConfig,
    toolContext,
    maxIterations,
    timeout,
    startTime,
    dryRun,
    onUsage,
    contextId,
log,
    onBudgetCheck,
  } = options;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalResponse = "";
  let raResponse: ReclameAquiResponse | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // ── Global timeout guard ───────────────────────────────────────────────
    if (Date.now() - startTime > timeout) {
      log.warn({ iteration }, "Agent timeout");
      return {
        responded: false,
        escalated: false,
        iterations: iteration,
        error: "timeout",
        finalResponse,
        totalInputTokens,
        totalOutputTokens,
        raResponse,
      };
    }

    // ── Per-iteration budget check (atomic via Redis) ────────────────────
    if (onBudgetCheck) {
      const allowed = await onBudgetCheck();
      if (!allowed) {
        logger.info({ contextId, iteration }, "Daily spend limit reached mid-loop");
        return {
          responded: false,
          escalated: false,
          iterations: iteration,
          error: "daily_spend_limit_reached",
          finalResponse,
          totalInputTokens,
          totalOutputTokens,
          raResponse,
        };
      }
    }

    try {
      const response = await chatCompletion(messages, tools, providerConfig);

      // ── Accumulate / persist usage ─────────────────────────────────────
      if (response.usage) {
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
        await onUsage(response.usage.inputTokens, response.usage.outputTokens);
      }

      // ── LLM returned tool calls ────────────────────────────────────────
      if (response.tool_calls && response.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: response.content || null,
          tool_calls: response.tool_calls,
        });

        let shouldStop = false;
        let responded = false;
        let escalated = false;

        for (const toolCall of response.tool_calls) {
          const toolName = toolCall.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            args = {};
          }

          if (!dryRun) {
            log.info({ tool: toolName, iteration: iteration + 1 }, "Executing tool");
          }

          const result = await executeTool(toolName, args, toolContext);

          messages.push({
            role: "tool",
            content: result,
            tool_call_id: toolCall.id,
          });

          if (toolName === "RESPOND" || toolName === "RESPOND_EMAIL") {
            if (dryRun) {
              finalResponse = (args.message as string) || "";
            }
            responded = true;
            shouldStop = true;
          } else if (toolName === "RESPOND_RECLAMEAQUI") {
            // Parse the RA dual response from tool result
            try {
              raResponse = JSON.parse(result) as ReclameAquiResponse;
              finalResponse = result;
            } catch {
              log.error({ result }, "Failed to parse RESPOND_RECLAMEAQUI result");
              finalResponse = result;
            }
            responded = true;
            shouldStop = true;
          } else if (toolName === "ESCALATE") {
            if (dryRun) {
              finalResponse = `[Escalado] ${(args.reason as string) || "Sem motivo"}`;
            }
            escalated = true;
            shouldStop = true;
          }
        }

        if (shouldStop) {
          return {
            responded,
            escalated,
            iterations: iteration + 1,
            finalResponse,
            totalInputTokens,
            totalOutputTokens,
            raResponse,
          };
        }

      // ── LLM returned text only (no tool calls) ─────────────────────────
      } else if (response.content) {
        if (!dryRun) {
          log.info({ iteration: iteration + 1 }, "Direct text response from LLM");

          // For RECLAMEAQUI, attempt to parse direct text as JSON dual response
          if (toolContext.channel === "RECLAMEAQUI") {
            try {
              raResponse = JSON.parse(response.content) as ReclameAquiResponse;
              finalResponse = response.content;
            } catch {
              // LLM returned plain text instead of structured RA response — wrap it
              raResponse = {
                privateMessage: response.content,
                publicMessage: response.content,
                detectedType: "outro",
                confidence: 0.3,
              };
              finalResponse = JSON.stringify(raResponse);
            }
          } else {
            const respondTool =
              toolContext.channel === "EMAIL" ? "RESPOND_EMAIL" : "RESPOND";
            const respondArgs =
              toolContext.channel === "EMAIL"
                ? { subject: "Re: Atendimento", message: response.content }
                : { message: response.content };
            await executeTool(respondTool, respondArgs, toolContext);
          }
        } else {
          // Dry-run: handle RECLAMEAQUI text response
          if (toolContext.channel === "RECLAMEAQUI") {
            try {
              raResponse = JSON.parse(response.content) as ReclameAquiResponse;
            } catch {
              raResponse = {
                privateMessage: response.content,
                publicMessage: response.content,
                detectedType: "outro",
                confidence: 0.3,
              };
            }
          }
        }

        finalResponse = response.content;
        return {
          responded: true,
          escalated: false,
          iterations: iteration + 1,
          finalResponse,
          totalInputTokens,
          totalOutputTokens,
          raResponse,
        };

      // ── Empty response ─────────────────────────────────────────────────
      } else {
        if (!dryRun) {
          log.warn({ iteration: iteration + 1 }, "Empty response from LLM");
        }
        return {
          responded: false,
          escalated: false,
          iterations: iteration + 1,
          error: "empty LLM response",
          finalResponse,
          totalInputTokens,
          totalOutputTokens,
          raResponse,
        };
      }
    } catch (error) {
      log.error({ iteration: iteration + 1, error }, "Error in agent iteration");
      messages.push({
        role: "user",
        content: `Erro interno ao processar a solicitação. Tente uma abordagem diferente.`,
      });
    }
  }

  // Max iterations reached without terminal action
  if (!options.dryRun) {
    log.warn({ maxIterations }, "Max iterations reached");
  }

  return {
    responded: false,
    escalated: false,
    iterations: maxIterations,
    error: "max iterations reached",
    finalResponse: finalResponse || "(max iterations reached)",
    totalInputTokens,
    totalOutputTokens,
    raResponse,
  };
}

// ─── Main agent function ─────────────────────────────────────────────────────

export async function runAgent(
  ticketId: string,
  companyId: string,
  incomingMessage: string,
  channel: "WHATSAPP" | "EMAIL" | "RECLAMEAQUI" = "WHATSAPP"
): Promise<AgentResult> {
  const startTime = Date.now();
  const timeout = parseInt(process.env.AI_TIMEOUT || "30000", 10);

  // Create child logger with traceId for this entire request
  const log = createChildLogger({ companyId, ticketId });

  // Load AI config — try channel-specific first, fall back to global (channel=null)
  const aiConfig =
    (await prisma.aiConfig.findFirst({ where: { companyId, channel } })) ??
    (await prisma.aiConfig.findFirst({ where: { companyId, channel: null } }));

  if (!aiConfig || !aiConfig.enabled) {
    return { responded: false, escalated: false, iterations: 0, error: "AI not enabled" };
  }

  // ── Check if the channel is enabled ──────────────────────────────────────
  if (channel === "WHATSAPP" && !aiConfig.whatsappEnabled) {
    return { responded: false, escalated: false, iterations: 0, error: "whatsapp_channel_disabled" };
  }
  if (channel === "EMAIL" && !aiConfig.emailEnabled) {
    return { responded: false, escalated: false, iterations: 0, error: "email_channel_disabled" };
  }
  if (channel === "RECLAMEAQUI" && !aiConfig.raEnabled) {
    return { responded: false, escalated: false, iterations: 0, error: "reclameaqui_channel_disabled" };
  }

  // ── Check daily spend limit (atomic via Redis, DB fallback) ──────────────
  const dailyLimit = aiConfig.dailySpendLimitBrl
    ? Number(aiConfig.dailySpendLimitBrl)
    : null;

  if (dailyLimit) {
    const allowed = await checkAndReserveSpend(
      companyId,
      dailyLimit,
      ESTIMATED_COST_PER_ITERATION_BRL
    );
    if (!allowed) {
      return { responded: false, escalated: false, iterations: 0, error: "daily_spend_limit_reached" };
    }
  }

  // ── Check escalation keywords (fast-path before LLM) ────────────────────
  // For RECLAMEAQUI, use RA-specific escalation keywords if configured
  const escalationKeywords = channel === "RECLAMEAQUI" && aiConfig.raEscalationKeywords?.length
    ? aiConfig.raEscalationKeywords
    : aiConfig.escalationKeywords;

  if (escalationKeywords && escalationKeywords.length > 0) {
    const lowerContent = incomingMessage.toLowerCase();
    const matchedKeyword = escalationKeywords.find((keyword) =>
      lowerContent.includes(keyword.toLowerCase())
    );

    if (matchedKeyword) {
      log.info({ keyword: matchedKeyword, channel }, "Escalation keyword detected, escalating without LLM");

      // Rollback the pre-reserved spend since we won't call the LLM
      if (dailyLimit) {
        await rollbackSpendReservation(companyId, ESTIMATED_COST_PER_ITERATION_BRL);
      }

      await prisma.ticket.update({
        where: { id: ticketId },
        data: { aiEnabled: false, status: "OPEN" },
      });

      await prisma.ticketMessage.create({
        data: {
          ticketId,
          senderId: null,
          content: `[AI Agent] Escalado automaticamente — palavra-chave detectada: "${matchedKeyword}"`,
          isInternal: true,
          isAiGenerated: true,
        },
      });

      return { responded: false, escalated: true, iterations: 0 };
    }
  }

  const maxIterations = aiConfig.maxIterations || 5;

  // ── Build provider config ────────────────────────────────────────────────
  let providerConfig: ProviderConfig;
  if (aiConfig.apiKey) {
    let decryptedApiKey: string;
    try {
      decryptedApiKey = decrypt(aiConfig.apiKey);
    } catch {
      return { responded: false, escalated: false, iterations: 0, error: "api_key_decrypt_failed" };
    }
    providerConfig = {
      provider: aiConfig.provider,
      apiKey: decryptedApiKey,
      model: aiConfig.model || undefined,
      temperature: aiConfig.temperature,
    };
  } else {
    providerConfig = await getEnvProviderConfig({ companyId, ticketId });
  }

  // Load ticket with client and contact info
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      client: { select: { id: true, name: true, telefone: true } },
      contact: { select: { id: true, name: true, whatsapp: true, email: true } },
    },
  });

  if (!ticket) {
    return { responded: false, escalated: false, iterations: 0, error: "Ticket not found" };
  }

  const contactPhone = ticket.contact?.whatsapp || ticket.client?.telefone;
  if (channel === "WHATSAPP" && !contactPhone) {
    return {
      responded: false,
      escalated: false,
      iterations: 0,
      error: "No phone number available for reply",
    };
  }

  const toolContext: ToolContext = {
    ticketId,
    companyId,
    clientId: ticket.clientId,
    contactPhone: contactPhone ? contactPhone.replace(/\D/g, "") : "",
    channel,
    dryRun: false,
  };

  // Load recent message history for prompt context
  const recentMessages = await prisma.ticketMessage.findMany({
    where: { ticketId, isInternal: false },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { direction: true, content: true, isAiGenerated: true },
  });

  const historyContext = recentMessages
    .reverse()
    .map((m) => {
      const sender =
        m.direction === "INBOUND"
          ? "Cliente"
          : m.isAiGenerated
            ? "AI"
            : "Atendente";
      return `[${sender}]: ${m.content.substring(0, 200)}`;
    })
    .join("\n");

  const persona =
    channel === "EMAIL" && aiConfig.emailPersona
      ? aiConfig.emailPersona
      : aiConfig.persona;

  const clientName = ticket.contact?.name || ticket.client?.name;

  // Build channel-specific system prompt
  let systemPrompt: string;
  if (channel === "RECLAMEAQUI") {
    systemPrompt = buildReclameAquiSystemPrompt(persona, clientName, historyContext);
  } else if (channel === "EMAIL") {
    systemPrompt = buildEmailSystemPrompt(persona, clientName, historyContext, aiConfig.emailSignature);
  } else {
    systemPrompt = buildWhatsAppSystemPrompt(persona, clientName, historyContext);
  }

  const messages: AiMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: incomingMessage },
  ];

  const effectiveModel =
    providerConfig.model || aiConfig.model || DEFAULT_MODELS[aiConfig.provider];

  if (!effectiveModel) {
    return {
      responded: false,
      escalated: false,
      iterations: 0,
      error: `no_default_model_for_provider:${aiConfig.provider}`,
    };
  }

  const tools = getToolsForChannel(channel);

  const loopResult = await runAgentLoop({
    messages,
    tools,
    providerConfig,
    toolContext,
    maxIterations,
    timeout,
    startTime,
    dryRun: false,
    contextId: ticketId,
log,
    onBudgetCheck: dailyLimit
      ? async () => {
          return checkAndReserveSpend(
            companyId,
            dailyLimit,
            ESTIMATED_COST_PER_ITERATION_BRL
          );
        }
      : undefined,
    onUsage: async (inputTokens, outputTokens) => {
      const result = await logUsage({
        aiConfigId: aiConfig.id,
        companyId,
        provider: providerConfig.provider,
        model: effectiveModel,
        channel,
        inputTokens,
        outputTokens,
        ticketId,
      });

      if (dailyLimit && result) {
        await rollbackSpendReservation(companyId, ESTIMATED_COST_PER_ITERATION_BRL);
      }
    },
  });

  return {
    responded: loopResult.responded,
    escalated: loopResult.escalated,
    iterations: loopResult.iterations,
    error: loopResult.error,
    raResponse: loopResult.raResponse,
  };
}

// ─── Dry-run agent function (simulation mode) ────────────────────────────────

/**
 * Runs the AI agent in dry-run mode for simulation purposes.
 * - Does NOT require a real ticket — uses mock client context
 * - Does NOT save TicketMessage records
 * - Does NOT send real WhatsApp/email messages
 * - Tools RESPOND / RESPOND_EMAIL / RESPOND_RECLAMEAQUI return the message without side effects
 * - Uses the real persona and knowledge base of the company
 * - Returns the AI response, token usage, and estimated cost
 */
export async function runAgentDryRun(
  companyId: string,
  incomingMessage: string,
  channel: "WHATSAPP" | "EMAIL" | "RECLAMEAQUI" = "WHATSAPP"
): Promise<DryRunResult> {
  const startTime = Date.now();
  const timeout = parseInt(process.env.AI_TIMEOUT || "30000", 10);

  // Create child logger with traceId for this dry-run request
  const log = createChildLogger({ companyId, ticketId: "simulation" });

  const aiConfig = await prisma.aiConfig.findFirst({
    where: { companyId, channel: null },
  });

  if (!aiConfig) {
    return { response: "", inputTokens: 0, outputTokens: 0, estimatedCostBrl: 0, error: "AI not configured" };
  }

  // ── Guard: respect aiConfig.enabled and channel flags even in dry-run ──────
  if (!aiConfig.enabled) {
    return { response: "", inputTokens: 0, outputTokens: 0, estimatedCostBrl: 0, error: "AI not enabled" };
  }
  if (channel === "EMAIL" && !aiConfig.emailEnabled) {
    return { response: "", inputTokens: 0, outputTokens: 0, estimatedCostBrl: 0, error: "email_channel_disabled" };
  }
  if (channel === "WHATSAPP" && !aiConfig.whatsappEnabled) {
    return { response: "", inputTokens: 0, outputTokens: 0, estimatedCostBrl: 0, error: "whatsapp_channel_disabled" };
  }
  if (channel === "RECLAMEAQUI" && !aiConfig.raEnabled) {
    return { response: "", inputTokens: 0, outputTokens: 0, estimatedCostBrl: 0, error: "reclameaqui_channel_disabled" };
  }

  // ── Escalation keyword fast-path (mirrors runAgent behaviour) ────────────
  const escalationKeywords = channel === "RECLAMEAQUI" && aiConfig.raEscalationKeywords?.length
    ? aiConfig.raEscalationKeywords
    : aiConfig.escalationKeywords;

  if (escalationKeywords && escalationKeywords.length > 0) {
    const lowerContent = incomingMessage.toLowerCase();
    const matchedKeyword = escalationKeywords.find((keyword) =>
      lowerContent.includes(keyword.toLowerCase())
    );

    if (matchedKeyword) {
      log.info({ keyword: matchedKeyword }, "Dry-run: escalation keyword detected, would escalate without LLM");
      return {
        response: `[Simulação] Seria escalado automaticamente — palavra-chave detectada: "${matchedKeyword}"`,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostBrl: 0,
      };
    }
  }

  let providerConfig: ProviderConfig;
  if (aiConfig.apiKey) {
    let decryptedApiKey: string;
    try {
      decryptedApiKey = decrypt(aiConfig.apiKey);
    } catch {
      return { response: "", inputTokens: 0, outputTokens: 0, estimatedCostBrl: 0, error: "api_key_decrypt_failed" };
    }
    providerConfig = {
      provider: aiConfig.provider,
      apiKey: decryptedApiKey,
      model: aiConfig.model || undefined,
      temperature: aiConfig.temperature,
    };
  } else {
    providerConfig = await getEnvProviderConfig({ companyId, ticketId: "simulation" });
  }

  const maxIterations = aiConfig.maxIterations || 5;

  const toolContext: ToolContext = {
    ticketId: "simulation",
    companyId,
    clientId: "simulation",
    contactPhone: "5511999999999",
    channel,
    dryRun: true,
  };

  const persona =
    channel === "EMAIL" && aiConfig.emailPersona
      ? aiConfig.emailPersona
      : aiConfig.persona;

  const mockClientName = "Cliente Simulação";

  let systemPrompt: string;
  if (channel === "RECLAMEAQUI") {
    systemPrompt = buildReclameAquiSystemPrompt(persona, mockClientName, "");
  } else if (channel === "EMAIL") {
    systemPrompt = buildEmailSystemPrompt(persona, mockClientName, "", aiConfig.emailSignature);
  } else {
    systemPrompt = buildWhatsAppSystemPrompt(persona, mockClientName, "");
  }

  const messages: AiMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: incomingMessage },
  ];

  const effectiveModel =
    providerConfig.model || aiConfig.model || DEFAULT_MODELS[aiConfig.provider];

  if (!effectiveModel) {
    return {
      response: "",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostBrl: 0,
      error: `no_default_model_for_provider:${aiConfig.provider}`,
    };
  }

  const tools = getToolsForChannel(channel);

  const loopResult = await runAgentLoop({
    messages,
    tools,
    providerConfig,
    toolContext,
    maxIterations,
    timeout,
    startTime,
    dryRun: true,
    contextId: "simulation",
log,
    onUsage: async (inputTokens, outputTokens) => {
      if (aiConfig.id) {
        await logUsage({
          aiConfigId: aiConfig.id,
          companyId,
          provider: providerConfig.provider,
          model: effectiveModel,
          channel,
          inputTokens,
          outputTokens,
          isSimulation: true,
        });
      }
    },
  });

  return {
    response: loopResult.finalResponse,
    inputTokens: loopResult.totalInputTokens,
    outputTokens: loopResult.totalOutputTokens,
    estimatedCostBrl: estimateCostBrl(
      effectiveModel,
      loopResult.totalInputTokens,
      loopResult.totalOutputTokens
    ),
    error: loopResult.error,
    raResponse: loopResult.raResponse,
  };
}

// ─── Cost estimation helper ──────────────────────────────────────────────────

function estimateCostBrl(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model] ?? FALLBACK_PRICING;
  const costUsd =
    (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  return costUsd * getBrlUsdRateSync();
}


// ─── v2 shared prompt blocks ─────────────────────────────────────────────────

const CNPJ_INSTRUCTIONS = `
## Identificação do Cliente (CNPJ/CPF)

Regra: ticket sem CNPJ/CPF identificado = ticket incompleto.

1. Verifique se o cliente já foi identificado via GET_CLIENT_INFO
2. Se CPF/CNPJ mostra "DESCONHECIDO" ou o cliente não foi identificado:
   a. Verifique o histórico e anexos — pode haver CNPJ no summary dos anexos
   b. Se encontrar CNPJ/CPF → use LOOKUP_CLIENT_BY_CNPJ para confirmar
   c. Se confirmar → use LINK_TICKET_TO_CLIENT para vincular
   d. Se não encontrar → pergunte naturalmente: "Para localizar sua empresa no sistema, pode me informar o CNPJ?"
3. Formato aceito: XX.XXX.XXX/XXXX-XX ou apenas números
4. Após vincular, continue o atendimento normalmente
5. Se o cliente for pessoa física, pergunte o CPF
6. Se o cliente não quiser informar, continue o atendimento mesmo assim — não insista mais de 1 vez
`;

const ATTACHMENT_INSTRUCTIONS = `
## Anexos

Anexos aparecem no histórico com ícone 📎, seguidos de summary e metadata.

- Se o summary já contém a informação que você precisa → use diretamente, NÃO chame READ_ATTACHMENT
- Se precisa de detalhes específicos → chame READ_ATTACHMENT(attachmentId, query="sua busca")
- Se precisa do texto completo → chame READ_ATTACHMENT(attachmentId) sem query
- Anexos em processamento mostram "[processando...]" — tente novamente em 10 segundos
`;

// ─── WhatsApp system prompt builder ──────────────────────────────────────────

function buildWhatsAppSystemPrompt(
  persona: string,
  clientName: string,
  historyContext: string
): string {
  let prompt = `# Assistente de Atendimento - MendesERP (WhatsApp)

${persona}

## SUAS FERRAMENTAS DISPONÍVEIS:
- SEARCH_DOCUMENTS(query): Busca informações na base de conhecimento da empresa
- GET_CLIENT_INFO(): Retorna dados do cliente vinculado ao ticket (financeiro, tickets anteriores)
- GET_HISTORY(limit?): Retorna histórico de mensagens da conversa (inclui summaries de anexos)
- RESPOND(message): Envia resposta ao cliente via WhatsApp
- ESCALATE(reason): Escala para atendente humano
- CREATE_NOTE(content): Cria nota interna no ticket
- LOOKUP_CLIENT_BY_CNPJ(cnpj): Busca cliente por CNPJ/CPF
- LINK_TICKET_TO_CLIENT(cnpj, contactName?, contactEmail?, contactPhone?): Vincula ticket ao cliente
- READ_ATTACHMENT(attachmentId, query?): Lê conteúdo extraído de um anexo

## REGRAS:
1. SEMPRE consulte a base de conhecimento antes de responder sobre valores, datas, produtos ou serviços
2. NUNCA invente informações — se não souber, busque na base de conhecimento ou pergunte ao cliente
3. Use RESPOND para enviar a resposta final ao cliente
4. Use ESCALATE se o cliente pedir um humano ou se o problema for muito complexo
5. Seja conciso mas completo nas respostas
6. Responda SEMPRE em português brasileiro
7. Se não conseguir resolver em 3 tentativas de busca, escale para humano
8. Pode usar várias ferramentas em sequência antes de responder
9. Mensagens WhatsApp devem ser curtas e diretas — evite parágrafos longos
${CNPJ_INSTRUCTIONS}${ATTACHMENT_INSTRUCTIONS}
## CONTEXTO ATUAL:
- Canal: WhatsApp
- Cliente: ${clientName}`;

  if (historyContext) {
    prompt += `\n\n## HISTÓRICO RECENTE:\n${historyContext}`;
  }

  return prompt;
}

// ─── Email system prompt builder ─────────────────────────────────────────────

function buildEmailSystemPrompt(
  persona: string,
  clientName: string,
  historyContext: string,
  emailSignature: string | null
): string {
  let prompt = `# Assistente de Atendimento - MendesERP (Email)

${persona}

## SUAS FERRAMENTAS DISPONÍVEIS:
- SEARCH_DOCUMENTS(query): Busca informações na base de conhecimento da empresa
- GET_CLIENT_INFO(): Retorna dados do cliente vinculado ao ticket (financeiro, tickets anteriores)
- GET_HISTORY(limit?): Retorna histórico de mensagens da conversa (inclui summaries de anexos)
- RESPOND_EMAIL(subject, message): Envia resposta ao cliente por email (suporta HTML simples)
- ESCALATE(reason): Escala para atendente humano
- CREATE_NOTE(content): Cria nota interna no ticket
- LOOKUP_CLIENT_BY_CNPJ(cnpj): Busca cliente por CNPJ/CPF
- LINK_TICKET_TO_CLIENT(cnpj, contactName?, contactEmail?, contactPhone?): Vincula ticket ao cliente
- READ_ATTACHMENT(attachmentId, query?): Lê conteúdo extraído de um anexo

## REGRAS:
1. SEMPRE consulte a base de conhecimento antes de responder sobre valores, datas, produtos ou serviços
2. NUNCA invente informações — se não souber, busque na base de conhecimento ou pergunte ao cliente
3. Use RESPOND_EMAIL para enviar a resposta final ao cliente (inclua assunto e corpo)
4. Use ESCALATE se o cliente pedir um humano ou se o problema for muito complexo
5. Seja profissional e detalhado nas respostas por email
6. Responda SEMPRE em português brasileiro
7. Se não conseguir resolver em 3 tentativas de busca, escale para humano
8. Pode usar várias ferramentas em sequência antes de responder
9. Emails devem ter tom mais formal que WhatsApp — use saudação e despedida adequadas`;

  if (emailSignature) {
    prompt += `\n10. SEMPRE inclua a seguinte assinatura ao final do email:\n\n${emailSignature}`;
  }

  prompt += `
${CNPJ_INSTRUCTIONS}${ATTACHMENT_INSTRUCTIONS}
## CONTEXTO ATUAL:
- Canal: Email
- Cliente: ${clientName}`;

  if (historyContext) {
    prompt += `\n\n## HISTÓRICO RECENTE:\n${historyContext}`;
  }

  return prompt;
}

// ─── Reclame Aqui system prompt builder ──────────────────────────────────────

function buildReclameAquiSystemPrompt(
  persona: string,
  clientName: string,
  historyContext: string
): string {
  let prompt = `# Assistente de Atendimento - MendesERP (Reclame Aqui)

${persona}

## CONTEXTO CRÍTICO — RECLAME AQUI:
Você está respondendo uma reclamação no Reclame Aqui. Respostas públicas são PERMANENTES e visíveis para TODOS na internet. Nunca exponha dados pessoais em respostas públicas. Siga as regras da Knowledge Base estritamente.

## SUAS FERRAMENTAS DISPONÍVEIS:
- SEARCH_DOCUMENTS(query): Busca informações na base de conhecimento da empresa (prioriza docs específicos do Reclame Aqui)
- GET_CLIENT_INFO(): Retorna dados do cliente vinculado ao ticket (financeiro, tickets anteriores)
- GET_HISTORY(limit?): Retorna histórico de mensagens/interações da reclamação (inclui summaries de anexos)
- RESPOND_RECLAMEAQUI(privateMessage, publicMessage, detectedType, confidence): Gera resposta dual — privada + pública
- ESCALATE(reason): Escala para atendente humano
- CREATE_NOTE(content): Cria nota interna no ticket
- LOOKUP_CLIENT_BY_CNPJ(cnpj): Busca cliente por CNPJ/CPF
- LINK_TICKET_TO_CLIENT(cnpj, contactName?, contactEmail?, contactPhone?): Vincula ticket ao cliente
- READ_ATTACHMENT(attachmentId, query?): Lê conteúdo extraído de um anexo

## REGRAS ESPECÍFICAS RECLAME AQUI:
1. SEMPRE consulte a base de conhecimento ANTES de responder — busque por termos da reclamação
2. NUNCA invente informações — se não souber, busque na base ou escale
3. Use RESPOND_RECLAMEAQUI para gerar DUAS mensagens: privada e pública
4. **MENSAGEM PRIVADA**: Pode conter detalhes específicos, CPF, valores, links de pagamento, instruções detalhadas
5. **MENSAGEM PÚBLICA**: NUNCA inclua CPF, email, telefone, valores financeiros ou dados pessoais. Seja empático, profissional e mostre que a empresa se importa
6. Classifique o tipo da reclamação (detectedType): boleto_nao_solicitado, cobranca_indevida, reembolso, servico_nao_entregue, qualidade_servico, trabalhista, outro
7. Se detectar reclamação trabalhista → SEMPRE classifique como 'trabalhista' (isso ativa moderação)
8. Se detectar palavras como "processo", "advogado", "procon", "judicial", "indenização" → use ESCALATE
9. Responda SEMPRE em português brasileiro
10. Tom público: empático, profissional, sem ser subserviente. Reconheça o problema, demonstre ação concreta
11. Se não conseguir resolver em 3 tentativas de busca, escale para humano

## FORMATO DE CLASSIFICAÇÃO:
- boleto_nao_solicitado: Cliente recebeu boleto/cobrança que não solicitou
- cobranca_indevida: Cobrança em valor errado, duplicada, ou após cancelamento
- reembolso: Pedido de devolução/estorno de valor
- servico_nao_entregue: Serviço contratado mas não realizado/entregue
- qualidade_servico: Problemas com qualidade do serviço prestado
- trabalhista: Questões trabalhistas (ex-funcionários, condições de trabalho)
- outro: Não se encaixa nas categorias acima
${CNPJ_INSTRUCTIONS}${ATTACHMENT_INSTRUCTIONS}
## CONTEXTO ATUAL:
- Canal: Reclame Aqui
- Reclamante: ${clientName}`;

  if (historyContext) {
    prompt += `\n\n## HISTÓRICO DA RECLAMAÇÃO:\n${historyContext}`;
  }

  return prompt;
}
