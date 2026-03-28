import { prisma } from "@/lib/prisma";
import type {
  StepType,
  StepResult,
  ChannelName,
  CollectInfoConfig,
  SearchConfig,
  UpdateConfig,
  RespondConfig,
  WaitConfig,
  SendAttachmentConfig,
  SetTagConfig,
  ConditionConfig,
  EscalateConfig,
  StepConfig,
} from "./workflow-types";

// ─── Variable interpolation ──────────────────────────────────────────────────

export function interpolate(template: string, stepData: Record<string, unknown>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    const parts = key.split(".");
    let value: unknown = stepData;
    for (const part of parts) {
      if (value == null || typeof value !== "object") return `\${${key}}`;
      value = (value as Record<string, unknown>)[part];
    }
    return value != null ? String(value) : `\${${key}}`;
  });
}

export function interpolateRecord(
  record: Record<string, string>,
  stepData: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    result[k] = interpolate(v, stepData);
  }
  return result;
}

// ─── Context passed to each block ────────────────────────────────────────────

export interface BlockContext {
  companyId: string;
  ticketId: string;
  channel: ChannelName;
  stepData: Record<string, unknown>;
}

// ─── Block dispatcher ────────────────────────────────────────────────────────

export async function executeBlock(
  tipo: StepType,
  config: StepConfig,
  ctx: BlockContext,
): Promise<StepResult> {
  switch (tipo) {
    case "COLLECT_INFO": return executeCollectInfo(config as CollectInfoConfig, ctx);
    case "SEARCH": return executeSearch(config as SearchConfig, ctx);
    case "UPDATE": return executeUpdate(config as UpdateConfig, ctx);
    case "RESPOND": return executeRespond(config as RespondConfig, ctx);
    case "WAIT": return executeWait(config as WaitConfig, ctx);
    case "SEND_ATTACHMENT": return executeSendAttachment(config as SendAttachmentConfig, ctx);
    case "SET_TAG": return executeSetTag(config as SetTagConfig, ctx);
    case "CONDITION": return executeCondition(config as ConditionConfig, ctx);
    case "ESCALATE": return executeEscalate(config as EscalateConfig, ctx);
    default: return { success: false, error: `Unknown block type: ${tipo}` };
  }
}

// ─── Field validation ─────────────────────────────────────────────────────────

const VALIDATION_PATTERNS: Record<string, { regex: RegExp; message: string }> = {
  cnpj: { regex: /^\d{14}$/, message: "CNPJ deve conter exatamente 14 dígitos numéricos." },
  cpf: { regex: /^\d{11}$/, message: "CPF deve conter exatamente 11 dígitos numéricos." },
  email: { regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Email inválido." },
  telefone: { regex: /^\d{10,11}$/, message: "Telefone deve conter 10 ou 11 dígitos." },
  data: { regex: /^\d{2}\/\d{2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/, message: "Data deve estar no formato DD/MM/AAAA ou AAAA-MM-DD." },
  numero: { regex: /^-?\d+(\.\d+)?$/, message: "Valor deve ser numérico." },
  texto: { regex: /^.{1,1000}$/, message: "Texto deve ter entre 1 e 1000 caracteres." },
};

function validateField(value: string, tipo: string): string | null {
  const stripped = tipo === "cnpj" || tipo === "cpf" || tipo === "telefone" ? value.replace(/\D/g, "") : value;
  const pattern = VALIDATION_PATTERNS[tipo];
  if (!pattern) return null; // unknown validation type — skip
  if (!pattern.regex.test(stripped)) return pattern.message;
  return null;
}

// ─── COLLECT_INFO ────────────────────────────────────────────────────────────

async function executeCollectInfo(config: CollectInfoConfig, ctx: BlockContext): Promise<StepResult> {
  const { campo, obrigatorio, validacao, promptPorCanal } = config;

  if (ctx.stepData[campo] != null) {
    // Validate collected value if validacao is specified
    const value = String(ctx.stepData[campo]);
    const validationError = validacao ? validateField(value, validacao) : null;
    if (validationError) {
      return { success: true, message: validationError, data: { _pendingField: campo, _validationError: validationError } };
    }
    return { success: true, data: { [campo]: ctx.stepData[campo] }, message: `Campo "${campo}" já coletado: ${ctx.stepData[campo]}` };
  }

  const prompt = promptPorCanal?.[ctx.channel] ?? promptPorCanal?.WHATSAPP ?? `Por favor, informe: ${campo}`;

  if (obrigatorio) {
    return { success: true, message: prompt, data: { _pendingField: campo, _prompt: prompt } };
  }

  return { success: true, data: { [campo]: null }, message: `Campo "${campo}" opcional — pulado.` };
}

// ─── SEARCH ──────────────────────────────────────────────────────────────────

const ENTITY_MODEL_MAP: Record<string, string> = {
  boleto: "accountReceivable",
  cliente: "client",
  titulo: "accountReceivable",
  ticket: "ticket",
  refund: "refund",
};

/** Whitelist of Prisma model names allowed for dynamic access */
const ALLOWED_PRISMA_MODELS = new Set(Object.values(ENTITY_MODEL_MAP));

async function executeSearch(config: SearchConfig, ctx: BlockContext): Promise<StepResult> {
  const { entidade, filtro, limiteResultados = 10, ordenacao } = config;
  const modelName = ENTITY_MODEL_MAP[entidade];
  if (!modelName || !ALLOWED_PRISMA_MODELS.has(modelName)) return { success: false, error: `Entidade desconhecida ou não permitida: ${entidade}` };

  const resolvedFilter = interpolateRecord(filtro, ctx.stepData);
  const where: Record<string, unknown> = { companyId: ctx.companyId };

  for (const [key, value] of Object.entries(resolvedFilter)) {
    if (key === "cnpj") {
      if (entidade === "cliente") {
        where.cpfCnpj = value.replace(/\D/g, "");
      } else {
        const client = await prisma.client.findFirst({
          where: { companyId: ctx.companyId, cpfCnpj: value.replace(/\D/g, "") },
          select: { id: true },
        });
        if (client) where.clientId = client.id;
        else return { success: true, data: { total: 0, results: [] }, message: "Cliente não encontrado." };
      }
    } else {
      where[key] = value;
    }
  }

  let orderBy: Record<string, string> | undefined;
  if (ordenacao) {
    const [field, dir] = ordenacao.split(":");
    orderBy = { [field]: dir || "asc" };
  }

  try {
    const model = prisma[modelName as keyof typeof prisma] as unknown as { findMany: (args: unknown) => Promise<unknown[]> };
    const results = await model.findMany({ where, take: limiteResultados, ...(orderBy && { orderBy }) });
    return { success: true, data: { total: results.length, results }, message: `Encontrados ${results.length} resultado(s).` };
  } catch (err) {
    return { success: false, error: `Erro ao buscar ${entidade}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────

async function executeUpdate(config: UpdateConfig, ctx: BlockContext): Promise<StepResult> {
  const { entidade, filtro, campos, requireConfirmation, auditLog = true } = config;
  const modelName = ENTITY_MODEL_MAP[entidade];
  if (!modelName || !ALLOWED_PRISMA_MODELS.has(modelName)) return { success: false, error: `Entidade desconhecida ou não permitida: ${entidade}` };

  // Fix 5: requireConfirmation — pause for human confirmation before writing
  if (requireConfirmation && !ctx.stepData._updateConfirmed) {
    return {
      success: true,
      shouldPause: true,
      data: { waitingFor: "humano", waitingCondition: "Confirmação para atualizar registros", _pendingUpdate: true },
      message: `Atualização requer confirmação humana antes de prosseguir.`,
    };
  }

  const resolvedFilter = interpolateRecord(filtro, ctx.stepData);
  const resolvedCampos: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(campos)) {
    resolvedCampos[k] = typeof v === "string" ? interpolate(v, ctx.stepData) : v;
  }

  const where: Record<string, unknown> = { companyId: ctx.companyId };
  for (const [k, v] of Object.entries(resolvedFilter)) where[k] = v;

  try {
    const model = prisma[modelName as keyof typeof prisma] as unknown as { findMany: (args: unknown) => Promise<unknown[]>; update: (args: unknown) => Promise<unknown> };
    const records = await model.findMany({ where, take: 50 });
    if (records.length === 0) return { success: false, error: `Nenhum registro encontrado.` };

    let updatedCount = 0;
    for (const record of records as { id: string }[]) {
      await model.update({ where: { id: record.id }, data: resolvedCampos });
      updatedCount++;
      if (auditLog) {
        await prisma.auditLog.create({
          data: { userId: "system-workflow", action: "WORKFLOW_UPDATE", entity: entidade, entityId: record.id, dataBefore: record, dataAfter: { ...record, ...resolvedCampos }, companyId: ctx.companyId },
        });
      }
    }
    return { success: true, data: { updatedCount }, message: `${updatedCount} registro(s) atualizado(s).` };
  } catch (err) {
    return { success: false, error: `Erro ao atualizar: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── RESPOND ─────────────────────────────────────────────────────────────────

async function executeRespond(config: RespondConfig, ctx: BlockContext): Promise<StepResult> {
  const { templatePorCanal } = config;
  let message: string;
  const template = templatePorCanal?.[ctx.channel];

  if (template) {
    if (typeof template === "object" && "publico" in template) {
      const publico = interpolate(template.publico, ctx.stepData);
      const privado = interpolate(template.privado, ctx.stepData);
      message = JSON.stringify({ publico, privado });
    } else {
      message = interpolate(template as string, ctx.stepData);
    }
  } else {
    const fallback = templatePorCanal ? Object.values(templatePorCanal)[0] : null;
    message = fallback ? interpolate(typeof fallback === "string" ? fallback : (fallback as Record<string, string>).privado || "", ctx.stepData) : "Processo concluído.";
  }

  return { success: true, message, data: { respondedMessage: message } };
}

// ─── WAIT ────────────────────────────────────────────────────────────────────

async function executeWait(config: WaitConfig, _ctx: BlockContext): Promise<StepResult> {
  return {
    success: true,
    shouldPause: true,
    data: { waitingFor: config.quem, waitingCondition: config.condicao, timeoutHoras: config.timeoutHoras ?? 48 },
    message: `Workflow pausado — aguardando ${config.quem}: ${config.condicao}`,
  };
}

// ─── SEND_ATTACHMENT ─────────────────────────────────────────────────────────

async function executeSendAttachment(config: SendAttachmentConfig, ctx: BlockContext): Promise<StepResult> {
  const { porCanal, fallbackTexto, source, referenciaStep } = config;
  const channelSupported = porCanal?.[ctx.channel] ?? true;

  if (!channelSupported || ctx.channel === "RECLAMEAQUI") {
    const fallback = fallbackTexto ? interpolate(fallbackTexto, ctx.stepData) : "Anexo não suportado neste canal.";
    return { success: true, message: fallback, data: { skipped: true, reason: "channel_unsupported" } };
  }

  if (source === "busca" && referenciaStep) {
    const refData = ctx.stepData[referenciaStep];
    if (!refData) {
      return { success: true, message: fallbackTexto ? interpolate(fallbackTexto, ctx.stepData) : "Dados não encontrados.", data: { skipped: true } };
    }
  }

  return { success: true, data: { attachmentSent: true, source }, message: "Anexo processado." };
}

// ─── SET_TAG ─────────────────────────────────────────────────────────────────

async function executeSetTag(config: SetTagConfig, ctx: BlockContext): Promise<StepResult> {
  try {
    if (config.alvo === "ticket") {
      const ticket = await prisma.ticket.findUnique({ where: { id: ctx.ticketId }, select: { tags: true, status: true } });
      if (!ticket) return { success: false, error: "Ticket não encontrado." };

      if (config.acao === "adicionar_tag") {
        await prisma.ticket.update({ where: { id: ctx.ticketId }, data: { tags: Array.from(new Set([...ticket.tags, config.valor])) } });
      } else if (config.acao === "remover_tag") {
        await prisma.ticket.update({ where: { id: ctx.ticketId }, data: { tags: ticket.tags.filter((t) => t !== config.valor) } });
      } else if (config.acao === "alterar_status") {
        await prisma.ticket.update({ where: { id: ctx.ticketId }, data: { status: config.valor as unknown as import("@prisma/client").TicketStatus } });
      }
    }
    return { success: true, data: { alvo: config.alvo, acao: config.acao, valor: config.valor }, message: `Tag/status atualizado.` };
  } catch (err) {
    return { success: false, error: `Erro: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── CONDITION ───────────────────────────────────────────────────────────────

export function evaluateCondition(
  config: ConditionConfig,
  stepData: Record<string, unknown>,
): { result: boolean; nextStepId: string } {
  const { se, entao, senao } = config;
  const parts = se.campo.split(".");
  let fieldValue: unknown = stepData;
  for (const part of parts) {
    if (fieldValue == null || typeof fieldValue !== "object") { fieldValue = undefined; break; }
    fieldValue = (fieldValue as Record<string, unknown>)[part];
  }

  let result = false;
  switch (se.operador) {
    case "igual": result = String(fieldValue) === String(se.valor); break;
    case "diferente": result = String(fieldValue) !== String(se.valor); break;
    case "maior": result = Number(fieldValue) > Number(se.valor); break;
    case "menor": result = Number(fieldValue) < Number(se.valor); break;
    case "contem":
      result = typeof fieldValue === "string" && typeof se.valor === "string" ? fieldValue.includes(se.valor)
        : Array.isArray(fieldValue) && fieldValue.includes(se.valor);
      break;
    case "existe": result = fieldValue !== null && fieldValue !== "" && fieldValue !== undefined; break;
    case "nao_existe": result = fieldValue === null || fieldValue === "" || fieldValue === undefined; break;
  }

  return { result, nextStepId: result ? entao : senao };
}

async function executeCondition(config: ConditionConfig, ctx: BlockContext): Promise<StepResult> {
  const { result, nextStepId } = evaluateCondition(config, ctx.stepData);
  return { success: true, nextStepId, data: { conditionResult: result, nextStepId }, message: `Condição: ${result} → ${nextStepId}` };
}

// ─── ESCALATE ────────────────────────────────────────────────────────────────

async function executeEscalate(config: EscalateConfig, ctx: BlockContext): Promise<StepResult> {
  const resolvedMotivo = interpolate(config.motivo, ctx.stepData);
  try {
    await prisma.ticket.update({
      where: { id: ctx.ticketId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { aiEnabled: false, status: "OPEN" as const, ...(config.prioridade && { priority: config.prioridade as any }) },
    });

    const noteContent = config.incluirContexto
      ? `[Workflow Escalation] ${resolvedMotivo}\n\nDados: ${JSON.stringify(ctx.stepData, null, 2)}`
      : `[Workflow Escalation] ${resolvedMotivo}`;

    await prisma.ticketMessage.create({
      data: { ticketId: ctx.ticketId, senderId: null, content: noteContent, isInternal: true, isAiGenerated: true },
    });

    return { success: true, shouldComplete: true, data: { escalated: true, motivo: resolvedMotivo }, message: `Escalado: ${resolvedMotivo}` };
  } catch (err) {
    return { success: false, error: `Erro ao escalar: ${err instanceof Error ? err.message : String(err)}` };
  }
}
