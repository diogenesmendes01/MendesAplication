import crypto from "crypto";
import type {
  PaymentGateway,
  CreateBoletoInput,
  CreateBoletoResult,
  BoletoStatusResult,
  WebhookEvent,
} from "../types";
import {
import { logger } from "@/lib/logger";
  PHONE_PLACEHOLDER,
  PHONE_AREA_CODE_PLACEHOLDER,
  PHONE_COUNTRY_CODE,
} from "../constants";

const BASE_URL = "https://api.pagar.me/core/v5";

// Bug #19: Default timeout for all API requests (15 seconds)
const REQUEST_TIMEOUT_MS = 15_000;

interface PagarmeCredentials {
  apiKey: string;
}

interface PagarmeMetadata {
  defaultInstructions?: string;
  daysToExpire?: number;
}

/**
 * Pagar.me v5 payment provider.
 *
 * Uses native fetch with Basic Auth (apiKey as username, empty password).
 * API docs: https://docs.pagar.me/reference/introducao-1
 *
 * @todo TD-03 (Tech Lead Review #313): Consider refactoring this monolithic provider
 * into separate modules (auth, business logic) following the pattern established by
 * SantanderProvider (santander-auth.ts, santander-sequence.ts, santander.provider.ts).
 * This would improve testability and maintainability. Low priority — current code works
 * correctly but all auth + API + business logic lives in a single ~400 LOC file.
 */
export class PagarmeProvider implements PaymentGateway {
  private readonly apiKey: string;
  private readonly authHeader: string;
  private readonly defaultInstructions: string;
  private readonly daysToExpire: number;
  private readonly webhookSecret?: string;

  constructor(
    credentials: PagarmeCredentials,
    metadata?: PagarmeMetadata | null,
    webhookSecret?: string
  ) {
    if (!credentials.apiKey) {
      throw new Error("Pagar.me: apiKey é obrigatória");
    }
    this.apiKey = credentials.apiKey;
    // Basic Auth: base64(apiKey + ":") — colon after key, empty password
    this.authHeader = `Basic ${Buffer.from(this.apiKey + ":").toString("base64")}`;
    this.defaultInstructions =
      metadata?.defaultInstructions ?? "Não receber após vencimento";
    this.daysToExpire = metadata?.daysToExpire ?? 5;
    this.webhookSecret = webhookSecret;
  }

  // ──────────────────────────────────────────────
  // HTTP helper
  // ──────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${BASE_URL}${path}`;

    // Bug #19 fix: AbortController with 15s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const options: RequestInit = {
      method,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: controller.signal,
    };

    if (body && method !== "GET" && method !== "DELETE") {
      options.body = JSON.stringify(body);
    }

    try {
      const res = await fetch(url, options);

      if (!res.ok) {
        let errorMessage: string;
        try {
          const errorBody = (await res.json()) as Record<string, unknown>;
          const message =
            (errorBody.message as string) ??
            JSON.stringify(errorBody.errors ?? errorBody);
          errorMessage = `Pagar.me API error (${res.status}): ${message}`;
        } catch {
          errorMessage = `Pagar.me API error (${res.status}): ${res.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // DELETE may return 204 with no body
      if (res.status === 204) {
        return {} as T;
      }

      return res.json() as Promise<T>;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Pagar.me API timeout (${REQUEST_TIMEOUT_MS}ms): ${method} ${path}`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ──────────────────────────────────────────────
  // Customer helpers
  // ──────────────────────────────────────────────

  private async findCustomerByDocument(
    document: string
  ): Promise<PagarmeCustomer | null> {
    const cleanDoc = document.replace(/\D/g, "");
    const result = await this.request<PagarmeListResponse<PagarmeCustomer>>(
      "GET",
      `/customers?document=${cleanDoc}`
    );
    if (result.data && result.data.length > 0) {
      return result.data[0];
    }
    return null;
  }

  private async createCustomer(
    input: CreateBoletoInput
  ): Promise<PagarmeCustomer> {
    const cleanDoc = input.customer.document.replace(/\D/g, "");
    const customerType =
      input.customer.documentType === "cpf" ? "individual" : "company";

    const payload: Record<string, unknown> = {
      name: input.customer.name,
      email: input.customer.email ?? `${cleanDoc}@placeholder.com`,
      document: cleanDoc,
      type: customerType,
      document_type: input.customer.documentType.toUpperCase(),
    };

    if (input.customer.address) {
      const addr = input.customer.address;
      payload.address = {
        line_1: `${addr.number}, ${addr.street}, ${addr.neighborhood}`,
        line_2: addr.complement ?? "",
        zip_code: addr.zipCode.replace(/\D/g, ""),
        city: addr.city,
        state: addr.state,
        country: "BR",
      };
    }

    // Pagar.me requires phones for customers
    payload.phones = {
      mobile_phone: {
        country_code: PHONE_COUNTRY_CODE,
        area_code: PHONE_AREA_CODE_PLACEHOLDER,
        number: PHONE_PLACEHOLDER,
      },
    };

    return this.request<PagarmeCustomer>("POST", "/customers", payload);
  }

  // ──────────────────────────────────────────────
  // PaymentGateway implementation
  // ──────────────────────────────────────────────

  async createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResult> {
    // 1. Find or create customer
    let customer = await this.findCustomerByDocument(input.customer.document);
    if (!customer) {
      customer = await this.createCustomer(input);
    }

    // 2. Calculate due date
    const dueDate = new Date(input.dueDate);
    const dueAtISO = dueDate.toISOString();

    // 3. Build description
    const description =
      input.description ??
      (input.installmentNumber && input.totalInstallments
        ? `Parcela ${input.installmentNumber}/${input.totalInstallments}`
        : "Cobrança via boleto");

    const instructions = input.instructions ?? this.defaultInstructions;

    // 4. Create order with boleto payment
    const orderPayload = {
      customer_id: customer.id,
      items: [
        {
          amount: input.amount, // centavos
          description,
          quantity: 1,
        },
      ],
      payments: [
        {
          payment_method: "boleto",
          boleto: {
            due_at: dueAtISO,
            instructions,
          },
        },
      ],
    };

    const order = await this.request<PagarmeOrder>(
      "POST",
      "/orders",
      orderPayload
    );

    // 5. Extract charge and transaction data
    const charge = order.charges?.[0];
    if (!charge) {
      throw new Error(
        "Pagar.me: resposta da order não contém charges. Response: " +
          JSON.stringify(order)
      );
    }

    const transaction = charge.last_transaction;
    const gatewayId = charge.id;

    return {
      gatewayId,
      url: transaction?.url ?? undefined,
      line: transaction?.line ?? undefined,
      barcode: transaction?.barcode ?? undefined,
      qrCode: transaction?.qr_code ?? undefined,
      pdf: transaction?.pdf ?? undefined,
      nossoNumero: transaction?.nosso_numero ?? undefined,
      rawResponse: order,
    };
  }

  async getBoletoStatus(gatewayId: string): Promise<BoletoStatusResult> {
    const charge = await this.request<PagarmeCharge>(
      "GET",
      `/charges/${gatewayId}`
    );

    return {
      gatewayId,
      status: mapPagarmeStatus(charge.status),
      paidAt: charge.paid_at ? new Date(charge.paid_at) : undefined,
      paidAmount: charge.paid_amount ?? undefined,
    };
  }

  async cancelBoleto(gatewayId: string): Promise<{ success: boolean }> {
    try {
      await this.request<unknown>("DELETE", `/charges/${gatewayId}`);
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro desconhecido";
      throw new Error(`Pagar.me: falha ao cancelar charge ${gatewayId}: ${message}`);
    }
  }

  validateWebhook(headers: Record<string, string>, body: string): boolean {
    if (!this.webhookSecret) {
      // No secret configured — can't validate, reject
      return false;
    }

    const signature = headers["x-hub-signature"] ?? "";
    if (!signature) {
      return false;
    }

    const hmac = crypto.createHmac("sha1", this.webhookSecret);
    hmac.update(body, "utf8");
    const expected = `sha1=${hmac.digest("hex")}`;

    // Constant-time comparison
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      );
    } catch {
      // Lengths differ
      return false;
    }
  }

  parseWebhookEvent(body: string): WebhookEvent | null {
    const parsed =
      typeof body === "string"
        ? (JSON.parse(body) as PagarmeWebhookPayload)
        : (body as unknown as PagarmeWebhookPayload);

    const eventType = parsed.type;
    const charge = parsed.data;
    const gatewayId = charge?.id ?? "";

    // Bug #16 fix: Map overpaid to boleto.paid but preserve overpaid flag in rawEvent
    const typeMap: Record<string, WebhookEvent["type"]> = {
      "charge.paid": "boleto.paid",
      "charge.canceled": "boleto.cancelled",
      "charge.payment_failed": "boleto.failed",
      "charge.underpaid": "boleto.failed",
      "charge.overpaid": "boleto.paid",
    };

    // Bug A fix: Return null for unknown event types instead of falling back to boleto.failed
    // Pagar.me sends charge.created, charge.pending etc. that are not actionable
    const mappedType = typeMap[eventType] ?? null;

    if (!mappedType) {
      logger.info(`[Pagar.me] Unknown webhook event type: ${eventType}, ignoring`);
      return null;
    }

    // Bug #16 fix: Include overpaid flag in the raw event for downstream handling
    const isOverpaid = eventType === "charge.overpaid";

    return {
      type: mappedType,
      gatewayId,
      paidAt: charge?.paid_at ? new Date(charge.paid_at) : undefined,
      paidAmount: charge?.paid_amount ?? undefined,
      rawEvent: { ...parsed, _isOverpaid: isOverpaid },
    };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.request<PagarmeListResponse<PagarmeCustomer>>(
        "GET",
        "/customers?size=1"
      );
      return { ok: true, message: "Conexão com Pagar.me OK" };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro desconhecido";
      return { ok: false, message: `Falha na conexão: ${message}` };
    }
  }
}

// ──────────────────────────────────────────────
// Pagar.me API types (internal)
// ──────────────────────────────────────────────

interface PagarmeListResponse<T> {
  data: T[];
  paging?: {
    total: number;
    previous?: string;
    next?: string;
  };
}

interface PagarmeCustomer {
  id: string;
  name: string;
  email: string;
  document: string;
  type: string;
}

interface PagarmeTransaction {
  url?: string;
  line?: string;
  barcode?: string;
  qr_code?: string;
  pdf?: string;
  nosso_numero?: string;
}

interface PagarmeCharge {
  id: string;
  status: string;
  paid_at?: string;
  paid_amount?: number;
  last_transaction?: PagarmeTransaction;
}

interface PagarmeOrder {
  id: string;
  status: string;
  charges?: PagarmeCharge[];
}

interface PagarmeWebhookPayload {
  type: string;
  data: {
    id: string;
    status: string;
    paid_at?: string;
    paid_amount?: number;
  };
}

// ──────────────────────────────────────────────
// Status mapping
// ──────────────────────────────────────────────

function mapPagarmeStatus(
  status: string
): BoletoStatusResult["status"] {
  const map: Record<string, BoletoStatusResult["status"]> = {
    pending: "pending",
    paid: "paid",
    canceled: "cancelled",
    failed: "failed",
    expired: "expired",
    // Bug #16 fix: Map overpaid distinctly (keep as "paid" but with flag)
    overpaid: "paid",
    underpaid: "pending",
    processing: "pending",
  };
  return map[status] ?? "pending";
}
