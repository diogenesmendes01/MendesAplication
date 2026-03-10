import type { PaymentGateway } from "./types";
import { PROVIDER_REGISTRY } from "./registry";
import { MockProvider } from "./providers/mock.provider";

/**
 * Instancia o gateway correto baseado no tipo do provider.
 *
 * @param providerType - Tipo do provider ("pagarme" | "pinbank" | "mock")
 * @param decryptedCredentials - Credentials já decriptadas (JSON parseado)
 * @param metadata - Config comportamental (juros, multa, instruções, etc.)
 * @returns Instância de PaymentGateway
 *
 * @throws Error se o provider não existir no registry
 * @throws Error se o provider ainda não estiver implementado
 */
export function getGateway(
  providerType: string,
  decryptedCredentials: Record<string, unknown>,
  metadata?: Record<string, unknown> | null
): PaymentGateway {
  if (!PROVIDER_REGISTRY[providerType]) {
    throw new Error(`Provider not found: ${providerType}`);
  }

  switch (providerType) {
    case "mock":
      return new MockProvider();
    case "pagarme":
    case "pinbank":
      throw new Error(
        `Provider "${providerType}" not implemented yet. ` +
          `Credentials and metadata received: ${!!decryptedCredentials}, ${!!metadata}`
      );
    default:
      throw new Error(`Provider not found: ${providerType}`);
  }
}
