import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlingApiClient } from '../client';
import type { BlingCredentials } from '../../../types';

const mockCredentials: BlingCredentials = {
  accessToken: 'test_access',
  refreshToken: 'test_refresh',
  clientId: 'test_client',
  clientSecret: 'test_secret',
  expiresAt: Date.now() + 3_600_000,
};

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

describe('BlingApiClient', () => {
  it('adiciona os headers corretos em todas as requisições', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], meta: { total: 0, page: 1, pageSize: 50 } }),
    });

    const client = new BlingApiClient(mockCredentials);
    await client.getContacts();

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Authorization']).toBe(
      `Bearer ${mockCredentials.accessToken}`
    );
    expect((options.headers as Record<string, string>)['enable-jwt']).toBe('1');
  });

  it('chama a URL correta para /contatos', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], meta: { total: 0, page: 1, pageSize: 50 } }),
    });

    const client = new BlingApiClient(mockCredentials);
    await client.getContacts({ situacao: 'A', page: 2 });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('api.bling.com.br/Api/v3/contatos');
    expect(url).toContain('situacao=A');
    expect(url).toContain('page=2');
  });

  it('faz refresh do token quando está prestes a expirar', async () => {
    const expiredCredentials: BlingCredentials = {
      ...mockCredentials,
      expiresAt: Date.now() + 60_000, // expira em 1min (< buffer de 5min)
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_access',
          refresh_token: 'new_refresh',
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [], meta: { total: 0, page: 1, pageSize: 50 } }),
      });

    const client = new BlingApiClient(expiredCredentials);
    await client.getProducts();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const refreshCall = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(refreshCall[0]).toContain('oauth/token');
    expect((refreshCall[1].headers as Record<string, string>)['enable-jwt']).toBe('1');
  });

  it('lança erro com status code quando a API retorna erro', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const client = new BlingApiClient(mockCredentials);
    await expect(client.getContacts()).rejects.toThrow('401');
  });
});
