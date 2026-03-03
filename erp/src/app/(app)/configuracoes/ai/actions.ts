"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiConfigData {
  enabled: boolean;
  persona: string;
  welcomeMessage: string;
  escalationKeywords: string[];
  maxIterations: number;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function getAiConfig(companyId: string): Promise<AiConfigData> {
  await requireCompanyAccess(companyId);

  const config = await prisma.aiConfig.findUnique({
    where: { companyId },
  });

  if (!config) {
    return {
      enabled: false,
      persona: "",
      welcomeMessage: "",
      escalationKeywords: [],
      maxIterations: 5,
    };
  }

  return {
    enabled: config.enabled,
    persona: config.persona,
    welcomeMessage: config.welcomeMessage ?? "",
    escalationKeywords: config.escalationKeywords,
    maxIterations: config.maxIterations,
  };
}

export async function updateAiConfig(
  companyId: string,
  data: AiConfigData
): Promise<void> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);

  await prisma.aiConfig.upsert({
    where: { companyId },
    create: {
      companyId,
      enabled: data.enabled,
      persona: data.persona,
      welcomeMessage: data.welcomeMessage || null,
      escalationKeywords: data.escalationKeywords,
      maxIterations: data.maxIterations,
    },
    update: {
      enabled: data.enabled,
      persona: data.persona,
      welcomeMessage: data.welcomeMessage || null,
      escalationKeywords: data.escalationKeywords,
      maxIterations: data.maxIterations,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "AiConfig",
    entityId: companyId,
    dataAfter: data as unknown as Prisma.InputJsonValue,
    companyId,
  });
}
