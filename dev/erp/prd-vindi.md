# PRD — Vindi Recorrência como Gateway de Cobrança

> **Autor:** Vex ⚡ | **Data:** 2026-03-26
> **Repo:** `diogenesmendes01/MendesAplication` | **Base:** `erp/`
> **Branch sugerida:** `feat/vindi-provider`
> **Depende de:** Payment Providers (Pagar.me, Santander, Cobre Fácil, Lytex, Mock)

---

## 1. Contexto

O MendesApplication possui 5 payment providers. A Vindi será o 6º, trazendo como diferencial principal o **foco em recorrência** — planos, assinaturas, billing cycles e descontos avançados. Além disso, a autenticação é a mais simples de todas (API Key fixa via Basic Auth, sem token management).

**API Reference:** https://vindi.github.io/api-docs/dist/?url=https://sandbox-app.vindi.com.br/api/v1/docs
**Documentação estudada:** `memory/integracoes/vindi-api.md`
**NFSe: NÃO usar da Vindi — MendesApplication já emite notas sozinho.**

---

## 2. Decisões de Arquitetura

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Padrão | Mesmo factory/registry/router | Consolidado |
| Auth | Basic Auth (API Key fixa) | Sem expiração, sem refresh — mais simples possível |
| Customer | Obrigatório criar antes (lazy creation por registry_code) | API exige customer_id na bill |
| Code | Usar `boletoId` do ERP como referência em metadata ou `code` do customer | Reconciliação |
| Valores | **Reais (float)** — converter de centavos do ERP | Vindi usa float (42.90 = R$42,90) |
| NFSe Vindi | NÃO USAR | MendesApp já emite |
| Recorrência | Fase 2 — primeiro implementar cobrança avulsa (bills) | Manter consistência com outros providers |

---

## 3. Diferenças da Vindi vs Providers Existentes

| Aspecto | Pagar.me | Cobre Fácil | Lytex | Vindi |
|---------|----------|-------------|-------|-------|
| Auth | API Key (Basic) | Token 1h | Token 5min + refresh | **API Key (Basic) — sem expiração** |
| Customer | Inline | Criar antes | Inline | **Criar antes** (lazy por registry_code) |
| Valores | Centavos | Misto | Centavos | **Reais (float)** |
| referenceId | metadata | Não nativo | Nativo | `code` no customer + metadata na bill |
| Recorrência | ❌ | Básico | Básico | **✅ Completo (plans, subscriptions, periods)** |
| Descontos | ❌ | ❌ | ❌ | **✅ Avançado (%, valor, quantidade, cycles)** |
| Webhook auth | HMAC-SHA1 | Sem HMAC | Sem HMAC | **HTTP Basic Auth na URL** |
| Webhook redundância | 1 URL | 1 URL + retry | 1 URL | **2 URLs** |
| 3D Secure | ❌ | ❌ | ❌ | **✅** |

---

## 4. Arquivos a Criar/Modificar

### Novos Arquivos

```
erp/src/lib/payment/providers/
└── vindi.provider.ts              ← Implementação PaymentGateway (sem arquivo de auth separado!)
erp/src/lib/payment/__tests__/
└── vindi.provider.test.ts         ← Testes
```

**Nota:** NÃO precisa de `vindi-auth.ts` separado. A auth é Basic Auth estática — basta calcular o header uma vez no constructor. Sem cache, sem refresh, sem retry de token.

### Arquivos a Modificar

```
erp/src/lib/payment/
├── constants.ts               ← Adicionar "vindi"
├── registry.ts                ← Adicionar configSchema + settingsSchema
└── factory.ts                 ← Adicionar factory entry
```

---

## 5. Implementação Detalhada

### 5.1 Provider (`vindi.provider.ts`)

```typescript
// vindi.provider.ts — implements PaymentGateway

import type {
  PaymentGateway,
  CreateBoletoInput,
  CreateBoletoResult,
  BoletoStatusResult,
  WebhookEvent,
} from "../types";
import { logger } from "@/lib/logger";

const PROD_BASE_URL = "https://app.vindi.com.br/api/v1";
const SANDBOX_BASE_URL = "https://sandbox-app.vindi.com.br/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;

interface VindiCredentials {
  apiKey: string;
  sandbox?: boolean;
}

interface VindiMetadata {
  defaultPaymentMethodCode?: string;  // "bank_slip" | "pix" | "credit_card"
}

export class VindiProvider implements PaymentGateway {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly metadata: VindiMetadata | null;
  private readonly webhookSecret?: string;

  constructor(
    credentials: VindiCredentials,
    metadata?: VindiMetadata | null,
    webhookSecret?: string,
  ) {
    if (!credentials.apiKey) throw new Error("Vindi: apiKey é obrigatório");

    this.baseUrl = credentials.sandbox ? SANDBOX_BASE_URL : PROD_BASE_URL;
    // RFC2617: API_KEY + ":" (separador obrigatório, senha vazia)
    this.authHeader = `Basic ${Buffer.from(`${credentials.apiKey}:`).toString("base64")}`;
    this.metadata = metadata ?? null;
    this.webhookSecret = webhookSecret;
  }

  // ----- Helper: fetch autenticado -----
  private async api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
        ...options.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Vindi API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  // ----- Helper: garantir customer existe na Vindi -----
  private async ensureCustomer(input: CreateBoletoInput["customer"]): Promise<number> {
    const doc = input.document.replace(/\D/g, "");

    // Buscar por registry_code (CPF/CNPJ)
    const searchResult = await this.api<{ customers: Array<{ id: number }> }>(
      `/customers?query=registry_code=${doc}`,
    );

    if (searchResult.customers?.length > 0) {
      return searchResult.customers[0].id;
    }

    // Criar customer
    const created = await this.api<{ customer: { id: number } }>("/customers", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        email: input.email ?? "",
        registry_code: doc,
        code: input.metadata?.erpCustomerId ?? doc,  // ID externo pra reconciliação
        metadata: input.metadata ?? {},
        ...(input.address ? {
          address: {
            street: input.address.street,
            number: input.address.number ?? "",
            additional_details: input.address.complement ?? "",
            zipcode: input.address.zipCode?.replace(/\D/g, ""),
            neighborhood: input.address.neighborhood,
            city: input.address.city,
            state: input.address.state,
            country: "BR",
          },
        } : {}),
      }),
    });

    return created.customer.id;
  }

  // ========== PaymentGateway Interface ==========

  async createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResult> {
    // 1. Garantir customer existe
    const customerId = await this.ensureCustomer(input.customer);

    // 2. Determinar método de pagamento
    const paymentMethodCode = this.metadata?.defaultPaymentMethodCode ?? "bank_slip";

    // 3. Criar bill (fatura avulsa)
    // Vindi usa valores em REAIS (float) — converter de centavos do ERP
    const amountInReais = input.amount / 100;

    const bill = await this.api<{
      bill: {
        id: number;
        code: string | null;
        status: string;
        url: string;
        charges: Array<{
          id: number;
          status: string;
          payment_method: { code: string };
          print_url?: string;
          last_transaction?: {
            gateway_response_fields?: {
              typeable_barcode?: string;
              barcode?: string;
              qrcode_original_path?: string;
              qrcode_path?: string;
              pix_code?: string;
            };
          };
        }>;
      };
    }>("/bills", {
      method: "POST",
      body: JSON.stringify({
        customer_id: customerId,
        payment_method_code: paymentMethodCode,
        bill_items: [{
          product_id: null,  // Produto avulso via amount
          amount: amountInReais,
          description: input.description ?? "Cobrança",
          quantity: 1,
        }],
        due_at: input.dueDate.toISOString().split("T")[0],
        metadata: {
          boletoId: input.metadata?.boletoId ?? "",
          referenceId: input.metadata?.referenceId ?? "",
        },
      }),
    });

    const charge = bill.bill.charges?.[0];
    const gatewayFields = charge?.last_transaction?.gateway_response_fields;

    return {
      gatewayId: String(bill.bill.id),
      url: bill.bill.url ?? charge?.print_url,
      line: gatewayFields?.typeable_barcode,
      barcode: gatewayFields?.barcode,
      qrCode: gatewayFields?.pix_code ?? gatewayFields?.qrcode_original_path,
      pdf: charge?.print_url,
      nossoNumero: String(bill.bill.id),
      rawResponse: bill,
    };
  }

  async getBoletoStatus(gatewayId: string): Promise<BoletoStatusResult> {
    const result = await this.api<{
      bill: {
        id: number;
        status: string;
        charges: Array<{
          status: string;
          paid_at?: string;
          last_transaction?: { amount?: number };
        }>;
      };
    }>(`/bills/${gatewayId}`);

    const bill = result.bill;
    const charge = bill.charges?.[0];

    // Vindi bill statuses: pending, paid, canceled, review
    const statusMap: Record<string, BoletoStatusResult["status"]> = {
      pending: "pending",
      paid: "paid",
      canceled: "cancelled",
      review: "pending",
    };

    return {
      gatewayId: String(bill.id),
      status: statusMap[bill.status] ?? "pending",
      paidAt: charge?.paid_at ? new Date(charge.paid_at) : undefined,
      // Vindi retorna em reais → converter pra centavos
      paidAmount: charge?.last_transaction?.amount
        ? Math.round(charge.last_transaction.amount * 100)
        : undefined,
    };
  }

  async cancelBoleto(gatewayId: string): Promise<{ success: boolean }> {
    try {
      await this.api(`/bills/${gatewayId}`, { method: "DELETE" });
      return { success: true };
    } catch (err) {
      logger.error({ err, gatewayId }, "[Vindi] cancelBoleto failed");
      return { success: false };
    }
  }

  validateWebhook(headers: Record<string, string>, body: string): boolean {
    // Vindi suporta HTTP Basic Auth na URL do webhook
    // Se webhookSecret configurado, validar o Authorization header
    if (this.webhookSecret) {
      const authHeader = headers["authorization"] ?? headers["Authorization"] ?? "";
      const expected = `Basic ${Buffer.from(this.webhookSecret).toString("base64")}`;
      return authHeader === expected;
    }

    // Fallback: validar por estrutura do payload
    try {
      const parsed = JSON.parse(body);
      return !!(parsed.event?.type && parsed.event?.data);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: string): WebhookEvent | null {
    try {
      const parsed = JSON.parse(body);
      const { type, data } = parsed.event ?? {};

      const eventMap: Record<string, WebhookEvent["type"]> = {
        bill_paid: "boleto.paid",
        bill_canceled: "boleto.cancelled",
        charge_rejected: "boleto.failed",
        charge_refunded: "boleto.cancelled",
      };

      const mappedType = eventMap[type];
      if (!mappedType) return null;

      const bill = data?.bill;
      const charge = data?.charge ?? bill?.charges?.[0];

      return {
        type: mappedType,
        gatewayId: String(bill?.id ?? charge?.bill?.id),
        paidAt: charge?.paid_at ? new Date(charge.paid_at) : undefined,
        // Vindi retorna em reais → converter pra centavos
        paidAmount: charge?.last_transaction?.amount
          ? Math.round(charge.last_transaction.amount * 100)
          : undefined,
        rawEvent: parsed,
      };
    } catch (err) {
      logger.error({ err }, "[Vindi] Failed to parse webhook event");
      return null;
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      // Buscar dados da empresa — valida auth e conexão
      const result = await this.api<{ merchant: { name: string } }>("/merchants/current");
      return {
        ok: true,
        message: `Conexão com Vindi estabelecida. Empresa: ${result.merchant?.name ?? "OK"}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Erro desconhecido",
      };
    }
  }
}
```

### 5.2 Registry — `registry.ts`

```typescript
vindi: {
  id: "vindi",
  name: "Vindi Recorrência",
  configSchema: [
    {
      key: "apiKey",
      label: "API Key",
      type: "password",
      required: true,
      helpText: "Painel Vindi → Configurações → API. Formato: chave alfanumérica.",
      group: "credentials",
    },
  ],
  settingsSchema: [
    {
      key: "defaultPaymentMethodCode",
      label: "Método de Pagamento Padrão",
      type: "select",
      required: false,
      options: [
        { value: "bank_slip", label: "Boleto Bancário" },
        { value: "pix", label: "PIX" },
        { value: "credit_card", label: "Cartão de Crédito" },
      ],
      helpText: "Código do método de pagamento na Vindi.",
      group: "settings",
    },
  ],
},
```

### 5.3 Factory — `factory.ts`

```typescript
vindi: (decryptedCredentials, metadata, webhookSecret, options) => {
  const { VindiProvider } = require("./providers/vindi.provider");

  const apiKey = decryptedCredentials.apiKey;
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("Vindi: campo 'apiKey' é obrigatório");
  }

  return new VindiProvider(
    { apiKey, sandbox: options?.sandbox ?? false },
    metadata ? {
      defaultPaymentMethodCode: typeof metadata.defaultPaymentMethodCode === "string"
        ? metadata.defaultPaymentMethodCode
        : undefined,
    } : null,
    webhookSecret,
  );
},
```

### 5.4 Constants

```typescript
export const PRODUCTION_PROVIDER_TYPES = [
  "pagarme", "pinbank", "santander", "cobrefacil", "lytex", "vindi"
] as const;
```

---

## 6. Stories de Implementação

### Story 1: Provider Base + Auth + testConnection
**Prioridade:** 🔴 Crítica | **Estimativa:** 1.5h

- [ ] Criar `vindi.provider.ts` com constructor (Basic Auth inline — sem arquivo auth separado)
- [ ] Implementar `testConnection()` via `GET /merchants/current`
- [ ] Implementar helper `api<T>()` com timeout e error handling
- [ ] Adicionar `"vindi"` em `PRODUCTION_PROVIDER_TYPES`
- [ ] Adicionar config no `registry.ts`
- [ ] Adicionar factory no `factory.ts`

**Critério de aceite:** Configurar Vindi na UI → Testar Conexão → retorna nome da empresa.

### Story 2: Customer + Bill (Cobrança Avulsa)
**Prioridade:** 🔴 Crítica | **Estimativa:** 2.5h

- [ ] Implementar `ensureCustomer()` — busca por `registry_code` (CPF/CNPJ), cria se não existe
- [ ] `ensureCustomer` deve ser `private` (aprendizado do Cobre Fácil)
- [ ] Implementar `createBoleto()` — cria bill avulsa com `bill_items`
- [ ] Converter centavos (ERP) → reais (Vindi) na criação: `amount / 100`
- [ ] Converter reais (Vindi) → centavos (ERP) no retorno: `Math.round(amount * 100)`
- [ ] Extrair line, barcode, qrCode do `gateway_response_fields` da charge
- [ ] Implementar `getBoletoStatus()` — GET /bills/{id}, mapear status
- [ ] Implementar `cancelBoleto()` — DELETE /bills/{id}, com gatewayId no log de erro

**Critério de aceite:** Gerar cobrança → boleto/PIX gerado → status consultável → cancelável.

### Story 3: Webhooks
**Prioridade:** 🔴 Crítica | **Estimativa:** 1.5h

- [ ] Implementar `validateWebhook()` com suporte a HTTP Basic Auth (webhookSecret)
- [ ] Fallback: validar por estrutura `event.type + event.data`
- [ ] Implementar `parseWebhookEvent()`:
  - `bill_paid` → `boleto.paid`
  - `bill_canceled` → `boleto.cancelled`
  - `charge_rejected` → `boleto.failed`
  - `charge_refunded` → `boleto.cancelled`
- [ ] Converter valores reais → centavos no webhook
- [ ] Extrair `bill.id` como `gatewayId`

**Critério de aceite:** Webhook `bill_paid` → Boleto PAID → AccountReceivable PAID → audit log.

### Story 4: Testes Automatizados
**Prioridade:** 🟡 Média | **Estimativa:** 2h

- [ ] Criar `vindi.provider.test.ts`
- [ ] Testar auth header format (RFC2617 com ":" obrigatório)
- [ ] Testar createBoleto (ensureCustomer, conversão centavos→reais, bill creation)
- [ ] Testar getBoletoStatus (conversão reais→centavos)
- [ ] Testar parseWebhookEvent (bill_paid, bill_canceled, charge_rejected, charge_refunded)
- [ ] Testar validateWebhook (com e sem webhookSecret)
- [ ] Testar testConnection (success + failure)
- [ ] **LINT CHECK:** Garantir zero imports não utilizados

**Critério de aceite:** Todos os testes passando, lint limpo, CI verde.

---

## 7. Pontos de Atenção

### ⚠️ Conversão Reais ↔ Centavos
- **ERP:** valores em centavos (integer)
- **Vindi:** valores em reais (float)
- Na criação: `amount / 100` (centavos → reais)
- No retorno/webhook: `Math.round(amount * 100)` (reais → centavos)
- `Math.round` obrigatório pra evitar floating point (250.75 * 100 = 25074.999...)

### ⚠️ RFC2617 — ":" Obrigatório
A Vindi vai começar a rejeitar requests sem o `:` após a API Key (RFC2617). A implementação DEVE usar `Buffer.from(\`${apiKey}:\`).toString("base64")` — o `:` é obrigatório mesmo com senha vazia.

### ⚠️ bill_items precisa de product_id OU amount
Na criação de bill avulsa, cada item precisa de `product_id` (referência a um produto cadastrado) ou pode usar `amount` diretamente. Para cobrança avulsa simples, usar `amount` + `description`.

### ⚠️ Webhook com HTTP Basic Auth
Diferente dos outros providers, a Vindi suporta autenticação no webhook via HTTP Basic Auth na URL (`https://user:pass@seusite.com/webhook`). Usar `webhookSecret` como `user:pass` encoded. Mais seguro que os outros providers.

### ⚠️ Customer é obrigatório
Assim como o Cobre Fácil, precisa de `ensureCustomer`. O campo `code` no customer é a ponte com o ERP. O campo `registry_code` é o CPF/CNPJ.

---

## 8. Fora de Escopo (Fase 1)

- ❌ NFSe da Vindi (MendesApp já emite)
- ❌ Plans + Subscriptions (fase 2 — recorrência)
- ❌ Payment Profiles / cartão tokenizado (fase 2)
- ❌ Discounts (fase 2 — bolsas e promoções)
- ❌ 3D Secure (fase 2)
- ❌ Split de pagamento (fase futura)
- ❌ Usages / medição (fase futura)
- ❌ Export/Import batches

---

## 9. Pré-requisitos

- [ ] Criar conta na Vindi (https://vindi.com.br/cadastro/)
- [ ] Obter API Key de sandbox (Configurações → API)
- [ ] Obter API Key de produção
- [ ] Cadastrar URL(s) de webhook no painel (até 2 URLs pra redundância)
- [ ] Salvar API Keys no 1Password

---

## 10. Estimativa Total

| Story | Estimativa |
|-------|-----------|
| 1. Provider Base + Auth | 1.5h |
| 2. Customer + Bill | 2.5h |
| 3. Webhooks | 1.5h |
| 4. Testes | 2h |
| **Total** | **~7.5h** |

**Nota:** ~0.5h menos que Lytex porque a auth é trivial (sem arquivo separado, sem token management). E o `ensureCustomer` já tem padrão testado do Cobre Fácil pra seguir.
