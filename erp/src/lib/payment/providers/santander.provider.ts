import type {
  PaymentGateway,
  CreateBoletoInput,
  CreateBoletoResult,
  BoletoStatusResult,
  WebhookEvent,
} from "../types";
import {
  SantanderAuthManager,
  type SantanderCredentials,
} from "./santander-auth";
import { getNextBankNumber } from "./santander-sequence";

// ============================================================
// SantanderProvider — Boleto híbrido (código de barras + QR Pix)
// ============================================================

/** Timeout for API requests (15 seconds) */
const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Santander API types (internal)
// ---------------------------------------------------------------------------

interface SantanderPayer {
  name: string;
  documentType: "CPF" | "CNPJ";
  documentNumber: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
}

interface SantanderBankSlipRequest {
  environment: "PRODUCAO" | "TESTE";
  nsuCode: string;
  nsuDate: string;
  covenantCode: string;
  bankNumber: string;
  clientNumber?: string;
  dueDate: string;
  issueDate: string;
  nominalValue: string;
  payer: SantanderPayer;
  documentKind: string;
  paymentType: string;
  finePercentage?: string;
  fineQuantityDays?: string;
  interestPercentage?: string;
  writeOffQuantityDays?: string;
  protestType?: string;
  messages?: string[];
  key?: { type: string; dictKey: string };
  txId?: string;
}

interface SantanderBankSlipResponse {
  environment: string;
  nsuCode: string;
  nsuDate: string;
  covenantCode: string;
  bankNumber: string;
  barcode?: string;
  digitableLine?: string;
  qrCodePix?: string;
  qrCodeUrl?: string;
  entryDate?: string;
}

interface SantanderErrorTemplate {
  _errorCode?: number;
  _message?: string;
  _details?: string;
  _timestamp?: string;
  _traceId?: string;
  _errors?: Array<{
    _code?: number;
    _field?: string;
    _message?: string;
  }>;
}

/** Response from GET /bills/{bill_id}?tipoConsulta=default */
interface SantanderBillStatusResponse {
  status?: string;
  covenantCode?: string;
  bankNumber?: string;
  nominalValue?: string;
  dueDate?: string;
  issueDate?: string;
}

/** Response from GET /bills/{bill_id}?tipoConsulta=settlement */
interface SantanderBillSettlementResponse {
  status?: string;
  settlementData?: Array<{
    settlementDate?: string;
    settlementValue?: string;
    settlementChannel?: string;
  }>;
}

/** Request body for PATCH /workspaces/{id}/bank_slips (instructions) */
interface SantanderInstructionRequest {
  covenantCode: string;
  bankNumber: string;
  operation: "BAIXAR" | "PROTESTAR" | "CANCELAR_PROTESTO";
}

/** Response from PATCH /workspaces/{id}/bank_slips */
interface SantanderInstructionResponse {
  message?: string;
  _message?: string;
  _errorCode?: number;
}

/** Response from GET /workspaces */
interface SantanderWorkspacesResponse {
  content?: Array<{ id?: string; name?: string }>;
  totalElements?: number;
}

// ---------------------------------------------------------------------------
// Settings interface (from registry settingsSchema)
// ---------------------------------------------------------------------------

interface SantanderSettings {
  documentKind?: string;
  finePercentage?: number;
  fineQuantityDays?: number;
  interestPercentage?: number;
  writeOffQuantityDays?: number;
  protestType?: string;
  defaultMessages?: string;
  pixKeyType?: string;
  pixDictKey?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates a unique NSU code: timestamp-based + random alphanumeric.
 * Pattern: ^[A-Za-z0-9]{1,20}$
 */
function generateNsuCode(): string {
  const timestamp = Date.now().toString(36); // base36 timestamp (~8 chars)
  const randomPart = Math.random().toString(36).slice(2, 7); // 5 random chars
  const nsu = `${timestamp}${randomPart}`.slice(0, 20);
  return nsu;
}

/**
 * Formats a date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats amount (in centavos) to Santander nominal value format.
 * Example: 1015 → "10.15"
 */
function formatNominalValue(amountCentavos: number): string {
  const reais = amountCentavos / 100;
  return reais.toFixed(2);
}

/**
 * Formats a number to Santander's string pattern for percentages.
 * Example: 2.5 → "2.50"
 */
function formatPercentage(value: number): string {
  return value.toFixed(2);
}

/**
 * Determines document type based on document length.
 * CPF = 11 digits, CNPJ = 14 digits.
 */
function getDocumentType(document: string): "CPF" | "CNPJ" {
  const clean = document.replace(/\D/g, "");
  return clean.length <= 11 ? "CPF" : "CNPJ";
}

/**
 * Formats zipCode to Santander's expected pattern: XXXXX-XXX
 */
function formatZipCode(zipCode: string): string {
  const clean = zipCode.replace(/\D/g, "");
  if (clean.length === 8) {
    return `${clean.slice(0, 5)}-${clean.slice(5)}`;
  }
  return zipCode;
}

/**
 * Parses a Santander error response into a human-readable message.
 */
function parseSantanderError(error: SantanderErrorTemplate): string {
  const parts: string[] = [];

  if (error._errorCode !== undefined) {
    parts.push(`Código: ${error._errorCode}`);
  }
  if (error._message) {
    parts.push(error._message);
  }
  if (error._details) {
    parts.push(error._details);
  }
  if (error._errors?.length) {
    const fieldErrors = error._errors
      .map((e) => {
        const field = e._field ? `[${e._field}]` : "";
        return `${field} ${e._message ?? ""}`.trim();
      })
      .filter(Boolean);
    if (fieldErrors.length > 0) {
      parts.push(`Campos: ${fieldErrors.join("; ")}`);
    }
  }

  return parts.length > 0
    ? `Santander API: ${parts.join(" — ")}`
    : "Santander API: Erro desconhecido";
}

/**
 * Parses the compound gatewayId into its components.
 * Format: nsuCode.nsuDate.ENV.covenantCode.bankNumber
 * Note: nsuDate contains hyphens (YYYY-MM-DD), so we can't simply split by dot.
 * Strategy: split by dot, then reassemble nsuDate from parts 1-3 (YYYY-MM-DD).
 *
 * Example: "abc123.2026-03-19.PRODUCAO.123456789.0000000000001"
 * Split by '.': ["abc123", "2026-03-19", "PRODUCAO", "123456789", "0000000000001"]
 *
 * Wait — nsuDate is YYYY-MM-DD which has hyphens, not dots. So splitting by dot is safe.
 * The 5 parts separated by dots are: nsuCode, nsuDate, ENV, covenantCode, bankNumber
 */
function parseGatewayId(gatewayId: string): {
  nsuCode: string;
  nsuDate: string;
  environment: string;
  covenantCode: string;
  bankNumber: string;
} {
  const parts = gatewayId.split(".");
  if (parts.length !== 5) {
    throw new Error(
      `Santander: gatewayId inválido — esperado formato nsuCode.nsuDate.ENV.covenantCode.bankNumber (5 partes), recebido ${parts.length} partes: "${gatewayId}"`,
    );
  }

  const [nsuCode, nsuDate, environment, covenantCode, bankNumber] = parts;
  return { nsuCode, nsuDate, environment, covenantCode, bankNumber };
}

/**
 * Maps Santander bill status to BoletoStatusResult status.
 */
function mapSantanderStatus(
  santanderStatus: string,
): "pending" | "paid" | "cancelled" | "expired" | "failed" {
  const normalized = santanderStatus.toUpperCase().trim();
  switch (normalized) {
    case "ATIVO":
      return "pending";
    case "LIQUIDADO":
    case "LIQUIDADO PARCIALMENTE":
      return "paid";
    case "BAIXADO":
      return "cancelled";
    default:
      return "pending";
  }
}

// ---------------------------------------------------------------------------
// Webhook types and helpers (US-SAN-006)
// ---------------------------------------------------------------------------

/**
 * Santander webhook payload — defensive typing since the exact format
 * is not fully documented in the OpenAPI spec. All fields are optional.
 */
interface SantanderWebhookPayload {
  // Status / event identification
  status?: string;
  situacao?: string;
  eventType?: string;
  type?: string;

  // Boleto identification
  covenantCode?: string;
  codigoConvenio?: string;
  convenio?: string;
  bankNumber?: string;
  nossoNumero?: string;
  nsuCode?: string;
  nsuDate?: string;
  environment?: string;

  // Payment details
  dataPagamento?: string;
  paymentDate?: string;
  settlementDate?: string;
  datLiquidacao?: string;
  valorPago?: string | number;
  paidAmount?: string | number;
  settlementValue?: string | number;
  vlrLiquidacao?: string | number;

  // Additional fields that may be present
  barcode?: string;
  digitableLine?: string;
  nominalValue?: string;
  dueDate?: string;

  // Allow any additional properties
  [key: string]: unknown;
}

/**
 * Maps Santander webhook status strings to WebhookEvent types.
 * Returns null for unrecognized statuses.
 */
function mapWebhookEventType(
  status: string,
): WebhookEvent["type"] | null {
  switch (status) {
    // Payment confirmed
    case "LIQUIDADO":
    case "LIQUIDADO PARCIALMENTE":
    case "PAGO":
    case "PAYMENT":
    case "PAID":
    case "SETTLED":
      return "boleto.paid";

    // Cancellation / write-off
    case "BAIXADO":
    case "BAIXA":
    case "CANCELLED":
    case "CANCELED":
    case "CANCEL":
      return "boleto.cancelled";

    // Expiration
    case "EXPIRADO":
    case "EXPIRED":
    case "VENCIDO":
      return "boleto.expired";

    default:
      return null;
  }
}

/**
 * Builds a gatewayId from webhook payload data.
 *
 * Attempts to reconstruct the full composite gatewayId format:
 *   nsuCode.nsuDate.ENV.covenantCode.bankNumber
 *
 * If nsuCode/nsuDate/environment are not in the payload, uses the
 * partial format that the webhook route can search with LIKE/endsWith.
 */
function buildGatewayIdFromWebhook(
  payload: SantanderWebhookPayload,
  covenantCode: string,
  bankNumber: string,
): string {
  const nsuCode = (payload.nsuCode ?? "").toString();
  const nsuDate = (payload.nsuDate ?? "").toString();
  const environment = (payload.environment ?? "").toString().toUpperCase();

  // If we have all parts, build the full gatewayId
  if (nsuCode && nsuDate && environment) {
    return `${nsuCode}.${nsuDate}.${environment}.${covenantCode}.${bankNumber}`;
  }

  // Partial: use suffix format that the webhook route matches against
  // The route will search boletos WHERE gatewayId LIKE '%.covenantCode.bankNumber'
  return `%.${covenantCode}.${bankNumber}`;
}

// ---------------------------------------------------------------------------
// SantanderProvider
// ---------------------------------------------------------------------------

export class SantanderProvider implements PaymentGateway {
  private readonly authManager: SantanderAuthManager;
  private readonly credentials: SantanderCredentials;
  private readonly settings: SantanderSettings;
  private readonly workspaceId: string;
  private readonly covenantCode: string;
  private readonly companyId: string;

  constructor(
    credentials: SantanderCredentials,
    metadata?: SantanderSettings | null,
    _webhookSecret?: string,
    workspaceId?: string,
    covenantCode?: string,
    companyId?: string,
  ) {
    if (!credentials.clientId || !credentials.clientSecret) {
      throw new Error(
        "Santander: clientId e clientSecret são obrigatórios",
      );
    }
    if (!credentials.certificate || !credentials.certificateKey) {
      throw new Error(
        "Santander: certificado (.CRT) e chave (.KEY) são obrigatórios",
      );
    }

    this.credentials = credentials;
    this.authManager = new SantanderAuthManager(credentials);
    this.settings = metadata ?? {};
    this.workspaceId = workspaceId ?? "";
    this.covenantCode = covenantCode ?? "";
    this.companyId = companyId ?? "";
  }

  // ──────────────────────────────────────────────
  // PaymentGateway — createBoleto
  // ──────────────────────────────────────────────

  async createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResult> {
    if (!this.workspaceId) {
      throw new Error("Santander: workspaceId é obrigatório para registrar boleto");
    }
    if (!this.covenantCode) {
      throw new Error("Santander: covenantCode é obrigatório para registrar boleto");
    }
    if (!this.companyId) {
      throw new Error("Santander: companyId é obrigatório para registrar boleto");
    }

    // 1. Generate unique identifiers
    const nsuCode = generateNsuCode();
    const nsuDate = formatDate(new Date());
    const environment = this.credentials.sandbox ? "TESTE" : "PRODUCAO";
    const bankNumber = await getNextBankNumber(this.companyId, this.covenantCode);

    // 2. Map customer → payer
    const cleanDoc = input.customer.document.replace(/\D/g, "");
    const payer: SantanderPayer = {
      name: input.customer.name.slice(0, 40),
      documentType: getDocumentType(input.customer.document),
      documentNumber: cleanDoc,
      address: input.customer.address?.street
        ? `${input.customer.address.street}, ${input.customer.address.number}`.slice(0, 40)
        : "Não informado",
      neighborhood: input.customer.address?.neighborhood?.slice(0, 30) ?? "Não informado",
      city: input.customer.address?.city?.slice(0, 20) ?? "Não informado",
      state: input.customer.address?.state ?? "SP",
      zipCode: input.customer.address?.zipCode
        ? formatZipCode(input.customer.address.zipCode)
        : "00000-000",
    };

    // 3. Build request payload
    const dueDate = formatDate(new Date(input.dueDate));
    const issueDate = formatDate(new Date());
    const nominalValue = formatNominalValue(input.amount);
    const documentKind =
      (this.settings.documentKind as string) || "DUPLICATA_MERCANTIL";

    const payload: SantanderBankSlipRequest = {
      environment,
      nsuCode,
      nsuDate,
      covenantCode: this.covenantCode,
      bankNumber,
      dueDate,
      issueDate,
      nominalValue,
      payer,
      documentKind,
      paymentType: "REGISTRO",
    };

    // Optional: client number (internal reference)
    if (input.metadata?.clientNumber) {
      payload.clientNumber = input.metadata.clientNumber;
    }

    // Optional: fine
    if (this.settings.finePercentage !== undefined && this.settings.finePercentage > 0) {
      payload.finePercentage = formatPercentage(this.settings.finePercentage);
      if (this.settings.fineQuantityDays !== undefined) {
        payload.fineQuantityDays = String(this.settings.fineQuantityDays);
      }
    }

    // Optional: interest
    if (this.settings.interestPercentage !== undefined && this.settings.interestPercentage > 0) {
      payload.interestPercentage = formatPercentage(this.settings.interestPercentage);
    }

    // Optional: write-off
    if (this.settings.writeOffQuantityDays !== undefined && this.settings.writeOffQuantityDays > 0) {
      payload.writeOffQuantityDays = String(this.settings.writeOffQuantityDays);
    }

    // Optional: protest
    if (this.settings.protestType && this.settings.protestType !== "SEM_PROTESTO") {
      payload.protestType = this.settings.protestType;
    }

    // Optional: messages
    if (this.settings.defaultMessages) {
      // Split by newlines, max 4 messages of 100 chars each
      const msgs = this.settings.defaultMessages
        .split("\n")
        .map((m) => m.trim())
        .filter(Boolean)
        .slice(0, 4)
        .map((m) => m.slice(0, 100));
      if (msgs.length > 0) {
        payload.messages = msgs;
      }
    }

    // Optional: Pix key for hybrid boleto (boleto + QR Code Pix)
    if (this.settings.pixKeyType && this.settings.pixDictKey) {
      payload.key = {
        type: this.settings.pixKeyType,
        dictKey: this.settings.pixDictKey,
      };
      // Generate txId for bolepix: alphanumeric 26-35 chars
      const txIdBase = `${this.covenantCode}${bankNumber}${Date.now().toString(36)}`;
      payload.txId = txIdBase.replace(/[^a-zA-Z0-9]/g, "").slice(0, 35).padEnd(26, "0");
    }

    // 4. POST to Santander API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.authManager.authenticatedFetch(
        `/workspaces/${this.workspaceId}/bank_slips`,
        {
          method: "POST",
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        let errorMessage: string;
        try {
          const errorBody = (await response.json()) as SantanderErrorTemplate;
          errorMessage = parseSantanderError(errorBody);
        } catch {
          errorMessage = `Santander API error (${response.status}): ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = (await response.json()) as SantanderBankSlipResponse;

      // 5. Build composite gatewayId
      const envCode = environment === "TESTE" ? "TESTE" : "PRODUCAO";
      const gatewayId = `${nsuCode}.${nsuDate}.${envCode}.${this.covenantCode}.${bankNumber}`;

      return {
        gatewayId,
        barcode: data.barcode ?? undefined,
        line: data.digitableLine ?? undefined,
        qrCode: data.qrCodePix ?? undefined,
        url: data.qrCodeUrl ?? undefined,
        nossoNumero: bankNumber,
        rawResponse: data,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(
          `Santander API timeout (${REQUEST_TIMEOUT_MS}ms): POST /workspaces/${this.workspaceId}/bank_slips`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ──────────────────────────────────────────────
  // PaymentGateway — getBoletoStatus
  // ──────────────────────────────────────────────

  async getBoletoStatus(gatewayId: string): Promise<BoletoStatusResult> {
    const { covenantCode, bankNumber } = parseGatewayId(gatewayId);
    const billId = `${covenantCode}.${bankNumber}`;

    // 1. First request: get current status
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.authManager.authenticatedFetch(
        `/bills/${billId}?tipoConsulta=default`,
        { signal: controller.signal },
      );

      if (!response.ok) {
        let errorMessage: string;
        try {
          const errorBody = (await response.json()) as SantanderErrorTemplate;
          errorMessage = parseSantanderError(errorBody);
        } catch {
          errorMessage = `Santander API error (${response.status}): ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = (await response.json()) as SantanderBillStatusResponse;
      const santanderStatus = (data.status ?? "").toUpperCase().trim();
      const status = mapSantanderStatus(santanderStatus);

      const result: BoletoStatusResult = {
        gatewayId,
        status,
      };

      // 2. If paid (LIQUIDADO or LIQUIDADO PARCIALMENTE), fetch settlement details
      if (
        santanderStatus === "LIQUIDADO" ||
        santanderStatus === "LIQUIDADO PARCIALMENTE"
      ) {
        const settlementData = await this.fetchSettlementData(billId);
        if (settlementData) {
          result.paidAt = settlementData.paidAt;
          result.paidAmount = settlementData.paidAmount;
        }
      }

      return result;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(
          `Santander API timeout (${REQUEST_TIMEOUT_MS}ms): GET /bills/${billId}`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ──────────────────────────────────────────────
  // PaymentGateway — cancelBoleto
  // ──────────────────────────────────────────────

  async cancelBoleto(gatewayId: string): Promise<{ success: boolean }> {
    if (!this.workspaceId) {
      throw new Error("Santander: workspaceId é obrigatório para cancelar boleto");
    }

    const { covenantCode, bankNumber } = parseGatewayId(gatewayId);

    const payload: SantanderInstructionRequest = {
      covenantCode,
      bankNumber,
      operation: "BAIXAR",
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.authManager.authenticatedFetch(
        `/workspaces/${this.workspaceId}/bank_slips`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );

      if (response.status === 201 || response.ok) {
        // Attempt to read response body for confirmation
        try {
          const data = (await response.json()) as SantanderInstructionResponse;
          // Check if response contains an error code despite 2xx status
          if (data._errorCode && data._errorCode >= 400) {
            throw new Error(
              parseSantanderError(data as unknown as SantanderErrorTemplate),
            );
          }
        } catch (parseErr) {
          // If JSON parsing fails on a 2xx, still consider it success
          if (parseErr instanceof SyntaxError) {
            return { success: true };
          }
          throw parseErr;
        }
        return { success: true };
      }

      // Non-success status
      let errorMessage: string;
      try {
        const errorBody = (await response.json()) as SantanderErrorTemplate;
        errorMessage = parseSantanderError(errorBody);
      } catch {
        errorMessage = `Santander API error (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMessage);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(
          `Santander API timeout (${REQUEST_TIMEOUT_MS}ms): PATCH /workspaces/${this.workspaceId}/bank_slips`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ──────────────────────────────────────────────
  // PaymentGateway — testConnection
  // ──────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.authManager.authenticatedFetch(
        "/workspaces",
        { signal: controller.signal },
      );

      if (response.ok) {
        try {
          const data = (await response.json()) as SantanderWorkspacesResponse;
          const count =
            data.totalElements ?? data.content?.length ?? 0;
          return {
            ok: true,
            message: `Conectado ao Santander (${count} workspaces)`,
          };
        } catch {
          return {
            ok: true,
            message: "Conectado ao Santander",
          };
        }
      }

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          message: "Credenciais inválidas",
        };
      }

      return {
        ok: false,
        message: `Erro ao conectar (HTTP ${response.status})`,
      };
    } catch (err) {
      // TLS/certificate errors
      if (err instanceof Error) {
        const msg = err.message.toLowerCase();
        if (
          msg.includes("certificate") ||
          msg.includes("ssl") ||
          msg.includes("tls") ||
          msg.includes("unable to verify") ||
          msg.includes("self signed") ||
          msg.includes("cert") ||
          msg.includes("eproto") ||
          msg.includes("err_tls")
        ) {
          return {
            ok: false,
            message: "Certificado inválido ou expirado",
          };
        }

        // 401 thrown by authManager (token request failed)
        if (msg.includes("não autorizado") || msg.includes("401")) {
          return {
            ok: false,
            message: "Credenciais inválidas",
          };
        }
      }

      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ──────────────────────────────────────────────
  // PaymentGateway — webhooks (US-SAN-006)
  // ──────────────────────────────────────────────

  /**
   * Validates an incoming Santander webhook request.
   * Basic validation: Content-Type must be JSON and body must be parseable.
   * Santander does not provide HMAC signatures — validation is URL-based
   * (each provider has a unique webhook URL with providerId).
   */
  validateWebhook(headers: Record<string, string>, body: string): boolean {
    // 1. Check Content-Type is JSON (Santander sends application/json)
    const contentType = headers["content-type"] ?? "";
    if (!contentType.includes("json")) {
      console.warn(
        `[santander-webhook] Invalid Content-Type: ${contentType}`,
      );
      return false;
    }

    // 2. Check body is parseable JSON
    try {
      JSON.parse(body);
    } catch {
      console.warn("[santander-webhook] Body is not valid JSON");
      return false;
    }

    return true;
  }

  /**
   * Parses a Santander webhook notification payload into a WebhookEvent.
   *
   * Santander webhook payload format is not fully documented.
   * This handler is defensive — it logs the raw event and tries to extract:
   * - status/event type (payment, baixa/cancellation)
   * - covenantCode + bankNumber → gatewayId
   * - payment details (paidAt, paidAmount)
   *
   * Returns null for unrecognized event types (acknowledged but not processed).
   */
  parseWebhookEvent(body: string): WebhookEvent | null {
    let payload: SantanderWebhookPayload;
    try {
      payload = JSON.parse(body) as SantanderWebhookPayload;
    } catch {
      console.error("[santander-webhook] Failed to parse webhook body");
      return null;
    }

    // Log raw event for debugging (always, regardless of outcome)
    console.log(
      "[santander-webhook] Raw event received:",
      JSON.stringify(payload).slice(0, 2000),
    );

    // Extract status/event type from payload
    // Santander may use different field names; try multiple possibilities
    const status = (
      payload.status ??
      payload.situacao ??
      payload.eventType ??
      payload.type ??
      ""
    )
      .toString()
      .toUpperCase()
      .trim();

    // Map Santander event status to WebhookEvent type
    const eventType = mapWebhookEventType(status);
    if (!eventType) {
      console.warn(
        `[santander-webhook] Unknown event status: "${status}", skipping`,
      );
      return null;
    }

    // Extract covenantCode and bankNumber to build gatewayId
    const covenantCode = (
      payload.covenantCode ??
      payload.codigoConvenio ??
      payload.convenio ??
      ""
    ).toString();
    const bankNumber = (
      payload.bankNumber ??
      payload.nossoNumero ??
      payload.nsuCode ??
      ""
    ).toString();

    if (!covenantCode || !bankNumber) {
      console.error(
        "[santander-webhook] Missing covenantCode or bankNumber in payload",
      );
      return null;
    }

    // Build gatewayId — match format used in createBoleto:
    // nsuCode.nsuDate.ENV.covenantCode.bankNumber
    // From webhook we only have covenantCode + bankNumber, so we search
    // using a partial match pattern. The webhook route will handle lookup.
    // For now, compose a searchable gatewayId suffix.
    const gatewayId = buildGatewayIdFromWebhook(payload, covenantCode, bankNumber);

    // Extract payment details
    let paidAt: Date | undefined;
    let paidAmount: number | undefined;

    const paymentDate =
      payload.dataPagamento ??
      payload.paymentDate ??
      payload.settlementDate ??
      payload.datLiquidacao;
    if (paymentDate) {
      const parsed = new Date(paymentDate.toString());
      if (!isNaN(parsed.getTime())) {
        paidAt = parsed;
      }
    }

    const paymentValue =
      payload.valorPago ??
      payload.paidAmount ??
      payload.settlementValue ??
      payload.vlrLiquidacao;
    if (paymentValue !== undefined && paymentValue !== null) {
      const numValue = parseFloat(paymentValue.toString());
      if (!isNaN(numValue)) {
        // If value looks like reais (has decimal), convert to centavos
        paidAmount = numValue < 1000 && paymentValue.toString().includes(".")
          ? Math.round(numValue * 100)
          : Math.round(numValue);
      }
    }

    return {
      type: eventType,
      gatewayId,
      paidAt,
      paidAmount,
      rawEvent: payload,
    };
  }

  // ──────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────

  /**
   * Fetches settlement details for a paid bill.
   * Uses tipoConsulta=settlement to get paidAt and paidAmount.
   */
  private async fetchSettlementData(
    billId: string,
  ): Promise<{ paidAt?: Date; paidAmount?: number } | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.authManager.authenticatedFetch(
        `/bills/${billId}?tipoConsulta=settlement`,
        { signal: controller.signal },
      );

      if (!response.ok) {
        // Settlement query failed — return null, caller still has the status
        return null;
      }

      const data = (await response.json()) as SantanderBillSettlementResponse;

      if (!data.settlementData?.length) {
        return null;
      }

      // Use the most recent settlement entry
      const settlement = data.settlementData[0];

      const result: { paidAt?: Date; paidAmount?: number } = {};

      if (settlement.settlementDate) {
        result.paidAt = new Date(settlement.settlementDate);
      }

      if (settlement.settlementValue) {
        // settlementValue comes as string "X.XX" (reais)
        const valueInReais = parseFloat(settlement.settlementValue);
        if (!isNaN(valueInReais)) {
          // Convert to centavos to match BoletoStatusResult.paidAmount convention
          result.paidAmount = Math.round(valueInReais * 100);
        }
      }

      return result;
    } catch {
      // Settlement fetch is best-effort — don't fail the entire status query
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
