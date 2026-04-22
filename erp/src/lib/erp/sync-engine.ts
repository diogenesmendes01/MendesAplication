import { prisma } from '@/lib/prisma';
import { decryptConfig } from '@/lib/encryption';
import { createErpClient } from './factory';
import { BlingSyncEngine } from './providers/bling/sync';
import type { ErpSyncOptions } from './types';

export async function runErpSync(companyId: string, providerId: string, options: ErpSyncOptions = {}) {
  const provider = await prisma.erpProvider.findUniqueOrThrow({
    where: { id: providerId, companyId, isActive: true },
  });

  const credentials = JSON.parse(decryptConfig(provider.credentials));
  const client = createErpClient(provider.provider, credentials, provider.sandbox);
  const engine = new BlingSyncEngine(client as import('./providers/bling/client').BlingApiClient);

  const results = await engine.syncAll({
    ...options,
    since: options.since ?? provider.lastSyncAt ?? undefined,
  });

  await prisma.erpProvider.update({
    where: { id: provider.id },
    data: {
      lastSyncAt: new Date(),
      syncStatus: Object.fromEntries(
        results.map(r => [r.resource, r.errors > 0 ? 'error' : 'ok'])
      ),
    },
  });

  return results;
}
