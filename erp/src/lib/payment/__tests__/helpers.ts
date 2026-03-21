/**
 * Shared test helpers, fixtures, and mocks for the payment module tests.
 */
import type { CreateBoletoInput } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function makeCreateBoletoInput(
  overrides?: Partial<CreateBoletoInput>,
): CreateBoletoInput {
  return {
    customer: {
      name: "João da Silva",
      document: "12345678901",
      documentType: "cpf",
      email: "joao@example.com",
      address: {
        street: "Rua Teste",
        number: "123",
        complement: "Apto 1",
        neighborhood: "Centro",
        city: "Campinas",
        state: "SP",
        zipCode: "13000-000",
      },
    },
    amount: 10000,
    dueDate: new Date("2026-04-01"),
    installmentNumber: 1,
    totalInstallments: 3,
    description: "Parcela 1/3",
    ...overrides,
  };
}

export function makePaymentProvider(overrides?: Record<string, unknown>) {
  return {
    id: "prov-001",
    name: "Test Provider",
    provider: "pagarme",
    isActive: true,
    isDefault: false,
    companyId: "company-001",
    credentials: "encrypted-creds",
    metadata: null,
    webhookSecret: null,
    webhookUrl: null,
    sandbox: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makeRoutingRule(overrides?: Record<string, unknown>) {
  return {
    id: "rule-001",
    providerId: "prov-001",
    isActive: true,
    priority: 1,
    clientType: null as string | null,
    minValue: null as number | null,
    maxValue: null as number | null,
    tags: [] as string[],
    createdAt: new Date(),
    updatedAt: new Date(),
    provider: makePaymentProvider(),
    ...overrides,
  };
}
