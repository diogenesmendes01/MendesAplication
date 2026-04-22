# PRD — Cobre Fácil como Gateway de Cobrança

> **Autor:** Vex ⚡ | **Data:** 2026-03-26
> **Repo:** `diogenesmendes01/MendesAplication` | **Base:** `erp/`
> **Branch sugerida:** `feat/cobrefacil-provider`
> **Depende de:** Payment Providers (já implementado — Pagar.me, Santander, Mock)

---

## 1. Contexto

O MendesApplication já possui um sistema robusto de payment providers com suporte a múltiplos bancos por empresa (Pagar.me, Santander, PinBank placeholder, Mock). A arquitetura usa factory pattern + registry + router com regras de roteamento automático.

**Novo requisito:** integrar o **Cobre Fácil** como mais um gateway de cobrança. O Cobre Fácil será usado para emissão de boletos, cobrança via cartão de crédito e PIX. **A emissão de NFSe continua sendo responsabilidade exclusiva do MendesApplication** — não usar o módulo fiscal do Cobre Fácil.

**API Reference:** https://developers.cobrefacil.com.br
**Documentação estudada:** `memory/integracoes/cobrefacil-api.md`

---

## 2. Decisões de Arquitetura

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Padrão de implementação | Mesmo do Pagar.me/Santander | Arquitetura já consolidada |
| Autenticação | Token Bearer com cache + auto-refresh | Token expira em ~1h, precisa renovar |
| Sync de clientes | Lazy (cria no Cobre Fácil no momento da cobrança) | Evita sync bidirecional desnecessário |
| Módulo NFSe do Cobre Fácil | **NÃO USAR** | MendesApp já emite notas sozinho |
| Métodos de pagamento | Boleto + PIX (cartão como fase 2) | Boleto é prioridade, PIX é essencial |
| Preço na API | Centavos na criação, float no retorno | ⚠️ Gotcha documentado — tratar na conversão |

---

## 3. Diferenças do Cobre Fácil vs Providers Existentes

| Aspecto | Pagar.me / Santander | Cobre Fácil |
|---------|---------------------|-------------|
| Autenticação | API Key fixa (Basic Auth) / OAuth2 + mTLS | `app_id` + `secret` → token Bearer (expira 1h) |
| Customer | Cria na hora da order | **Obrigatório criar antes** da cobrança (`/customers`) |
| Endereço | Opcional em alguns | **Obrigatório** no cadastro do cliente |
| Preço (criação) | Centavos (Pagar.me) / Reais (Santander) | Centavos nos produtos, **reais nas cobranças** (confirmar) |
| Webhook auth | HMAC-SHA1 / Signature header | Sem assinatura documentada (validar por IP ou secret customizado) |
| PIX | Via order com payment_method | Via `payable_with: "pix"` na cobrança |
| Boleto | Via order com payment_method | Via `payable_with: "bankslip"` na cobrança |

---

## 4. Arquivos a Criar/Modificar

### 4.1 Novos Arquivos

```
erp/src/lib/payment/
├── providers/
│   ├── cobrefacil-auth.ts          ← Token management (cache + refresh)
│   └── cobrefacil.provider.ts      ← Implementação PaymentGateway
```

### 4.2 Arquivos a Modificar

```
erp/src/lib/payment/
├── constants.ts                     ← Adicionar "cobrefacil" em PRODUCTION_PROVIDER_TYPES
├── registry.ts                      ← Adicionar configSchema + settingsSchema
├── factory.ts                       ← Adicionar factory entry
├── types.ts                         ← Estender WebhookEvent com novos tipos (se necessário)
```

---

## 5. Implementação Detalhada

### 5.1 Token Management (`cobrefacil-auth.ts`)

O Cobre Fácil usa autenticação por token que expira (~3600s). Precisa de cache em memória com refresh automático.

```typescript
// cobrefacil-auth.ts

interface CachedToken {
  token: string;
  expiresAt: number; // Date.now() + (expiration * 1000) - margem
}

// Cache por par app_id+secret (suporta múltiplas empresas)
const tokenCache = new Map<string, CachedToken>();

const BASE_URL = "https://api.cobrefacil.com.br/v1";
const TOKEN_REFRESH_MARGIN_MS = 300_000; // 5 min antes de expirar
const REQUEST_TIMEOUT_MS = 15_000;

export async function getAuthToken(appId: string, secret: string): Promise<string> {
  const cacheKey = `${appId}:${secret}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const response = await fetch(`${BASE_URL}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, secret }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Cobre Fácil auth failed: ${response.status}`);
  }

  const json = await response.json();
  if (!json.success) {
    throw new Error(`Cobre Fácil auth error: ${json.message}`);
  }

  const { token, expiration } = json.data;
  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + (expiration * 1000) - TOKEN_REFRESH_MARGIN_MS,
  });

  return token;
}

/**
 * Helper para fazer requests autenticados com auto-retry em 401.
 */
export async function authenticatedFetch(
  appId: string,
  secret: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  let token = await getAuthToken(appId, secret);

  let response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // Token expirou entre cache e request — retry uma vez
  if (response.status === 401) {
    tokenCache.delete(`${appId}:${secret}`);
    token = await getAuthToken(appId, secret);
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  return response;
}
```

### 5.2 Provider (`cobrefacil.provider.ts`)

```typescript
// cobrefacil.provider.ts — implements PaymentGateway

import type {
  PaymentGateway,
  CreateBoletoInput,
  CreateBoletoResult,
  BoletoStatusResult,
  WebhookEvent,
} from "../types";
import { authenticatedFetch } from "./cobrefacil-auth";
import { logger } from "@/lib/logger";

interface CobreFacilCredentials {
  appId: string;
  secret: string;
}

interface CobreFacilMetadata {
  defaultPaymentMethod?: "bankslip" | "pix" | "credit_card";
  finePercentage?: number;    // multa %
  interestPercentage?: number; // juros mensal %
  discountPercentage?: number; // desconto antecipação %
  discountDays?: number;       // dias pra desconto
}

export class CobreFacilProvider implements PaymentGateway {
  private readonly appId: string;
  private readonly secret: string;
  private readonly defaultPaymentMethod: string;
  private readonly metadata: CobreFacilMetadata | null;
  private readonly webhookSecret?: string;

  constructor(
    credentials: CobreFacilCredentials,
    metadata?: CobreFacilMetadata | null,
    webhookSecret?: string,
  ) {
    if (!credentials.appId) throw new Error("Cobre Fácil: appId é obrigatório");
    if (!credentials.secret) throw new Error("Cobre Fácil: secret é obrigatório");

    this.appId = credentials.appId;
    this.secret = credentials.secret;
    this.defaultPaymentMethod = metadata?.defaultPaymentMethod ?? "bankslip";
    this.metadata = metadata ?? null;
    this.webhookSecret = webhookSecret;
  }

  // ----- Helper: fetch autenticado -----
  private async api(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await authenticatedFetch(this.appId, this.secret, path, options);
    const json = await response.json();
    if (!json.success) {
      throw new Error(`Cobre Fácil API error: ${json.message} ${JSON.stringify(json.errors ?? [])}`);
    }
    return json.data;
  }

  // ----- Helper: garantir customer existe no Cobre Fácil -----
  private async ensureCustomer(input: CreateBoletoInput["customer"]): Promise<string> {
    // Buscar por documento (CPF/CNPJ)
    const searchField = input.documentType === "cpf" ? "taxpayer_id" : "ein";
    const searchResponse = await authenticatedFetch(
      this.appId, this.secret,
      `/customers?${searchField}=${input.document}`,
    );
    const searchJson = await searchResponse.json();

    if (searchJson.success && searchJson.data?.length > 0) {
      return searchJson.data[0].id;
    }

    // Criar customer
    const customerData: Record<string, unknown> = {
      person_type: input.documentType === "cpf" ? 1 : 2,
      ...(input.documentType === "cpf"
        ? { taxpayer_id: input.document, personal_name: input.name }
        : { ein: input.document, company_name: input.name }),
      email: input.email ?? undefined,
      address: input.address
        ? {
            description: "Principal",
            zipcode: input.address.zipCode.replace(/\D/g, ""),
            street: input.address.street,
            number: input.address.number,
            complement: input.address.complement ?? "",
            neighborhood: input.address.neighborhood,
            city: input.address.city,
            state: input.address.state,
          }
        : {
            // Endereço placeholder (obrigatório na API)
            description: "Principal",
            zipcode: "01001000",
            street: "Praça da Sé",
            number: "1",
            neighborhood: "Sé",
            city: "São Paulo",
            state: "SP",
          },
    };

    const created = (await this.api("/customers", {
      method: "POST",
      body: JSON.stringify(customerData),
    })) as { id: string };

    return created.id;
  }

  // ========== PaymentGateway Interface ==========

  async createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResult> {
    // 1. Garantir customer existe
    const customerId = await this.ensureCustomer(input.customer);

    // 2. Criar cobrança
    const invoiceData: Record<string, unknown> = {
      customer_id: customerId,
      payable_with: this.defaultPaymentMethod,
      due_date: input.dueDate.toISOString().split("T")[0], // YYYY-MM-DD
      price: input.amount / 100, // centavos → reais (Cobre Fácil recebe em reais nas invoices)
      items: input.description
        ? [{ description: input.description, quantity: 1, price: input.amount / 100 }]
        : [],
    };

    // Configurações opcionais (multa, juros, desconto)
    if (this.metadata?.finePercentage || this.metadata?.interestPercentage) {
      invoiceData.settings = {
        ...(this.metadata.finePercentage ? { late_fee: { mode: "percentage", value: this.metadata.finePercentage } } : {}),
        ...(this.metadata.interestPercentage ? { interest: { mode: "monthly_percentage", value: this.metadata.interestPercentage } } : {}),
        ...(this.metadata.discountPercentage ? { discount: { mode: "percentage", value: this.metadata.discountPercentage, limit_date: this.metadata.discountDays ?? 0 } } : {}),
      };
    }

    const invoice = (await this.api("/invoices", {
      method: "POST",
      body: JSON.stringify(invoiceData),
    })) as {
      id: string;
      barcode?: string;
      barcode_data?: string;
      pix_qrcode?: string;
      pix_code?: string;
      url?: string;
      status: string;
    };

    return {
      gatewayId: invoice.id,
      url: invoice.url,
      line: invoice.barcode, // linha digitável
      barcode: invoice.barcode,
      qrCode: invoice.pix_qrcode ?? invoice.pix_code,
      nossoNumero: invoice.id,
      rawResponse: invoice,
    };
  }

  async getBoletoStatus(gatewayId: string): Promise<BoletoStatusResult> {
    const invoice = (await this.api(`/invoices/${gatewayId}`)) as {
      id: string;
      status: string;
      paid_at: string | null;
      total_paid: number | null;
    };

    const statusMap: Record<string, BoletoStatusResult["status"]> = {
      pending: "pending",
      paid: "paid",
      canceled: "cancelled",
      refunded: "cancelled",
      reversed: "failed",
      declined: "failed",
    };

    return {
      gatewayId: invoice.id,
      status: statusMap[invoice.status] ?? "pending",
      paidAt: invoice.paid_at ? new Date(invoice.paid_at) : undefined,
      paidAmount: invoice.total_paid ? invoice.total_paid * 100 : undefined, // reais → centavos
    };
  }

  async cancelBoleto(gatewayId: string): Promise<{ success: boolean }> {
    try {
      await this.api(`/invoices/${gatewayId}/cancel`, { method: "POST" });
      return { success: true };
    } catch (err) {
      logger.error("Cobre Fácil cancelBoleto failed:", err);
      return { success: false };
    }
  }

  validateWebhook(headers: Record<string, string>, body: string): boolean {
    // Cobre Fácil não documenta assinatura de webhook.
    // Validação por presença do campo "event" + "data" no body.
    // Em produção, considerar validar por IP de origem ou secret customizado.
    try {
      const parsed = JSON.parse(body);
      return !!(parsed.event && parsed.data);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: string): WebhookEvent | null {
    try {
      const parsed = JSON.parse(body);
      const { event, data } = parsed;

      const eventMap: Record<string, WebhookEvent["type"]> = {
        "invoice.paid": "boleto.paid",
        "invoice.canceled": "boleto.cancelled",
        "invoice.refunded": "boleto.cancelled",
        "invoice.reversed": "boleto.failed",
        "invoice.declined": "boleto.failed",
      };

      const mappedType = eventMap[event];
      if (!mappedType) return null;

      return {
        type: mappedType,
        gatewayId: data.id,
        paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
        paidAmount: data.total_paid ? data.total_paid * 100 : undefined,
        rawEvent: parsed,
      };
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      // Tentar autenticar — se der certo, conexão OK
      const response = await authenticatedFetch(
        this.appId, this.secret, "/customers?limit=1",
      );
      const json = await response.json();

      if (json.success) {
        return { ok: true, message: "Conexão com Cobre Fácil estabelecida com sucesso." };
      }
      return { ok: false, message: `Erro: ${json.message}` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Erro desconhecido",
      };
    }
  }
}
```

### 5.3 Registry — Adicionar ao `registry.ts`

```typescript
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
      helpText: "Encontre em Cobre Fácil → Configurações → Integrações",
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
      group: "settings",
    },
  ],
},
```

### 5.4 Factory — Adicionar ao `factory.ts`

```typescript
cobrefacil: (decryptedCredentials, metadata, webhookSecret) => {
  const { CobreFacilProvider } = require("./providers/cobrefacil.provider");

  const appId = decryptedCredentials.appId;
  const secret = decryptedCredentials.secret;
  if (!appId || typeof appId !== "string") {
    throw new Error("Cobre Fácil: campo 'appId' é obrigatório");
  }
  if (!secret || typeof secret !== "string") {
    throw new Error("Cobre Fácil: campo 'secret' é obrigatório");
  }

  return new CobreFacilProvider(
    { appId, secret },
    metadata ? {
      defaultPaymentMethod: metadata.defaultPaymentMethod as string | undefined,
      finePercentage: typeof metadata.finePercentage === "number" ? metadata.finePercentage : undefined,
      interestPercentage: typeof metadata.interestPercentage === "number" ? metadata.interestPercentage : undefined,
      discountPercentage: typeof metadata.discountPercentage === "number" ? metadata.discountPercentage : undefined,
      discountDays: typeof metadata.discountDays === "number" ? metadata.discountDays : undefined,
    } : null,
    webhookSecret,
  );
},
```

### 5.5 Constants — Adicionar ao `constants.ts`

```typescript
export const PRODUCTION_PROVIDER_TYPES = ["pagarme", "pinbank", "santander", "cobrefacil"] as const;
```

---

## 6. Stories de Implementação

### Story 1: Token Management + Provider Base
**Prioridade:** 🔴 Crítica | **Estimativa:** 2h

- [ ] Criar `cobrefacil-auth.ts` com cache de token + auto-refresh
- [ ] Criar `cobrefacil.provider.ts` com constructor + `testConnection()`
- [ ] Adicionar `"cobrefacil"` em `PRODUCTION_PROVIDER_TYPES`
- [ ] Adicionar config schema no `registry.ts`
- [ ] Adicionar factory entry no `factory.ts`
- [ ] Testar: configurar provider via UI → "Testar Conexão" funciona

**Critério de aceite:** Admin configura Cobre Fácil pela UI existente de Integrações Bancárias e testa conexão com sucesso.

### Story 2: Criar Customer + Gerar Cobrança (Boleto)
**Prioridade:** 🔴 Crítica | **Estimativa:** 3h

- [ ] Implementar `ensureCustomer()` — busca por CPF/CNPJ, cria se não existe
- [ ] Implementar `createBoleto()` — gera cobrança com `payable_with: "bankslip"`
- [ ] Tratar conversão centavos ↔ reais (ERP usa centavos, CF usa reais nas invoices)
- [ ] Implementar `getBoletoStatus()`
- [ ] Implementar `cancelBoleto()`
- [ ] Testar: gerar boleto a partir de proposta aceita

**Critério de aceite:** Proposta aceita → Gerar Boletos → selecionar Cobre Fácil → boleto gerado com linha digitável, código de barras e URL.

### Story 3: Webhook de Pagamento
**Prioridade:** 🔴 Crítica | **Estimativa:** 2h

- [ ] Implementar `validateWebhook()` e `parseWebhookEvent()`
- [ ] Mapear eventos: `invoice.paid` → `boleto.paid`, `invoice.canceled` → `boleto.cancelled`
- [ ] Testar com webhook do Cobre Fácil → boleto baixado automaticamente no financeiro
- [ ] Verificar que `processBoletoWebhookEvent()` (já existente) funciona com o novo provider

**Critério de aceite:** Cobre Fácil envia webhook `invoice.paid` → Boleto atualiza pra PAID → AccountReceivable atualiza pra PAID → Audit log registrado.

### Story 4: Suporte a PIX
**Prioridade:** 🟡 Média | **Estimativa:** 2h

- [ ] Confirmar na API se PIX usa mesmo endpoint (`/invoices` com `payable_with: "pix"`)
- [ ] Extrair QR Code e código PIX copia-e-cola do retorno
- [ ] Mapear no `CreateBoletoResult.qrCode`
- [ ] Setting `defaultPaymentMethod` determina se gera boleto ou PIX

**Critério de aceite:** Gerar cobrança PIX via Cobre Fácil → QR Code exibido na UI → pagamento via webhook.

### Story 5: Testes Automatizados
**Prioridade:** 🟡 Média | **Estimativa:** 2h

- [ ] Criar `__tests__/cobrefacil.provider.test.ts`
- [ ] Testar auth (token cache, refresh, retry em 401)
- [ ] Testar createBoleto (mock HTTP)
- [ ] Testar parseWebhookEvent (todos os tipos)
- [ ] Testar ensureCustomer (busca existente + criação)

**Critério de aceite:** Todos os testes passando, cobertura ≥ 80% do provider.

---

## 7. Pontos de Atenção

### ⚠️ Conversão de Valores
- **ERP:** valores em centavos (integer)
- **Cobre Fácil invoices:** valores em reais (float) — **confirmar com a API real**
- **Cobre Fácil product-services:** valores em centavos na criação, float no retorno
- Usar `CENTS_PER_UNIT` (100) do `constants.ts` pra converter

### ⚠️ Customer Obrigatório
Diferente do Pagar.me onde o customer pode ser criado inline, no Cobre Fácil o customer precisa existir **antes** da cobrança. O `ensureCustomer()` faz lazy creation (busca por CPF/CNPJ, cria se não existe). Endereço é **obrigatório**.

### ⚠️ Token Expiration
Token dura ~1h. O `cobrefacil-auth.ts` cacheia em memória com margem de 5min. Em serverless/edge, o cache pode ser perdido entre invocações — precisa de fallback (retry em 401).

### ⚠️ Webhook Sem Assinatura
A documentação do Cobre Fácil **não documenta** assinatura HMAC nos webhooks. Opções:
1. Validar por estrutura do payload (campo `event` + `data`)
2. Validar por IP de origem (se eles publicarem ranges)
3. Usar secret customizado na URL do webhook (ex: `/api/webhooks/payment/{providerId}?secret=xxx`)

**Recomendação:** usar opção 3 (secret na URL) como camada extra, já que o `providerId` na URL já restringe o escopo.

### ⚠️ Rate Limits
Documentação não menciona rate limits explícitos. Implementar retry com backoff exponencial nas chamadas HTTP.

---

## 8. Fora de Escopo

- ❌ Módulo NFSe do Cobre Fácil (MendesApp já emite notas)
- ❌ Sync bidirecional de clientes (apenas lazy creation ERP → CF)
- ❌ Mensalidades/subscriptions do Cobre Fácil (usar recorrência do ERP)
- ❌ Split de pagamentos (fase futura se necessário)
- ❌ Carnês de pagamento (fase futura)
- ❌ Cartão de crédito como método principal (fase 2 — começar com boleto + PIX)
- ❌ Migração de cobranças existentes de outros providers

---

## 9. Pré-requisitos

- [ ] Criar conta no Cobre Fácil (https://app.cobrefacil.com.br)
- [ ] Obter `app_id` + `secret` de produção (painel → Integrações)
- [ ] Solicitar credenciais de **sandbox** pra testes (contatar suporte)
- [ ] Salvar credenciais no 1Password (vault Automação)
- [ ] Cadastrar URL de webhook no painel: `https://boletoapi.com/api/webhooks/payment/{providerId}`

---

## 10. Estimativa Total

| Story | Estimativa |
|-------|-----------|
| 1. Token + Provider Base | 2h |
| 2. Customer + Boleto | 3h |
| 3. Webhooks | 2h |
| 4. PIX | 2h |
| 5. Testes | 2h |
| **Total** | **~11h** |

**Nota:** zero mudança no frontend necessária — a UI de Integrações Bancárias já renderiza campos dinamicamente a partir do `configSchema`. Novo provider aparece automaticamente no dropdown.
