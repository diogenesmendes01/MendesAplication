import type { ProviderDefinition } from "./types";

/**
 * Registry de providers disponíveis apenas em produção.
 * Não inclui o provider mock.
 */
export const PRODUCTION_PROVIDER_REGISTRY: Record<string, ProviderDefinition> = {
  pagarme: {
    id: "pagarme",
    name: "Pagar.me",
    configSchema: [
      {
        key: "apiKey",
        label: "Secret Key",
        type: "password",
        required: true,
        placeholder: "sk_live_...",
        helpText:
          "Encontre em Pagar.me Dashboard → Configurações → Chaves",
        group: "credentials",
      },
    ],
    settingsSchema: [
      {
        key: "defaultInstructions",
        label: "Instruções do Boleto",
        type: "text",
        required: false,
        placeholder: "Não receber após vencimento",
        group: "settings",
      },
      {
        key: "daysToExpire",
        label: "Dias para expirar",
        type: "number",
        required: false,
        placeholder: "5",
        group: "settings",
      },
    ],
  },
  pinbank: {
    id: "pinbank",
    name: "PinBank",
    configSchema: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
        required: true,
        group: "credentials",
      },
      {
        key: "convenio",
        label: "Convênio",
        type: "text",
        required: true,
        group: "credentials",
      },
      {
        key: "carteira",
        label: "Carteira",
        type: "text",
        required: true,
        group: "credentials",
      },
      {
        key: "cedente",
        label: "Código Cedente",
        type: "text",
        required: true,
        group: "credentials",
      },
      {
        key: "agencia",
        label: "Agência",
        type: "text",
        required: true,
        group: "credentials",
      },
      {
        key: "conta",
        label: "Conta",
        type: "text",
        required: true,
        group: "credentials",
      },
    ],
    settingsSchema: [
      {
        key: "multa",
        label: "Multa (%)",
        type: "number",
        required: false,
        group: "settings",
      },
      {
        key: "juros",
        label: "Juros ao mês (%)",
        type: "number",
        required: false,
        group: "settings",
      },
      {
        key: "desconto",
        label: "Desconto antecipação (%)",
        type: "number",
        required: false,
        group: "settings",
      },
      {
        key: "diasDesconto",
        label: "Dias antecedência p/ desconto",
        type: "number",
        required: false,
        group: "settings",
      },
    ],
  },
};

/**
 * Registry estendido com providers de desenvolvimento/teste.
 * Inclui todos os providers de produção + mock.
 *
 * @internal — use `PROVIDER_REGISTRY` para acesso público; importar
 * `DEV_PROVIDER_REGISTRY` diretamente bypassa o env check de produção.
 */
export const DEV_PROVIDER_REGISTRY: Record<string, ProviderDefinition> = {
  ...PRODUCTION_PROVIDER_REGISTRY,
  mock: {
    id: "mock",
    name: "Mock (Teste)",
    configSchema: [],
    settingsSchema: [],
  },
};

/**
 * Registro central de todos os providers disponíveis.
 * Em produção: apenas pagarme e pinbank.
 * Em dev/test: inclui mock.
 * O frontend consulta isso pra saber quais bancos existem e quais campos mostrar.
 */
export const PROVIDER_REGISTRY: Record<string, ProviderDefinition> =
  process.env.NODE_ENV === "production"
    ? PRODUCTION_PROVIDER_REGISTRY
    : DEV_PROVIDER_REGISTRY;
