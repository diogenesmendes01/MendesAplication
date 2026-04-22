import { Agent as UndiciAgent } from "undici";

// ============================================================
// SantanderAuthManager — mTLS + OAuth 2.0 com cache de token
// ============================================================
// Gerencia autenticação mTLS e OAuth 2.0 do Santander.
// O provider usa esta classe para fazer requests autenticados
// sem se preocupar com token management.
// ============================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SantanderCredentials {
  /** Client ID obtido no Portal do Desenvolvedor Santander */
  clientId: string;
  /** Client Secret obtido no Portal do Desenvolvedor Santander */
  clientSecret: string;
  /** Conteúdo do certificado digital A1 (.CRT) em formato PEM */
  certificate: string;
  /** Chave privada do certificado digital A1 (.KEY) em formato PEM */
  certificateKey: string;
  /** Key User — identificador do espaço de cobrança */
  keyUser: string;
  /** Se true, usa URLs de sandbox; se false, produção */
  sandbox: boolean;
}

export interface SantanderAuthHeaders {
  Authorization: string;
  "X-Application-Key": string;
  "Content-Type": string;
}

interface CachedToken {
  accessToken: string;
  /** Timestamp (ms) em que o token expira */
  expiresAt: number;
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const URLS = {
  production: {
    base: "https://trust-open.api.santander.com.br/collection_bill_management/v2",
    oauth: "https://trust-open.api.santander.com.br/auth/oauth/v2/token",
  },
  sandbox: {
    base: "https://trust-sandbox.api.santander.com.br/collection_bill_management/v2",
    oauth: "https://trust-sandbox.api.santander.com.br/auth/oauth/v2/token",
  },
} as const;

/** Margem de segurança para renovação do token (60 segundos) */
const TOKEN_RENEWAL_MARGIN_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// SantanderAuthManager
// ---------------------------------------------------------------------------

export class SantanderAuthManager {
  private readonly credentials: SantanderCredentials;
  private cachedToken: CachedToken | null = null;
  private httpsAgent: UndiciAgent | null = null;
  /** Pending promise for token request (singleflight pattern) */
  private pendingTokenRequest: Promise<string> | null = null;

  constructor(credentials: SantanderCredentials) {
    this.credentials = credentials;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Retorna um UndiciAgent configurado com o certificado mTLS do cliente.
   * O agent é criado uma vez e reutilizado nas chamadas subsequentes.
   * Usa undici.Agent (via `dispatcher`) pois o fetch nativo do Node.js 18+
   * é implementado sobre undici e ignora silenciosamente `https.Agent`.
   */
  getHttpsAgent(): UndiciAgent {
    if (!this.httpsAgent) {
      this.httpsAgent = new UndiciAgent({
        connect: {
          cert: this.credentials.certificate,
          key: this.credentials.certificateKey,
          rejectUnauthorized: true,
        },
      });
    }
    return this.httpsAgent;
  }

  /**
   * Obtém um access token OAuth 2.0 válido.
   * Usa cache em memória e renova automaticamente quando faltam <= 60s.
   * Implementa singleflight para evitar concurrent token requests.
   */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && !this.isTokenExpired(this.cachedToken)) {
      return this.cachedToken.accessToken;
    }

    // F1.2: Singleflight pattern — if a token request is already in flight, wait for it
    if (this.pendingTokenRequest) {
      return this.pendingTokenRequest;
    }

    // Create a new token request promise and store it
    this.pendingTokenRequest = (async () => {
      try {
        const tokenData = await this.requestNewToken();

        this.cachedToken = {
          accessToken: tokenData.access_token,
          expiresAt: Date.now() + tokenData.expires_in * 1000,
        };

        return this.cachedToken.accessToken;
      } finally {
        // Always clean up the pending promise
        this.pendingTokenRequest = null;
      }
    })();

    return this.pendingTokenRequest;
  }

  /**
   * Retorna headers de autenticação prontos para uso.
   */
  async getAuthHeaders(): Promise<SantanderAuthHeaders> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      "X-Application-Key": this.credentials.keyUser,
      "Content-Type": "application/json",
    };
  }

  /**
   * Retorna a URL base da API de cobrança (sandbox ou produção).
   */
  getBaseUrl(): string {
    const env = this.credentials.sandbox ? "sandbox" : "production";
    return URLS[env].base;
  }

  /**
   * Wrapper de fetch que injeta automaticamente o agent mTLS e
   * os headers de autenticação OAuth.
   *
   * @param path Caminho relativo à base URL (ex: "/workspaces")
   * @param options Opções adicionais do fetch (method, body, etc.)
   * @returns A Response do fetch
   * @throws Error com mensagem clara para erros 401/403
   */
  async authenticatedFetch(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const url = `${this.getBaseUrl()}${path}`;
    const headers = await this.getAuthHeaders();

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string> | undefined),
      },
      // @ts-expect-error -- `dispatcher` é propriedade do undici/Node.js fetch; não existe no type DOM.
      dispatcher: this.getHttpsAgent(),
    });

    if (response.status === 401) {
      // Invalidar token cacheado e retry com token novo (1x)
      this.cachedToken = null;
      const freshHeaders = await this.getAuthHeaders();
      const retryResponse = await fetch(url, {
        ...options,
        headers: {
          ...freshHeaders,
          ...(options.headers as Record<string, string> | undefined),
        },
        // @ts-expect-error -- `dispatcher` é propriedade do undici/Node.js fetch; não existe no type DOM.
        dispatcher: this.getHttpsAgent(),
      });
      if (retryResponse.status === 401) {
        throw new Error(
          `Santander API: Não autorizado (401). Verifique se o Client ID, Client Secret e Key User estão corretos. URL: ${url}`,
        );
      }
      if (retryResponse.status === 403) {
        throw new Error(
          `Santander API: Acesso negado (403). Verifique se o certificado digital (.CRT/.KEY) está válido e associado às credenciais no portal Santander. URL: ${url}`,
        );
      }
      return retryResponse;
    }

    if (response.status === 403) {
      throw new Error(
        `Santander API: Acesso negado (403). Verifique se o certificado digital (.CRT/.KEY) está válido e associado às credenciais no portal Santander. URL: ${url}`,
      );
    }

    return response;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Verifica se o token está expirado ou prestes a expirar (margem de 60s).
   */
  private isTokenExpired(token: CachedToken): boolean {
    return Date.now() >= token.expiresAt - TOKEN_RENEWAL_MARGIN_MS;
  }

  /**
   * Obtém a URL do endpoint OAuth baseado no ambiente.
   */
  private getOAuthUrl(): string {
    const env = this.credentials.sandbox ? "sandbox" : "production";
    return URLS[env].oauth;
  }

  /**
   * Faz POST ao endpoint OAuth do Santander para obter um novo token.
   * Usa mTLS (certificado) na conexão.
   */
  private async requestNewToken(): Promise<OAuthTokenResponse> {
    const url = this.getOAuthUrl();

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      // @ts-expect-error -- `dispatcher` é propriedade do undici/Node.js fetch; não existe no type DOM.
      dispatcher: this.getHttpsAgent(),
    });

    if (response.status === 401 || response.status === 403) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Santander OAuth: Falha na autenticação (${response.status}). ` +
          `Verifique Client ID, Client Secret e certificado digital. ` +
          `Resposta: ${errorBody || "(vazio)"}`,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Santander OAuth: Erro ao obter token (HTTP ${response.status}). ` +
          `Resposta: ${errorBody || "(vazio)"}`,
      );
    }

    const data = (await response.json()) as OAuthTokenResponse;

    if (!data.access_token) {
      throw new Error(
        "Santander OAuth: Resposta não contém access_token. Resposta inesperada do servidor.",
      );
    }

    return data;
  }
}
