import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do Prisma
const mockPrisma = {
  erpProvider: {
    findMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

// Mock de encryption — simula criptografia (transforma conteúdo)
vi.mock('@/lib/encryption', () => ({
  encrypt: (v: string) => `enc:${Buffer.from(v).toString('base64')}`,
  decrypt: (v: string) => Buffer.from(v.replace(/^enc:/, ''), 'base64').toString(),
}));

const { getErpProviders, saveErpProvider, deleteErpProvider, toggleErpProviderActive } =
  await import('../actions');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getErpProviders', () => {
  it('mascara as credentials retornadas', async () => {
    mockPrisma.erpProvider.findMany.mockResolvedValueOnce([
      {
        id: '1',
        companyId: 'c1',
        name: 'Bling Prod',
        provider: 'bling',
        credentials: `enc:${Buffer.from('{"accessToken":"mysecrettoken"}').toString('base64')}`,
      },
    ]);

    const result = await getErpProviders('c1');

    expect(result[0].credentials).toContain('****');
    expect(result[0].credentials).not.toContain('mysecrettoken');
  });
});

describe('saveErpProvider — create', () => {
  it('cria provider com credentials encriptadas', async () => {
    mockPrisma.erpProvider.create.mockResolvedValueOnce({ id: 'new-id' });

    await saveErpProvider('c1', {
      name: 'Bling',
      provider: 'bling',
      credentials: {
        clientId: 'cid',
        clientSecret: 'csec',
        accessToken: 'tok',
        refreshToken: 'ref',
      },
    });

    const createCall = mockPrisma.erpProvider.create.mock.calls[0][0];
    expect(createCall.data.credentials).toMatch(/^enc:/);
    expect(createCall.data.credentials).not.toContain('tok');
  });

  it('rejeita provider desconhecido', async () => {
    await expect(
      saveErpProvider('c1', { name: 'X', provider: 'unknown', credentials: {} })
    ).rejects.toThrow('Provider inválido');
  });
});

describe('saveErpProvider — update', () => {
  it('preserva credential mascarada (não substitui)', async () => {
    mockPrisma.erpProvider.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'existing',
      companyId: 'c1',
      credentials: `enc:${Buffer.from('{"accessToken":"original_tok","clientId":"orig_cid"}').toString('base64')}`,
    });
    mockPrisma.erpProvider.update.mockResolvedValueOnce({ id: 'existing' });

    await saveErpProvider('c1', {
      id: 'existing',
      name: 'Bling',
      provider: 'bling',
      credentials: {
        accessToken: '****last', // mascarado — deve manter "original_tok"
        clientId: 'new_cid',    // não mascarado — deve atualizar
      },
    });

    const updateCall = mockPrisma.erpProvider.update.mock.calls[0][0];
    const decrypted = Buffer.from(updateCall.data.credentials.replace(/^enc:/, ''), 'base64').toString();
    const parsed = JSON.parse(decrypted) as Record<string, string>;
    expect(parsed.accessToken).toBe('original_tok');
    expect(parsed.clientId).toBe('new_cid');
  });
});

describe('deleteErpProvider', () => {
  it('deleta o provider correto', async () => {
    mockPrisma.erpProvider.delete.mockResolvedValueOnce({ id: '1' });

    await deleteErpProvider('c1', '1');

    expect(mockPrisma.erpProvider.delete).toHaveBeenCalledWith({
      where: { id: '1', companyId: 'c1' },
    });
  });
});
