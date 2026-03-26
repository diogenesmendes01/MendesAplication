// ============================================================
// LytexProvider — Lytex Pagamentos payment gateway
// ============================================================
// Implements PaymentGateway interface for Lytex API v2.
//
// Key differences from other providers:
// - Client is INLINE in the invoice (no ensureCustomer needed)
// - Values in CENTAVOS (same as ERP — zero conversion!)
// - Token expires in 5 MINUTES (see lytex-auth.ts)
// - Native referenceId for ERP reconciliation
// - Native Serasa negativation (opt-in)
// - Native billing rules (régua de cobrança)
// - Webhook validated by payload structure (_hashId + status)
//
// API Reference: https://docs-pay.lytex.com.br/documentacao/v2
// ============================================================

import type {
  PaymentGateway,
  CreateBoletoInput,
  CreateBoletoResult,
  BoletoStatusResult,
  WebhookEvent,
} from "../types";
import { authenticatedFetch } from "./lytex-auth";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LytexCredentials {
  clientId: string;
  clientSecret: string;
  sandbox?: boolean;
}

interface LytexMetadata {
  defaultPaymentMethod?: "boleto" | "pix" | "creditCard";
  cancelOverdueDays?: number;
  overduePaymentDays?: number;
  enableMulctAndInterest?: boolean;
  mulctPercentage?: number;
  interestPercentage?: number;
  enableSerasa?: boolean;
  serasaNegativityDays?: number;
  billingRuleId?: string;
}

/** Shape returned by POST /v2/invoices and GET /v2/invoices/{id} */
interface LytexInvoice {
  _hashId: string;
  _id?: string;
  status: string;
  linkCheckout?: string;
  linkBoleto?: string;
  paymentMethods?: Record<string, unknown>;
  lastPayment?: {
    ourNumber?: string;
    payedAt?: string;
    payedValue?: number;
  };
  paymentData?: {
    payedAt?: string;
    payedValue?: number;
  };
}

/** Webhook payload from Lytex */
interface LytexWebhookPayload {
  _hashId?: string;
  _id?: string;
  status: string;
  paymentData?: {
    payedAt?: string;
    payedValue?: number;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// LytexProvider
// ---------------------------------------------------------------------------

export class LytexProvider implements PaymentGateway {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly sandbox: boolean;
  private readonly metadata: LytexMetadata | null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly webhookSecret?: string;

  constructor(
    credentials: LytexCredentials,
    metadata?: LytexMetadata | null,
    webhookSecret?: string,
  ) {
    if (!credentials.clientId) {
      throw new Error("Lytex: clientId é obrigatório");
    }
    if (!credentials.clientSecret) {
      throw new Error("Lytex: clientSecret é obrigatório");
    }

    this.clientId = credentials.clientId;
    this.clientSecret = credentials.clientSecret;
    this.sandbox = credentials.sandbox ?? false;
    this.metadata = metadata ?? null;
    this.webhookSecret = webhookSecret;
  }

  // ──────────────────────────────────────────────
  // HTTP helper
  // ──────────────────────────────────────────────

  /**
   * Makes an authenticated request to the Lytex API.
   * Parses the response and throws on HTTP errors.
   */
  private async api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await authenticatedFetch(
      this.clientId,
      this.clientSecret,
      path,
      options,
      this.sandbox,
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Lytex API error ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  // ──────────────────────────────────────────────
  // PaymentGateway implementation
  // ──────────────────────────────────────────────

  async createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResult> {
    // Determinar métodos de pagamento
    const method = this.metadata?.defaultPaymentMethod ?? "boleto";

    const invoiceData: Record<string, unknown> = {
      // Cliente INLINE — sem necessidade de pré-cadastro
      client: {
        type: input.customer.documentType === "cpf" ? "pf" : "pj",
        name: input.customer.name,
        cpfCnpj: input.customer.document.replace(/\D/g, ""),
        email: input.customer.email ?? "",
        cellphone: "",
        ...(input.customer.address
          ? {
              address: {
                zip: input.customer.address.zipCode.replace(/\D/g, ""),
                street: input.customer.address.street,
                city: input.customer.address.city,
                state: input.customer.address.state,
                zone: input.customer.address.neighborhood,
              },
            }
          : {}),
      },
      // Valor em CENTAVOS (igual ao ERP — zero conversão!)
      totalValue: input.amount,
      items: [
        {
          name: input.description ?? "Cobrança",
          quantity: 1,
          value: input.amount,
        },
      ],
      dueDate: input.dueDate.toISOString().split("T")[0], // YYYY-MM-DD
      paymentMethods: {
        pix: { enable: method === "pix" || method === "boleto" },
        boleto: { enable: method === "boleto" },
        creditCard: { enable: method === "creditCard" },
      },
      // referenceId → vincular com boletoId do ERP pra reconciliação
      referenceId:
        input.metadata?.boletoId ?? input.metadata?.referenceId ?? "",
      observation: input.instructions ?? "",
    };

    // Multa e juros
    if (this.metadata?.enableMulctAndInterest) {
      invoiceData.mulctAndInterest = {
        enable: true,
        mulct: {
          type: "percentage",
          value: this.metadata.mulctPercentage ?? 2,
        },
        interest: {
          type: "monthly",
          value: this.metadata.interestPercentage ?? 1,
        },
      };
    }

    // Cancelamento automático após vencimento
    if (this.metadata?.cancelOverdueDays) {
      invoiceData.cancelOverdueDays = this.metadata.cancelOverdueDays;
    }
    if (this.metadata?.overduePaymentDays) {
      invoiceData.overduePaymentDays = this.metadata.overduePaymentDays;
    }

    // Serasa (negativação)
    if (this.metadata?.enableSerasa) {
      invoiceData.serasa = {
        negativityDays: this.metadata.serasaNegativityDays ?? 30,
      };
    }

    // Régua de cobrança
    if (this.metadata?.billingRuleId) {
      invoiceData._billingRuleId = this.metadata.billingRuleId;
    }

    const invoice = await this.api<LytexInvoice>("/v2/invoices", {
      method: "POST",
      body: JSON.stringify(invoiceData),
    });

    return {
      gatewayId: invoice._hashId ?? invoice._id ?? "",
      url: invoice.linkCheckout,
      line: undefined, // Lytex não retorna linha digitável diretamente
      barcode: undefined,
      qrCode: undefined, // PIX code disponível no checkout
      pdf: invoice.linkBoleto,
      nossoNumero: invoice.lastPayment?.ourNumber,
      rawResponse: invoice,
    };
  }

  async getBoletoStatus(gatewayId: string): Promise<BoletoStatusResult> {
    const invoice = await this.api<LytexInvoice>(
      `/v2/invoices/${gatewayId}`,
    );

    const paidAt =
      invoice.paymentData?.payedAt ?? invoice.lastPayment?.payedAt;
    const paidAmount =
      invoice.paymentData?.payedValue ?? invoice.lastPayment?.payedValue;

    return {
      gatewayId: invoice._hashId ?? gatewayId,
      status: mapLytexStatus(invoice.status),
      paidAt: paidAt ? new Date(paidAt) : undefined,
      paidAmount: paidAmount ?? undefined, // já em centavos
    };
  }

  async cancelBoleto(gatewayId: string): Promise<{ success: boolean }> {
    try {
      await this.api(`/v2/invoices/${gatewayId}`, {
        method: "DELETE",
      });
      return { success: true };
    } catch (err) {
      logger.error({ err }, "[Lytex] cancelBoleto failed");
      return { success: false };
    }
  }

  validateWebhook(
    _headers: Record<string, string>,
    body: string,
  ): boolean {
    // Lytex não documenta HMAC — validar por estrutura do payload
    try {
      const parsed = JSON.parse(body) as Partial<LytexWebhookPayload>;
      return !!(parsed._hashId || parsed._id) && !!parsed.status;
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: string): WebhookEvent | null {
    try {
      const parsed = (
        typeof body === "string" ? JSON.parse(body) : body
      ) as LytexWebhookPayload;

      // Mapear status da fatura → evento do ERP
      const statusToEvent: Record<string, WebhookEvent["type"]> = {
        paid: "boleto.paid",
        canceled: "boleto.cancelled",
        expired: "boleto.expired",
        refunded: "boleto.cancelled",
      };

      const eventType = statusToEvent[parsed.status];
      if (!eventType) return null;

      return {
        type: eventType,
        gatewayId: parsed._hashId ?? parsed._id ?? "",
        paidAt: parsed.paymentData?.payedAt
          ? new Date(parsed.paymentData.payedAt)
          : undefined,
        paidAmount: parsed.paymentData?.payedValue ?? undefined,
        rawEvent: parsed,
      };
    } catch (err) {
      logger.error({ err }, "[Lytex] Failed to parse webhook event");
      return null;
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.api("/v2/auth/user_data");
      return {
        ok: true,
        message: "Conexão com Lytex estabelecida com sucesso.",
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

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

function mapLytexStatus(
  status: string,
): BoletoStatusResult["status"] {
  const map: Record<string, BoletoStatusResult["status"]> = {
    waiting_payment: "pending",
    pending: "pending",
    paid: "paid",
    canceled: "cancelled",
    expired: "expired",
    refunded: "cancelled",
    overdue: "pending",
  };
  return map[status] ?? "pending";
}
