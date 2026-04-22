# PRD — Lytex Pagamentos como Gateway de Cobrança

> **Autor:** Vex ⚡ | **Data:** 2026-03-26
> **Repo:** `diogenesmendes01/MendesAplication` | **Base:** `erp/`
> **Branch sugerida:** `feat/lytex-provider`
> **Depende de:** Payment Providers (já implementado — Pagar.me, Santander, Cobre Fácil, Mock)

---

## 1. Contexto

O MendesApplication já possui 4 payment providers integrados (Pagar.me, Santander, Cobre Fácil, Mock). A Lytex Pagamentos será o 5º gateway, trazendo como diferenciais o **referenceId nativo** (vinculação direta com ID do ERP), **cliente inline** na fatura (sem necessidade de pré-cadastro), **régua de cobrança** automatizada e **negativação Serasa** integrada.

**API Reference:** https://docs-pay.lytex.com.br/documentacao/v2
**Documentação estudada:** `memory/integracoes/lytex-api.md`
**NFSe: NÃO usar da Lytex — MendesApplication já emite notas sozinho.**

---

## 2. Decisões de Arquitetura

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Padrão | Mesmo factory/registry/router existente | Consolidado |
| Auth | Token + refresh token com cache | Token expira em **5 minutos** (!), refresh obrigatório |
| Cliente | Inline na fatura (campo `client`) | Mais simples que Cobre Fácil, não precisa de `ensureCustomer` |
| referenceId | Mapear para `boletoId` do ERP | Reconciliação direta via webhook |
| Valores | Centavos (mesmo do ERP) | Zero conversão necessária ✅ |
| NFSe Lytex | NÃO USAR | MendesApp já emite |
| Serasa | Expor como setting configurável | Feature poderosa mas opt-in |

---

## 3. Diferenças da Lytex vs Providers Existentes

| Aspecto | Pagar.me | Cobre Fácil | Lytex |
|---------|----------|-------------|-------|
| Auth | API Key fixa (Basic) | Token 1h | Token **5min** + refresh |
| Customer | Inline na order | Criar antes (obrigatório) | **Inline na fatura** |
| Valores | Centavos | Misto (centavos/reais) | **Centavos** (= ERP) |
| referenceId | metadata | Não nativo | ✅ **Nativo** |
| Serasa | ❌ | ❌ | ✅ Negativação automática |
| Régua cobrança | ❌ | ❌ | ✅ Nativo |
| Webhook HMAC | SHA1 | Não documentado | Não documentado |
| Links de pgto | ❌ | ❌ | ✅ Nativo |

---

## 4. Arquivos a Criar/Modificar

### Novos Arquivos

```
erp/src/lib/payment/providers/
├── lytex-auth.ts              ← Token + refresh management (cache 5min)
└── lytex.provider.ts          ← Implementação PaymentGateway
erp/src/lib/payment/__tests__/
└── lytex.provider.test.ts     ← Testes
```

### Arquivos a Modificar

```
erp/src/lib/payment/
├── constants.ts               ← Adicionar "lytex" em PRODUCTION_PROVIDER_TYPES
├── registry.ts                ← Adicionar configSchema + settingsSchema
└── factory.ts                 ← Adicionar factory entry
```

---

## 5. Implementação Detalhada

### 5.1 Token Management (`lytex-auth.ts`)

Token da Lytex expira em **5 minutos** — muito mais curto que o Cobre Fácil (1h).
Necessita de refresh token agressivo + cache com margem mínima.

```typescript
// lytex-auth.ts

interface CachedAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;       // Date.now() + TTL - margem
  refreshExpiresAt: number;
}

const authCache = new Map<string, CachedAuth>();

const BASE_URL = "https://api-pay.lytex.com.br";
const SANDBOX_BASE_URL = "https://sandbox-api-pay.lytex.com.br";
const TOKEN_REFRESH_MARGIN_MS = 60_000;  // 1 min antes de expirar (de 5min)
const REQUEST_TIMEOUT_MS = 15_000;

export async function getAuthToken(
  clientId: string, 
  clientSecret: string, 
  sandbox: boolean = false
): Promise<string> {
  const cacheKey = `${clientId}:${clientSecret}`;
  const cached = authCache.get(cacheKey);
  const baseUrl = sandbox ? SANDBOX_BASE_URL : BASE_URL;

  // Token válido → retorna
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  // Token expirado mas refresh válido → refresh
  if (cached && cached.refreshExpiresAt > Date.now()) {
    return refreshAuth(cached, cacheKey, baseUrl);
  }

  // Nada válido → obtain fresh
  return obtainNewToken(clientId, clientSecret, cacheKey, baseUrl);
}

async function obtainNewToken(
  clientId: string, 
  clientSecret: string, 
  cacheKey: string, 
  baseUrl: string
): Promise<string> {
  const response = await fetch(`${baseUrl}/v2/auth/obtain_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`Lytex auth failed: ${response.status}`);
  const data = await response.json();

  const now = Date.now();
  authCache.set(cacheKey, {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: new Date(data.expireAt).getTime() - TOKEN_REFRESH_MARGIN_MS,
    refreshExpiresAt: new Date(data.refreshExpireAt).getTime() - TOKEN_REFRESH_MARGIN_MS,
  });

  return data.accessToken;
}

async function refreshAuth(
  cached: CachedAuth, 
  cacheKey: string, 
  baseUrl: string
): Promise<string> {
  const response = await fetch(`${baseUrl}/v2/auth/refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accessToken: cached.accessToken,
      refreshToken: cached.refreshToken,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Refresh falhou → limpar cache, forçar novo obtain
    authCache.delete(cacheKey);
    throw new Error(`Lytex refresh failed: ${response.status}`);
  }

  const data = await response.json();
  authCache.set(cacheKey, {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: new Date(data.expireAt).getTime() - TOKEN_REFRESH_MARGIN_MS,
    refreshExpiresAt: new Date(data.refreshExpireAt).getTime() - TOKEN_REFRESH_MARGIN_MS,
  });

  return data.accessToken;
}

/**
 * Fetch autenticado com retry em 401 (re-auth automático).
 */
export async function authenticatedFetch(
  clientId: string,
  clientSecret: string,
  path: string,
  options: RequestInit = {},
  sandbox: boolean = false,
): Promise<Response> {
  const baseUrl = sandbox ? SANDBOX_BASE_URL : BASE_URL;
  let token = await getAuthToken(clientId, clientSecret, sandbox);

  let response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      ...options.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // Token expirou entre cache e request → retry
  if (response.status === 401 || response.status === 410) {
    authCache.delete(`${clientId}:${clientSecret}`);
    token = await getAuthToken(clientId, clientSecret, sandbox);
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
        ...options.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  return response;
}

export function clearTokenCache(): void {
  authCache.clear();
}
```

### 5.2 Provider (`lytex.provider.ts`)

```typescript
// lytex.provider.ts — implements PaymentGateway

import type {
  PaymentGateway,
  CreateBoletoInput,
  CreateBoletoResult,
  BoletoStatusResult,
  WebhookEvent,
} from "../types";
import { authenticatedFetch } from "./lytex-auth";
import { logger } from "@/lib/logger";

interface LytexCredentials {
  clientId: string;
  clientSecret: string;
  sandbox?: boolean;
}

interface LytexMetadata {
  defaultPaymentMethod?: "boleto" | "pix" | "creditCard";
  cancelOverdueDays?: number;
  overduePaymentDays?: number;
  enableMulctAndInterest?: boolean;
  mulctPercentage?: number;    // multa %
  interestPercentage?: number; // juros mensal %
  enableSerasa?: boolean;
  serasaNegativityDays?: number;
  billingRuleId?: string;      // régua de cobrança
}

export class LytexProvider implements PaymentGateway {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly sandbox: boolean;
  private readonly metadata: LytexMetadata | null;
  private readonly webhookSecret?: string;

  constructor(
    credentials: LytexCredentials,
    metadata?: LytexMetadata | null,
    webhookSecret?: string,
  ) {
    if (!credentials.clientId) throw new Error("Lytex: clientId é obrigatório");
    if (!credentials.clientSecret) throw new Error("Lytex: clientSecret é obrigatório");

    this.clientId = credentials.clientId;
    this.clientSecret = credentials.clientSecret;
    this.sandbox = credentials.sandbox ?? false;
    this.metadata = metadata ?? null;
    this.webhookSecret = webhookSecret;
  }

  private async api(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await authenticatedFetch(
      this.clientId, this.clientSecret, path, options, this.sandbox,
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Lytex API error ${response.status}: ${text}`);
    }
    return response.json();
  }

  // ========== PaymentGateway Interface ==========

  async createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResult> {
    // Determinar métodos de pagamento
    const method = this.metadata?.defaultPaymentMethod ?? "boleto";

    const invoiceData: Record<string, unknown> = {
      // Cliente INLINE — sem necessidade de pré-cadastro
      client: {
        type: input.customer.documentType === "cpf" ? "pf" : "pj",
        name: input.customer.name,
        cpfCnpj: input.customer.document.replace(/\D/g, ""),
        email: input.customer.email ?? "",
        cellphone: "",
        ...(input.customer.address ? {
          address: {
            zip: input.customer.address.zipCode.replace(/\D/g, ""),
            street: input.customer.address.street,
            city: input.customer.address.city,
            state: input.customer.address.state,
            zone: input.customer.address.neighborhood,
          },
        } : {}),
      },
      // Valor em CENTAVOS (igual ao ERP — zero conversão!)
      totalValue: input.amount,
      items: [{
        name: input.description ?? "Cobrança",
        quantity: 1,
        value: input.amount,
      }],
      dueDate: input.dueDate.toISOString().split("T")[0], // YYYY-MM-DD
      paymentMethods: {
        pix: { enable: method === "pix" || method === "boleto" },
        boleto: { enable: method === "boleto" },
        creditCard: { enable: method === "creditCard" },
      },
      // referenceId → vincular com boletoId do ERP pra reconciliação
      referenceId: input.metadata?.boletoId ?? input.metadata?.referenceId ?? "",
      observation: input.instructions ?? "",
    };

    // Multa e juros
    if (this.metadata?.enableMulctAndInterest) {
      invoiceData.mulctAndInterest = {
        enable: true,
        mulct: { type: "percentage", value: this.metadata.mulctPercentage ?? 2 },
        interest: { type: "monthly", value: this.metadata.interestPercentage ?? 1 },
      };
    }

    // Cancelamento automático após vencimento
    if (this.metadata?.cancelOverdueDays) {
      invoiceData.cancelOverdueDays = this.metadata.cancelOverdueDays;
    }
    if (this.metadata?.overduePaymentDays) {
      invoiceData.overduePaymentDays = this.metadata.overduePaymentDays;
    }

    // Serasa (negativação)
    if (this.metadata?.enableSerasa) {
      invoiceData.serasa = {
        negativityDays: this.metadata.serasaNegativityDays ?? 30,
      };
    }

    // Régua de cobrança
    if (this.metadata?.billingRuleId) {
      invoiceData._billingRuleId = this.metadata.billingRuleId;
    }

    const invoice = (await this.api("/v2/invoices", {
      method: "POST",
      body: JSON.stringify(invoiceData),
    })) as {
      _hashId: string;
      _id: string;
      status: string;
      linkCheckout?: string;
      linkBoleto?: string;
      paymentMethods?: Record<string, unknown>;
      lastPayment?: { ourNumber?: string };
    };

    return {
      gatewayId: invoice._hashId ?? invoice._id,
      url: invoice.linkCheckout,
      line: undefined,    // Lytex não retorna linha digitável diretamente (usar linkBoleto)
      barcode: undefined,
      qrCode: undefined,  // PIX code disponível no checkout
      pdf: invoice.linkBoleto,
      nossoNumero: invoice.lastPayment?.ourNumber,
      rawResponse: invoice,
    };
  }

  async getBoletoStatus(gatewayId: string): Promise<BoletoStatusResult> {
    const invoice = (await this.api(`/v2/invoices/${gatewayId}`)) as {
      _hashId: string;
      status: string;
      paymentData?: { payedAt?: string; payedValue?: number };
      lastPayment?: { payedAt?: string; payedValue?: number };
    };

    const statusMap: Record<string, BoletoStatusResult["status"]> = {
      waiting_payment: "pending",
      pending: "pending",
      paid: "paid",
      canceled: "cancelled",
      expired: "expired",
      refunded: "cancelled",
      overdue: "pending",
    };

    const paidAt = invoice.paymentData?.payedAt ?? invoice.lastPayment?.payedAt;
    const paidAmount = invoice.paymentData?.payedValue ?? invoice.lastPayment?.payedValue;

    return {
      gatewayId: invoice._hashId,
      status: statusMap[invoice.status] ?? "pending",
      paidAt: paidAt ? new Date(paidAt) : undefined,
      paidAmount: paidAmount ?? undefined, // já em centavos
    };
  }

  async cancelBoleto(gatewayId: string): Promise<{ success: boolean }> {
    try {
      // Lytex: atualizar fatura com cancelamento (confirmar endpoint exato)
      await this.api(`/v2/invoices/${gatewayId}`, {
        method: "DELETE",
      });
      return { success: true };
    } catch (err) {
      logger.error({ err }, "[Lytex] cancelBoleto failed");
      return { success: false };
    }
  }

  validateWebhook(headers: Record<string, string>, body: string): boolean {
    try {
      const parsed = JSON.parse(body);
      // Lytex não documenta HMAC — validar por estrutura
      return !!(parsed._hashId || parsed._id) && !!parsed.status;
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: string): WebhookEvent | null {
    try {
      const parsed = JSON.parse(body);

      // Mapear status da fatura → evento do ERP
      const statusToEvent: Record<string, WebhookEvent["type"]> = {
        paid: "boleto.paid",
        canceled: "boleto.cancelled",
        expired: "boleto.expired",
        refunded: "boleto.cancelled",
      };

      const eventType = statusToEvent[parsed.status];
      if (!eventType) return null;

      return {
        type: eventType,
        gatewayId: parsed._hashId ?? parsed._id,
        paidAt: parsed.paymentData?.payedAt ? new Date(parsed.paymentData.payedAt) : undefined,
        paidAmount: parsed.paymentData?.payedValue ?? undefined,
        rawEvent: parsed,
      };
    } catch (err) {
      logger.error({ err }, "[Lytex] Failed to parse webhook event");
      return null;
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.api("/v2/auth/user_data");
      return { ok: true, message: "Conexão com Lytex estabelecida com sucesso." };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Erro desconhecido",
      };
    }
  }
}
```

### 5.3 Registry — `registry.ts`

```typescript
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
```

### 5.4 Factory — `factory.ts`

```typescript
lytex: (decryptedCredentials, metadata, webhookSecret, options) => {
  const { LytexProvider } = require("./providers/lytex.provider");

  const clientId = decryptedCredentials.clientId;
  const clientSecret = decryptedCredentials.clientSecret;
  if (!clientId || typeof clientId !== "string") {
    throw new Error("Lytex: campo 'clientId' é obrigatório");
  }
  if (!clientSecret || typeof clientSecret !== "string") {
    throw new Error("Lytex: campo 'clientSecret' é obrigatório");
  }

  return new LytexProvider(
    { clientId, clientSecret, sandbox: options?.sandbox ?? false },
    metadata ? {
      defaultPaymentMethod: metadata.defaultPaymentMethod as string | undefined,
      cancelOverdueDays: typeof metadata.cancelOverdueDays === "number" ? metadata.cancelOverdueDays : undefined,
      overduePaymentDays: typeof metadata.overduePaymentDays === "number" ? metadata.overduePaymentDays : undefined,
      enableMulctAndInterest: !!metadata.enableMulctAndInterest,
      mulctPercentage: typeof metadata.mulctPercentage === "number" ? metadata.mulctPercentage : undefined,
      interestPercentage: typeof metadata.interestPercentage === "number" ? metadata.interestPercentage : undefined,
      enableSerasa: !!metadata.enableSerasa,
      serasaNegativityDays: typeof metadata.serasaNegativityDays === "number" ? metadata.serasaNegativityDays : undefined,
      billingRuleId: typeof metadata.billingRuleId === "string" ? metadata.billingRuleId : undefined,
    } : null,
    webhookSecret,
  );
},
```

### 5.5 Constants

```typescript
export const PRODUCTION_PROVIDER_TYPES = [
  "pagarme", "pinbank", "santander", "cobrefacil", "lytex"
] as const;
```

---

## 6. Stories de Implementação

### Story 1: Auth com Refresh Token + Provider Base
**Prioridade:** 🔴 Crítica | **Estimativa:** 2h

- [ ] Criar `lytex-auth.ts` com obtain + refresh + cache (margem 1min de 5min)
- [ ] Criar `lytex.provider.ts` com constructor + `testConnection()`
- [ ] Adicionar `"lytex"` em `PRODUCTION_PROVIDER_TYPES`
- [ ] Adicionar config no `registry.ts` (credentials + 9 settings)
- [ ] Adicionar factory no `factory.ts` (com suporte a sandbox flag)

**Critério de aceite:** Configurar Lytex na UI → Testar Conexão → sucesso (chama `/v2/auth/user_data`)

### Story 2: Criar Fatura com Cliente Inline
**Prioridade:** 🔴 Crítica | **Estimativa:** 2h

- [ ] Implementar `createBoleto()` com client inline (sem ensureCustomer)
- [ ] Mapear `referenceId` → `boletoId` do ERP
- [ ] Valores em centavos (zero conversão)
- [ ] Suporte a boleto + PIX via `paymentMethods`
- [ ] Multa, juros, Serasa, régua de cobrança opcionais
- [ ] Implementar `getBoletoStatus()` e `cancelBoleto()`

**Critério de aceite:** Gerar cobrança → link checkout + link boleto retornados → status consultável

### Story 3: Webhook de Pagamento
**Prioridade:** 🔴 Crítica | **Estimativa:** 2h

- [ ] Implementar `validateWebhook()` e `parseWebhookEvent()`
- [ ] Mapear status: paid → boleto.paid, canceled → boleto.cancelled, expired → boleto.expired
- [ ] `referenceId` no webhook → reconciliar com boleto do ERP
- [ ] Verificar compatibilidade com `processBoletoWebhookEvent()` existente

**Critério de aceite:** Webhook paid → Boleto PAID → AccountReceivable PAID → audit log

### Story 4: Testes Automatizados
**Prioridade:** 🟡 Média | **Estimativa:** 2h

- [ ] Criar `lytex.provider.test.ts`
- [ ] Testar auth: obtain, refresh, retry em 401/410, cache expiry
- [ ] Testar createBoleto: client inline, referenceId, centavos
- [ ] Testar parseWebhookEvent: todos os status
- [ ] Testar testConnection: success + failure
- [ ] Garantir que NÃO importa variáveis sem usar (lint fix preventivo)

**Critério de aceite:** Todos os testes passando, lint limpo, CI verde

---

## 7. Pontos de Atenção

### ⚠️ Token de 5 Minutos
Mais agressivo que qualquer outro provider. O `lytex-auth.ts` precisa:
- Cache com margem de 1 min (refresh quando faltam 60s)
- Refresh token quando access expira
- Fallback para `obtain_token` quando refresh também expirou
- Retry em 401/410 no `authenticatedFetch`

### ⚠️ Webhook Payload Incerto
A documentação lista os eventos mas não mostra o payload exato do webhook. A implementação inicial assume que o payload é a fatura completa (com `_hashId`, `status`, `paymentData`). Pode precisar de ajuste quando testar com webhooks reais.

### ⚠️ Serasa — Cuidado
A negativação Serasa é poderosa mas irreversível. Manter como opt-in (setting `enableSerasa`) e alertar na UI que está ativando negativação automática.

### ⚠️ referenceId — Mão Dupla
O `referenceId` é retornado nos webhooks e buscas. Usar isso como ponte de reconciliação → mapear para `boletoId` do ERP, permitindo match direto sem heurística (melhora muito sobre o fallback por valor/data do `webhook-handler.ts`).

---

## 8. Fora de Escopo

- ❌ NFSe da Lytex (MendesApp já emite)
- ❌ Links de pagamento (usar faturas diretas)
- ❌ Assinaturas/recorrência da Lytex (usar do ERP)
- ❌ Subcontas
- ❌ Carteira digital
- ❌ Cartão de crédito como método principal (fase 2)

---

## 9. Pré-requisitos

- [ ] Criar conta na Lytex (https://lytex.com.br)
- [ ] Obter clientId + clientSecret (Painel → Configurações → Integrações e API)
- [ ] Acessar sandbox (login separado)
- [ ] Cadastrar URL de webhook no painel
- [ ] Configurar permissão "Faturas" na integração
- [ ] Salvar credenciais no 1Password

---

## 10. Estimativa Total

| Story | Estimativa |
|-------|-----------|
| 1. Auth + Provider Base | 2h |
| 2. Fatura + Status | 2h |
| 3. Webhooks | 2h |
| 4. Testes | 2h |
| **Total** | **~8h** |

**Nota:** ~3h menos que Cobre Fácil porque: (1) sem `ensureCustomer` (cliente inline), (2) valores em centavos (zero conversão), (3) padrão já consolidado nos outros providers.
