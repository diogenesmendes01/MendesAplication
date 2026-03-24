"use server";

import { prisma } from "@/lib/prisma";
import { searchDocuments, searchDocumentsByChannel } from "./embeddings";
import { sendTextMessage } from "@/lib/whatsapp-api";
import { emailOutboundQueue } from "@/lib/queue";
import { sanitizeEmailHtml } from "./sanitize-utils";

// ─── Context ─────────────────────────────────────────────────────────────────

export interface ToolContext {
  ticketId: string;
  companyId: string;
  clientId: string;
  contactPhone: string; // Digits-only phone for WhatsApp replies
  channel?: "WHATSAPP" | "EMAIL" | "RECLAMEAQUI"; // Originating channel — used for audit logs
  dryRun?: boolean;     // When true, tools return results without side effects
}

// ─── Reclame Aqui response type ──────────────────────────────────────────────

export interface ReclameAquiResponse {
  privateMessage: string;
  publicMessage: string;
  detectedType: string;
  confidence: number;
  suggestModeration?: boolean;
  moderationReason?: number;
}

// ─── Main dispatcher ─────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  try {
    switch (toolName) {
      case "SEARCH_DOCUMENTS":
        return await executeSearchDocuments(args, context);
      case "GET_CLIENT_INFO":
        if (context.dryRun) return executeDryRunGetClientInfo();
        return await executeGetClientInfo(context);
      case "GET_HISTORY":
        if (context.dryRun) return executeDryRunGetHistory();
        return await executeGetHistory(args, context);
      case "RESPOND":
        if (context.dryRun) return executeDryRunRespond(args);
        return await executeRespond(args, context);
      case "RESPOND_EMAIL":
        if (context.dryRun) return executeDryRunRespondEmail(args);
        return await executeRespondEmail(args, context);
      case "RESPOND_RECLAMEAQUI":
        if (context.dryRun) return executeDryRunRespondReclameAqui(args);
        return await executeRespondReclameAqui(args, context);
      case "ESCALATE":
        if (context.dryRun) return executeDryRunEscalate(args);
        return await executeEscalate(args, context);
      case "CREATE_NOTE":
        if (context.dryRun) return executeDryRunCreateNote(args);
        return await executeCreateNote(args, context);
      default:
        return `Ferramenta "${toolName}" nao disponivel.`;
    }
  } catch (error) {
    return `Erro ao executar ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

// ─── SEARCH_DOCUMENTS ────────────────────────────────────────────────────────

async function executeSearchDocuments(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const query = args.query as string;
  if (!query) return "Erro: query nao fornecida.";

  // SEARCH_DOCUMENTS works the same in dry-run — it reads from the real
  // knowledge base so the simulation accurately reflects actual behaviour.
  // For RECLAMEAQUI, filter to RA-specific + general (null channel) documents.
  const results = context.channel === "RECLAMEAQUI"
    ? await searchDocumentsByChannel(query, context.companyId, "RECLAMEAQUI")
    : await searchDocuments(query, context.companyId);

  if (results.length === 0) {
    return "Nenhum documento relevante encontrado na base de conhecimento.";
  }

  return results
    .map((r) => {
      const similarity = (r.similarity * 100).toFixed(0);
      return `[Documento: ${r.documentName} | Relevancia: ${similarity}%]\n${r.content}`;
    })
    .join("\n\n---\n\n");
}

// ─── GET_CLIENT_INFO ─────────────────────────────────────────────────────────

async function executeGetClientInfo(context: ToolContext): Promise<string> {
  const client = await prisma.client.findUnique({
    where: { id: context.clientId },
    include: {
      accountsReceivable: {
        where: { status: { in: ["PENDING", "OVERDUE"] } },
        orderBy: { dueDate: "asc" },
        take: 10,
      },
      tickets: {
        where: { id: { not: context.ticketId } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          subject: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });

  if (!client) return "Cliente nao encontrado.";

  const info: string[] = [
    `Nome: ${client.name}`,
    `Tipo: ${client.type}`,
    `CPF/CNPJ: ${client.cpfCnpj}`,
    `Email: ${client.email || "Nao informado"}`,
    `Telefone: ${client.telefone || "Nao informado"}`,
    `Endereco: ${client.endereco || "Nao informado"}`,
  ];

  // Financial info — pending receivables
  const pendingReceivables = client.accountsReceivable.filter(
    (ar) => ar.status === "PENDING"
  );
  if (pendingReceivables.length > 0) {
    const total = pendingReceivables.reduce(
      (sum, ar) => sum + Number(ar.value),
      0
    );
    info.push(
      `\nTitulos pendentes: ${pendingReceivables.length} (R$ ${total.toFixed(2)})`
    );
    for (const ar of pendingReceivables.slice(0, 3)) {
      info.push(
        `  - ${ar.description}: R$ ${Number(ar.value).toFixed(2)} (venc: ${formatDate(ar.dueDate)})`
      );
    }
  }

  // Financial info — overdue receivables
  const overdueReceivables = client.accountsReceivable.filter(
    (ar) => ar.status === "OVERDUE"
  );
  if (overdueReceivables.length > 0) {
    const total = overdueReceivables.reduce(
      (sum, ar) => sum + Number(ar.value),
      0
    );
    info.push(
      `\nTitulos vencidos: ${overdueReceivables.length} (R$ ${total.toFixed(2)})`
    );
    for (const ar of overdueReceivables.slice(0, 3)) {
      info.push(
        `  - ${ar.description}: R$ ${Number(ar.value).toFixed(2)} (venc: ${formatDate(ar.dueDate)})`
      );
    }
  }

  // Previous tickets
  if (client.tickets.length > 0) {
    info.push(`\nTickets anteriores:`);
    for (const t of client.tickets) {
      info.push(
        `  - [${t.status}] ${t.subject} (${formatDate(t.createdAt)})`
      );
    }
  }

  return info.join("\n");
}

// ─── GET_HISTORY ─────────────────────────────────────────────────────────────

async function executeGetHistory(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const limit = typeof args.limit === "number" ? args.limit : 20;

  const messages = await prisma.ticketMessage.findMany({
    where: { ticketId: context.ticketId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      direction: true,
      content: true,
      isAiGenerated: true,
      isInternal: true,
      createdAt: true,
    },
  });

  if (messages.length === 0) {
    return "Nenhum historico de mensagens encontrado.";
  }

  return messages
    .reverse()
    .filter((m) => !m.isInternal)
    .map((m) => {
      const sender =
        m.direction === "INBOUND"
          ? "Cliente"
          : m.isAiGenerated
            ? "AI"
            : "Atendente";
      return `[${sender}]: ${m.content.substring(0, 300)}`;
    })
    .join("\n");
}

// ─── RESPOND ─────────────────────────────────────────────────────────────────

async function executeRespond(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const message = args.message as string;
  if (!message) return "Erro: mensagem nao fornecida.";

  // Send via WhatsApp Service
  await sendTextMessage(context.companyId, context.contactPhone, message);

  // Create TicketMessage record
  await prisma.ticketMessage.create({
    data: {
      ticketId: context.ticketId,
      senderId: null,
      content: message,
      channel: context.channel ?? "WHATSAPP",
      direction: "OUTBOUND",
      origin: "SYSTEM",
      isAiGenerated: true,
    },
  });

  return `Mensagem enviada ao cliente com sucesso.`;
}

// ─── HTML Sanitizer ───────────────────────────────────────────────────────────
//
// Strips all HTML tags except a small allow-list, and removes all attributes
// from allowed tags to prevent prompt-injection attacks where inbound email
// content could cause the LLM to emit malicious HTML (tracking pixels,
// phishing links, arbitrary scripts) in outgoing replies.
//
// ─── RESPOND_EMAIL ───────────────────────────────────────────────────────────

async function executeRespondEmail(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  // Strip CRLF to prevent SMTP header injection via LLM-generated subject
  const subject = (args.subject as string)?.replace(/[\r\n]+/g, " ").trim();
  const rawMessage = args.message as string;
  if (!subject) return "Erro: assunto (subject) nao fornecido.";
  if (!rawMessage) return "Erro: mensagem (message) nao fornecida.";

  // Validate body size to prevent oversized emails from overwhelming SMTP/DB
  // See: https://github.com/diogenesmendes01/MendesAplication/issues/102
  const MAX_EMAIL_BODY_BYTES = 100 * 1024; // 100 KB
  if (new TextEncoder().encode(rawMessage).byteLength > MAX_EMAIL_BODY_BYTES) {
    return `Erro: corpo do email excede o limite maximo de 100KB (${Math.round(new TextEncoder().encode(rawMessage).byteLength / 1024)}KB). Reduza o conteudo antes de enviar.`;
  }

  // Sanitize LLM-generated HTML before dispatch to prevent prompt-injection
  // from inbound email content influencing outgoing email markup.
  // See: https://github.com/diogenesmendes01/MendesAplication/issues/103
  const message = sanitizeEmailHtml(rawMessage);

  // Resolve recipient email from ticket -> contact.email or client.email
  const ticket = await prisma.ticket.findUnique({
    where: { id: context.ticketId },
    include: {
      contact: { select: { email: true } },
      client: { select: { email: true } },
    },
  });

  if (!ticket) {
    return "Erro: ticket nao encontrado.";
  }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const recipientEmail = ticket.contact?.email ?? ticket.client?.email ?? null;

  if (!recipientEmail || !EMAIL_REGEX.test(recipientEmail)) {
    return "Erro: nao foi possivel encontrar o email do contato ou cliente vinculado ao ticket. Use ESCALATE para encaminhar a um atendente humano que podera obter o email.";
  }

  // Create TicketMessage record first (email-outbound needs the messageId)
  const ticketMessage = await prisma.ticketMessage.create({
    data: {
      ticketId: context.ticketId,
      senderId: null,
      content: message,
      channel: "EMAIL",
      direction: "OUTBOUND",
      origin: "SYSTEM",
      isAiGenerated: true,
    },
  });

  // Enqueue for email outbound delivery
  await emailOutboundQueue.add("send-email", {
    messageId: ticketMessage.id,
    ticketId: context.ticketId,
    companyId: context.companyId,
    to: recipientEmail,
    subject,
    content: message,
    attachmentIds: [],
  });

  return `Email enfileirado para envio ao destinatario ${recipientEmail} com assunto "${subject}".`;
}

// ─── RESPOND_RECLAMEAQUI ─────────────────────────────────────────────────────

async function executeRespondReclameAqui(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const privateMessage = args.privateMessage as string;
  const publicMessage = args.publicMessage as string;
  const detectedType = args.detectedType as string;
  const confidence = args.confidence as number;

  if (!privateMessage) return "Erro: privateMessage nao fornecida.";
  if (!publicMessage) return "Erro: publicMessage nao fornecida.";
  if (!detectedType) return "Erro: detectedType nao fornecido.";

  const validTypes = [
    "boleto_nao_solicitado",
    "cobranca_indevida",
    "reembolso",
    "servico_nao_entregue",
    "qualidade_servico",
    "trabalhista",
    "outro",
  ];
  if (!validTypes.includes(detectedType)) {
    return `Erro: detectedType invalido. Valores aceitos: ${validTypes.join(", ")}`;
  }

  // Build the dual response payload
  const raResponse: ReclameAquiResponse = {
    privateMessage,
    publicMessage,
    detectedType,
    confidence: typeof confidence === "number" ? Math.min(1, Math.max(0, confidence)) : 0.5,
  };

  // Flag trabalhista complaints for moderation
  if (detectedType === "trabalhista") {
    raResponse.suggestModeration = true;
    raResponse.moderationReason = 16;
  }

  // Store as JSON in content field — the worker (ai-agent.ts) will parse and route
  // The tool does NOT send to RA directly; that's the outbound worker's job.
  // We return the structured response so the agent loop can capture it.
  return JSON.stringify(raResponse);
}

// ─── ESCALATE ────────────────────────────────────────────────────────────────

async function executeEscalate(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const reason = (args.reason as string) || "Solicitacao de atendimento humano";

  // Disable AI on the ticket and set status to OPEN for human attention
  await prisma.ticket.update({
    where: { id: context.ticketId },
    data: {
      aiEnabled: false,
      status: "OPEN",
    },
  });

  // Create internal note about escalation
  await prisma.ticketMessage.create({
    data: {
      ticketId: context.ticketId,
      senderId: null,
      content: `[Escalacao AI] Motivo: ${reason}`,
      channel: context.channel ?? "WHATSAPP",
      direction: "OUTBOUND",
      origin: "SYSTEM",
      isInternal: true,
      isAiGenerated: true,
    },
  });

  return `Ticket escalado para atendente humano. Motivo: ${reason}`;
}

// ─── CREATE_NOTE ─────────────────────────────────────────────────────────────

async function executeCreateNote(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const content = args.content as string;
  if (!content) return "Erro: conteudo da nota nao fornecido.";

  await prisma.ticketMessage.create({
    data: {
      ticketId: context.ticketId,
      senderId: null,
      content,
      isInternal: true,
      isAiGenerated: true,
    },
  });

  return "Nota interna criada com sucesso.";
}

// ─── Dry-run tool implementations ────────────────────────────────────────────
// These return simulated results without any side effects.

function executeDryRunGetClientInfo(): string {
  return [
    "Nome: Cliente Simulação",
    "Tipo: PF",
    "CPF/CNPJ: ***.***.***-**",
    "Email: simulacao@exemplo.com",
    "Telefone: (11) 99999-9999",
    "Endereco: Rua Exemplo, 123 - Campinas/SP",
    "",
    "Titulos pendentes: 0",
    "Titulos vencidos: 0",
    "",
    "Tickets anteriores: nenhum",
  ].join("\n");
}

function executeDryRunGetHistory(): string {
  return "Nenhum historico de mensagens encontrado. (Modo simulação)";
}

function executeDryRunRespond(args: Record<string, unknown>): string {
  const message = args.message as string;
  if (!message) return "Erro: mensagem nao fornecida.";
  return `[SIMULAÇÃO] Mensagem que seria enviada via WhatsApp: "${message}"`;
}

function executeDryRunRespondEmail(args: Record<string, unknown>): string {
  // Strip CRLF to prevent SMTP header injection via LLM-generated subject (consistency with real path)
  const subject = (args.subject as string)?.replace(/[\r\n]+/g, " ").trim();
  const message = args.message as string;
  if (!subject) return "Erro: assunto (subject) nao fornecido.";
  if (!message) return "Erro: mensagem (message) nao fornecida.";
  return `[SIMULAÇÃO] Email que seria enviado — Assunto: "${subject}" | Corpo: "${message}"`;
}

function executeDryRunRespondReclameAqui(args: Record<string, unknown>): string {
  const privateMessage = args.privateMessage as string;
  const publicMessage = args.publicMessage as string;
  const detectedType = args.detectedType as string;
  const confidence = args.confidence as number;

  if (!privateMessage) return "Erro: privateMessage nao fornecida.";
  if (!publicMessage) return "Erro: publicMessage nao fornecida.";

  const raResponse: ReclameAquiResponse = {
    privateMessage,
    publicMessage,
    detectedType: detectedType || "outro",
    confidence: typeof confidence === "number" ? confidence : 0.5,
  };

  if (detectedType === "trabalhista") {
    raResponse.suggestModeration = true;
    raResponse.moderationReason = 16;
  }

  return JSON.stringify(raResponse);
}

function executeDryRunEscalate(args: Record<string, unknown>): string {
  const reason = (args.reason as string) || "Solicitacao de atendimento humano";
  return `[SIMULAÇÃO] Ticket seria escalado para atendente humano. Motivo: ${reason}`;
}

function executeDryRunCreateNote(args: Record<string, unknown>): string {
  const content = args.content as string;
  if (!content) return "Erro: conteudo da nota nao fornecido.";
  return `[SIMULAÇÃO] Nota interna que seria criada: "${content}"`;
}
