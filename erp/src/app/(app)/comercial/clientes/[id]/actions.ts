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

export type TimelineItemType = "ticket" | "boleto" | "email";

export interface TimelineItem {
  id: string;
  type: TimelineItemType;
  date: string;
  summary: string;
  status: string;
  href: string | null;
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
      },
    });

    for (const m of emailMessages) {
      const preview =
        m.content.length > 80 ? m.content.slice(0, 80) + "…" : m.content;
      items.push({
        id: m.id,
        type: "email",
        date: m.createdAt.toISOString(),
        summary: `Email de ${m.sender.name}: ${preview}`,
        status: "SENT",
        href: `/sac/tickets/${m.ticketId}`,
      });
    }
  }

  // Sort all items by date descending (most recent first)
  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return items;
}
