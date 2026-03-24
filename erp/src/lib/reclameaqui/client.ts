// ============================================================
// Reclame Aqui (HugMe) API Client
// ============================================================
// OAuth2 client_credentials + token caching + rate limiter (10/min)
// Uses native fetch — no axios.

import { logger } from "@/lib/logger";
import type {
  RaClientConfig,
  RaAuthResponse,
  RaTicket,
  RaTicketFilters,
  RaDateFilter,
  RaPaginatedResponse,
  RaCountResponse,
  RaAttachmentResponse,
  RaCompany,
  RaReputation,
  RaWhatsAppConsumption,
} from "./types";

// ──────────────────────────────────────────────
// Error Handling
// ──────────────────────────────────────────────

/** Map of known API error codes → user-friendly descriptions */
const ERROR_CODE_MAP: Record<number, string> = {
  4000: "Requisição inválida",
  4010: "Token inválido ou expirado",
  4030: "Acesso negado — verifique permissões",
  4040: "Recurso não encontrado",
  4050: "Método não permitido",
  4090: "Conflito — ação já realizada ou duplicada",
  4091: "Conflito de estado — ticket não permite esta ação",
  4220: "Dados inválidos — verifique os campos enviados",
  4290: "Rate limit excedido — aguarde antes de tentar novamente",
  5000: "Erro interno do servidor Reclame Aqui",
  5030: "Serviço temporariamente indisponível",
};

export class ReclameAquiError extends Error {
  public readonly code: number;
  public readonly httpStatus: number;
  public readonly originalMessage: string;

  constructor(message: string, code: number, httpStatus: number, originalMessage: string) {
    const friendly = ERROR_CODE_MAP[code];
    super(friendly ? `${friendly}: ${message}` : message);
    this.name = "ReclameAquiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.originalMessage = originalMessage;
  }
}

// ──────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds
const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_MARGIN_S = 60; // refresh 60s before expiry

export class ReclameAquiClient {
  private readonly config: RaClientConfig;
  private tokenCache: { token: string; expiresAt: number } | null = null;
  private readonly requestTimestamps: number[] = [];

  constructor(config: RaClientConfig) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error("ReclameAquiClient: clientId e clientSecret são obrigatórios");
    }
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, ""), // strip trailing slash
    };
  }

  // ──────────────────────────────────────────────
  // Auth
  // ──────────────────────────────────────────────

  /**
   * Authenticate via OAuth2 client_credentials.
   * Caches token until (expires_in - 60s).
   */
  async authenticate(): Promise<RaAuthResponse> {
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");

    const url = `${this.config.baseUrl}/auth/oauth/token?grant_type=client_credentials`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ReclameAquiError(
          `Falha na autenticação: ${res.status}`,
          4010,
          res.status,
          body
        );
      }

      const data: RaAuthResponse = await res.json();

      // Cache token with safety margin
      this.tokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - TOKEN_MARGIN_S) * 1000,
      };

      logger.info("[ReclameAqui] Autenticado com sucesso");
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Returns auth headers, auto-refreshing token if expired.
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    if (!this.tokenCache || Date.now() >= this.tokenCache.expiresAt) {
      await this.authenticate();
    }

    return {
      Authorization: `Bearer ${this.tokenCache!.token}`,
      Accept: "application/json",
    };
  }

  // ──────────────────────────────────────────────
  // Rate Limiter
  // ──────────────────────────────────────────────

  /**
   * Simple sliding-window rate limiter.
   * Max 10 requests per 60s. Delays when limit is reached.
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();

    // Prune timestamps outside the window
    while (
      this.requestTimestamps.length > 0 &&
      this.requestTimestamps[0]! < now - RATE_LIMIT_WINDOW_MS
    ) {
      this.requestTimestamps.shift();
    }

    if (this.requestTimestamps.length >= RATE_LIMIT_MAX) {
      const oldestInWindow = this.requestTimestamps[0]!;
      const waitMs = oldestInWindow + RATE_LIMIT_WINDOW_MS - now + 100; // +100ms safety
      logger.warn(`[ReclameAqui] Rate limit atingido, aguardando ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      // Recurse to re-check after waiting
      return this.waitForRateLimit();
    }

    this.requestTimestamps.push(Date.now());
  }

  // ──────────────────────────────────────────────
  // HTTP Helper
  // ──────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      contentType?: string;
      formData?: FormData;
      skipAuth?: boolean;
    }
  ): Promise<T> {
    await this.waitForRateLimit();

    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = options?.skipAuth
      ? { Accept: "application/json" }
      : await this.getAuthHeaders();

    if (options?.contentType) {
      headers["Content-Type"] = options.contentType;
    }

    let fetchBody: string | FormData | undefined;
    if (options?.formData) {
      // Don't set Content-Type for FormData — fetch sets it with boundary
      delete headers["Content-Type"];
      fetchBody = options.formData;
    } else if (options?.body !== undefined) {
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      fetchBody = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      logger.debug(`[ReclameAqui] ${method} ${path}`);

      const res = await fetch(url, {
        method,
        headers,
        body: fetchBody,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let code = res.status * 10; // fallback: e.g. 404 → 4040
        let message = text;

        try {
          const parsed = JSON.parse(text);
          if (parsed.code) code = parsed.code;
          if (parsed.message) message = parsed.message;
        } catch {
          // not JSON, keep raw text
        }

        throw new ReclameAquiError(message, code, res.status, text);
      }

      // Some endpoints return empty body (204, etc.)
      const contentLength = res.headers.get("content-length");
      if (res.status === 204 || contentLength === "0") {
        return {} as T;
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof ReclameAquiError) throw err;

      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ReclameAquiError(
          `Timeout após ${REQUEST_TIMEOUT_MS}ms: ${method} ${path}`,
          5000,
          0,
          "Request aborted due to timeout"
        );
      }

      throw new ReclameAquiError(
        `Erro de rede: ${(err as Error).message}`,
        5000,
        0,
        (err as Error).message
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ──────────────────────────────────────────────
  // Reading Endpoints
  // ──────────────────────────────────────────────

  /**
   * Check API availability.
   */
  async checkAvailability(): Promise<unknown> {
    return this.request("GET", "/auth/availability", { skipAuth: true });
  }

  /**
   * Retrieve tickets with optional filters.
   */
  async getTickets(
    filters?: RaTicketFilters
  ): Promise<RaPaginatedResponse<RaTicket>> {
    const params = this.buildTicketFilterParams(filters);
    const qs = params.toString();
    const path = `/ticket/v1/tickets${qs ? `?${qs}` : ""}`;
    return this.request("GET", path);
  }

  /**
   * Retrieve a single ticket by its internal HugMe ID.
   */
  async getTicketById(id: number): Promise<RaPaginatedResponse<RaTicket>> {
    return this.request("GET", `/ticket/v1/tickets?id[eq]=${id}`);
  }

  /**
   * Count tickets matching optional filters.
   */
  async countTickets(filters?: RaTicketFilters): Promise<RaCountResponse> {
    const params = this.buildTicketFilterParams(filters);
    const qs = params.toString();
    const path = `/ticket/v1/tickets/count${qs ? `?${qs}` : ""}`;
    return this.request("GET", path);
  }

  /**
   * Get a temporary download link for a ticket attachment.
   * Use when interaction detail has ticket_detail_type_id = 15.
   */
  async getAttachmentLink(detailId: string): Promise<RaAttachmentResponse> {
    return this.request("GET", `/ticket/v1/tickets/attachment/${detailId}`);
  }

  /**
   * List all companies in the organization.
   */
  async listCompanies(): Promise<RaCompany[]> {
    return this.request("GET", "/companies/v1/companies/organization");
  }

  /**
   * Search companies by name (for moderation — migrate ticket to another company).
   */
  async searchCompanies(
    name: string,
    page = 1,
    limit = 15
  ): Promise<unknown> {
    const params = new URLSearchParams({
      companyName: name,
      page: String(page),
      limit: String(limit),
    });
    return this.request(
      "GET",
      `/ticket/v1/tickets/moderation/companies?${params.toString()}`
    );
  }

  /**
   * Get company reputation by period.
   * Returns array with entries for SEISMESES, DOZEMESES, UMANOATRAS, etc.
   */
  async getReputation(companyId: number): Promise<RaReputation[]> {
    return this.request(
      "GET",
      `/companies/v1/companies/${companyId}/reputation`
    );
  }

  /**
   * Get WhatsApp consumption data for the organization.
   */
  async getWhatsAppConsumption(): Promise<RaWhatsAppConsumption> {
    return this.request(
      "GET",
      "/companies/v1/companies/organization/whatsapp/consumption"
    );
  }

  // ──────────────────────────────────────────────
  // Writing Endpoints
  // ──────────────────────────────────────────────

  /**
   * Send a public response to a ticket (visible on Reclame Aqui).
   */
  async sendPublicMessage(ticketId: string, message: string): Promise<unknown> {
    return this.request("POST", "/ticket/v1/tickets/message/public", {
      body: { id: ticketId, message },
      contentType: "application/json",
    });
  }

  /**
   * Send a private message to the consumer.
   * Uses multipart/form-data as required by the API.
   */
  async sendPrivateMessage(
    ticketId: string,
    message: string,
    email: string
  ): Promise<unknown> {
    const formData = new FormData();
    formData.append("id", ticketId);
    formData.append("message", message);
    formData.append("email", email);

    return this.request("POST", "/ticket/v1/tickets/message/private", {
      formData,
    });
  }

  /**
   * Request the consumer to evaluate the ticket.
   * Conditions: last public interaction must be from the company + ticket not yet evaluated.
   */
  async requestEvaluation(ticketId: string): Promise<unknown> {
    return this.request("POST", "/ticket/v1/tickets/evaluation", {
      body: { id: ticketId },
      contentType: "application/json",
    });
  }

  /**
   * Request moderation for a ticket.
   * Uses multipart/form-data. Optional file attachment.
   * @param migrateTO - required when reason = 1 (outra empresa) — target company ID.
   */
  async requestModeration(
    ticketId: string,
    reason: number,
    message: string,
    migrateTO?: number
  ): Promise<unknown> {
    const formData = new FormData();
    formData.append("id", ticketId);
    formData.append("reason", String(reason));
    formData.append("message", message);

    if (migrateTO !== undefined) {
      formData.append("migrateTO", String(migrateTO));
    }

    return this.request("POST", "/ticket/v1/tickets/moderation", { formData });
  }

  /**
   * Finish (close) a private message thread.
   */
  async finishPrivateMessage(ticketId: string): Promise<unknown> {
    return this.request(
      "POST",
      `/ticket/v1/tickets/message/private/${ticketId}/end`
    );
  }

  // ──────────────────────────────────────────────
  // Filter Builder
  // ──────────────────────────────────────────────

  private buildTicketFilterParams(
    filters?: RaTicketFilters
  ): URLSearchParams {
    const params = new URLSearchParams();
    if (!filters) return params;

    if (filters.id !== undefined) {
      params.set("id[eq]", String(filters.id));
    }
    if (filters.source_external_id !== undefined) {
      params.set("source_external_id[eq]", filters.source_external_id);
    }
    if (filters.company_id !== undefined) {
      params.set("company.id[eq]", String(filters.company_id));
    }

    // Date filters support single or multiple comparators
    this.appendDateFilters(params, "creation_date", filters.creation_date);
    this.appendDateFilters(
      params,
      "last_modification_date",
      filters.last_modification_date
    );

    if (filters.page_size !== undefined) {
      params.set("page[size]", String(Math.min(filters.page_size, 50)));
    }
    if (filters.page_number !== undefined) {
      params.set("page[number]", String(filters.page_number));
    }
    if (filters.sort) {
      params.set("sort[creation_date]", filters.sort);
    }

    return params;
  }

  private appendDateFilters(
    params: URLSearchParams,
    field: string,
    filter?: RaDateFilter | RaDateFilter[]
  ): void {
    if (!filter) return;

    const filters = Array.isArray(filter) ? filter : [filter];
    for (const f of filters) {
      params.set(`${field}[${f.comparator}]`, f.value);
    }
  }
}
