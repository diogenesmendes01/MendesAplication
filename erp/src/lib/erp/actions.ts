'use server';

import { prisma } from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/encryption';
import { createErpClient } from './factory';
import { ERP_PROVIDER_REGISTRY, isErpProviderType } from './registry';
import type { BlingCredentials } from './types';

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getErpProviders(companyId: string) {
  const providers = await prisma.erpProvider.findMany({
    where: { companyId },
    orderBy: { createdAt: 'asc' },
  });

  return providers.map(p => ({
    ...p,
    credentials: maskCredentials(p.credentials),
  }));
}

export async function getAvailableErpProviders() {
  return ERP_PROVIDER_REGISTRY;
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function saveErpProvider(
  companyId: string,
  data: {
    id?: string;
    name: string;
    provider: string;
    credentials: Record<string, string>;
    storeId?: string;
    sandbox?: boolean;
  }
) {
  if (!isErpProviderType(data.provider)) {
    throw new Error(`Provider inválido: ${data.provider}`);
  }

  let credentialsJson: string;

  if (data.id) {
    const existing = await prisma.erpProvider.findUniqueOrThrow({
      where: { id: data.id, companyId },
    });

    const current = JSON.parse(decrypt(existing.credentials)) as Record<string, string>;
    const merged = mergeCredentials(current, data.credentials);
    credentialsJson = encrypt(JSON.stringify(merged));
  } else {
    credentialsJson = encrypt(JSON.stringify(data.credentials));
  }

  if (data.id) {
    return prisma.erpProvider.update({
      where: { id: data.id, companyId },
      data: {
        name: data.name,
        credentials: credentialsJson,
        storeId: data.storeId,
        sandbox: data.sandbox ?? false,
      },
    });
  }

  return prisma.erpProvider.create({
    data: {
      companyId,
      name: data.name,
      provider: data.provider,
      credentials: credentialsJson,
      storeId: data.storeId,
      sandbox: data.sandbox ?? false,
    },
  });
}

export async function deleteErpProvider(companyId: string, id: string) {
  return prisma.erpProvider.delete({
    where: { id, companyId },
  });
}

export async function toggleErpProviderActive(companyId: string, id: string) {
  const provider = await prisma.erpProvider.findUniqueOrThrow({
    where: { id, companyId },
  });

  return prisma.erpProvider.update({
    where: { id },
    data: { isActive: !provider.isActive },
  });
}

// ── Test connection ───────────────────────────────────────────────────────────

export async function testErpProviderConnection(companyId: string, id: string) {
  const provider = await prisma.erpProvider.findUniqueOrThrow({
    where: { id, companyId },
  });

  const credentials = JSON.parse(
    decrypt(provider.credentials)
  ) as BlingCredentials;

  const client = createErpClient(provider.provider, credentials, provider.sandbox);

  // Testa fazendo uma chamada real à API — GET /contatos com pageSize=1
  const result = await (client as import('./providers/bling/client').BlingApiClient).getContacts({
    page: 1,
    pageSize: 1,
  });

  return { ok: true, total: result.meta.total };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskCredentials(encrypted: string): string {
  try {
    const parsed = JSON.parse(decrypt(encrypted)) as Record<string, string>;
    const masked = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [
        k,
        v.length > 4 ? `****${v.slice(-4)}` : '****',
      ])
    );
    return JSON.stringify(masked);
  } catch {
    return '{}';
  }
}

// Se o valor está mascarado (começa com ****), preserva o valor atual
function mergeCredentials(
  current: Record<string, string>,
  incoming: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(incoming).map(([k, v]) => [
      k,
      v.startsWith('****') ? (current[k] ?? v) : v,
    ])
  );
}
