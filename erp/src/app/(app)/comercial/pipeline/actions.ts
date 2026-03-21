"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStage =
  | "DRAFT"
  | "SENT"
  | "ACCEPTED"
  | "BOLETO_GENERATED"
  | "PAID";

export interface PipelineCard {
  id: string;
  clientName: string;
  totalValue: string;
  createdAt: string;
}

export interface PipelineColumn {
  stage: PipelineStage;
  label: string;
  cards: PipelineCard[];
  total: string;
  count: number;
}

export interface PipelineData {
  columns: PipelineColumn[];
  conversionRate: number;
}

export interface PipelineFilters {
  companyId: string;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  valueMin?: number;
  valueMax?: number;
}

export interface ClientOption {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function listPipelineData(
  filters: PipelineFilters
): Promise<PipelineData> {
  await requireCompanyAccess(filters.companyId);

  const where: Prisma.ProposalWhereInput = {
    companyId: filters.companyId,
    // Exclude terminal negative states from pipeline
    status: { notIn: ["REJECTED", "EXPIRED"] },
  };

  if (filters.clientId) {
    where.clientId = filters.clientId;
  }

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) {
      where.createdAt.gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  if (filters.valueMin !== undefined || filters.valueMax !== undefined) {
    where.totalValue = {};
    if (filters.valueMin !== undefined) {
      where.totalValue.gte = new Decimal(filters.valueMin);
    }
    if (filters.valueMax !== undefined) {
      where.totalValue.lte = new Decimal(filters.valueMax);
    }
  }

  const proposals = await prisma.proposal.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      boletos: { select: { status: true } },
    },
  });

  // Classify proposals into pipeline stages
  const groups: Record<PipelineStage, PipelineCard[]> = {
    DRAFT: [],
    SENT: [],
    ACCEPTED: [],
    BOLETO_GENERATED: [],
    PAID: [],
  };

  for (const p of proposals) {
    const card: PipelineCard = {
      id: p.id,
      clientName: p.client.name,
      totalValue: p.totalValue.toString(),
      createdAt: p.createdAt.toISOString(),
    };

    if (p.status === "DRAFT") {
      groups.DRAFT.push(card);
    } else if (p.status === "SENT") {
      groups.SENT.push(card);
    } else if (p.status === "ACCEPTED") {
      if (p.boletos.length === 0) {
        groups.ACCEPTED.push(card);
      } else {
        const allPaid = p.boletos.every((b) => b.status === "PAID");
        if (allPaid) {
          groups.PAID.push(card);
        } else {
          groups.BOLETO_GENERATED.push(card);
        }
      }
    }
  }

  const stageLabels: Record<PipelineStage, string> = {
    DRAFT: "Rascunho",
    SENT: "Enviada",
    ACCEPTED: "Aceita",
    BOLETO_GENERATED: "Boleto Gerado",
    PAID: "Pago",
  };

  const columns: PipelineColumn[] = (
    ["DRAFT", "SENT", "ACCEPTED", "BOLETO_GENERATED", "PAID"] as PipelineStage[]
  ).map((stage) => {
    const cards = groups[stage];
    const total = cards.reduce(
      (sum, c) => sum + parseFloat(c.totalValue),
      0
    );
    return {
      stage,
      label: stageLabels[stage],
      cards,
      total: total.toFixed(2),
      count: cards.length,
    };
  });

  // Conversion rate: proposals that reached PAID / total proposals
  const totalProposals = proposals.length;
  const paidCount = groups.PAID.length;
  const conversionRate =
    totalProposals > 0 ? (paidCount / totalProposals) * 100 : 0;

  return { columns, conversionRate };
}

export async function listClientsForPipeline(
  companyId: string
): Promise<ClientOption[]> {
  await requireCompanyAccess(companyId);

  const clients = await prisma.client.findMany({
    where: { companyId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return clients;
}
