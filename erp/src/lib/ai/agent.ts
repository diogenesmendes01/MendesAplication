"use server";

import { prisma } from "@/lib/prisma";
import { chatCompletion, getEnvProviderConfig } from "./provider";
import type { AiMessage, ProviderConfig } from "./provider";
import { getToolsForChannel } from "./tools";
import { executeTool } from "./tool-executor";
import type { ToolContext } from "./tool-executor";
import { decrypt } from "@/lib/encryption";
import { getTodaySpend, logUsage } from "./cost-tracker";
import { MODEL_PRICING, FALLBACK_PRICING, DEFAULT_MODELS } from "./pricing";
import { getBrlUsdRateSync } from "./exchange-rate";
import { createChildLogger } from "@/lib/logger";
import type { Logger } from "pino";

// ─── Result types ─────────────────────────────────────────────────────────────

export interface AgentResult {
  responded: boolean;
  escalated: boolean;
  iterations: number;
  error?: string;
}

export interface DryRunResult {
  response: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostBrl: number;
  error?: string;
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
  } = options;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalResponse = "";

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
      };
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
          };
        }

      // ── LLM returned text only (no tool calls) ─────────────────────────
      } else if (response.content) {
        if (!dryRun) {
          log.info({ iteration: iteration + 1 }, "Direct text response from LLM");
          const respondTool =
            toolContext.channel === "EMAIL" ? "RESPOND_EMAIL" : "RESPOND";
          const respondArgs =
            toolContext.channel === "EMAIL"
              ? { subject: "Re: Atendimento", message: response.content }
              : { message: response.content };
          await executeTool(respondTool, respondArgs, toolContext);
        }

        finalResponse = response.content;
        return {
          responded: true,
          escalated: false,
          iterations: iteration + 1,
          finalResponse,
          totalInputTokens,
          totalOutputTokens,
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
  };
}

// ─── Main agent function ─────────────────────────────────────────────────────

export async function runAgent(
  ticketId: string,
  companyId: string,
  incomingMessage: string,
  channel: "WHATSAPP" | "EMAIL" = "WHATSAPP"
): Promise<AgentResult> {
  const startTime = Date.now();
  const timeout = parseInt(process.env.AI_TIMEOUT || "30000", 10);

  // Create child logger with traceId for this entire request
  const log = createChildLogger({ companyId, ticketId });

  // Load AI config for the company
  const aiConfig = await prisma.aiConfig.findUnique({
    where: { companyId },
  });

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

  // ── Check daily spend limit ──────────────────────────────────────────────
  if (aiConfig.dailySpendLimitBrl) {
    const todaySpend = await getTodaySpend(companyId);
    if (todaySpend >= Number(aiConfig.dailySpendLimitBrl)) {
      return { responded: false, escalated: false, iterations: 0, error: "daily_spend_limit_reached" };
    }
    // ⚠️ KNOWN LIMITATION — TOCTOU RACE (check-then-act, not atomic):
    // Under concurrent load, multiple requests may pass this check before any
    // logUsage() call completes. In traffic bursts the daily limit can be
    // exceeded by 2–10× depending on concurrency and avg cost per call.
    // A post-logUsage heuristic re-check (see onUsage callback below) amortises
    // the risk but does NOT eliminate it — the LLM call has already been made.
    // TODO: Replace with Redis INCR+EXPIRE atomic counter (see simulationRateMap
    //       TODO). Until then, the limit is best-effort / advisory only.
  }

  // ── Check escalation keywords (fast-path before LLM) ────────────────────
  // Moved here from ai-agent worker to avoid a redundant aiConfig DB query.
  if (aiConfig.escalationKeywords && aiConfig.escalationKeywords.length > 0) {
    const lowerContent = incomingMessage.toLowerCase();
    const matchedKeyword = aiConfig.escalationKeywords.find((keyword) =>
      lowerContent.includes(keyword.toLowerCase())
    );

    if (matchedKeyword) {
      log.info({ keyword: matchedKeyword }, "Escalation keyword detected, escalating without LLM");

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

  const contactPhone = ticket.contact?.whatsapp || ticket.client.telefone;
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

  const clientName = ticket.contact?.name || ticket.client.name;
  const systemPrompt =
    channel === "EMAIL"
      ? buildEmailSystemPrompt(persona, clientName, historyContext, aiConfig.emailSignature)
      : buildWhatsAppSystemPrompt(persona, clientName, historyContext);

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
    onUsage: async (inputTokens, outputTokens) => {
      await logUsage({
        aiConfigId: aiConfig.id,
        companyId,
        provider: providerConfig.provider,
        model: effectiveModel,
        channel,
        inputTokens,
        outputTokens,
        ticketId,
      });
      // ── Heuristic post-logUsage overshoot detection ────────────────────
      // After persisting the usage record, re-check the daily spend. If we
      // exceeded the limit, log a warning so ops teams can detect race-condition
      // overshoots in monitoring dashboards. This does NOT stop the current
      // request (the LLM call is already complete) but helps quantify the
      // TOCTOU exposure. See the KNOWN LIMITATION comment above.
      if (aiConfig.dailySpendLimitBrl) {
        const postCallSpend = await getTodaySpend(companyId);
        if (postCallSpend > Number(aiConfig.dailySpendLimitBrl)) {
          log.warn({ spend: postCallSpend, limit: Number(aiConfig.dailySpendLimitBrl) }, "Daily spend overshoot — TOCTOU race detected");
        }
      }
    },
  });

  return {
    responded: loopResult.responded,
    escalated: loopResult.escalated,
    iterations: loopResult.iterations,
    error: loopResult.error,
  };
}

// ─── Dry-run agent function (simulation mode) ────────────────────────────────

/**
 * Runs the AI agent in dry-run mode for simulation purposes.
 * - Does NOT require a real ticket — uses mock client context
 * - Does NOT save TicketMessage records
 * - Does NOT send real WhatsApp/email messages
 * - Tools RESPOND / RESPOND_EMAIL return the message without side effects
 * - Uses the real persona and knowledge base of the company
 * - Returns the AI response, token usage, and estimated cost
 */
export async function runAgentDryRun(
  companyId: string,
  incomingMessage: string,
  channel: "WHATSAPP" | "EMAIL" = "WHATSAPP"
): Promise<DryRunResult> {
  const startTime = Date.now();
  const timeout = parseInt(process.env.AI_TIMEOUT || "30000", 10);

  // Create child logger with traceId for this dry-run request
  const log = createChildLogger({ companyId, ticketId: "simulation" });

  const aiConfig = await prisma.aiConfig.findUnique({
    where: { companyId },
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

  // ── Escalation keyword fast-path (mirrors runAgent behaviour) ────────────
  // Without this check the dry-run would call the LLM even when the production
  // path would have escalated immediately, producing misleading simulation
  // results and unnecessary token costs.
  if (aiConfig.escalationKeywords && aiConfig.escalationKeywords.length > 0) {
    const lowerContent = incomingMessage.toLowerCase();
    const matchedKeyword = aiConfig.escalationKeywords.find((keyword) =>
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
  const systemPrompt =
    channel === "EMAIL"
      ? buildEmailSystemPrompt(persona, mockClientName, "", aiConfig.emailSignature)
      : buildWhatsAppSystemPrompt(persona, mockClientName, "");

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
    // Log simulation token usage for internal/technical DB audit (isSimulation=true).
    // NOT visible in the "Consumo de IA" tab — getUsageSummary() filters isSimulation: false.
    // NOT counted against the daily budget — getTodaySpend() also filters isSimulation: false.
    // Admin tests must not silently exhaust the company's limit.
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
- GET_HISTORY(limit?): Retorna histórico de mensagens da conversa
- RESPOND(message): Envia resposta ao cliente via WhatsApp
- ESCALATE(reason): Escala para atendente humano
- CREATE_NOTE(content): Cria nota interna no ticket

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
- GET_HISTORY(limit?): Retorna histórico de mensagens da conversa
- RESPOND_EMAIL(subject, message): Envia resposta ao cliente por email (suporta HTML simples)
- ESCALATE(reason): Escala para atendente humano
- CREATE_NOTE(content): Cria nota interna no ticket

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

  prompt += `\n\n## CONTEXTO ATUAL:
- Canal: Email
- Cliente: ${clientName}`;

  if (historyContext) {
    prompt += `\n\n## HISTÓRICO RECENTE:\n${historyContext}`;
  }

  return prompt;
}
