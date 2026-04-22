import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlingSyncEngine } from '../sync';

const mockClient = {
  getProducts: vi.fn(),
  getContacts: vi.fn(),
  getOrders: vi.fn(),
};

const singlePageMeta = { total: 1, page: 1, pageSize: 100 };

beforeEach(() => vi.clearAllMocks());

describe('BlingSyncEngine.syncAll', () => {
  it('sincroniza products e retorna resultado', async () => {
    mockClient.getProducts.mockResolvedValueOnce({
      data: [
        { id: '1', codigo: 'P1', nome: 'Prod 1', tipo: 'P', situacao: 'A' },
      ],
      meta: singlePageMeta,
    });

    const engine = new BlingSyncEngine(mockClient as never);
    const results = await engine.syncAll({ resources: ['products'] });

    expect(results).toHaveLength(1);
    expect(results[0].resource).toBe('products');
    expect(results[0].synced).toBe(1);
    expect(results[0].errors).toBe(0);
  });

  it('captura erros por item sem interromper o sync', async () => {
    mockClient.getProducts.mockResolvedValueOnce({
      data: [
        { id: '1', codigo: 'P1', nome: 'OK', tipo: 'P', situacao: 'A' },
        { id: '2', codigo: null as never, nome: null as never, tipo: 'P', situacao: 'A' }, // vai lançar
      ],
      meta: { ...singlePageMeta, total: 2 },
    });

    const engine = new BlingSyncEngine(mockClient as never);
    const results = await engine.syncAll({ resources: ['products'] });

    // synced = 1 (o que funcionou), errors = 1 (o que falhou com null)
    expect(results[0].synced + results[0].errors).toBe(2);
  });

  it('reporta progresso via callback', async () => {
    mockClient.getContacts.mockResolvedValueOnce({
      data: [],
      meta: { total: 0, page: 1, pageSize: 100 },
    });

    const progress = vi.fn();
    const engine = new BlingSyncEngine(mockClient as never);
    await engine.syncAll({ resources: ['contacts'] }, progress);

    expect(progress).toHaveBeenCalledOnce();
    expect(progress.mock.calls[0][0].resource).toBe('contacts');
  });

  it('captura erro de API e retorna como erro no resultado', async () => {
    mockClient.getOrders.mockRejectedValueOnce(new Error('API down'));

    const engine = new BlingSyncEngine(mockClient as never);
    const results = await engine.syncAll({ resources: ['orders'] });

    expect(results[0].errors).toBe(1);
    expect(results[0].details?.[0]).toContain('API down');
  });
});
