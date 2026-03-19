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
  // PaymentGateway — placeholders (US-SAN-005)
  // ──────────────────────────────────────────────

  async getBoletoStatus(): Promise<BoletoStatusResult> {
    throw new Error(
      "Santander: getBoletoStatus não implementado — aguardando US-SAN-005",
    );
  }

  async cancelBoleto(): Promise<{ success: boolean }> {
    throw new Error(
      "Santander: cancelBoleto não implementado — aguardando US-SAN-005",
    );
  }

  validateWebhook(): boolean {
    throw new Error(
      "Santander: validateWebhook não implementado — aguardando US-SAN-005",
    );
  }

  parseWebhookEvent(): WebhookEvent | null {
    throw new Error(
      "Santander: parseWebhookEvent não implementado — aguardando US-SAN-005",
    );
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    throw new Error(
      "Santander: testConnection não implementado — aguardando US-SAN-005",
    );
  }
}
