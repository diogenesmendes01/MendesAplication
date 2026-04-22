# PRD — Integrações Bancárias (Payment Providers)

> **Autor:** Vex ⚡ | **Data:** 2026-03-10
> **Repo:** `diogenesmendes01/MendesAplication` | **Base:** `erp/`
> **Branch:** `feat/payment-providers`

---

## 1. Contexto

O ERP hoje gera boletos via `MockBoletoProvider` — uma interface que simula a geração mas não conecta com nenhum banco real. A TrustCloud já usa a API da Pagar.me (repo `api-pagarme` separado) com ~85k cobranças no banco, e há demanda por PinBank e futuros bancos.

**Problema:** cada banco é um sistema isolado, sem vínculo com clientes, propostas ou financeiro do ERP.

**Solução:** abstrair os gateways de pagamento dentro do ERP com suporte a múltiplos providers por empresa, regras de roteamento automático, seleção manual na proposta, e formulário de configuração dinâmico por provider.

---

## 2. Decisões de Arquitetura

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Onde vive o código | Dentro do ERP (`erp/src/lib/payment/`) | Evita microsserviço isolado, dados ficam integrados |
| Quantos bancos por empresa | N (ilimitado) | Empresa pode ter Pagar.me + PinBank + Bradesco |
| Roteamento | Automático com regras + override manual | Automático no dia a dia, manual quando quiser |
| Credenciais | Encriptadas no banco (AES, mesma lib do certificado NFS-e) | Já existe `encryption.ts` no ERP |
| Webhooks | Rota única `/api/webhooks/payment/[provider]` | Cada provider valida sua própria assinatura |
| Chamadas HTTP | Direto pra API do banco (fetch), sem SDK | Controle total, sem dependência de SDK desatualizado |
| Config dinâmica | Cada provider exporta `configSchema` que o frontend renderiza | Novo banco = novo schema, zero mudança no frontend |

---

## 3. Schema Prisma — Novos Models

```prisma
model PaymentProvider {
  id            String   @id @default(cuid())
  companyId     String
  name          String                          // "Pagar.me Produção", "PinBank"
  provider      String                          // "pagarme" | "pinbank" | "mock"
  credentials   String   @db.Text               // JSON encriptado (AES): apiKey, apiSecret, convênio, etc
  webhookUrl    String?                         // URL gerada automaticamente
  webhookSecret String?                         // secret pra validar webhook
  sandbox       Boolean  @default(false)
  isDefault     Boolean  @default(false)        // fallback quando nenhuma regra casa
  isActive      Boolean  @default(true)
  metadata      Json?                           // config comportamental (juros, multa, instruções)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  company  Company              @relation(fields: [companyId], references: [id], onDelete: Cascade)
  rules    PaymentRoutingRule[]
  boletos  Boleto[]

  @@index([companyId, isActive])
  @@map("payment_providers")
}

model PaymentRoutingRule {
  id          String      @id @default(cuid())
  providerId  String
  priority    Int         @default(0)          // menor = mais prioritário
  clientType  ClientType?                      // PF | PJ | null = qualquer
  minValue    Decimal?    @db.Decimal(12, 2)   // null = sem mínimo
  maxValue    Decimal?    @db.Decimal(12, 2)   // null = sem máximo
  tags        String[]                         // "governo", "educação", etc
  isActive    Boolean     @default(true)
  createdAt   DateTime    @default(now())

  provider PaymentProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@index([providerId, priority])
  @@map("payment_routing_rules")
}
```

### Alterações no model Boleto existente:

```prisma
model Boleto {
  // campos existentes mantidos (id, proposalId, bankReference, value, dueDate, installmentNumber, status, companyId, createdAt)

  // NOVOS CAMPOS:
  providerId     String?                        // qual provider gerou
  gatewayId      String?                        // ID na API do banco (charge_id, order_id, etc)
  gatewayData    Json?                          // { url, line, barcode, qrCode, pdf, nossoNumero, rawResponse }
  manualOverride Boolean  @default(false)       // true = usuário escolheu o banco manualmente

  provider PaymentProvider? @relation(fields: [providerId], references: [id], onDelete: SetNull)
}
```

### Alteração no model Company:

```prisma
model Company {
  // ... existente ...
  paymentProviders PaymentProvider[]
}
```

---

## 4. Backend — Estrutura de Arquivos

```
erp/src/lib/payment/
├── types.ts                  ← Interfaces: PaymentGateway, CreateBoletoInput/Result, WebhookEvent, ConfigField
├── factory.ts                ← getGateway(providerType, credentials, metadata) → instância do gateway
├── registry.ts               ← Registro de providers disponíveis + configSchema de cada um
├── router.ts                 ← resolveProvider(companyId, context) → provider do banco de dados
├── webhook-handler.ts        ← Valida assinatura + roteia pro provider correto + atualiza boleto + baixa financeiro
├── providers/
│   ├── pagarme.provider.ts   ← Implementação Pagar.me (API v5, HTTP direto)
│   ├── pinbank.provider.ts   ← Placeholder (throw "not implemented")
│   └── mock.provider.ts      ← Provider de teste (migra do atual MockBoletoProvider)
```

### 4.1 Interfaces (`types.ts`)

```typescript
// ============================================================
// Config Schema — cada provider define quais campos precisa
// ============================================================

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select';
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: { value: string; label: string }[];  // para type='select'
  group?: 'credentials' | 'settings';            // agrupa na UI
}

export interface ProviderDefinition {
  id: string;                     // "pagarme" | "pinbank" | "mock"
  name: string;                   // "Pagar.me" | "PinBank"
  logo?: string;                  // URL ou path do logo
  configSchema: ConfigField[];    // campos dinâmicos pra UI
  settingsSchema: ConfigField[];  // config comportamental (multa, juros, etc)
}

// ============================================================
// Gateway Interface — contrato que todo provider implementa
// ============================================================

export interface PaymentGateway {
  createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResult>;
  getBoletoStatus(gatewayId: string): Promise<BoletoStatusResult>;
  cancelBoleto(gatewayId: string): Promise<{ success: boolean }>;
  validateWebhook(headers: Record<string, string>, body: string): boolean;
  parseWebhookEvent(body: string): WebhookEvent;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

export interface CreateBoletoInput {
  customer: {
    name: string;
    document: string;         // CPF ou CNPJ
    documentType: 'cpf' | 'cnpj';
    email?: string;
    address?: {
      street: string;
      number: string;
      complement?: string;
      neighborhood: string;
      city: string;
      state: string;
      zipCode: string;
    };
  };
  amount: number;              // em centavos
  dueDate: Date;
  installmentNumber?: number;
  totalInstallments?: number;
  description?: string;
  instructions?: string;
  metadata?: Record<string, string>;
}

export interface CreateBoletoResult {
  gatewayId: string;
  url?: string;
  line?: string;               // linha digitável
  barcode?: string;
  qrCode?: string;
  pdf?: string;
  nossoNumero?: string;
  rawResponse?: unknown;       // resposta completa pra debug
}

export interface BoletoStatusResult {
  gatewayId: string;
  status: 'pending' | 'paid' | 'cancelled' | 'expired' | 'failed';
  paidAt?: Date;
  paidAmount?: number;
}

export interface WebhookEvent {
  type: 'boleto.paid' | 'boleto.cancelled' | 'boleto.expired' | 'boleto.failed';
  gatewayId: string;
  paidAt?: Date;
  paidAmount?: number;
  rawEvent: unknown;
}
```

### 4.2 Registry (`registry.ts`)

```typescript
// Registro central de todos os providers disponíveis
// O frontend consulta isso pra saber quais bancos existem e quais campos mostrar

export const PROVIDER_REGISTRY: Record<string, ProviderDefinition> = {
  pagarme: {
    id: 'pagarme',
    name: 'Pagar.me',
    configSchema: [
      { key: 'apiKey', label: 'Secret Key', type: 'password', required: true, 
        placeholder: 'sk_live_...', helpText: 'Encontre em Pagar.me Dashboard → Configurações → Chaves', group: 'credentials' },
    ],
    settingsSchema: [
      { key: 'defaultInstructions', label: 'Instruções do Boleto', type: 'text', required: false,
        placeholder: 'Não receber após vencimento', group: 'settings' },
      { key: 'daysToExpire', label: 'Dias para expirar', type: 'number', required: false, 
        placeholder: '5', group: 'settings' },
    ],
  },
  pinbank: {
    id: 'pinbank',
    name: 'PinBank',
    configSchema: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, group: 'credentials' },
      { key: 'convenio', label: 'Convênio', type: 'text', required: true, group: 'credentials' },
      { key: 'carteira', label: 'Carteira', type: 'text', required: true, group: 'credentials' },
      { key: 'cedente', label: 'Código Cedente', type: 'text', required: true, group: 'credentials' },
      { key: 'agencia', label: 'Agência', type: 'text', required: true, group: 'credentials' },
      { key: 'conta', label: 'Conta', type: 'text', required: true, group: 'credentials' },
    ],
    settingsSchema: [
      { key: 'multa', label: 'Multa (%)', type: 'number', required: false, group: 'settings' },
      { key: 'juros', label: 'Juros ao mês (%)', type: 'number', required: false, group: 'settings' },
      { key: 'desconto', label: 'Desconto antecipação (%)', type: 'number', required: false, group: 'settings' },
      { key: 'diasDesconto', label: 'Dias antecedência p/ desconto', type: 'number', required: false, group: 'settings' },
    ],
  },
  mock: {
    id: 'mock',
    name: 'Mock (Teste)',
    configSchema: [],
    settingsSchema: [],
  },
};
```

### 4.3 Router (`router.ts`)

```typescript
/**
 * Resolve qual provider usar para uma cobrança.
 *
 * 1. Busca todas as regras ativas da empresa, ordenadas por priority ASC
 * 2. Avalia cada regra: clientType, minValue, maxValue, tags
 * 3. Primeira que casa → retorna o provider
 * 4. Nenhuma casou → retorna o provider com isDefault=true
 * 5. Sem default → throw Error("Configure um banco padrão")
 */
export async function resolveProvider(
  companyId: string,
  context: { clientType: 'PF' | 'PJ'; value: number; tags?: string[] }
): Promise<PaymentProviderWithReason>;

/**
 * Retorna provider específico (override manual).
 * Valida que pertence à empresa e está ativo.
 */
export async function getProviderById(
  companyId: string,
  providerId: string
): Promise<PaymentProvider>;

/**
 * Retorna qual provider SERIA usado (preview, sem gerar nada).
 * Usado pelo frontend pra mostrar "Automático (Pagar.me)" no dropdown.
 */
export async function previewRouting(
  companyId: string,
  context: { clientType: 'PF' | 'PJ'; value: number; tags?: string[] }
): Promise<{ providerId: string; providerName: string; reason: string } | null>;
```

### 4.4 Pagar.me Provider

**API Reference:** https://docs.pagar.me/reference/introducao-1
- Base URL: `https://api.pagar.me/core/v5`
- Auth: Basic Auth (`sk_xxx:` como username, password vazio)
- Chamadas HTTP diretas com `fetch`, sem SDK

**Endpoints:**
| Ação | Método | Endpoint |
|------|--------|----------|
| Criar customer | POST | `/customers` |
| Criar order + charge (boleto) | POST | `/orders` |
| Consultar charge | GET | `/charges/{id}` |
| Cancelar charge | DELETE | `/charges/{id}` |

**Mapeamento de status:**
| Pagar.me | ERP BoletoStatus |
|----------|-----------------|
| `pending` | `GENERATED` |
| `paid` | `PAID` |
| `canceled` | `CANCELLED` |
| `failed` | `CANCELLED` |
| dueDate passada | `OVERDUE` |

**Webhook:** header `x-hub-signature` com HMAC-SHA1

### 4.5 Webhook Route

```
erp/src/app/api/webhooks/payment/[provider]/route.ts
```

URL pública: `https://boletoapi.com/api/webhooks/payment/pagarme`

Fluxo:
1. Recebe POST do banco
2. Identifica provider pelo path param
3. Busca todos PaymentProviders ativos desse tipo
4. Tenta validar assinatura com cada um (webhook secret)
5. Parseia evento → busca boleto por `gatewayId`
6. Atualiza status do boleto
7. Se pago: atualiza `AccountReceivable` correspondente (status → PAID, paidAt)
8. Log no `AuditLog`

---

## 5. Frontend

### 5.1 Configurações → Integrações Bancárias (NOVA PÁGINA)

**Rota:** `/configuracoes/integracoes-bancarias`

**Tela principal:**
- Cards dos providers configurados: nome, tipo, status (ativo/inativo), badge "Padrão", contagem de regras
- Botões por card: Editar, Testar Conexão, Ativar/Desativar
- Botão "+ Adicionar banco"

**Modal de adicionar/editar:**
- Step 1: Selecionar provider (dropdown dos disponíveis no registry)
- Step 2: Campos dinâmicos renderizados a partir do `configSchema` do provider selecionado
  - Grupo "Credenciais" (type=password mascarado)
  - Grupo "Configurações" (juros, multa, instruções)
- Step 3: Regras de roteamento
  - Lista de regras com: prioridade, tipo cliente (PF/PJ/Qualquer), valor mín/máx, tags
  - Adicionar/remover regras
  - Reordenar prioridade (drag-and-drop ou setas)
- Checkbox "Usar como padrão (fallback)"
- Toggle Sandbox
- Webhook URL (read-only, copiável)
- Botão "Testar Conexão"

**O formulário de credenciais é inteiramente dinâmico** — renderiza o que o `configSchema` mandar. Novo banco com campos diferentes = zero mudança no componente de UI.

### 5.2 Comercial → Propostas → Gerar Boletos (ALTERAÇÃO)

No modal de gerar boletos da proposta aceita:
- **Seletor de banco:** dropdown com:
  - `⚡ Automático` — mostra entre parênteses qual banco seria usado (chama `previewRouting`)
  - Lista de todos providers ativos da empresa
- Se 1 provider → não mostra dropdown
- Se 0 providers → aviso com link pra config
- Quando automático: tooltip mostrando qual regra casou
- Campo `providerId` é passado pro `generateBoletosForProposal()`

**Arquivo:** `erp/src/app/(app)/comercial/propostas/[id]/page.tsx`

### 5.3 Financeiro → Contas a Receber (ALTERAÇÃO)

Na listagem:
- Coluna/badge com ícone do provider
- Badge "Manual" se `manualOverride=true`

No detalhe do boleto:
- URL do boleto (link clicável)
- Linha digitável (copiável)
- QR Code (imagem se disponível)
- PDF (link)
- Nosso Número

### 5.4 Sidebar (ALTERAÇÃO)

Adicionar em Configurações:
```
⚙️ Configurações
├── ...existente...
├── 🏦 Integrações Bancárias  ← NOVO
├── ...existente...
```

---

## 6. Migration & Compatibilidade

- Novos models: `PaymentProvider`, `PaymentRoutingRule`
- Novos campos no `Boleto`: `providerId`, `gatewayId`, `gatewayData`, `manualOverride`
- Nova relação na `Company`: `paymentProviders`
- Boletos existentes: `providerId=null`, `gatewayData=null` (gerados pelo mock)
- `erp/src/lib/boleto.ts` atual → migra pra `providers/mock.provider.ts`
- `generateBoletosForProposal()` refatorado pra usar router/factory

---

## 7. Variáveis de Ambiente

Nenhuma nova. Credenciais ficam no banco encriptadas com `ENCRYPTION_KEY` (já existe).

---

## 8. Fora de Escopo

- Importar boletos existentes do banco Pagar.me (84k registros)
- Notificação automática (email/WhatsApp) quando boleto é gerado
- Retry automático de boletos que falharam
- Dashboard de métricas por provider
- Emissão automática de NFS-e ao receber pagamento via webhook
