"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientDetail {
  id: string;
  name: string;
  razaoSocial: string | null;
  cpfCnpj: string;
  email: string | null;
  telefone: string | null;
  endereco: string | null;
  type: string;
  createdAt: string;
}

export type TimelineItemType = "ticket" | "boleto" | "email" | "whatsapp";

export interface TimelineItem {
  id: string;
  type: TimelineItemType;
  date: string;
  summary: string;
  status: string;
  href: string | null;
  contactName: string | null;
  contactRole: string | null;
  hasRefund: boolean;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function getClientById(
  clientId: string,
  companyId: string
): Promise<ClientDetail> {
  await requireCompanyAccess(companyId);

  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
  });

  if (!client) {
    throw new Error("Cliente não encontrado");
  }

  return {
    id: client.id,
    name: client.name,
    razaoSocial: client.razaoSocial,
    cpfCnpj: client.cpfCnpj,
    email: client.email,
    telefone: client.telefone,
    endereco: client.endereco,
    type: client.type,
    createdAt: client.createdAt.toISOString(),
  };
}

export async function getClientTimeline(
  clientId: string,
  companyId: string,
  filterType?: TimelineItemType
): Promise<TimelineItem[]> {
  await requireCompanyAccess(companyId);

  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    select: { id: true },
  });

  if (!client) {
    throw new Error("Cliente não encontrado");
  }

  const items: TimelineItem[] = [];

  // --- Tickets ---
  if (!filterType || filterType === "ticket") {
    const tickets = await prisma.ticket.findMany({
      where: { clientId, companyId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
        contact: { select: { name: true, role: true } },
        refunds: { select: { id: true }, take: 1 },
      },
    });

    for (const t of tickets) {
      items.push({
        id: t.id,
        type: "ticket",
        date: t.createdAt.toISOString(),
        summary: t.subject,
        status: t.status,
        href: `/sac/tickets/${t.id}`,
        contactName: t.contact?.name ?? null,
        contactRole: t.contact?.role ?? null,
        hasRefund: t.refunds.length > 0,
      });
    }
  }

  // --- Boletos / Accounts Receivable ---
  if (!filterType || filterType === "boleto") {
    const receivables = await prisma.accountReceivable.findMany({
      where: { clientId, companyId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        description: true,
        value: true,
        dueDate: true,
        status: true,
        createdAt: true,
      },
    });

    const currFmt = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

    for (const r of receivables) {
      items.push({
        id: r.id,
        type: "boleto",
        date: r.createdAt.toISOString(),
        summary: `${r.description} — ${currFmt.format(Number(r.value))}`,
        status: r.status,
        href: `/financeiro/receber`,
        contactName: null,
        contactRole: null,
        hasRefund: false,
      });
    }
  }

  // --- Emails (ticket messages sent via email) ---
  if (!filterType || filterType === "email") {
    const emailMessages = await prisma.ticketMessage.findMany({
      where: {
        sentViaEmail: true,
        ticket: { clientId, companyId },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        content: true,
        createdAt: true,
        ticketId: true,
        sender: { select: { name: true } },
        contact: { select: { name: true, role: true } },
      },
    });

    for (const m of emailMessages) {
      const preview =
        m.content.length > 80 ? m.content.slice(0, 80) + "…" : m.content;
      const senderName = m.contact?.name ?? m.sender?.name ?? "Desconhecido";
      items.push({
        id: m.id,
        type: "email",
        date: m.createdAt.toISOString(),
        summary: `Email de ${senderName}: ${preview}`,
        status: "SENT",
        href: `/sac/tickets/${m.ticketId}`,
        contactName: m.contact?.name ?? null,
        contactRole: m.contact?.role ?? null,
        hasRefund: false,
      });
    }
  }

  // --- WhatsApp messages ---
  if (!filterType || filterType === "whatsapp") {
    const whatsappMessages = await prisma.ticketMessage.findMany({
      where: {
        channel: "WHATSAPP",
        ticket: { clientId, companyId },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        content: true,
        direction: true,
        createdAt: true,
        ticketId: true,
        sender: { select: { name: true } },
        contact: { select: { name: true, role: true } },
      },
    });

    for (const m of whatsappMessages) {
      const preview =
        m.content.length > 80 ? m.content.slice(0, 80) + "…" : m.content;
      const senderName = m.contact?.name ?? m.sender?.name ?? "Desconhecido";
      const dirLabel = m.direction === "INBOUND" ? "recebida" : "enviada";
      items.push({
        id: m.id,
        type: "whatsapp",
        date: m.createdAt.toISOString(),
        summary: `WhatsApp ${dirLabel} — ${senderName}: ${preview}`,
        status: m.direction === "INBOUND" ? "RECEIVED" : "SENT",
        href: `/sac/tickets/${m.ticketId}`,
        contactName: m.contact?.name ?? null,
        contactRole: m.contact?.role ?? null,
        hasRefund: false,
      });
    }
  }

  // Sort all items by date descending (most recent first)
  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return items;
}
