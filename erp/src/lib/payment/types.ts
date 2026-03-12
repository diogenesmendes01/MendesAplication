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
