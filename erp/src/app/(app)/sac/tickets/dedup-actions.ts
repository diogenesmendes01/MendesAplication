"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { sseBus } from "@/lib/sse";
import { logger } from "@/lib/logger";
import type { ChannelType } from "@prisma/client";

export interface TicketLinkRow {
  id: string;
  ticketAId: string;
  ticketBId: string;
  type: string;
  confidence: number;
  status: string;
  detectedBy: string;
  confirmedBy: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  linkedTicket: {
    id: string;
    subject: string;
    status: string;
    channelType: ChannelType | null;
    createdAt: string;
  };
}

export async function getLinkedTickets(ticketId: string, companyId: string): Promise<TicketLinkRow[]> {
  await requireCompanyAccess(companyId);
  const links = await prisma.ticketLink.findMany({
    where: { OR: [{ ticketAId: ticketId }, { ticketBId: ticketId }], status: { not: "rejected" } },
    include: {
      ticketA: { select: { id: true, subject: true, status: true, channel: { select: { type: true } }, createdAt: true } },
      ticketB: { select: { id: true, subject: true, status: true, channel: { select: { type: true } }, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return links.map((link) => {
    const isA = link.ticketAId === ticketId;
    const other = isA ? link.ticketB : link.ticketA;
    return {
      id: link.id, ticketAId: link.ticketAId, ticketBId: link.ticketBId,
      type: link.type, confidence: link.confidence, status: link.status,
      detectedBy: link.detectedBy, confirmedBy: link.confirmedBy,
      metadata: link.metadata as Record<string, unknown> | null,
      createdAt: link.createdAt.toISOString(),
      linkedTicket: {
        id: other.id, subject: other.subject, status: other.status,
        channelType: other.channel?.type ?? null, createdAt: other.createdAt.toISOString(),
      },
    };
  });
}

export async function linkTickets(ticketAId: string, ticketBId: string, type: "DUPLICATE" | "RELATED" | "PARENT_CHILD", companyId: string): Promise<{ id: string }> {
  const session = await requireCompanyAccess(companyId);
  const [tA, tB] = await Promise.all([
    prisma.ticket.findFirst({ where: { id: ticketAId, companyId }, select: { id: true } }),
    prisma.ticket.findFirst({ where: { id: ticketBId, companyId }, select: { id: true } }),
  ]);
  if (!tA || !tB) throw new Error("Um ou ambos os tickets nao encontrados");
  const [sortedA, sortedB] = ticketAId < ticketBId ? [ticketAId, ticketBId] : [ticketBId, ticketAId];
  const existing = await prisma.ticketLink.findUnique({ where: { ticketAId_ticketBId: { ticketAId: sortedA, ticketBId: sortedB } } });
  if (existing) {
    if (existing.status === "rejected") {
      await prisma.ticketLink.update({ where: { id: existing.id }, data: { type, status: "confirmed", confirmedBy: session.userId, detectedBy: session.userId } });
    }
    return { id: existing.id };
  }
  const link = await prisma.ticketLink.create({
    data: { ticketAId: sortedA, ticketBId: sortedB, type, confidence: 1.0, detectedBy: session.userId, confirmedBy: session.userId, status: "confirmed" },
  });
  await logAuditEvent({ userId: session.userId, action: "CREATE", entity: "TicketLink", entityId: link.id, companyId, dataAfter: { ticketAId: sortedA, ticketBId: sortedB, type } });
  return { id: link.id };
}

export async function confirmLink(linkId: string, companyId: string): Promise<void> {
  const session = await requireCompanyAccess(companyId);
  const link = await prisma.ticketLink.findUnique({ where: { id: linkId }, include: { ticketA: { select: { companyId: true } } } });
  if (!link || link.ticketA.companyId !== companyId) throw new Error("Link nao encontrado");
  await prisma.ticketLink.update({ where: { id: linkId }, data: { status: "confirmed", confirmedBy: session.userId } });
}

export async function rejectLink(linkId: string, companyId: string): Promise<void> {
  const session = await requireCompanyAccess(companyId);
  const link = await prisma.ticketLink.findUnique({ where: { id: linkId }, include: { ticketA: { select: { companyId: true } } } });
  if (!link || link.ticketA.companyId !== companyId) throw new Error("Link nao encontrado");
  await prisma.ticketLink.update({ where: { id: linkId }, data: { status: "rejected", confirmedBy: session.userId } });
}

export async function unlinkTickets(linkId: string, companyId: string): Promise<void> {
  const session = await requireCompanyAccess(companyId);
  const link = await prisma.ticketLink.findUnique({ where: { id: linkId }, include: { ticketA: { select: { companyId: true } } } });
  if (!link || link.ticketA.companyId !== companyId) throw new Error("Link nao encontrado");
  await prisma.ticketLink.delete({ where: { id: linkId } });
  await logAuditEvent({ userId: session.userId, action: "DELETE", entity: "TicketLink", entityId: linkId, companyId, dataBefore: { ticketAId: link.ticketAId, ticketBId: link.ticketBId, type: link.type } });
}

export async function mergeTickets(primaryTicketId: string, duplicateTicketId: string, companyId: string): Promise<void> {
  const session = await requireCompanyAccess(companyId);
  const [primary, duplicate] = await Promise.all([
    prisma.ticket.findFirst({ where: { id: primaryTicketId, companyId }, include: { channel: { select: { type: true } } } }),
    prisma.ticket.findFirst({ where: { id: duplicateTicketId, companyId }, include: { messages: { orderBy: { createdAt: "asc" } }, channel: { select: { type: true } } } }),
  ]);
  if (!primary || !duplicate) throw new Error("Ticket nao encontrado");
  if (primary.companyId !== duplicate.companyId) throw new Error("Tickets de empresas diferentes");
  if (duplicate.status === "MERGED") throw new Error("Ticket ja foi mergeado");

  await prisma.$transaction(async (tx) => {
    for (const msg of duplicate.messages) {
      await tx.ticketMessage.create({
        data: {
          ticketId: primaryTicketId,
          content: `[Merged de Ticket ${duplicateTicketId} via ${duplicate.channel?.type ?? "UNKNOWN"}]\n${msg.content}`,
          direction: msg.direction, isInternal: true, isAiGenerated: msg.isAiGenerated, origin: "SYSTEM", createdAt: msg.createdAt,
        },
      });
    }
    await tx.attachment.updateMany({ where: { ticketId: duplicateTicketId }, data: { ticketId: primaryTicketId } });
    await tx.ticket.update({ where: { id: duplicateTicketId }, data: { status: "MERGED", mergedIntoId: primaryTicketId, mergedAt: new Date(), aiEnabled: false } });

    const existingLink = await tx.ticketLink.findFirst({ where: { OR: [{ ticketAId: primaryTicketId, ticketBId: duplicateTicketId }, { ticketAId: duplicateTicketId, ticketBId: primaryTicketId }] } });
    if (existingLink) {
      await tx.ticketLink.update({ where: { id: existingLink.id }, data: { status: "confirmed", confirmedBy: session.userId, type: "DUPLICATE" } });
    } else {
      await tx.ticketLink.create({ data: { ticketAId: primaryTicketId, ticketBId: duplicateTicketId, type: "DUPLICATE", confidence: 1.0, detectedBy: session.userId, confirmedBy: session.userId, status: "confirmed" } });
    }

    await tx.ticketMessage.create({
      data: {
        ticketId: primaryTicketId,
        content: `[Sistema] Ticket ${duplicateTicketId} (${duplicate.channel?.type ?? "UNKNOWN"}) mergeado neste ticket. ${duplicate.messages.length} mensagens importadas.`,
        isInternal: true, direction: "OUTBOUND", origin: "SYSTEM",
      },
    });

    await tx.auditLog.create({
      data: { userId: session.userId, action: "STATUS_CHANGE", entity: "Ticket", entityId: primaryTicketId, companyId, dataAfter: { mergedTicketId: duplicateTicketId, messagesImported: duplicate.messages.length } },
    });
  });

  sseBus.publish(`sac:${companyId}`, "ticket-merged", { primaryId: primaryTicketId, duplicateId: duplicateTicketId });
  logger.info({ primaryTicketId, duplicateTicketId }, "[dedup] Tickets merged");
}
