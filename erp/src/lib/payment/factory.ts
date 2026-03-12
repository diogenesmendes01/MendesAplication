import type { PaymentGateway } from "./types";
import { PROVIDER_REGISTRY } from "./registry";
import { MockProvider } from "./providers/mock.provider";
import { PagarmeProvider } from "./providers/pagarme.provider";

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

    case "pagarme": {
      // Bug #17 fix: Validate required credential fields before instantiation
      const apiKey = decryptedCredentials.apiKey;
      if (!apiKey || typeof apiKey !== "string") {
        throw new Error(
          "Pagar.me: campo 'apiKey' é obrigatório e deve ser uma string válida"
        );
      }
      return new PagarmeProvider(
        { apiKey },
        metadata
          ? {
              defaultInstructions:
                typeof metadata.defaultInstructions === "string"
                  ? metadata.defaultInstructions
                  : undefined,
              daysToExpire:
                typeof metadata.daysToExpire === "number"
                  ? metadata.daysToExpire
                  : undefined,
            }
          : null,
        webhookSecret
      );
    }

    case "pinbank":
      // Bug #9 fix: Throw explicit "not implemented" instead of silently failing
      throw new Error(
        "PinBank provider não está implementado. Aguardando documentação da API."
      );

    default:
      throw new Error(`Provider not found: ${providerType}`);
  }
}
