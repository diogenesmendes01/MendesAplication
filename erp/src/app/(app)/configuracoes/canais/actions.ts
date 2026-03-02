"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { encryptConfig, decryptConfig } from "@/lib/encryption";
import { type ChannelType, type Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChannelRow {
  id: string;
  type: ChannelType;
  name: string;
  config: Record<string, unknown>;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChannelInput {
  companyId: string;
  type: ChannelType;
  name: string;
  config: Record<string, unknown>;
}

export interface UpdateChannelInput {
  channelId: string;
  companyId: string;
  name?: string;
  config?: Record<string, unknown>;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function listChannels(companyId: string): Promise<ChannelRow[]> {
  await requireCompanyAccess(companyId);

  const channels = await prisma.channel.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });

  return channels.map((ch) => ({
    id: ch.id,
    type: ch.type,
    name: ch.name,
    config: decryptConfig(ch.config as Record<string, unknown>),
    isActive: ch.isActive,
    lastSyncAt: ch.lastSyncAt?.toISOString() ?? null,
    createdAt: ch.createdAt.toISOString(),
    updatedAt: ch.updatedAt.toISOString(),
  }));
}

export async function createChannel(input: CreateChannelInput): Promise<ChannelRow> {
  const session = await requireAdmin();
  await requireCompanyAccess(input.companyId);

  if (!input.name.trim()) {
    throw new Error("Nome do canal é obrigatório");
  }

  const encryptedConfig = encryptConfig(input.config) as Prisma.InputJsonValue;

  const channel = await prisma.channel.create({
    data: {
      companyId: input.companyId,
      type: input.type,
      name: input.name.trim(),
      config: encryptedConfig,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Channel",
    entityId: channel.id,
    dataAfter: { type: channel.type, name: channel.name },
    companyId: input.companyId,
  });

  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    config: input.config, // Return unencrypted for immediate use
    isActive: channel.isActive,
    lastSyncAt: null,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
  };
}

export async function updateChannel(input: UpdateChannelInput): Promise<ChannelRow> {
  const session = await requireAdmin();
  await requireCompanyAccess(input.companyId);

  const existing = await prisma.channel.findFirst({
    where: { id: input.channelId, companyId: input.companyId },
  });

  if (!existing) {
    throw new Error("Canal não encontrado");
  }

  const updateData: Prisma.ChannelUpdateInput = {};

  if (input.name !== undefined) {
    updateData.name = input.name.trim();
  }

  if (input.config !== undefined) {
    updateData.config = encryptConfig(input.config) as Prisma.InputJsonValue;
  }

  const channel = await prisma.channel.update({
    where: { id: input.channelId },
    data: updateData,
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Channel",
    entityId: channel.id,
    dataBefore: { name: existing.name },
    dataAfter: { name: channel.name },
    companyId: input.companyId,
  });

  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    config: input.config ?? decryptConfig(channel.config as Record<string, unknown>),
    isActive: channel.isActive,
    lastSyncAt: channel.lastSyncAt?.toISOString() ?? null,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
  };
}

export async function toggleChannel(
  channelId: string,
  companyId: string
): Promise<{ isActive: boolean }> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);

  const existing = await prisma.channel.findFirst({
    where: { id: channelId, companyId },
  });

  if (!existing) {
    throw new Error("Canal não encontrado");
  }

  const channel = await prisma.channel.update({
    where: { id: channelId },
    data: { isActive: !existing.isActive },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Channel",
    entityId: channel.id,
    dataBefore: { isActive: existing.isActive },
    dataAfter: { isActive: channel.isActive },
    companyId,
  });

  return { isActive: channel.isActive };
}

export async function testChannelConnection(
  channelId: string,
  companyId: string
): Promise<TestConnectionResult> {
  await requireAdmin();
  await requireCompanyAccess(companyId);

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, companyId },
  });

  if (!channel) {
    throw new Error("Canal não encontrado");
  }

  const config = decryptConfig(channel.config as Record<string, unknown>);

  if (channel.type === "EMAIL") {
    // Test IMAP connection
    try {
      const host = config.imapHost as string;
      const port = config.imapPort as number;
      if (!host || !port) {
        return { success: false, message: "Configuração IMAP incompleta (host/port)" };
      }
      // In production, would actually connect to IMAP
      // For now, validate config is complete
      const requiredFields = ["imapHost", "imapPort", "smtpHost", "smtpPort", "email", "password"];
      const missing = requiredFields.filter((f) => !config[f]);
      if (missing.length > 0) {
        return { success: false, message: `Campos faltando: ${missing.join(", ")}` };
      }
      return { success: true, message: `Configuração válida para ${config.email}` };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Erro ao testar conexão IMAP",
      };
    }
  }

  if (channel.type === "WHATSAPP") {
    // Test Evolution API connection
    try {
      const apiUrl = config.apiUrl as string || process.env.EVOLUTION_API_URL;
      const apiKey = config.apiKey as string || process.env.EVOLUTION_API_KEY;
      const instanceName = config.instanceName as string;

      if (!instanceName) {
        return { success: false, message: "Nome da instância não configurado" };
      }

      if (!apiUrl || !apiKey) {
        return { success: false, message: "Evolution API URL/Key não configurada" };
      }

      // Test by calling the instance status endpoint
      const response = await fetch(`${apiUrl}/instance/connectionState/${instanceName}`, {
        headers: { apikey: apiKey },
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, message: `Instância ${instanceName}: ${data.state || "conectada"}` };
      }

      return { success: false, message: `Evolution API retornou status ${response.status}` };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Erro ao testar Evolution API",
      };
    }
  }

  return { success: false, message: "Tipo de canal não suportado" };
}
