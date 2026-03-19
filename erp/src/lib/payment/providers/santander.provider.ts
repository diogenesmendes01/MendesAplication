import type {
  PaymentGateway,
  CreateBoletoResult,
  BoletoStatusResult,
  WebhookEvent,
} from "../types";

const NOT_IMPLEMENTED =
  "Santander provider não está implementado — aguardando US-SAN-004";

/**
 * Santander payment provider placeholder.
 *
 * All methods throw until the Santander API integration is implemented
 * in US-SAN-004.
 */
export class SantanderProvider implements PaymentGateway {
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
