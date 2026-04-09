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
import { createHmac } from "crypto";

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
  companyAddress?: CobreFacilAddress;
}

interface CobreFacilAddress {
  zipCode: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
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
  // Webhook signature validation
  // ──────────────────────────────────────────────

  /**
   * Validates HMAC signature for Cobre Fácil webhooks.
   * Uses HMAC-SHA256 with the webhook secret.
   * Header format: X-Webhook-Signature (base64-encoded SHA256 hash)
   */
  private validateHmacSignature(
    body: string,
    signature: string,
  ): boolean {
    if (!this.webhookSecret) {
      // Without webhook secret, fall back to structural validation
      return false;
    }

    try {
      const hmac = createHmac("sha256", this.webhookSecret);
      hmac.update(body, "utf-8");
      const computed = hmac.digest("base64");
      return computed === signature;
    } catch (err) {
      logger.error(
        { err },
        "[CobreFacil] Failed to validate HMAC signature",
      );
      return false;
    }
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

    // Build address (required by API)
    // Use customer address if available, otherwise fall back to company config or default
    const fallbackAddress = this.metadata?.companyAddress ?? {
      zipCode: "01001000",
      street: "Praça da Sé",
      number: "1",
      complement: "",
      neighborhood: "Sé",
      city: "São Paulo",
      state: "SP",
    };

    const addressData = customer.address ?? fallbackAddress;
    const address = {
      description: "Principal",
      zipcode: addressData.zipCode.replace(/\D/g, ""),
      street: addressData.street,
      number: addressData.number,
      complement: addressData.complement ?? "",
      neighborhood: addressData.neighborhood,
      city: addressData.city,
      state: addressData.state,
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
      const discountDays = this.metadata?.discountDays ?? 0;
      // discountDays = 0 means discount valid until due date itself
      // discountDays > 0 means discount valid until N days before due date
      const limitDate = new Date(input.dueDate);
      if (discountDays > 0) {
        limitDate.setDate(limitDate.getDate() - discountDays);
      }
      settings.discount = {
        mode: "percentage",
        value: this.metadata.discountPercentage,
        limit_date: limitDate.toISOString().split("T")[0], // YYYY-MM-DD
      };
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
    headers: Record<string, string>,
    body: string,
  ): boolean {
    // F1.1: Validate webhook signature using HMAC-SHA256
    // Header: X-Webhook-Signature (base64-encoded)
    const signature =
      headers["x-webhook-signature"] ?? headers["X-Webhook-Signature"];

    // If webhook secret is configured, HMAC validation is mandatory
    if (this.webhookSecret) {
      if (!signature) {
        logger.warn(
          "[CobreFacil] Webhook secret configured but no X-Webhook-Signature header — rejecting",
        );
        return false;
      }
      if (!this.validateHmacSignature(body, signature)) {
        logger.warn(
          "[CobreFacil] Webhook signature validation failed — rejecting",
        );
        return false;
      }
    }

    // Validate payload structure
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
