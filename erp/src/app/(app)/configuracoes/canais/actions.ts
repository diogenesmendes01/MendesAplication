"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { encryptConfig, decryptConfig } from "@/lib/encryption";
import { type ChannelType, type Prisma } from "@prisma/client";
import { withLogging } from "@/lib/with-logging";

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

async function _listChannels(companyId: string): Promise<ChannelRow[]> {
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

async function _createChannel(input: CreateChannelInput): Promise<ChannelRow> {
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

async function _updateChannel(input: UpdateChannelInput): Promise<ChannelRow> {
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

async function _toggleChannel(
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

async function _testChannelConnection(
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
    // Test WhatsApp Service connection
    try {
      const serviceUrl = process.env.WHATSAPP_SERVICE_URL || "http://localhost:3001";
      const serviceApiKey = process.env.WHATSAPP_SERVICE_API_KEY;
      const instanceName = config.instanceName as string;

      if (!instanceName) {
        return { success: false, message: "Nome da instância não configurado" };
      }

      if (!serviceUrl || !serviceApiKey) {
        return { success: false, message: "WhatsApp Service URL/Key não configurada" };
      }

      // Test by calling the instance status endpoint
      const response = await fetch(`${serviceUrl}/instance/${instanceName}/status`, {
        headers: { apikey: serviceApiKey },
      });

      if (response.ok) {
        const data = await response.json();
        const state = data.isConnected ? "conectada" : data.isConnecting ? "conectando" : "desconectada";
        return { success: true, message: `Instância ${instanceName}: ${state}` };
      }

      return { success: false, message: `WhatsApp Service retornou status ${response.status}` };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Erro ao testar WhatsApp Service",
      };
    }
  }

  if (channel.type === "RECLAMEAQUI") {
    try {
      const { ReclameAquiClient } = await import("@/lib/reclameaqui/client");
      const client = new ReclameAquiClient({
        clientId: config.clientId as string,
        clientSecret: config.clientSecret as string,
        baseUrl: config.baseUrl as string,
      });
      await client.checkAvailability();
      await client.authenticate();
      return { success: true, message: "Conexão com Reclame Aqui OK" };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Erro ao testar conexão Reclame Aqui",
      };
    }
  }

  return { success: false, message: "Tipo de canal não suportado" };
}

async function _getWhatsAppStatus(
  companyId: string
): Promise<{ isConnected: boolean }> {
  try {
    const channel = await prisma.channel.findFirst({
      where: { companyId, type: "WHATSAPP", isActive: true },
    });

    if (!channel) return { isConnected: false };

    const config = decryptConfig(channel.config as Record<string, unknown>);
    const serviceUrl = process.env.WHATSAPP_SERVICE_URL || "http://localhost:3001";
    const serviceApiKey = process.env.WHATSAPP_SERVICE_API_KEY;
    const instanceName = config.instanceName as string;

    if (!instanceName || !serviceApiKey) return { isConnected: false };

    const response = await fetch(`${serviceUrl}/instance/${instanceName}/status`, {
      headers: { apikey: serviceApiKey },
    });

    if (!response.ok) return { isConnected: false };

    const data = await response.json();
    return { isConnected: Boolean(data.isConnected) };
  } catch {
    return { isConnected: false };
  }
}

// ---------------------------------------------------------------------------
// Reclame Aqui Test Connection
// ---------------------------------------------------------------------------

export interface TestRaConnectionInput {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export interface TestRaConnectionResult {
  success: boolean;
  companyId?: number;
  companyName?: string;
  error?: string;
}

async function _testRaConnection(
  input: TestRaConnectionInput
): Promise<TestRaConnectionResult> {
  await requireAdmin();

  const { clientId, clientSecret, baseUrl } = input;

  if (!clientId || !clientSecret || !baseUrl) {
    return { success: false, error: "Client ID, Client Secret e URL base são obrigatórios" };
  }

  try {
    const { ReclameAquiClient } = await import("@/lib/reclameaqui/client");

    const client = new ReclameAquiClient({
      clientId,
      clientSecret,
      baseUrl,
    });

    // Step 1: Check API availability
    await client.checkAvailability();

    // Step 2: Authenticate
    await client.authenticate();

    // Step 3: List companies to auto-discover companyId
    try {
      const companies = await client.listCompanies();
      if (companies && companies.length > 0) {
        const company = companies[0]!;
        return {
          success: true,
          companyId: company.companyId,
          companyName: company.name,
        };
      }
      return { success: true };
    } catch {
      // Auth worked but couldn't list companies — still a success
      return { success: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido ao testar conexão";
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
export const listChannels = withLogging('canais.listChannels', _listChannels);
export const createChannel = withLogging('canais.createChannel', _createChannel);
export const updateChannel = withLogging('canais.updateChannel', _updateChannel);
export const toggleChannel = withLogging('canais.toggleChannel', _toggleChannel);
export const testChannelConnection = withLogging('canais.testChannelConnection', _testChannelConnection);
export const getWhatsAppStatus = withLogging('canais.getWhatsAppStatus', _getWhatsAppStatus);
export const testRaConnection = withLogging('canais.testRaConnection', _testRaConnection);
