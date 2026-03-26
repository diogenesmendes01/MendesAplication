import type { PaymentGateway } from "./types";
import { PROVIDER_REGISTRY } from "./registry";
import { PagarmeProvider } from "./providers/pagarme.provider";
import { SantanderProvider } from "./providers/santander.provider";
import { CobreFacilProvider } from "./providers/cobrefacil.provider";
import { LytexProvider } from "./providers/lytex.provider";
import { VindiProvider } from "./providers/vindi.provider";
import type { SantanderCredentials } from "./providers/santander-auth";

// ---------------------------------------------------------------------------
// Gateway Options — passed to constructor factories
// ---------------------------------------------------------------------------

interface GatewayOptions {
  sandbox?: boolean;
  companyId?: string;
}

// ---------------------------------------------------------------------------
// Constructor Factory Registry
//
// Maps provider type → factory function that knows how to validate credentials
// and instantiate the correct PaymentGateway implementation.
//
// To add a new provider:
// 1. Implement PaymentGateway in providers/<name>.provider.ts
// 2. Register it in PRODUCTION_PROVIDER_REGISTRY (registry.ts)
// 3. Add a factory entry in GATEWAY_FACTORIES below
// ---------------------------------------------------------------------------

type GatewayFactory = (
  decryptedCredentials: Record<string, unknown>,
  metadata: Record<string, unknown> | null | undefined,
  webhookSecret: string | undefined,
  options: GatewayOptions | undefined,
) => PaymentGateway | Promise<PaymentGateway>;

const GATEWAY_FACTORIES: Record<string, GatewayFactory> = {
  mock: async () => {
    const { MockProvider } = await import("./providers/mock.provider");
    return new MockProvider();
  },

  pagarme: (decryptedCredentials, metadata, webhookSecret) => {
    // Bug #17 fix: Validate required credential fields before instantiation
    const apiKey = decryptedCredentials.apiKey;
    if (!apiKey || typeof apiKey !== "string") {
      throw new Error(
        "Pagar.me: campo 'apiKey' é obrigatório e deve ser uma string válida",
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
      webhookSecret,
    );
  },

  pinbank: () => {
    // Bug #9 fix: Throw explicit "not implemented" instead of silently failing
    throw new Error(
      "PinBank provider não está implementado. Aguardando documentação da API.",
    );
  },

  santander: (decryptedCredentials, metadata, webhookSecret, options) => {
    const creds: SantanderCredentials = {
      clientId: String(decryptedCredentials.clientId ?? ""),
      clientSecret: String(decryptedCredentials.clientSecret ?? ""),
      certificate: String(decryptedCredentials.certificate ?? ""),
      certificateKey: String(decryptedCredentials.certificateKey ?? ""),
      keyUser: String(decryptedCredentials.keyUser ?? ""),
      sandbox: options?.sandbox ?? false,
    };
    const workspaceId = String(decryptedCredentials.workspaceId ?? "");
    const covenantCode = String(decryptedCredentials.covenantCode ?? "");
    const companyId = options?.companyId ?? "";

    return new SantanderProvider(
      creds,
      metadata as Record<string, unknown> | null,
      webhookSecret,
      workspaceId,
      covenantCode,
      companyId,
    );
  },

  cobrefacil: (decryptedCredentials, metadata, webhookSecret) => {
    const appId = decryptedCredentials.appId;
    const secret = decryptedCredentials.secret;

    if (!appId || typeof appId !== "string") {
      throw new Error(
        "Cobre Fácil: campo 'appId' é obrigatório e deve ser uma string válida",
      );
    }
    if (!secret || typeof secret !== "string") {
      throw new Error(
        "Cobre Fácil: campo 'secret' é obrigatório e deve ser uma string válida",
      );
    }

    return new CobreFacilProvider(
      { appId, secret },
      metadata
        ? {
            defaultPaymentMethod:
              typeof metadata.defaultPaymentMethod === "string"
                ? (metadata.defaultPaymentMethod as
                    | "bankslip"
                    | "pix"
                    | "credit_card")
                : undefined,
            finePercentage:
              typeof metadata.finePercentage === "number"
                ? metadata.finePercentage
                : undefined,
            interestPercentage:
              typeof metadata.interestPercentage === "number"
                ? metadata.interestPercentage
                : undefined,
            discountPercentage:
              typeof metadata.discountPercentage === "number"
                ? metadata.discountPercentage
                : undefined,
            discountDays:
              typeof metadata.discountDays === "number"
                ? metadata.discountDays
                : undefined,
          }
        : null,
      webhookSecret,
    );
  },

  lytex: (decryptedCredentials, metadata, webhookSecret, options) => {
    const clientId = decryptedCredentials.clientId;
    const clientSecret = decryptedCredentials.clientSecret;

    if (!clientId || typeof clientId !== "string") {
      throw new Error(
        "Lytex: campo 'clientId' é obrigatório e deve ser uma string válida",
      );
    }
    if (!clientSecret || typeof clientSecret !== "string") {
      throw new Error(
        "Lytex: campo 'clientSecret' é obrigatório e deve ser uma string válida",
      );
    }

    return new LytexProvider(
      {
        clientId,
        clientSecret,
        sandbox: options?.sandbox ?? false,
      },
      metadata
        ? {
            defaultPaymentMethod:
              typeof metadata.defaultPaymentMethod === "string"
                ? (metadata.defaultPaymentMethod as
                    | "boleto"
                    | "pix"
                    | "creditCard")
                : undefined,
            cancelOverdueDays:
              typeof metadata.cancelOverdueDays === "number"
                ? metadata.cancelOverdueDays
                : undefined,
            overduePaymentDays:
              typeof metadata.overduePaymentDays === "number"
                ? metadata.overduePaymentDays
                : undefined,
            enableMulctAndInterest: !!metadata.enableMulctAndInterest,
            mulctPercentage:
              typeof metadata.mulctPercentage === "number"
                ? metadata.mulctPercentage
                : undefined,
            interestPercentage:
              typeof metadata.interestPercentage === "number"
                ? metadata.interestPercentage
                : undefined,
            enableSerasa: !!metadata.enableSerasa,
            serasaNegativityDays:
              typeof metadata.serasaNegativityDays === "number"
                ? metadata.serasaNegativityDays
                : undefined,
            billingRuleId:
              typeof metadata.billingRuleId === "string"
                ? metadata.billingRuleId
                : undefined,
          }
        : null,
      webhookSecret,
    );
  },

  vindi: (decryptedCredentials, metadata, webhookSecret, options) => {
    const apiKey = decryptedCredentials.apiKey;

    if (!apiKey || typeof apiKey !== "string") {
      throw new Error(
        "Vindi: campo 'apiKey' é obrigatório e deve ser uma string válida",
      );
    }

    return new VindiProvider(
      { apiKey, sandbox: options?.sandbox ?? false },
      metadata
        ? {
            defaultPaymentMethodCode:
              typeof metadata.defaultPaymentMethodCode === "string"
                ? metadata.defaultPaymentMethodCode
                : undefined,
          }
        : null,
      webhookSecret,
    );
  },
};

// ---------------------------------------------------------------------------
// getGateway — public API
// ---------------------------------------------------------------------------

/**
 * Instancia o gateway correto baseado no tipo do provider.
 *
 * Uses a registry-based factory pattern: each provider registers a factory
 * function in GATEWAY_FACTORIES. Adding a new provider requires only adding
 * an entry — no switch/case modification needed.
 *
 * Now async to support dynamic imports (e.g. MockProvider is lazy-loaded
 * so it never ends up in the production bundle).
 *
 * @param providerType - Tipo do provider ("pagarme" | "pinbank" | "santander" | "cobrefacil" | "lytex" | "vindi" | "mock")
 * @param decryptedCredentials - Credentials já decriptadas (JSON parseado)
 * @param metadata - Config comportamental (juros, multa, instruções, etc.)
 * @param webhookSecret - Secret para validação de webhooks (opcional)
 * @param options - Opções adicionais (sandbox, companyId)
 * @returns Instância de PaymentGateway
 *
 * @throws Error se o provider não existir no registry
 * @throws Error se o provider ainda não estiver implementado
 */
export async function getGateway(
  providerType: string,
  decryptedCredentials: Record<string, unknown>,
  metadata?: Record<string, unknown> | null,
  webhookSecret?: string,
  options?: GatewayOptions,
): Promise<PaymentGateway> {
  if (!PROVIDER_REGISTRY[providerType]) {
    throw new Error(`Provider not found: ${providerType}`);
  }

  const factory = GATEWAY_FACTORIES[providerType];
  if (!factory) {
    throw new Error(
      `Provider "${providerType}" is registered but has no gateway factory. ` +
        `Add a factory entry in GATEWAY_FACTORIES (factory.ts).`,
    );
  }

  return factory(decryptedCredentials, metadata, webhookSecret, options);
}
