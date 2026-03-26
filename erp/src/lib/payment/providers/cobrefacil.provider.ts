// ============================================================
// CobreFacilProvider — Cobre Fácil payment gateway
// ============================================================
// Implements PaymentGateway interface for Cobre Fácil API.
// Supports boleto, PIX, and credit card (via payable_with).
//
// Key differences from other providers:
// - Customer must exist BEFORE creating an invoice (lazy creation via ensureCustomer)
// - Address is REQUIRED when creating customers
// - Invoice prices are in REAIS (not centavos) — divide amount by 100
// - Token-based auth with auto-refresh (see cobrefacil-auth.ts)
// - Webhook has no HMAC signature — validated by payload structure
//
// API Reference: https://developers.cobrefacil.com.br
// ============================================================

import type {
  PaymentGateway,
  CreateBoletoInput,
  CreateBoletoResult,
  BoletoStatusResult,
  WebhookEvent,
} from "../types";
import { authenticatedFetch } from "./cobrefacil-auth";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CobreFacilCredentials {
  appId: string;
  secret: string;
}

interface CobreFacilMetadata {
  defaultPaymentMethod?: "bankslip" | "pix" | "credit_card";
  finePercentage?: number;
  interestPercentage?: number;
  discountPercentage?: number;
  discountDays?: number;
}

/** Shape returned by POST /invoices and GET /invoices/{id} */
interface CobreFacilInvoice {
  id: string;
  status: string;
  url?: string;
  barcode?: string;
  barcode_data?: string;
  pix_qrcode?: string;
  pix_code?: string;
  paid_at?: string | null;
  total_paid?: number | null;
}

/** Shape returned by POST /customers and GET /customers */
interface CobreFacilCustomer {
  id: string;
  personal_name?: string;
  company_name?: string;
  taxpayer_id?: string;
  ein?: string;
}

/** Shape of the API list response */
interface CobreFacilListResponse<T> {
  success: boolean;
  message?: string;
  data: T[];
}

/** Shape of the API single response */
interface CobreFacilResponse<T> {
  success: boolean;
  message?: string;
  errors?: unknown[];
  data: T;
}

/** Webhook payload from Cobre Fácil */
interface CobreFacilWebhookPayload {
  event: string;
  data: {
    id: string;
    status: string;
    paid_at?: string | null;
    total_paid?: number | null;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// CobreFacilProvider
// ---------------------------------------------------------------------------

export class CobreFacilProvider implements PaymentGateway {
  private readonly appId: string;
  private readonly secret: string;
  private readonly defaultPaymentMethod: string;
  private readonly metadata: CobreFacilMetadata | null;
  private readonly webhookSecret?: string;

  constructor(
    credentials: CobreFacilCredentials,
    metadata?: CobreFacilMetadata | null,
    webhookSecret?: string,
  ) {
    if (!credentials.appId) {
      throw new Error("Cobre Fácil: appId é obrigatório");
    }
    if (!credentials.secret) {
      throw new Error("Cobre Fácil: secret é obrigatório");
    }

    this.appId = credentials.appId;
    this.secret = credentials.secret;
    this.defaultPaymentMethod = metadata?.defaultPaymentMethod ?? "bankslip";
    this.metadata = metadata ?? null;
    this.webhookSecret = webhookSecret;
  }

  // ──────────────────────────────────────────────
  // HTTP helper
  // ──────────────────────────────────────────────

  /**
   * Makes an authenticated request to the Cobre Fácil API.
   * Parses the response and throws on API errors.
   */
  private async api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await authenticatedFetch(
      this.appId,
      this.secret,
      path,
      options,
    );

    const json = (await response.json()) as CobreFacilResponse<T>;

    if (!json.success) {
      const errDetail = json.errors
        ? ` Errors: ${JSON.stringify(json.errors)}`
        : "";
      throw new Error(
        `Cobre Fácil API error: ${json.message ?? "Unknown error"}${errDetail}`,
      );
    }

    return json.data;
  }

  // ──────────────────────────────────────────────
  // Customer management (lazy creation)
  // ──────────────────────────────────────────────

  /**
   * Ensures a customer exists in Cobre Fácil.
   * Searches by CPF/CNPJ first; creates if not found.
   * Address is REQUIRED by the Cobre Fácil API.
   */
  private async ensureCustomer(
    customer: CreateBoletoInput["customer"],
  ): Promise<string> {
    const cleanDoc = customer.document.replace(/\D/g, "");

    // Search by document
    const searchField =
      customer.documentType === "cpf" ? "taxpayer_id" : "ein";
    const searchResponse = await authenticatedFetch(
      this.appId,
      this.secret,
      `/customers?${searchField}=${cleanDoc}`,
    );
    const searchJson =
      (await searchResponse.json()) as CobreFacilListResponse<CobreFacilCustomer>;

    if (searchJson.success && searchJson.data?.length > 0) {
      logger.info(
        `[CobreFacil] Found existing customer: ${searchJson.data[0].id}`,
      );
      return searchJson.data[0].id;
    }

    // TODO: Placeholder address — tornar configurável via metadata por empresa
    // Issue: endereço default de SP pode ser incorreto pra empresas de outras regiões

    // Build address (required by API)
    const address = customer.address
      ? {
          description: "Principal",
          zipcode: customer.address.zipCode.replace(/\D/g, ""),
          street: customer.address.street,
          number: customer.address.number,
          complement: customer.address.complement ?? "",
          neighborhood: customer.address.neighborhood,
          city: customer.address.city,
          state: customer.address.state,
        }
      : {
          // Placeholder address when none provided (API requires it)
          description: "Principal",
          zipcode: "01001000",
          street: "Praça da Sé",
          number: "1",
          complement: "",
          neighborhood: "Sé",
          city: "São Paulo",
          state: "SP",
        };

    // Build customer payload
    const isCpf = customer.documentType === "cpf";
    const customerData: Record<string, unknown> = {
      person_type: isCpf ? 1 : 2,
      ...(isCpf
        ? { taxpayer_id: cleanDoc, personal_name: customer.name }
        : { ein: cleanDoc, company_name: customer.name }),
      ...(customer.email ? { email: customer.email } : {}),
      address,
    };

    const created = await this.api<CobreFacilCustomer>("/customers", {
      method: "POST",
      body: JSON.stringify(customerData),
    });

    logger.info(`[CobreFacil] Created customer: ${created.id}`);
    return created.id;
  }

  // ──────────────────────────────────────────────
  // PaymentGateway implementation
  // ──────────────────────────────────────────────

  async createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResult> {
    // 1. Ensure customer exists
    const customerId = await this.ensureCustomer(input.customer);

    // 2. Build invoice payload
    // IMPORTANT: Cobre Fácil invoices use REAIS (not centavos) — divide by 100
    const priceInReais = input.amount / 100;
    const dueDate = input.dueDate.toISOString().split("T")[0]; // YYYY-MM-DD

    const invoiceData: Record<string, unknown> = {
      customer_id: customerId,
      payable_with: this.defaultPaymentMethod,
      due_date: dueDate,
      price: priceInReais,
    };

    // Add items if description is provided
    if (input.description) {
      invoiceData.items = [
        {
          description: input.description,
          quantity: 1,
          price: priceInReais,
        },
      ];
    }

    // Optional settings: fine, interest, discount
    const settings: Record<string, unknown> = {};

    if (this.metadata?.finePercentage) {
      settings.late_fee = {
        mode: "percentage",
        value: this.metadata.finePercentage,
      };
    }

    if (this.metadata?.interestPercentage) {
      settings.interest = {
        mode: "monthly_percentage",
        value: this.metadata.interestPercentage,
      };
    }

    if (this.metadata?.discountPercentage) {
      const discount: Record<string, unknown> = {
        mode: "percentage",
        value: this.metadata.discountPercentage,
      };

      // Calculate limit_date as actual date: dueDate - discountDays
      const limitDate = new Date(input.dueDate);
      limitDate.setDate(limitDate.getDate() - (this.metadata?.discountDays ?? 0));
      discount.limit_date = limitDate.toISOString().split("T")[0];

      settings.discount = discount;
    }

    if (Object.keys(settings).length > 0) {
      invoiceData.settings = settings;
    }

    // 3. Create invoice
    const invoice = await this.api<CobreFacilInvoice>("/invoices", {
      method: "POST",
      body: JSON.stringify(invoiceData),
    });

    logger.info(
      `[CobreFacil] Created invoice: ${invoice.id} (${this.defaultPaymentMethod})`,
    );

    return {
      gatewayId: invoice.id,
      url: invoice.url,
      line: invoice.barcode_data ?? invoice.barcode,
      barcode: invoice.barcode,
      qrCode: invoice.pix_qrcode ?? invoice.pix_code,
      nossoNumero: invoice.id,
      rawResponse: invoice,
    };
  }

  async getBoletoStatus(gatewayId: string): Promise<BoletoStatusResult> {
    const invoice = await this.api<CobreFacilInvoice>(
      `/invoices/${gatewayId}`,
    );

    return {
      gatewayId: invoice.id,
      status: mapCobreFacilStatus(invoice.status),
      paidAt: invoice.paid_at ? new Date(invoice.paid_at) : undefined,
      // total_paid comes in reais from API — convert to centavos
      paidAmount: invoice.total_paid
        ? Math.round(invoice.total_paid * 100)
        : undefined,
    };
  }

  async cancelBoleto(gatewayId: string): Promise<{ success: boolean }> {
    try {
      // Cobre Fácil uses DELETE to cancel invoices
      await this.api(`/invoices/${gatewayId}`, { method: "DELETE" });
      logger.info(`[CobreFacil] Cancelled invoice: ${gatewayId}`);
      return { success: true };
    } catch (err) {
      logger.error({ err, gatewayId }, "[CobreFacil] cancelBoleto failed");
      return { success: false };
    }
  }

  validateWebhook(
    _headers: Record<string, string>,
    body: string,
  ): boolean {
    // TODO: Cobre Fácil não documenta HMAC/signature para webhooks
    // Validação apenas por estrutura do payload — adicionar verificação criptográfica quando disponível

    // Validation is done by checking the payload structure has required fields.
    // In production, consider also validating by IP origin or custom secret in URL.
    try {
      const parsed = JSON.parse(body) as Partial<CobreFacilWebhookPayload>;
      return !!(parsed.event && parsed.data);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: string): WebhookEvent | null {
    try {
      const parsed = (
        typeof body === "string" ? JSON.parse(body) : body
      ) as CobreFacilWebhookPayload;

      const { event, data } = parsed;

      const eventMap: Record<string, WebhookEvent["type"]> = {
        "invoice.paid": "boleto.paid",
        "invoice.canceled": "boleto.cancelled",
        "invoice.refunded": "boleto.cancelled",
        "invoice.reversed": "boleto.failed",
        "invoice.declined": "boleto.failed",
      };

      const mappedType = eventMap[event];
      if (!mappedType) {
        logger.info(
          `[CobreFacil] Unknown webhook event type: ${event}, ignoring`,
        );
        return null;
      }

      return {
        type: mappedType,
        gatewayId: data.id,
        paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
        // total_paid from webhook is in reais — convert to centavos
        paidAmount: data.total_paid
          ? Math.round(data.total_paid * 100)
          : undefined,
        rawEvent: parsed,
      };
    } catch (err) {
      logger.error({ err }, "[CobreFacil] Failed to parse webhook event");
      return null;
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await authenticatedFetch(
        this.appId,
        this.secret,
        "/customers?limit=1",
      );
      const json =
        (await response.json()) as CobreFacilListResponse<CobreFacilCustomer>;

      if (json.success) {
        return {
          ok: true,
          message: "Conexão com Cobre Fácil estabelecida com sucesso.",
        };
      }
      return { ok: false, message: `Erro: ${json.message ?? "Unknown"}` };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error ? err.message : "Erro desconhecido na conexão",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

function mapCobreFacilStatus(
  status: string,
): BoletoStatusResult["status"] {
  const map: Record<string, BoletoStatusResult["status"]> = {
    pending: "pending",
    paid: "paid",
    canceled: "cancelled",
    cancelled: "cancelled",
    refunded: "cancelled",
    reversed: "failed",
    declined: "failed",
    expired: "expired",
  };
  return map[status] ?? "pending";
}
