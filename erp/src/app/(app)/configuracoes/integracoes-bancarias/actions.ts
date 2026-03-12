"use server";

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { encrypt, decrypt } from "@/lib/encryption";
import { PROVIDER_REGISTRY, getGateway } from "@/lib/payment";
import type { ProviderDefinition } from "@/lib/payment";
import { Prisma } from "@prisma/client";
import type { ClientType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaymentProviderData {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  credentials: Record<string, string>;
  settings: Record<string, string>;
  webhookUrl: string | null;
  webhookSecret: string | null;
  sandbox: boolean;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  rules: RoutingRuleData[];
}

export interface RoutingRuleData {
  id: string;
  priority: number;
  clientType: ClientType | null;
  minValue: number | null;
  maxValue: number | null;
  tags: string[];
  isActive: boolean;
}

export interface SavePaymentProviderInput {
  id?: string;
  name: string;
  provider: string;
  credentials: Record<string, string>;
  settings: Record<string, string>;
  sandbox: boolean;
  isDefault: boolean;
}

export interface SaveRoutingRuleInput {
  priority: number;
  clientType: ClientType | null;
  minValue: number | null;
  maxValue: number | null;
  tags: string[];
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask credential values for password-type fields.
 * Shows only last 4 chars, prefixed with ****
 * Non-password fields are returned as-is.
 */
function maskCredentials(
  credentials: Record<string, string>,
  providerType: string,
): Record<string, string> {
  const definition = PROVIDER_REGISTRY[providerType];
  if (!definition) return credentials;

  const passwordKeys = new Set(
    definition.configSchema
      .filter((f) => f.type === "password")
      .map((f) => f.key),
  );

  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (passwordKeys.has(key) && value) {
      masked[key] =
        value.length > 4
          ? `****${value.slice(-4)}`
          : "****";
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

// ---------------------------------------------------------------------------
// getPaymentProviders — list providers for a company (masked credentials)
// ---------------------------------------------------------------------------

export async function getPaymentProviders(
  companyId: string,
): Promise<PaymentProviderData[]> {
  await requireCompanyAccess(companyId);

  const providers = await prisma.paymentProvider.findMany({
    where: { companyId },
    include: { rules: { orderBy: { priority: "asc" } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return providers.map((p) => {
    let decryptedCredentials: Record<string, string> = {};
    try {
      decryptedCredentials = JSON.parse(decrypt(p.credentials)) as Record<
        string,
        string
      >;
    } catch {
      // credentials might be empty or corrupted — return empty
    }

    let settings: Record<string, string> = {};
    if (p.metadata && typeof p.metadata === "object") {
      settings = p.metadata as Record<string, string>;
    }

    const providerDef = PROVIDER_REGISTRY[p.provider];

    return {
      id: p.id,
      name: p.name,
      provider: p.provider,
      providerLabel: providerDef?.name ?? p.provider,
      credentials: maskCredentials(decryptedCredentials, p.provider),
      settings,
      webhookUrl: p.webhookUrl,
      // Bug #8 fix: Mask webhookSecret to prevent exposure
      webhookSecret: p.webhookSecret
        ? (p.webhookSecret.length > 4 ? `****${p.webhookSecret.slice(-4)}` : "****")
        : null,
      sandbox: p.sandbox,
      isDefault: p.isDefault,
      isActive: p.isActive,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      rules: p.rules.map((r) => ({
        id: r.id,
        priority: r.priority,
        clientType: r.clientType,
        minValue: r.minValue !== null ? Number(r.minValue) : null,
        maxValue: r.maxValue !== null ? Number(r.maxValue) : null,
        tags: r.tags,
        isActive: r.isActive,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// getAvailableProviders — return PROVIDER_REGISTRY for dropdown
// ---------------------------------------------------------------------------

export async function getAvailableProviders(): Promise<ProviderDefinition[]> {
  return Object.values(PROVIDER_REGISTRY);
}

// ---------------------------------------------------------------------------
// savePaymentProvider — create or update provider
// Bug #20 fix: default unsetting + create/update wrapped in $transaction
// PR #35 fix: create provider uses placeholder webhookUrl then updates atomically
// ---------------------------------------------------------------------------

export async function savePaymentProvider(
  companyId: string,
  data: SavePaymentProviderInput,
): Promise<{ id: string }> {
  const session = await requireCompanyAccess(companyId);

  // Validate provider type exists
  if (!PROVIDER_REGISTRY[data.provider]) {
    throw new Error(`Tipo de provider inválido: ${data.provider}`);
  }

  const credentialsToEncrypt: Record<string, string> = { ...data.credentials };

  // On edit: if credential field is empty, keep existing value
  let existing: Awaited<ReturnType<typeof prisma.paymentProvider.findFirst>> = null;
  if (data.id) {
    existing = await prisma.paymentProvider.findFirst({
      where: { id: data.id, companyId },
    });

    if (!existing) {
      throw new Error("Provider não encontrado");
    }

    let existingCredentials: Record<string, string> = {};
    try {
      existingCredentials = JSON.parse(
        decrypt(existing.credentials),
      ) as Record<string, string>;
    } catch {
      // existing credentials corrupted — proceed with new values
    }

    // Bug #2 fix (server-side): if the new value looks masked (starts with ****),
    // keep the existing value instead
    for (const [key, value] of Object.entries(credentialsToEncrypt)) {
      if ((!value || value.startsWith("****")) && existingCredentials[key]) {
        credentialsToEncrypt[key] = existingCredentials[key];
      }
    }
  }

  const encryptedCredentials = encrypt(JSON.stringify(credentialsToEncrypt));

  const metadata = Object.keys(data.settings).length > 0
    ? (data.settings as Prisma.InputJsonValue)
    : Prisma.JsonNull;

  if (data.id) {
    // ── UPDATE path ──
    // Check if provider type changed — regenerate webhook URL/secret if so
    const providerChanged = data.provider !== existing!.provider;
    const webhookUpdate: { webhookUrl?: string; webhookSecret?: string } = {};
    if (providerChanged) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://boletoapi.com";
      webhookUpdate.webhookUrl = `${baseUrl}/api/webhooks/payment/${data.id}`;
      webhookUpdate.webhookSecret = crypto.randomUUID();
    }

    // Bug #20 fix: Wrap default unsetting + update in a single transaction
    // to prevent race condition leaving 0 or 2 defaults
    const result = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.paymentProvider.updateMany({
          where: { companyId, isDefault: true, NOT: { id: data.id } },
          data: { isDefault: false },
        });
      }

      return tx.paymentProvider.update({
        where: { id: data.id!, companyId },
        data: {
          name: data.name,
          provider: data.provider,
          credentials: encryptedCredentials,
          sandbox: data.sandbox,
          isDefault: data.isDefault,
          isActive: true,
          metadata,
          ...webhookUpdate,
        },
      });
    });

    await logAuditEvent({
      userId: session.userId,
      action: "UPDATE",
      entity: "PaymentProvider",
      entityId: result.id,
      dataAfter: {
        name: data.name,
        provider: data.provider,
        sandbox: data.sandbox,
        isDefault: data.isDefault,
        ...(providerChanged
          ? { webhookUrl: webhookUpdate.webhookUrl, providerChanged: true }
          : {}),
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return { id: result.id };
  } else {
    // ── CREATE path ──
    // PR #35 fix: Use a single transaction for create + webhookUrl update
    // so the provider never exists without its webhook URL.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://boletoapi.com";
    const webhookSecret = crypto.randomUUID();

    const result = await prisma.$transaction(async (tx) => {
      // Bug #20 fix: Unset other defaults inside the same transaction
      if (data.isDefault) {
        await tx.paymentProvider.updateMany({
          where: { companyId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.paymentProvider.create({
        data: {
          companyId,
          name: data.name,
          provider: data.provider,
          credentials: encryptedCredentials,
          webhookSecret,
          sandbox: data.sandbox,
          isDefault: data.isDefault,
          isActive: true,
          metadata,
        },
      });

      // Bug #14 fix: Include provider ID in webhook URL for unique routing
      // PR #35 fix: Set webhookUrl atomically within the same transaction
      const webhookUrlWithId = `${baseUrl}/api/webhooks/payment/${created.id}`;
      await tx.paymentProvider.update({
        where: { id: created.id, companyId },
        data: { webhookUrl: webhookUrlWithId },
      });

      return { ...created, webhookUrl: webhookUrlWithId };
    });

    await logAuditEvent({
      userId: session.userId,
      action: "CREATE",
      entity: "PaymentProvider",
      entityId: result.id,
      dataAfter: {
        name: data.name,
        provider: data.provider,
        sandbox: data.sandbox,
        isDefault: data.isDefault,
        webhookUrl: result.webhookUrl,
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return { id: result.id };
  }
}

// ---------------------------------------------------------------------------
// deletePaymentProvider — delete provider (cascade handles rules)
// ---------------------------------------------------------------------------

export async function deletePaymentProvider(
  companyId: string,
  id: string,
): Promise<{ success: boolean }> {
  const session = await requireCompanyAccess(companyId);

  const provider = await prisma.paymentProvider.findFirst({
    where: { id, companyId },
  });

  if (!provider) {
    throw new Error("Provider não encontrado");
  }

  await prisma.paymentProvider.delete({
    where: { id, companyId },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "DELETE",
    entity: "PaymentProvider",
    entityId: id,
    dataBefore: {
      name: provider.name,
      provider: provider.provider,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// testProviderConnection — decrypt credentials and test
// ---------------------------------------------------------------------------

export async function testProviderConnection(
  companyId: string,
  id: string,
): Promise<{ ok: boolean; message: string }> {
  const session = await requireCompanyAccess(companyId);

  const provider = await prisma.paymentProvider.findFirst({
    where: { id, companyId },
  });

  if (!provider) {
    throw new Error("Provider não encontrado");
  }

  let decryptedCredentials: Record<string, unknown> = {};
  try {
    decryptedCredentials = JSON.parse(decrypt(provider.credentials)) as Record<
      string,
      unknown
    >;
  } catch {
    return { ok: false, message: "Erro ao decriptar credenciais" };
  }

  try {
    const gateway = getGateway(
      provider.provider,
      decryptedCredentials,
      provider.metadata as Record<string, unknown> | null,
      provider.webhookSecret ?? undefined,
    );

    const result = await gateway.testConnection();

    await logAuditEvent({
      userId: session.userId,
      action: "STATUS_CHANGE",
      entity: "PaymentProvider",
      entityId: id,
      dataAfter: {
        action: "testConnection",
        result: result.ok ? "success" : "failure",
        message: result.message,
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return result;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erro desconhecido ao testar conexão";

    await logAuditEvent({
      userId: session.userId,
      action: "STATUS_CHANGE",
      entity: "PaymentProvider",
      entityId: id,
      dataAfter: {
        action: "testConnection",
        result: "error",
        message,
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return { ok: false, message };
  }
}

// ---------------------------------------------------------------------------
// saveRoutingRules — replace all rules for a provider
// ---------------------------------------------------------------------------

export async function saveRoutingRules(
  companyId: string,
  providerId: string,
  rules: SaveRoutingRuleInput[],
): Promise<{ success: boolean }> {
  const session = await requireCompanyAccess(companyId);

  // Validate provider belongs to company
  const provider = await prisma.paymentProvider.findFirst({
    where: { id: providerId, companyId },
  });

  if (!provider) {
    throw new Error("Provider não encontrado");
  }

  // Delete all existing rules and create new ones in a transaction
  await prisma.$transaction([
    prisma.paymentRoutingRule.deleteMany({
      where: { providerId },
    }),
    ...rules.map((rule) =>
      prisma.paymentRoutingRule.create({
        data: {
          providerId,
          priority: rule.priority,
          clientType: rule.clientType,
          minValue: rule.minValue,
          maxValue: rule.maxValue,
          tags: rule.tags,
          isActive: rule.isActive,
        },
      }),
    ),
  ]);

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "PaymentRoutingRule",
    entityId: providerId,
    dataAfter: {
      action: "replaceRules",
      rulesCount: rules.length,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// toggleProviderActive — activate/deactivate provider
// ---------------------------------------------------------------------------

export async function toggleProviderActive(
  companyId: string,
  id: string,
): Promise<{ isActive: boolean }> {
  const session = await requireCompanyAccess(companyId);

  const provider = await prisma.paymentProvider.findFirst({
    where: { id, companyId },
  });

  if (!provider) {
    throw new Error("Provider não encontrado");
  }

  const newIsActive = !provider.isActive;

  await prisma.paymentProvider.update({
    where: { id, companyId },
    data: { isActive: newIsActive },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "STATUS_CHANGE",
    entity: "PaymentProvider",
    entityId: id,
    dataAfter: {
      action: "toggleActive",
      isActive: newIsActive,
      name: provider.name,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { isActive: newIsActive };
}

// ---------------------------------------------------------------------------
// setDefaultProvider — mark as default (unmark others)
// Already uses $transaction (Bug #20 was fixed here)
// ---------------------------------------------------------------------------

export async function setDefaultProvider(
  companyId: string,
  id: string,
): Promise<{ success: boolean }> {
  const session = await requireCompanyAccess(companyId);

  const provider = await prisma.paymentProvider.findFirst({
    where: { id, companyId },
  });

  if (!provider) {
    throw new Error("Provider não encontrado");
  }

  // Unset all defaults for this company, then set the new one
  await prisma.$transaction([
    prisma.paymentProvider.updateMany({
      where: { companyId, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.paymentProvider.update({
      where: { id, companyId },
      data: { isDefault: true },
    }),
  ]);

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "PaymentProvider",
    entityId: id,
    dataAfter: {
      action: "setDefault",
      name: provider.name,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { success: true };
}
