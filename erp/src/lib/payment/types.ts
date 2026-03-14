// ============================================================
// Provider Types — lista canônica dos providers suportados
// ============================================================

/** Providers de produção — únicos valores válidos para registros no banco. */
export const PROVIDER_TYPES = ["pagarme", "pinbank"] as const;

/**
 * Provider de mock — usado exclusivamente como fallback interno em ambiente
 * de dev/test ou quando nenhum provider está configurado na empresa.
 * Não deve ser persistido no banco em produção.
 */
export const MOCK_PROVIDER = "mock" as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number] | typeof MOCK_PROVIDER;

/**
 * Type guard para narrowing em runtime: verifica se um valor lido do banco
 * corresponde a um provider válido antes de passá-lo para getGateway().
 *
 * Elimina a necessidade de casts `as ProviderType` e garante fail-fast
 * com mensagem clara para dados legados ou corrompidos.
 *
 * Nota: "mock" é aceito pois pode ser usado como fallback interno (ver propostas/actions.ts).
 * Valores de DB deveriam constar apenas em PROVIDER_TYPES (produção).
 */
export function isProviderType(v: string): v is ProviderType {
  return (PROVIDER_TYPES as readonly string[]).includes(v) || v === MOCK_PROVIDER;
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
