// ============================================================
// VindiProvider — Vindi Recorrência payment gateway
// ============================================================
// Implements PaymentGateway interface for Vindi API.
// Supports boleto, PIX, and credit card (via payment_method_code).
//
// Key differences from other providers:
// - Auth: Basic Auth with API Key (no token refresh, no expiration)
// - Customer must exist BEFORE creating a bill (lazy creation via ensureCustomer)
// - Bill prices are in REAIS (float, not centavos) — divide amount by 100
// - RFC2617: API Key + ":" is MANDATORY (empty password)
// - Webhook supports HTTP Basic Auth validation
//
// API Reference: https://vindi.github.io/api-docs/dist/
// ============================================================

import type {
  PaymentGateway,
  CreateBoletoInput,
  CreateBoletoResult,
  BoletoStatusResult,
  WebhookEvent,
} from "../types";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROD_BASE_URL = "https://app.vindi.com.br/api/v1";
const SANDBOX_BASE_URL = "https://sandbox-app.vindi.com.br/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VindiCredentials {
  apiKey: string;
  sandbox?: boolean;
}

interface VindiMetadata {
  defaultPaymentMethodCode?: string; // "bank_slip" | "pix" | "credit_card"
  defaultProductId?: number;
}

/** Shape returned by GET/POST /bills */
interface VindiBill {
  id: number;
  code: string | null;
  status: string;
  url: string;
  charges: VindiCharge[];
}

interface VindiCharge {
  id: number;
  status: string;
  paid_at?: string | null;
  payment_method: { code: string };
  print_url?: string;
  last_transaction?: {
    amount?: number;
    gateway_response_fields?: {
      typeable_barcode?: string;
      barcode?: string;
      qrcode_original_path?: string;
      qrcode_path?: string;
      pix_code?: string;
    };
  };
}

interface VindiCustomer {
  id: number;
  name: string;
  registry_code: string;
}

/** Webhook payload from Vindi */
interface VindiWebhookPayload {
  event: {
    type: string;
    data: {
      bill?: VindiBill;
      charge?: VindiCharge & { bill?: { id: number } };
    };
  };
}

// ---------------------------------------------------------------------------
// VindiProvider
// ---------------------------------------------------------------------------

export class VindiProvider implements PaymentGateway {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly metadata: VindiMetadata | null;
  private readonly webhookSecret?: string;

  constructor(
    credentials: VindiCredentials,
    metadata?: VindiMetadata | null,
    webhookSecret?: string,
  ) {
    if (!credentials.apiKey) {
      throw new Error("Vindi: apiKey é obrigatório");
    }

    this.baseUrl = credentials.sandbox ? SANDBOX_BASE_URL : PROD_BASE_URL;
    // RFC2617: API_KEY + ":" (separador obrigatório, senha vazia)
    this.authHeader = `Basic ${Buffer.from(`${credentials.apiKey}:`).toString("base64")}`;
    this.metadata = metadata ?? null;
    this.webhookSecret = webhookSecret;
  }

  // ──────────────────────────────────────────────
  // HTTP helper
  // ──────────────────────────────────────────────

  /**
   * Makes an authenticated request to the Vindi API.
   * Throws on non-OK responses.
   */
  private async api<T = unknown>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
        ...((options.headers as Record<string, string>) ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Vindi API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Generates an idempotency key for Vindi requests.
   * Uses a combination of referenceId and timestamp for uniqueness.
   */
  private generateIdempotencyKey(referenceId: string): string {
    // Vindi supports idempotency via request header (de facto standard)
    // Format: unique identifier per request to prevent duplicate resource creation
    return referenceId || `vindi-${Date.now()}`;
  }

  // ──────────────────────────────────────────────
  // Customer management (lazy creation)
  // ──────────────────────────────────────────────

  /**
   * Ensures a customer exists in Vindi.
   * Searches by registry_code (CPF/CNPJ) first; creates if not found.
   */
  private async ensureCustomer(
    customer: CreateBoletoInput["customer"],
  ): Promise<number> {
    const cleanDoc = customer.document.replace(/\D/g, "");

    // Search by registry_code (CPF/CNPJ)
    const searchResult = await this.api<{ customers: VindiCustomer[] }>(
      `/customers?query=registry_code=${cleanDoc}`,
    );

    if (searchResult.customers?.length > 0) {
      // TODO: Se Vindi retornar múltiplos customers com mesmo CPF/CNPJ (duplicatas),
      // pega o primeiro. Monitorar se isso causa problemas em produção.
      return searchResult.customers[0].id;
    }

    // Build customer payload
    const customerData: Record<string, unknown> = {
      name: customer.name,
      email: customer.email ?? "",
      registry_code: cleanDoc,
      code: cleanDoc, // External code for reconciliation
      metadata: {},
    };

    // Add address if available
    if (customer.address) {
      customerData.address = {
        street: customer.address.street,
        number: customer.address.number ?? "",
        additional_details: customer.address.complement ?? "",
        zipcode: customer.address.zipCode?.replace(/\D/g, ""),
        neighborhood: customer.address.neighborhood,
        city: customer.address.city,
        state: customer.address.state,
        country: "BR",
      };
    }

    const created = await this.api<{ customer: VindiCustomer }>(
      "/customers",
      {
        method: "POST",
        body: JSON.stringify(customerData),
      },
    );

    return created.customer.id;
  }

  // ──────────────────────────────────────────────
  // PaymentGateway implementation
  // ──────────────────────────────────────────────

  async createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResult> {
    // 1. Ensure customer exists
    const customerId = await this.ensureCustomer(input.customer);

    // 2. Determine payment method
    const paymentMethodCode =
      this.metadata?.defaultPaymentMethodCode ?? "bank_slip";

    // 3. Create bill (single charge)
    // IMPORTANT: Vindi uses REAIS (float, not centavos) — divide by 100
    const amountInReais = input.amount / 100;

    // Generate idempotency key to prevent duplicate bills on retry
    // Uses referenceId from input metadata for idempotent request handling
    const idempotencyKey = this.generateIdempotencyKey(
      input.metadata?.referenceId ?? "",
    );

    // product_id: null works for one-off bills. Some Vindi accounts require a product — configure defaultProductId in settings.
    const result = await this.api<{ bill: VindiBill }>("/bills", {
      method: "POST",
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        customer_id: customerId,
        payment_method_code: paymentMethodCode,
        bill_items: [
          {
            product_id: this.metadata?.defaultProductId ?? null,
            amount: amountInReais,
            description: input.description ?? "Cobrança",
            quantity: 1,
          },
        ],
        due_at: input.dueDate.toISOString().split("T")[0],
        metadata: {
          boletoId: input.metadata?.boletoId ?? "",
          referenceId: input.metadata?.referenceId ?? "",
        },
      }),
    });

    const bill = result.bill;
    const charge = bill.charges?.[0];
    const gatewayFields =
      charge?.last_transaction?.gateway_response_fields;

    return {
      gatewayId: String(bill.id),
      url: bill.url ?? charge?.print_url,
      line: gatewayFields?.typeable_barcode,
      barcode: gatewayFields?.barcode,
      qrCode:
        gatewayFields?.pix_code ?? gatewayFields?.qrcode_original_path,
      pdf: charge?.print_url,
      nossoNumero: String(bill.id),
      rawResponse: result,
    };
  }

  async getBoletoStatus(gatewayId: string): Promise<BoletoStatusResult> {
    const result = await this.api<{ bill: VindiBill }>(
      `/bills/${gatewayId}`,
    );

    const bill = result.bill;
    const charge = bill.charges?.[0];

    // Vindi bill statuses: pending, paid, canceled, review
    const statusMap: Record<string, BoletoStatusResult["status"]> = {
      pending: "pending",
      paid: "paid",
      canceled: "cancelled",
      review: "pending",
    };

    return {
      gatewayId: String(bill.id),
      status: statusMap[bill.status] ?? "pending",
      paidAt: charge?.paid_at ? new Date(charge.paid_at) : undefined,
      // Vindi returns in reais → convert to centavos
      paidAmount: charge?.last_transaction?.amount
        ? Math.round(charge.last_transaction.amount * 100)
        : undefined,
    };
  }

  async cancelBoleto(gatewayId: string): Promise<{ success: boolean }> {
    try {
      await this.api(`/bills/${gatewayId}`, { method: "DELETE" });
      return { success: true };
    } catch (err) {
      logger.error({ err, gatewayId }, "[Vindi] cancelBoleto failed");
      return { success: false };
    }
  }

  validateWebhook(
    headers: Record<string, string>,
    body: string,
  ): boolean {
    // ⚠️ PRODUCTION: sempre configurar webhookSecret (HTTP Basic Auth)
    // O fallback por estrutura (event.type + event.data) é inseguro — usar apenas em dev/sandbox

    // Vindi supports HTTP Basic Auth on webhook URL
    // If webhookSecret is configured, validate the Authorization header
    if (this.webhookSecret) {
      const authHeader =
        headers["authorization"] ?? headers["Authorization"] ?? "";
      const expected = `Basic ${Buffer.from(this.webhookSecret).toString("base64")}`;
      return authHeader === expected;
    }

    // Fallback: validate by payload structure (event.type + event.data)
    try {
      const parsed = JSON.parse(body) as Partial<VindiWebhookPayload>;
      return !!(parsed.event?.type && parsed.event?.data);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: string): WebhookEvent | null {
    try {
      const parsed = JSON.parse(body) as VindiWebhookPayload;
      const { type, data } = parsed.event ?? {};

      const eventMap: Record<string, WebhookEvent["type"]> = {
        bill_paid: "boleto.paid",
        bill_canceled: "boleto.cancelled",
        charge_rejected: "boleto.failed",
        charge_refunded: "boleto.cancelled",
      };

      const mappedType = eventMap[type];
      if (!mappedType) return null;

      const bill = data?.bill;
      const charge = data?.charge;

      return {
        type: mappedType,
        gatewayId: String(bill?.id ?? charge?.bill?.id ?? ""),
        paidAt: charge?.paid_at ? new Date(charge.paid_at) : undefined,
        // Vindi returns in reais → convert to centavos
        paidAmount: charge?.last_transaction?.amount
          ? Math.round(charge.last_transaction.amount * 100)
          : undefined,
        rawEvent: parsed,
      };
    } catch (err) {
      logger.error({ err }, "[Vindi] Failed to parse webhook event");
      return null;
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.api<{ merchant: { name: string } }>(
        "/merchants/current",
      );
      return {
        ok: true,
        message: `Conexão com Vindi estabelecida. Empresa: ${result.merchant?.name ?? "OK"}`,
      };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error ? err.message : "Erro desconhecido na conexão",
      };
    }
  }
}
