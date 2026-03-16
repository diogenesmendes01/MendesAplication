// ============================================================
// Provider Types — lista canônica dos providers suportados
// ============================================================

import { PRODUCTION_PROVIDER_TYPES } from "./constants";

/**
 * Providers de produção — fonte canônica derivada de PRODUCTION_PROVIDER_TYPES (constants.ts).
 * Re-exportado como alias para retrocompatibilidade com imports existentes de types.ts.
 * NÃO duplique a lista aqui — adicione novos providers apenas em constants.ts.
 */
export const PROVIDER_TYPES = PRODUCTION_PROVIDER_TYPES;

/**
 * Provider de mock — usado exclusivamente como fallback interno em ambiente
 * de dev/test ou quando nenhum provider está configurado na empresa.
 * Não deve ser persistido no banco em produção.
 */
export const MOCK_PROVIDER = "mock" as const;

export type ProviderType = (typeof PRODUCTION_PROVIDER_TYPES)[number] | typeof MOCK_PROVIDER;

/**
 * Type guard para narrowing em runtime: verifica se um valor lido do banco
 * corresponde a um provider válido antes de passá-lo para getGateway().
 *
 * Elimina a necessidade de casts `as ProviderType` e garante fail-fast
 * com mensagem clara para dados legados ou corrompidos.
 *
 * Nota: "mock" só é aceito fora de produção (NODE_ENV !== "production").
 * A rejeição final em produção é reforçada também via PROVIDER_REGISTRY
 * (factory.ts), que não registra o mock quando NODE_ENV=production.
 * Este type guard valida tanto a forma do valor quanto o ambiente de execução.
 */
export function isProviderType(v: string): v is ProviderType {
  if ((PRODUCTION_PROVIDER_TYPES as readonly string[]).includes(v)) return true;
  if (process.env.NODE_ENV !== "production" && v === MOCK_PROVIDER) return true;
  return false;
}

// ============================================================
// Config Schema — cada provider define quais campos precisa
// ============================================================

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "boolean" | "select";
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: { value: string; label: string }[];
  group?: "credentials" | "settings";
}

export interface ProviderDefinition {
  id: string;
  name: string;
  logo?: string;
  configSchema: ConfigField[];
  settingsSchema: ConfigField[];
}

// ============================================================
// Gateway Interface — contrato que todo provider implementa
// ============================================================

export interface PaymentGateway {
  createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResult>;
  getBoletoStatus(gatewayId: string): Promise<BoletoStatusResult>;
  cancelBoleto(gatewayId: string): Promise<{ success: boolean }>;
  validateWebhook(headers: Record<string, string>, body: string): boolean;
  parseWebhookEvent(body: string): WebhookEvent | null;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

export interface CreateBoletoInput {
  customer: {
    name: string;
    document: string;
    documentType: "cpf" | "cnpj";
    email?: string;
    address?: {
      street: string;
      number: string;
      complement?: string;
      neighborhood: string;
      city: string;
      state: string;
      zipCode: string;
    };
  };
  amount: number;
  dueDate: Date;
  installmentNumber?: number;
  totalInstallments?: number;
  description?: string;
  instructions?: string;
  metadata?: Record<string, string>;
}

export interface CreateBoletoResult {
  gatewayId: string;
  url?: string;
  line?: string;
  barcode?: string;
  qrCode?: string;
  pdf?: string;
  nossoNumero?: string;
  rawResponse?: unknown;
}

export interface BoletoStatusResult {
  gatewayId: string;
  status: "pending" | "paid" | "cancelled" | "expired" | "failed";
  paidAt?: Date;
  paidAmount?: number;
}

export interface WebhookEvent {
  type:
    | "boleto.paid"
    | "boleto.cancelled"
    | "boleto.expired"
    | "boleto.failed";
  gatewayId: string;
  paidAt?: Date;
  paidAmount?: number;
  rawEvent: unknown;
}
