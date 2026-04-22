import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const mockPrisma = {
  erpProvider: {
    findMany: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/encryption', () => ({
  decrypt: (v: string) => v.replace(/^enc:/, ''),
}));

const { POST } = await import('../route');

const CLIENT_SECRET = 'test-secret';
const WRONG_SECRET = 'wrong-secret';

function signedBody(body: string, secret = CLIENT_SECRET) {
  const hash = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return { signature: `sha256=${hash}`, body };
}

function makeRequest(body: string, signature: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signature) headers['x-bling-signature-256'] = signature;
  return new Request('https://example.com/api/webhooks/erp/bling', {
    method: 'POST',
    headers,
    body,
  });
}

const validPayload = JSON.stringify({
  event: 'product.updated',
  data: { id: 123 },
});

beforeEach(() => vi.clearAllMocks());

describe('POST /api/webhooks/erp/bling', () => {
  it('retorna 401 quando nenhum provider valida a assinatura', async () => {
    mockPrisma.erpProvider.findMany.mockResolvedValueOnce([
      { id: 'p1', credentials: `enc:${JSON.stringify({ clientSecret: WRONG_SECRET })}` },
    ]);

    const { body, signature } = signedBody(validPayload);
    const res = await POST(makeRequest(body, signature) as never);
    expect(res.status).toBe(401);
  });

  it('retorna 401 quando não há header de assinatura', async () => {
    const res = await POST(makeRequest(validPayload, null) as never);
    expect(res.status).toBe(401);
  });

  it('retorna 200 quando um dos providers valida a assinatura (busca entre múltiplos)', async () => {
    mockPrisma.erpProvider.findMany.mockResolvedValueOnce([
      { id: 'p1', credentials: `enc:${JSON.stringify({ clientSecret: WRONG_SECRET })}` },
      { id: 'p2', credentials: `enc:${JSON.stringify({ clientSecret: CLIENT_SECRET })}` },
    ]);

    const { body, signature } = signedBody(validPayload);
    const res = await POST(makeRequest(body, signature) as never);
    expect(res.status).toBe(200);
  });

  it('retorna 401 quando não há providers ativos', async () => {
    mockPrisma.erpProvider.findMany.mockResolvedValueOnce([]);

    const { body, signature } = signedBody(validPayload);
    const res = await POST(makeRequest(body, signature) as never);
    expect(res.status).toBe(401); // sem providers → nenhum valida → 401
  });
});
