import type {
  PaymentGateway,
  CreateBoletoInput,
  CreateBoletoResult,
  BoletoStatusResult,
  WebhookEvent,
} from "../types";

/**
 * Mock payment provider for testing purposes.
 * Migrated from the original MockBoletoProvider in erp/src/lib/boleto.ts.
 *
 * Returns fake but structurally valid data for all operations.
 */
export class MockProvider implements PaymentGateway {
  async createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResult> {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const installmentSuffix = input.installmentNumber ?? 0;
    const gatewayId = `MOCK${timestamp}${random}${installmentSuffix}`;

    const line = `23793.38128 60000.000${random} ${installmentSuffix}0000.000${timestamp} 1 ${input.amount}`;
    const barcode = `23791${input.amount}${timestamp}${random}0000000000${installmentSuffix}`;

    console.log("========== BOLETO (MOCK) ==========");
    console.log(`Gateway ID:     ${gatewayId}`);
    console.log(`Client:         ${input.customer.name} (${input.customer.document})`);
    console.log(`Value:          R$ ${(input.amount / 100).toFixed(2)}`);
    console.log(`Due Date:       ${input.dueDate.toISOString().split("T")[0]}`);
    if (input.installmentNumber && input.totalInstallments) {
      console.log(
        `Installment:    ${input.installmentNumber}/${input.totalInstallments}`
      );
    }
    console.log("===================================");

    return {
      gatewayId,
      url: `https://mock-bank.example.com/boleto/${gatewayId}`,
      line,
      barcode,
      qrCode: `https://mock-bank.example.com/qr/${gatewayId}`,
      pdf: `https://mock-bank.example.com/pdf/${gatewayId}`,
      nossoNumero: gatewayId.slice(0, 12),
      rawResponse: {
        provider: "mock",
        generatedAt: new Date().toISOString(),
        input: {
          customer: input.customer.name,
          amount: input.amount,
          dueDate: input.dueDate.toISOString(),
        },
      },
    };
  }

  async getBoletoStatus(gatewayId: string): Promise<BoletoStatusResult> {
    return {
      gatewayId,
      status: "pending",
    };
  }

  async cancelBoleto(): Promise<{ success: boolean }> {
    return { success: true };
  }

  validateWebhook(): boolean {
    return true;
  }

  parseWebhookEvent(body: string): WebhookEvent {
    const parsed =
      typeof body === "string" ? JSON.parse(body) : (body as unknown);
    const event = parsed as Record<string, unknown>;

    return {
      type: "boleto.paid",
      gatewayId: (event.gatewayId as string) ?? "mock-gateway-id",
      paidAt: new Date(),
      paidAmount: (event.amount as number) ?? 0,
      rawEvent: event,
    };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "Mock provider ativo" };
  }
}
