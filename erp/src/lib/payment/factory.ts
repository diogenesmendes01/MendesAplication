import type { PaymentGateway } from "./types";
import { PROVIDER_REGISTRY } from "./registry";
import { MockProvider } from "./providers/mock.provider";
import { PagarmeProvider } from "./providers/pagarme.provider";
import { PinBankProvider } from "./providers/pinbank.provider";

/**
 * Instancia o gateway correto baseado no tipo do provider.
 *
 * @param providerType - Tipo do provider ("pagarme" | "pinbank" | "mock")
 * @param decryptedCredentials - Credentials já decriptadas (JSON parseado)
 * @param metadata - Config comportamental (juros, multa, instruções, etc.)
 * @param webhookSecret - Secret para validação de webhooks (opcional)
 * @returns Instância de PaymentGateway
 *
 * @throws Error se o provider não existir no registry
 * @throws Error se o provider ainda não estiver implementado
 */
export function getGateway(
  providerType: string,
  decryptedCredentials: Record<string, unknown>,
  metadata?: Record<string, unknown> | null,
  webhookSecret?: string
): PaymentGateway {
  if (!PROVIDER_REGISTRY[providerType]) {
    throw new Error(`Provider not found: ${providerType}`);
  }

  switch (providerType) {
    case "mock":
      return new MockProvider();
    case "pagarme":
      return new PagarmeProvider(
        { apiKey: decryptedCredentials.apiKey as string },
        metadata
          ? {
              defaultInstructions: metadata.defaultInstructions as
                | string
                | undefined,
              daysToExpire: metadata.daysToExpire as number | undefined,
            }
          : null,
        webhookSecret
      );
    case "pinbank":
      return new PinBankProvider();
    default:
      throw new Error(`Provider not found: ${providerType}`);
  }
}
