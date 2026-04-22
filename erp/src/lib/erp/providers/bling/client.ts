import type { BlingCredentials } from '../../types';
import type {
  BlingApiResponse,
  BlingContact, BlingContactListParams,
  BlingProduct, BlingProductListParams,
  BlingOrder, BlingOrderListParams,
  BlingAccountReceivable, BlingAccountListParams,
} from './types';
import { BlingRateLimiter } from './rate-limiter';

const BASE_URL = 'https://api.bling.com.br/Api/v3';
const TOKEN_URL = 'https://api.bling.com.br/oauth/token';

export class BlingApiClient {
  private credentials: BlingCredentials;
  private limiter = new BlingRateLimiter();

  constructor(credentials: BlingCredentials, _sandbox = false) {
    this.credentials = { ...credentials };
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  async refreshAccessToken(): Promise<BlingCredentials> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.credentials.refreshToken,
    });

    const basic = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`
    ).toString('base64');

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basic}`,
        'enable-jwt': '1',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new Error(`Bling token refresh failed: ${res.status}`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    this.credentials = {
      ...this.credentials,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return this.credentials;
  }

  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    return this.limiter.enqueue(async () => {
      if (this.credentials.expiresAt && Date.now() > this.credentials.expiresAt - 300_000) {
        await this.refreshAccessToken();
      }

      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method,
        headers: {
          'Authorization': `Bearer ${this.credentials.accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'enable-jwt': '1',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bling API ${method} ${endpoint} → ${res.status}: ${text}`);
      }

      return res.json() as T;
    });
  }

  private buildQuery(params?: Record<string, unknown>): string {
    if (!params) return '';
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)])
      )
    );
    const s = q.toString();
    return s ? `?${s}` : '';
  }

  // ── Contatos ─────────────────────────────────────────────────────────────

  async getContacts(params?: BlingContactListParams): Promise<BlingApiResponse<BlingContact>> {
    return this.request('GET', `/contatos${this.buildQuery(params)}`);
  }

  async getContact(id: string): Promise<BlingContact> {
    const res = await this.request<{ data: BlingContact }>('GET', `/contatos/${id}`);
    return res.data;
  }

  // ── Produtos ─────────────────────────────────────────────────────────────

  async getProducts(params?: BlingProductListParams): Promise<BlingApiResponse<BlingProduct>> {
    return this.request('GET', `/produtos${this.buildQuery(params)}`);
  }

  async getProduct(id: string): Promise<BlingProduct> {
    const res = await this.request<{ data: BlingProduct }>('GET', `/produtos/${id}`);
    return res.data;
  }

  // ── Pedidos de Venda ──────────────────────────────────────────────────────

  async getOrders(params?: BlingOrderListParams): Promise<BlingApiResponse<BlingOrder>> {
    return this.request('GET', `/pedidos/vendas${this.buildQuery(params)}`);
  }

  async getOrder(id: string): Promise<BlingOrder> {
    const res = await this.request<{ data: BlingOrder }>('GET', `/pedidos/vendas/${id}`);
    return res.data;
  }

  async changeOrderStatus(orderId: string, statusId: number): Promise<void> {
    await this.request('PATCH', `/pedidos/vendas/${orderId}/situacoes/${statusId}`);
  }

  // ── Contas a Receber ──────────────────────────────────────────────────────

  async getAccountsReceivable(
    params?: BlingAccountListParams
  ): Promise<BlingApiResponse<BlingAccountReceivable>> {
    return this.request('GET', `/contas/receber${this.buildQuery(params)}`);
  }

  async getAccountReceivable(id: string): Promise<BlingAccountReceivable> {
    const res = await this.request<{ data: BlingAccountReceivable }>('GET', `/contas/receber/${id}`);
    return res.data;
  }

  getCredentials(): BlingCredentials {
    return { ...this.credentials };
  }
}
