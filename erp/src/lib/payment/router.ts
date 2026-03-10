import { prisma } from "@/lib/prisma";
import type { PaymentProvider, PaymentRoutingRule } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoutingContext {
  clientType: "PF" | "PJ";
  value: number;
  tags?: string[];
}

interface RoutingPreview {
  providerId: string;
  providerName: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// resolveProvider — main routing engine
// ---------------------------------------------------------------------------

/**
 * Resolve qual provider usar para uma cobrança.
 *
 * 1. Busca todas as regras ativas da empresa, ordenadas por priority ASC
 * 2. Avalia cada regra: clientType, minValue, maxValue, tags
 * 3. Primeira que casa → retorna o provider
 * 4. Nenhuma casou → retorna o provider com isDefault=true
 * 5. Sem default → throw Error
 */
export async function resolveProvider(
  companyId: string,
  context: RoutingContext,
): Promise<PaymentProvider> {
  const rules = await prisma.paymentRoutingRule.findMany({
    where: {
      isActive: true,
      provider: {
        companyId,
        isActive: true,
      },
    },
    orderBy: { priority: "asc" },
    include: { provider: true },
  });

  for (const rule of rules) {
    if (matchesRule(rule, context)) {
      return rule.provider;
    }
  }

  // No rule matched — fall back to default provider
  const defaultProvider = await prisma.paymentProvider.findFirst({
    where: {
      companyId,
      isActive: true,
      isDefault: true,
    },
  });

  if (defaultProvider) {
    return defaultProvider;
  }

  throw new Error(
    "Nenhuma regra de roteamento casou e não há provider padrão configurado. " +
      "Configure um banco padrão em Configurações → Integrações Bancárias.",
  );
}

// ---------------------------------------------------------------------------
// getProviderById — manual override validation
// ---------------------------------------------------------------------------

/**
 * Retorna provider específico (override manual).
 * Valida que pertence à empresa e está ativo.
 */
export async function getProviderById(
  companyId: string,
  providerId: string,
): Promise<PaymentProvider> {
  const provider = await prisma.paymentProvider.findFirst({
    where: {
      id: providerId,
      companyId,
      isActive: true,
    },
  });

  if (!provider) {
    throw new Error(
      `Provider "${providerId}" não encontrado, não pertence à empresa ou está inativo.`,
    );
  }

  return provider;
}

// ---------------------------------------------------------------------------
// previewRouting — lightweight preview for frontend
// ---------------------------------------------------------------------------

/**
 * Retorna qual provider SERIA usado (preview, sem gerar nada).
 * Usado pelo frontend pra mostrar "Automático (Pagar.me)" no dropdown.
 * Returns null if no provider can be resolved.
 */
export async function previewRouting(
  companyId: string,
  context: RoutingContext,
): Promise<RoutingPreview | null> {
  const rules = await prisma.paymentRoutingRule.findMany({
    where: {
      isActive: true,
      provider: {
        companyId,
        isActive: true,
      },
    },
    orderBy: { priority: "asc" },
    include: { provider: true },
  });

  for (const rule of rules) {
    if (matchesRule(rule, context)) {
      return {
        providerId: rule.provider.id,
        providerName: rule.provider.name,
        reason: buildReason(rule),
      };
    }
  }

  // No rule matched — check for default
  const defaultProvider = await prisma.paymentProvider.findFirst({
    where: {
      companyId,
      isActive: true,
      isDefault: true,
    },
  });

  if (defaultProvider) {
    return {
      providerId: defaultProvider.id,
      providerName: defaultProvider.name,
      reason: "Provider padrão (nenhuma regra específica casou)",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function matchesRule(
  rule: PaymentRoutingRule,
  context: RoutingContext,
): boolean {
  // clientType: null = match any
  if (rule.clientType !== null && rule.clientType !== context.clientType) {
    return false;
  }

  // minValue: null = no minimum
  if (rule.minValue !== null && context.value < Number(rule.minValue)) {
    return false;
  }

  // maxValue: null = no maximum
  if (rule.maxValue !== null && context.value > Number(rule.maxValue)) {
    return false;
  }

  // tags: all rule tags must be present in context (AND logic)
  if (rule.tags.length > 0) {
    const contextTags = context.tags ?? [];
    const allPresent = rule.tags.every((tag) => contextTags.includes(tag));
    if (!allPresent) {
      return false;
    }
  }

  return true;
}

function buildReason(rule: PaymentRoutingRule): string {
  const parts: string[] = [];

  if (rule.clientType !== null) {
    parts.push(`cliente ${rule.clientType}`);
  }

  if (rule.minValue !== null || rule.maxValue !== null) {
    const min = rule.minValue !== null ? `R$ ${Number(rule.minValue).toFixed(2)}` : "0";
    const max = rule.maxValue !== null ? `R$ ${Number(rule.maxValue).toFixed(2)}` : "∞";
    parts.push(`valor ${min}–${max}`);
  }

  if (rule.tags.length > 0) {
    parts.push(`tags: ${rule.tags.join(", ")}`);
  }

  if (parts.length === 0) {
    return `Regra prioridade ${rule.priority} (match geral)`;
  }

  return `Regra prioridade ${rule.priority}: ${parts.join(", ")}`;
}
