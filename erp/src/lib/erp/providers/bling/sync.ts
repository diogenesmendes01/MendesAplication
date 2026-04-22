import type { BlingApiClient } from './client';
import { mapBlingContact, mapBlingProduct, mapBlingOrder } from './mappers';
import type { ErpSyncResult, ErpSyncOptions } from '../../types';

export class BlingSyncEngine {
  constructor(private client: BlingApiClient) {}

  async syncAll(
    options: ErpSyncOptions = {},
    onProgress?: (result: ErpSyncResult) => void
  ): Promise<ErpSyncResult[]> {
    const resources = options.resources ?? ['products', 'contacts', 'orders'];
    const results: ErpSyncResult[] = [];

    for (const resource of resources) {
      const result = await this.syncResource(resource, options).catch(err => ({
        provider: 'bling',
        resource,
        direction: 'pull' as const,
        synced: 0,
        errors: 1,
        details: [err instanceof Error ? err.message : String(err)],
      }));
      results.push(result);
      onProgress?.(result);
    }

    return results;
  }

  private async syncResource(resource: string, options: ErpSyncOptions): Promise<ErpSyncResult> {
    switch (resource) {
      case 'products': return this.syncProducts(options);
      case 'contacts': return this.syncContacts(options);
      case 'orders':   return this.syncOrders(options);
      default:
        return { provider: 'bling', resource, direction: 'pull', synced: 0, errors: 0 };
    }
  }

  private async syncProducts(options: ErpSyncOptions): Promise<ErpSyncResult> {
    let page = 1;
    let synced = 0;
    const errors: string[] = [];
    const since = options.since?.toISOString().split('T')[0];

    for (;;) {
      const res = await this.client.getProducts({ page, pageSize: 100, dataInicial: since });

      for (const item of res.data) {
        try {
          const mapped = mapBlingProduct(item);
          // Hook: persist(mapped)
          void mapped;
          synced++;
        } catch (e) {
          errors.push(`Product ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (page >= Math.ceil(res.meta.total / res.meta.pageSize)) break;
      page++;
    }

    return { provider: 'bling', resource: 'products', direction: 'pull', synced, errors: errors.length, details: errors.slice(0, 5) };
  }

  private async syncContacts(options: ErpSyncOptions): Promise<ErpSyncResult> {
    let page = 1;
    let synced = 0;
    const errors: string[] = [];

    for (;;) {
      const res = await this.client.getContacts({ page, pageSize: 100 });

      for (const item of res.data) {
        try {
          const mapped = mapBlingContact(item);
          void mapped;
          synced++;
        } catch (e) {
          errors.push(`Contact ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (page >= Math.ceil(res.meta.total / res.meta.pageSize)) break;
      page++;
    }

    return { provider: 'bling', resource: 'contacts', direction: 'pull', synced, errors: errors.length, details: errors.slice(0, 5) };
  }

  private async syncOrders(options: ErpSyncOptions): Promise<ErpSyncResult> {
    let page = 1;
    let synced = 0;
    const errors: string[] = [];
    const since = options.since?.toISOString().split('T')[0];

    for (;;) {
      const res = await this.client.getOrders({ page, pageSize: 100, dataInicial: since });

      for (const item of res.data) {
        try {
          const mapped = mapBlingOrder(item);
          void mapped;
          synced++;
        } catch (e) {
          errors.push(`Order ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (page >= Math.ceil(res.meta.total / res.meta.pageSize)) break;
      page++;
    }

    return { provider: 'bling', resource: 'orders', direction: 'pull', synced, errors: errors.length, details: errors.slice(0, 5) };
  }
}
