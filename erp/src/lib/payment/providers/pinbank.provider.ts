import type {
  PaymentGateway,
  CreateBoletoResult,
  BoletoStatusResult,
  WebhookEvent,
} from "../types";

const NOT_IMPLEMENTED =
  "PinBank provider não implementado — aguardando documentação da API";

/**
 * PinBank payment provider placeholder.
 *
 * All methods throw until the PinBank API documentation is available
 * and the integration is implemented.
 */
export class PinBankProvider implements PaymentGateway {
  async createBoleto(): Promise<CreateBoletoResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getBoletoStatus(): Promise<BoletoStatusResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async cancelBoleto(): Promise<{ success: boolean }> {
    throw new Error(NOT_IMPLEMENTED);
  }

  validateWebhook(): boolean {
    throw new Error(NOT_IMPLEMENTED);
  }

  parseWebhookEvent(): WebhookEvent | null {
    throw new Error(NOT_IMPLEMENTED);
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: false, message: "Provider em desenvolvimento" };
  }
}
