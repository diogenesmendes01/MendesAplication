"use server";

import { prisma } from "@/lib/prisma";
import { searchDocuments } from "./embeddings";
import { sendTextMessage } from "@/lib/whatsapp-api";

// ─── Context ─────────────────────────────────────────────────────────────────

export interface ToolContext {
  ticketId: string;
  companyId: string;
  clientId: string;
  contactPhone: string; // Digits-only phone for WhatsApp replies
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
        return await executeGetClientInfo(context);
      case "GET_HISTORY":
        return await executeGetHistory(args, context);
      case "RESPOND":
        return await executeRespond(args, context);
      case "ESCALATE":
        return await executeEscalate(args, context);
      case "CREATE_NOTE":
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

  const results = await searchDocuments(query, context.companyId);

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
      channel: "WHATSAPP",
      direction: "OUTBOUND",
      origin: "SYSTEM",
      isAiGenerated: true,
    },
  });

  return `Mensagem enviada ao cliente com sucesso.`;
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
      channel: "WHATSAPP",
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
