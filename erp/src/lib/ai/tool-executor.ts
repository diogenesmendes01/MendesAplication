"use server";

import { prisma } from "@/lib/prisma";
import { searchDocuments, searchDocumentsByChannel } from "./embeddings";
import { sendTextMessage } from "@/lib/whatsapp-api";
import { emailOutboundQueue } from "@/lib/queue";
import { sanitizeEmailHtml } from "./sanitize-utils";
import { isValidCnpj } from "./cnpj-utils";

// ─── Context ─────────────────────────────────────────────────────────────────

export interface ToolContext {
  ticketId: string;
  companyId: string;
  clientId: string;
  contactPhone: string; // Digits-only phone for WhatsApp replies
  channel?: "WHATSAPP" | "EMAIL" | "RECLAMEAQUI"; // Originating channel — used for audit logs
  dryRun?: boolean;     // When true, tools return results without side effects
  suggestionMode?: boolean; // When true, write tools are intercepted (captured, not executed)
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


// ─── Tool classification for suggestion mode ─────────────────────────────────

/** Tools that only read data — always execute, even in suggestion mode */
export const READ_ONLY_TOOLS = new Set([
  "SEARCH_DOCUMENTS",
  "GET_CLIENT_INFO",
  "GET_HISTORY",
  "LOOKUP_CLIENT_BY_CNPJ",
  "READ_ATTACHMENT",
]);

/** Tools that write data or send messages — intercepted in suggestion mode */
export const WRITE_TOOLS = new Set([
  "RESPOND",
  "RESPOND_EMAIL",
  "RESPOND_RECLAMEAQUI",
  "ESCALATE",
  "CREATE_NOTE",
  "LINK_TICKET_TO_CLIENT",
]);

export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

/** Returns a simulated result for write tools in suggestion mode */
function executeSuggestionModeTool(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case "RESPOND":
      return `[Sugestão registrada] Mensagem seria enviada ao cliente.`;
    case "RESPOND_EMAIL":
      return `[Sugestão registrada] Email seria enviado ao cliente.`;
    case "RESPOND_RECLAMEAQUI":
      return JSON.stringify({
        privateMessage: args.privateMessage,
        publicMessage: args.publicMessage,
        detectedType: args.detectedType,
        confidence: args.confidence,
      });
    case "ESCALATE":
      return `[Sugestão registrada] Ticket seria escalado. Motivo: ${args.reason}`;
    case "CREATE_NOTE":
      return `[Sugestão registrada] Nota interna seria criada.`;
    case "LINK_TICKET_TO_CLIENT":
      return `[Sugestão registrada] Ticket seria vinculado ao cliente ${args.cnpj}.`;
    default:
      return `[Sugestão registrada] Ação ${toolName} seria executada.`;
  }
}

// ─── Main dispatcher ─────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  // Suggestion mode: read-only tools execute normally, write tools return simulated results
  if (context.suggestionMode && !isReadOnlyTool(toolName)) {
    return executeSuggestionModeTool(toolName, args);
  }

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
      // ─── v2 tools ──────────────────────────────────────────────────────
      case "LOOKUP_CLIENT_BY_CNPJ":
        if (context.dryRun) return executeDryRunLookupClientByCnpj(args);
        return await executeLookupClientByCnpj(args, context);
      case "LINK_TICKET_TO_CLIENT":
        if (context.dryRun) return executeDryRunLinkTicketToClient(args);
        return await executeLinkTicketToClient(args, context);
      case "READ_ATTACHMENT":
        if (context.dryRun) return executeDryRunReadAttachment(args);
        return await executeReadAttachment(args, context);
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
      // v2: include attachments with extraction summaries
      attachments: {
        select: {
          id: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          extraction: {
            select: {
              status: true,
              summary: true,
              metadata: true,
              tokenCount: true,
            },
          },
        },
      },
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

      let line = `[${sender}]: ${m.content.substring(0, 300)}`;

      // v2: inline attachment summaries
      if (m.attachments && m.attachments.length > 0) {
        for (const att of m.attachments) {
          const sizeKb = Math.round(att.fileSize / 1024);

          if (att.extraction?.status === "completed") {
            const summary = att.extraction.summary || "Sem resumo";
            const metadata = (att.extraction.metadata as Record<string, unknown>) || {};

            const metaParts: string[] = [];
            const cnpjs = metadata.cnpjs as string[] | undefined;
            const values = metadata.values as string[] | undefined;
            const dates = metadata.dates as string[] | undefined;

            if (cnpjs?.length) metaParts.push(`CNPJ: ${cnpjs.join(", ")}`);
            if (values?.length) metaParts.push(`Valor: ${values.join(", ")}`);
            if (dates?.length) metaParts.push(`Data: ${dates.join(", ")}`);

            const metaStr = metaParts.length > 0 ? ` | ${metaParts.join(" | ")}` : "";
            line += `\n  📎 ${att.fileName} (${sizeKb}KB) [id:${att.id}] — ${summary}${metaStr}`;
          } else if (att.extraction?.status === "processing") {
            line += `\n  📎 ${att.fileName} (${sizeKb}KB) [id:${att.id}] — [processando...]`;
          } else if (att.extraction?.status === "failed") {
            line += `\n  📎 ${att.fileName} (${sizeKb}KB) [id:${att.id}] — [extracao falhou — peca informacao por texto]`;
          } else {
            line += `\n  📎 ${att.fileName} (${sizeKb}KB) [id:${att.id}] — [aguardando processamento]`;
          }
        }
      }

      return line;
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
  _context: ToolContext
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

// ─── LOOKUP_CLIENT_BY_CNPJ (v2) ─────────────────────────────────────────────

async function executeLookupClientByCnpj(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const rawCnpj = args.cnpj as string;
  if (!rawCnpj) return "Erro: CNPJ/CPF nao fornecido.";

  const cnpj = rawCnpj.replace(/\D/g, "");
  if (cnpj.length !== 11 && cnpj.length !== 14) {
    return "Erro: CNPJ deve ter 14 digitos ou CPF 11 digitos.";
  }

  if (cnpj.length === 14 && !isValidCnpj(cnpj)) {
    return "Erro: CNPJ invalido — digitos verificadores nao conferem.";
  }

  const client = await prisma.client.findFirst({
    where: { cpfCnpj: cnpj, companyId: context.companyId },
    include: {
      additionalContacts: true,
      accountsReceivable: {
        where: { status: { in: ["PENDING", "OVERDUE"] } },
        orderBy: { dueDate: "asc" },
        take: 10,
      },
    },
  });

  if (!client) {
    return `Nenhum cliente encontrado com ${cnpj.length === 14 ? "CNPJ" : "CPF"}: ${cnpj}`;
  }

  const lines: string[] = [
    `Cliente encontrado:`,
    `  ID: ${client.id}`,
    `  Nome: ${client.name}`,
    `  Razao Social: ${client.razaoSocial || "—"}`,
    `  CPF/CNPJ: ${client.cpfCnpj}`,
    `  Email: ${client.email || "—"}`,
    `  Telefone: ${client.telefone || "—"}`,
    `  Tipo: ${client.type}`,
  ];

  if (client.additionalContacts.length > 0) {
    lines.push(`\nContatos adicionais (${client.additionalContacts.length}):`);
    for (const c of client.additionalContacts) {
      lines.push(
        `  - ${c.name} (${c.role || "sem cargo"}) | Email: ${c.email || "—"} | WhatsApp: ${c.whatsapp || "—"}`
      );
    }
  }

  if (client.accountsReceivable.length > 0) {
    const total = client.accountsReceivable.reduce(
      (s, ar) => s + Number(ar.value),
      0
    );
    lines.push(
      `\nTitulos pendentes/vencidos: ${client.accountsReceivable.length} (R$ ${total.toFixed(2)})`
    );
    for (const ar of client.accountsReceivable.slice(0, 5)) {
      const status = ar.status === "OVERDUE" ? "⚠️ VENCIDO" : "Pendente";
      lines.push(
        `  - ${ar.description}: R$ ${Number(ar.value).toFixed(2)} (venc: ${formatDate(ar.dueDate)}) [${status}]`
      );
    }
  }

  return lines.join("\n");
}

// ─── LINK_TICKET_TO_CLIENT (v2) ──────────────────────────────────────────────

async function executeLinkTicketToClient(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const cnpj = (args.cnpj as string)?.replace(/\D/g, "");
  if (!cnpj || (cnpj.length !== 11 && cnpj.length !== 14)) {
    return "Erro: CNPJ (14 digitos) ou CPF (11 digitos) invalido.";
  }

  if (cnpj.length === 14 && !isValidCnpj(cnpj)) {
    return "Erro: CNPJ invalido — digitos verificadores nao conferem.";
  }

  // Find client
  let client = await prisma.client.findFirst({
    where: { cpfCnpj: cnpj, companyId: context.companyId },
    include: { additionalContacts: true },
  });

  // Create if not found
  if (!client) {
    const contactName = args.contactName as string;
    client = await prisma.client.create({
      data: {
        name: contactName || `Empresa ${cnpj}`,
        cpfCnpj: cnpj,
        type: cnpj.length === 14 ? "PJ" : "PF",
        companyId: context.companyId,
        email: (args.contactEmail as string) || undefined,
        telefone: (args.contactPhone as string) || undefined,
      },
      include: { additionalContacts: true },
    });
  }

  // Link ticket to client
  const currentTicket = await prisma.ticket.findUnique({
    where: { id: context.ticketId },
    select: { clientId: true },
  });

  const oldClientId = currentTicket?.clientId;

  await prisma.ticket.update({
    where: { id: context.ticketId },
    data: { clientId: client.id },
  });

  // Create AdditionalContact if contact data provided and not existing
  let contactCreated = false;
  const contactName = args.contactName as string;
  const contactEmail = args.contactEmail as string;
  const contactPhone = args.contactPhone as string;

  if (contactName || contactEmail || contactPhone) {
    const existingContact = client.additionalContacts.find(
      (c) =>
        (contactEmail && c.email === contactEmail) ||
        (contactPhone && c.whatsapp === contactPhone)
    );

    if (!existingContact && (contactName || contactEmail)) {
      await prisma.additionalContact.create({
        data: {
          clientId: client.id,
          name: contactName || contactEmail || contactPhone || "Contato",
          email: contactEmail || undefined,
          whatsapp: contactPhone || undefined,
        },
      });
      contactCreated = true;
    }
  }

  // Clean up orphan "unknown" client if it was the previous one
  if (oldClientId && oldClientId !== client.id) {
    const oldClient = await prisma.client.findUnique({
      where: { id: oldClientId },
      select: { cpfCnpj: true, _count: { select: { tickets: true } } },
    });
    if (
      oldClient?.cpfCnpj === "00000000000" &&
      oldClient._count.tickets <= 1
    ) {
      await prisma.client.delete({ where: { id: oldClientId } });
    }
  }

  const parts = [
    `Ticket vinculado ao cliente "${client.name}" (${client.cpfCnpj}).`,
  ];
  if (contactCreated) parts.push(`Novo contato adicional criado.`);
  return parts.join(" ");
}

// ─── READ_ATTACHMENT (v2) ────────────────────────────────────────────────────

async function executeReadAttachment(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const attachmentId = args.attachmentId as string;
  if (!attachmentId) return "Erro: attachmentId nao fornecido.";

  const extraction = await prisma.attachmentExtraction.findUnique({
    where: { attachmentId },
    include: {
      attachment: {
        select: {
          fileName: true,
          mimeType: true,
          ticketId: true,
          ticketMessage: { select: { ticketId: true } },
        },
      },
    },
  });

  if (!extraction) {
    return "Anexo nao encontrado ou ainda nao processado. Tente novamente em alguns segundos.";
  }

  if (extraction.status === "processing") {
    return "Anexo ainda esta sendo processado. Tente novamente em alguns segundos.";
  }

  if (extraction.status === "failed") {
    return `Nao foi possivel extrair o conteudo deste anexo (${extraction.errorMessage || "erro desconhecido"}). Peca ao cliente para enviar a informacao por texto.`;
  }

  // Security: verify attachment belongs to a ticket in the same company
  const ticketId =
    extraction.attachment.ticketId ||
    extraction.attachment.ticketMessage?.ticketId;
  if (ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { companyId: true },
    });
    if (ticket?.companyId !== context.companyId) {
      return "Erro: anexo nao pertence a esta empresa.";
    }
  } else {
    // No ticket linked — cannot verify tenant ownership; block cross-tenant reads
    return "Erro: anexo nao esta vinculado a nenhum ticket. Nao e possivel verificar permissao.";
  }

  const query = args.query as string;

  if (!query) {
    // Return full text
    if (extraction.tokenCount > 5000) {
      return `⚠️ Anexo grande (${extraction.tokenCount} tokens). Considere usar query para busca especifica.\n\n---\n\n${extraction.rawText}`;
    }
    return extraction.rawText || "Anexo sem conteudo de texto extraido.";
  }

  // Query-based search — simple keyword match with context window
  const lines = extraction.rawText.split("\n");
  const queryLower = query.toLowerCase();
  const relevantLineIndices = new Set<number>();
  const contextWindow = 3;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(queryLower)) {
      const start = Math.max(0, i - contextWindow);
      const end = Math.min(lines.length - 1, i + contextWindow);
      for (let j = start; j <= end; j++) {
        relevantLineIndices.add(j);
      }
    }
  }

  if (relevantLineIndices.size === 0) {
    return `Nenhum trecho encontrado para "${query}" neste anexo. O documento contem ${extraction.tokenCount} tokens. Tente outra busca ou chame sem query para ver o texto completo.`;
  }

  const relevantLines = [...relevantLineIndices].sort((a, b) => a - b).map((i) => lines[i]);
  return `Trechos relevantes para "${query}" em ${extraction.attachment.fileName}:\n\n${relevantLines.join("\n")}`;
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

// ─── v2 dry-run implementations ──────────────────────────────────────────────

function executeDryRunLookupClientByCnpj(args: Record<string, unknown>): string {
  const rawCnpj = args.cnpj as string;
  if (!rawCnpj) return "Erro: CNPJ/CPF nao fornecido.";
  const cnpj = rawCnpj.replace(/\D/g, "");
  if (cnpj.length !== 11 && cnpj.length !== 14) {
    return "Erro: CNPJ deve ter 14 digitos ou CPF 11 digitos.";
  }
  if (cnpj.length === 14 && !isValidCnpj(cnpj)) {
    return "Erro: CNPJ invalido — digitos verificadores nao conferem.";
  }
  return [
    `[SIMULAÇÃO] Busca por ${cnpj.length === 14 ? "CNPJ" : "CPF"}: ${cnpj}`,
    "Cliente encontrado:",
    "  ID: sim_client_001",
    "  Nome: Empresa Simulação Ltda",
    `  CPF/CNPJ: ${cnpj}`,
    "  Tipo: PJ",
  ].join("\n");
}

function executeDryRunLinkTicketToClient(args: Record<string, unknown>): string {
  const cnpj = (args.cnpj as string)?.replace(/\D/g, "");
  if (!cnpj || (cnpj.length !== 11 && cnpj.length !== 14)) {
    return "Erro: CNPJ (14 digitos) ou CPF (11 digitos) invalido.";
  }
  if (cnpj.length === 14 && !isValidCnpj(cnpj)) {
    return "Erro: CNPJ invalido — digitos verificadores nao conferem.";
  }
  return `[SIMULAÇÃO] Ticket seria vinculado ao cliente com ${cnpj.length === 14 ? "CNPJ" : "CPF"}: ${cnpj}`;
}

function executeDryRunReadAttachment(args: Record<string, unknown>): string {
  const attachmentId = args.attachmentId as string;
  if (!attachmentId) return "Erro: attachmentId nao fornecido.";
  const query = args.query as string;
  if (query) {
    return `[SIMULAÇÃO] Busca por "${query}" no anexo ${attachmentId}: Nenhum conteudo disponivel em modo simulacao.`;
  }
  return `[SIMULAÇÃO] Conteudo do anexo ${attachmentId}: Nenhum conteudo disponivel em modo simulacao.`;
}
