// ============================================================
// Payment Module Constants
// ============================================================

/**
 * Provider types disponíveis apenas em produção.
 */
export const PRODUCTION_PROVIDER_TYPES = ["pagarme", "pinbank"] as const;

/**
 * Provider types disponíveis em desenvolvimento/teste (inclui mock).
 */
export const DEV_PROVIDER_TYPES = [...PRODUCTION_PROVIDER_TYPES, "mock"] as const;

/**
 * Provider types ativos no ambiente atual.
 * Em produção: apenas pagarme e pinbank.
 * Em dev/test: inclui mock.
 */
export const PROVIDER_TYPES =
  process.env.NODE_ENV === "production"
    ? PRODUCTION_PROVIDER_TYPES
    : DEV_PROVIDER_TYPES;

/**
 * Número máximo de parcelas permitido na geração de boletos.
 * Usado em: propostas/actions.ts → generateBoletosForProposal
 */
export const MAX_INSTALLMENTS = 48;

/**
 * Tolerância em R$ para match heurístico de receivables legados (sem boletoId).
 * Usado em: webhook route → fallback para receivables sem FK
 */
export const RECEIVABLE_VALUE_TOLERANCE = 0.01;

/**
 * Janela em dias para match heurístico de dueDate em receivables legados.
 * Usado em: webhook route → fallback para receivables sem FK
 */
export const RECEIVABLE_DUE_DATE_WINDOW_DAYS = 15;

/**
 * Placeholder de telefone para cadastro de customer no Pagar.me.
 * A API exige o campo phones, mas nem sempre temos o telefone do cliente.
 */
export const PHONE_PLACEHOLDER = "000000000";
export const PHONE_AREA_CODE_PLACEHOLDER = "00";
export const PHONE_COUNTRY_CODE = "55";
