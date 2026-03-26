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
  santander: {
    id: "santander",
    name: "Santander",
    configSchema: [
      {
        key: "clientId",
        label: "Client ID",
        type: "text",
        required: true,
        group: "credentials",
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        type: "password",
        required: true,
        group: "credentials",
      },
      {
        key: "keyUser",
        label: "Key User",
        type: "text",
        required: true,
        group: "credentials",
      },
      {
        key: "covenantCode",
        label: "Código do Convênio",
        type: "text",
        required: true,
        group: "credentials",
      },
      {
        key: "certificate",
        label: "Certificado (.CRT)",
        type: "password",
        required: true,
        helpText: "Conteúdo do .CRT em PEM",
        group: "credentials",
      },
      {
        key: "certificateKey",
        label: "Chave do Certificado (.KEY)",
        type: "password",
        required: true,
        helpText: "Conteúdo do .KEY em PEM",
        group: "credentials",
      },
      {
        key: "workspaceId",
        label: "Workspace ID",
        type: "text",
        required: true,
        group: "credentials",
      },
    ],
    settingsSchema: [
      {
        key: "documentKind",
        label: "Espécie do Documento",
        type: "select",
        required: false,
        options: [
          { value: "DUPLICATA_MERCANTIL", label: "Duplicata Mercantil" },
          { value: "DUPLICATA_SERVICO", label: "Duplicata de Serviço" },
          { value: "RECIBO", label: "Recibo" },
          { value: "NOTA_PROMISSORIA", label: "Nota Promissória" },
          { value: "OUTROS", label: "Outros" },
        ],
        group: "settings",
      },
      {
        key: "finePercentage",
        label: "Multa (%)",
        type: "number",
        required: false,
        group: "settings",
      },
      {
        key: "fineQuantityDays",
        label: "Dias para multa",
        type: "number",
        required: false,
        group: "settings",
      },
      {
        key: "interestPercentage",
        label: "Juros ao mês (%)",
        type: "number",
        required: false,
        group: "settings",
      },
      {
        key: "writeOffQuantityDays",
        label: "Dias para baixa automática",
        type: "number",
        required: false,
        group: "settings",
      },
      {
        key: "protestType",
        label: "Tipo de Protesto",
        type: "select",
        required: false,
        options: [
          { value: "SEM_PROTESTO", label: "Sem Protesto" },
          { value: "DIAS_CORRIDOS", label: "Dias Corridos" },
          { value: "DIAS_UTEIS", label: "Dias Úteis" },
        ],
        group: "settings",
      },
      {
        key: "defaultMessages",
        label: "Mensagens Padrão",
        type: "text",
        required: false,
        group: "settings",
      },
      {
        key: "pixKeyType",
        label: "Tipo de Chave Pix",
        type: "select",
        required: false,
        options: [
          { value: "CPF", label: "CPF" },
          { value: "CNPJ", label: "CNPJ" },
          { value: "CELULAR", label: "Celular" },
          { value: "EMAIL", label: "E-mail" },
          { value: "EVP", label: "EVP (Aleatória)" },
        ],
        group: "settings",
      },
      {
        key: "pixDictKey",
        label: "Chave Pix (DICT)",
        type: "text",
        required: false,
        group: "settings",
      },
    ],
  },
  cobrefacil: {
    id: "cobrefacil",
    name: "Cobre Fácil",
    configSchema: [
      {
        key: "appId",
        label: "App ID",
        type: "text",
        required: true,
        placeholder: "meuapp_...",
        helpText:
          "Encontre em Cobre Fácil → Configurações → Integrações",
        group: "credentials",
      },
      {
        key: "secret",
        label: "Secret",
        type: "password",
        required: true,
        placeholder: "eba5893f...",
        helpText: "Chave secreta da aplicação",
        group: "credentials",
      },
    ],
    settingsSchema: [
      {
        key: "defaultPaymentMethod",
        label: "Método de Pagamento Padrão",
        type: "select",
        required: false,
        options: [
          { value: "bankslip", label: "Boleto" },
          { value: "pix", label: "PIX" },
          { value: "credit_card", label: "Cartão de Crédito" },
        ],
        group: "settings",
      },
      {
        key: "finePercentage",
        label: "Multa (%)",
        type: "number",
        required: false,
        group: "settings",
      },
      {
        key: "interestPercentage",
        label: "Juros ao mês (%)",
        type: "number",
        required: false,
        group: "settings",
      },
      {
        key: "discountPercentage",
        label: "Desconto antecipação (%)",
        type: "number",
        required: false,
        group: "settings",
      },
      {
        key: "discountDays",
        label: "Dias antecedência p/ desconto",
        type: "number",
        required: false,
        helpText: "Dias antes do vencimento para desconto. 0 ou vazio = desconto válido até a data de vencimento.",
        group: "settings",
      },
    ],
  },
  lytex: {
    id: "lytex",
    name: "Lytex Pagamentos",
    configSchema: [
      {
        key: "clientId",
        label: "Client ID",
        type: "text",
        required: true,
        helpText: "Painel Lytex → Configurações → Integrações e API",
        group: "credentials",
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        type: "password",
        required: true,
        group: "credentials",
      },
    ],
    settingsSchema: [
      {
        key: "defaultPaymentMethod",
        label: "Método de Pagamento Padrão",
        type: "select",
        required: false,
        options: [
          { value: "boleto", label: "Boleto" },
          { value: "pix", label: "PIX" },
          { value: "creditCard", label: "Cartão de Crédito" },
        ],
        group: "settings",
      },
      {
        key: "cancelOverdueDays",
        label: "Dias para cancelar após vencimento",
        type: "number",
        required: false,
        placeholder: "29",
        group: "settings",
      },
      {
        key: "overduePaymentDays",
        label: "Dias para expirar após vencimento",
        type: "number",
        required: false,
        placeholder: "100",
        group: "settings",
      },
      {
        key: "enableMulctAndInterest",
        label: "Habilitar multa e juros",
        type: "boolean",
        required: false,
        group: "settings",
      },
      {
        key: "mulctPercentage",
        label: "Multa (%)",
        type: "number",
        required: false,
        placeholder: "2",
        group: "settings",
      },
      {
        key: "interestPercentage",
        label: "Juros ao mês (%)",
        type: "number",
        required: false,
        placeholder: "1",
        group: "settings",
      },
      {
        key: "enableSerasa",
        label: "Habilitar negativação Serasa",
        type: "boolean",
        required: false,
        helpText: "Negativação automática de inadimplentes",
        group: "settings",
      },
      {
        key: "serasaNegativityDays",
        label: "Dias para negativação Serasa",
        type: "number",
        required: false,
        placeholder: "30",
        helpText: "Após quantos dias de atraso negativar",
        group: "settings",
      },
      {
        key: "billingRuleId",
        label: "Régua de Cobrança (ID)",
        type: "text",
        required: false,
        helpText: "ID da régua criada no painel Lytex",
        group: "settings",
      },
    ],
  },
};

/**
 * Registry estendido com providers de desenvolvimento/teste.
 * Inclui todos os providers de produção + mock.
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
 * Em produção: apenas pagarme, pinbank, santander, cobrefacil e lytex.
 * Em dev/test: inclui mock.
 * O frontend consulta isso pra saber quais bancos existem e quais campos mostrar.
 */
export const PROVIDER_REGISTRY: Record<string, ProviderDefinition> =
  process.env.NODE_ENV === "production"
    ? PRODUCTION_PROVIDER_REGISTRY
    : DEV_PROVIDER_REGISTRY;
