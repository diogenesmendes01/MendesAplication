# PRD — Bling ERP Provider

> **Autor:** Vex ⚡ | **Data:** 2026-04-22
> **Repo:** `diogenesmendes01/MendesAplication` | **Base:** `erp/`
> **Branch:** `feat/bling-provider`

---

## 1. Context

O MendesApplication é um ERP multi-empresa para ecossistema de empresas de tecnologia. Hoje possui integrações com gateways de pagamento (Pagar.me, Santander, etc.) e precisa adicionar o Bling como um novo **provider de ERP** — não como gateway de pagamento.

O **Bling** é um ERP brasileiro completo que gerencia:
- **Produtos** (catálogo, variações, estoques)
- **Pedidos de Venda e Compra**
- **Notas Fiscais** (NF-e, NFC-e, NFS-e)
- **Contatos** (clientes e fornecedores)
- **Finanças** (contas a pagar e receber)
- **Categorização** de produtos e operações

Diferente da integração existente com a API Q10 Jack API (que é um sistema de telefonia), a integração com Bling permite sincronizar dados do ERP principal do cliente com o MendesApplication.

---

## 2. Arquitetura — Onde o Bling Provider se Encaixa

O MendesApplication já tem um padrão estabelecido de **provider** com:
- `types.ts` — interfaces
- `factory.ts` — criação de instâncias
- `registry.ts` — registro de providers disponíveis
- `providers/` — implementações específicas

O Bling provider segue o **mesmo padrão**, mas com escopo maior (ERP completo, não só financeiro).

### 2.1 Pasta de Destino

```
erp/src/lib/erp/
├── types.ts                     ← Interfaces genéricas de ERP Provider
├── factory.ts                   ← Factory de providers ERP
├── registry.ts                  ← Registro de providers ERP disponíveis
├── sync-engine.ts               ← Motor de sincronização (polling/webhook)
├── providers/
│   └── bling/
│       ├── types.ts             ← Tipos específicos do Bling
│       ├── client.ts             ← Cliente HTTP do Bling (OAuth + API)
│       ├── mappers.ts            ← Mapemento Bling → Modelo interno
│       ├── handlers/
│       │   ├── products.handler.ts
│       │   ├── orders.handler.ts
│       │   ├── contacts.handler.ts
│       │   ├── invoices.handler.ts
│       │   └── finances.handler.ts
│       └── sync.ts              ← Lógica de sincronização completa
```

### 2.2 Estratégia de Integração

Diferente de um gateway de pagamento (operação pontual), o Bling é um **sistema fonte de dados** que precisa de sincronização bidirecional contínua:

| Direção | Fluxo | Caso de Uso |
|---------|-------|-------------|
| Bling → ERP | Sync de dados | Produtos, pedidos, clientes criados no Bling aparecem no MendesApplication |
| ERP → Bling | Push de dados | Propostas/contratos criados no MendesApplication geram pedidos no Bling |
| Webhook | Event-driven | Atualização em tempo real (novo pedido, mudança de status) |

---

## 3. API do Bling — Visão Geral

### 3.1 Autenticação

O Bling usa **OAuth 2.0** (não API Key simples como outros providers).

**Fluxo:**
1. Criar aplicativo na conta Bling (via Bling Dashboard)
2. Obter `client_id` e `client_secret`
3. Realizar OAuth flow para obter `access_token` e `refresh_token`
4. Usar `access_token` no header `Authorization: Bearer {token}`
5. Quando expirar, usar `refresh_token` para obter novo access_token

**Endpoints de Auth:**
```
POST https://api.bling.com.br/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code={code}&client_id={id}&client_secret={secret}&redirect_uri={uri}
```

**Em produção:**
```
Base URL: https://api.bling.com.br
OAuth: https://api.bling.com.br/oauth/token
API: https://api.bling.com.br/Api/v3
```

**Rate Limits:**
- **3 requisições por segundo**
- **120.000 requisições por dia**
- Bloqueio por IP

**Regras de Filtro:**
- Requests GET com filtros por período com intervalo superior a um ano retornam **status code 400**
- Filtros por período possuem sufixos `"Inicial"` ou `"Final"` (ex: `dataInicial`, `dataFinal`, `dataAlteracaoInicial`, `dataAlteracaoFinal`)

### 3.2 Principais Endpoints

A API v3 do Bling segue padrão REST. Principais recursos:

#### Contatos (Clientes/Fornecedores)
```
GET    /contatos                              ← Listar (com filtros)
GET    /contatos/{id}                         ← Buscar por ID
POST   /contatos                              ← Criar
PUT    /contatos/{id}                         ← Atualizar
DELETE /contatos/{id}                        ← Deletar
```

**Exemplo GET /contatos:**
```json
{
  "data": [
    {
      "id": 123456,
      "tipo": "F",
      "situacao": "A",
      "nome": "Empresa XPTO LTDA",
      "cnpj": "12.345.678/0001-90",
      "ie": "123.456.789",
      "email": "contato@xpto.com",
      "telefone": "(19) 99999-9999",
      "endereco": {
        "endereco": "Rua Example",
        "numero": "100",
        "complemento": "Sala 1",
        "bairro": "Centro",
        "cep": "13010-000",
        "cidade": "Campinas",
        "uf": "SP"
      }
    }
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "pageSize": 50
  }
}
```

#### Produtos
```
GET    /produtos                              ← Listar
GET    /produtos/{id}                         ← Buscar por ID
POST   /produtos                              ← Criar
PUT    /produtos/{id}                         ← Atualizar
DELETE /produtos/{id}                        ← Deletar
GET    /produtos/variações/{id}             ← Variações
GET    /categorias/produtos                  ← Categorias
```

**Exemplo GET /produtos:**
```json
{
  "data": [
    {
      "id": 7890123,
      "codigo": "PROD-001",
      "nome": "Serviço de Desenvolvimento",
      "tipo": "S",
      "situacao": "A",
      "preco": "350.00",
      "estoque": {
        "geral": 0
      },
      "categoria": {
        "id": 123,
        "descricao": "Desenvolvimento"
      }
    }
  ]
}
```

#### Pedidos de Venda
```
GET    /pedidos/vendas                        ← Listar
GET    /pedidos/vendas/{id}                   ← Buscar por ID
POST   /pedidos/vendas                        ← Criar
PUT    /pedidos/vendas/{id}                   ← Atualizar
PATCH  /pedidos/vendas/{id}/sitacoes/{idSituacao}  ← Mudar situação
DELETE /pedidos/vendas/{id}                  ← Deletar
```

**Exemplo GET /pedidos/vendas:**
```json
{
  "data": [
    {
      "id": 456789,
      "numero": "2026-0001",
      "numeroPedidoIntegracao": "PROP-123",
      "data": "2026-04-22T10:30:00-03:00",
      "dataSaida": "2026-04-22",
      "situacao": {
        "id": 3,
        "nome": "Faturado"
      },
      "cliente": {
        "id": 123456,
        "nome": "Empresa XPTO LTDA"
      },
      "itens": {
        "item": [
          {
            "codigo": "PROD-001",
            "descricao": "Serviço de Desenvolvimento",
            "quantidade": "1.0000",
            "valorUnitario": "350.00",
            "valorFrete": "0.00",
            "desconto": "0.00",
            "total": "350.00"
          }
        ]
      },
      "totalVenda": "350.00",
      "valorFrete": "0.00",
      "desconto": "0.00",
      "totalLiquido": "350.00"
    }
  ]
}
```

#### Notas Fiscais
```
GET    /nfes                                 ← Listar NF-e
GET    /nfes/{id}                            ← Detalhe
POST   /nfes                                 ← Criar/emissão
GET    /nfes/documento/{chaveAcesso}        ← Download PDF/XML
GET    /nfces                                ← Listar NFC-e
GET    /nfses                                ← Listar NFS-e
```

#### Contas a Receber / Boletos
```
GET    /contas/receber                       ← Listar
GET    /contas/receber/{id}                 ← Detalhe
POST   /contas/receber                       ← Criar
PUT    /contas/receber/{id}                 ← Atualizar
PATCH  /contas/receber/{id}/baixa           ← Baixar (marcar como pago)
DELETE /contas/receber/{id}                ← Deletar
GET    /contas/receber/boletos              ← Listar boletos vinculados a contas
GET    /contas/receber/boletos/{id}        ← Detalhe de boleto específico
```

**Importante:** O endpoint `/contas/receber/boletos` retorna os dados do boleto (linha digitável, código de barras, PDF, nosso número) associado à conta. Útil para recuperar infos de boleto quando a conta foi criada/gerida via Bling e não via integração direta.

**Exemplo GET /contas/receber/boletos:**
```json
{
  "data": [
    {
      "id": 123456,
      "contaReceberId": 999888,
      "numeroDocumento": "FAT-2026-001",
      "nossoNumero": "1234567-8",
      "codigoBarras": "12345678901234567890123456789012345678901234",
      "linhaDigitavel": "12345678901234567890123456789012345678901234567890123",
      "urlBoleto": "https://www.bling.com.br/boleto/...",
      "dataEmissao": "2026-04-22",
      "dataVencimento": "2026-05-22",
      "valor": "350.00",
      "situacao": "aberto",
      "banco": {
        "id": 1,
        "nome": "Banco do Brasil"
      }
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "pageSize": 50
  }
}
```

**Exemplo GET /contas/receber:**
```json
{
  "data": [
    {
      "id": 999888,
      "documento": "FAT-2026-001",
      "dataEmissao": "2026-04-22",
      "dataVencimento": "2026-05-22",
      "dataCompetencia": "2026-04-22",
      "valorOriginal": "350.00",
      "valorJuros": "0.00",
      "valorMulta": "0.00",
      "valorDesconto": "0.00",
      "valorFinal": "350.00",
      "valorRecebido": "0.00",
      "situacao": "A",
      "categoria": {
        "id": 1,
        "descricao": "Receita de Vendas"
      },
      "cliente": {
        "id": 123456,
        "nome": "Empresa XPTO LTDA"
      }
    }
  ]
}
```

### 3.3 Parâmetros de Query Comuns

| Parâmetro | Descrição | Exemplo |
|-----------|-----------|---------|
| `page` | Página | `?page=2` |
| `pageSize` | Itens por página (max 100) | `?pageSize=50` |
| `situacao` | Filtrar por situação | `?situacao=A` |
| `dataInicial` | Data inicial (ISO 8601) | `?dataInicial=2026-01-01` |
| `dataFinal` | Data final | `?dataFinal=2026-12-31` |
| `loja` | ID da loja | `?loja=123456` |

### 3.4 Códigos de Situação de Pedidos

| ID | Nome |
|----|------|
| 1 | Aberto |
| 2 | em Aprovação |
| 3 | Faturado |
| 4 | Não Fiscalizado |
| 5 | Cancelado |

---

## 4. Schema Prisma — Extensões

```prisma
model ErpProvider {
  id            String   @id @default(cuid())
  companyId     String
  name          String                          // "Bling Produção"
  provider      String                          // "bling"
  credentials   String   @db.Text               // JSON encriptado (access_token, refresh_token, client_id, client_secret)
  baseUrl       String   @default("https://api.bling.com.br/Api/v3")
  storeId       String?                         // ID da loja no Bling (para multi-loja)
  sandbox       Boolean  @default(false)
  isActive      Boolean  @default(true)
  lastSyncAt    DateTime?
  syncStatus    Json?                           // { products: "ok", orders: "error", ... }
  metadata      Json?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, isActive])
  @@map("erp_providers")
}

// ─── Extensões em models existentes ───────────────────────────────────────

model Product {
  // ... existing fields ...
  blingId        String?                        // ID do produto no Bling
  blingSyncAt    DateTime?                      // Última sincronização com Bling
  blingData      Json?                          // Dados brutos do Bling pra referência
}

model Proposal {
  // ... existing fields ...
  blingOrderId   String?                        // ID do pedido gerado no Bling
  blingSyncAt    DateTime?
}

model Invoice {
  // ... existing fields ...
  blingNfId      String?                        // ID da NF-e no Bling
  blingChaveAcesso String?                     // Chave de acesso da nota
  blingSyncAt    DateTime?
}

// Extend Company model
model Company {
  // ... existing fields ...
  erpProviders   ErpProvider[]
}
```

---

## 5. Interfaces do Provider

```typescript
// ============================================================
//erp/src/lib/erp/types.ts
// ============================================================

export interface ErpProviderDefinition {
  id: string;              // "bling"
  name: string;            // "Bling ERP"
  logo?: string;
  configSchema: ConfigField[];
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select';
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: { value: string; label: string }[];
  group?: 'credentials' | 'settings';
}

// ─── Credenciais encriptadas (descriptado em runtime) ──────────────────────

export interface BlingCredentials {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  expiresAt?: number; // timestamp ms
}

// ─── Client Bling ──────────────────────────────────────────────────────────

export interface BlingClient {
  // Auth
  refreshAccessToken(): Promise<BlingCredentials>;

  // Contatos
  getContacts(params?: ContactListParams): Promise<BlingResponse<Contact>>;
  getContact(id: string): Promise<Contact>;
  createContact(data: CreateContactInput): Promise<Contact>;
  updateContact(id: string, data: UpdateContactInput): Promise<Contact>;

  // Produtos
  getProducts(params?: ProductListParams): Promise<BlingResponse<Product>>;
  getProduct(id: string): Promise<Product>;
  createProduct(data: CreateProductInput): Promise<Product>;
  updateProduct(id: string, data: UpdateProductInput): Promise<Product>;

  // Pedidos
  getOrders(params?: OrderListParams): Promise<BlingResponse<Order>>;
  getOrder(id: string): Promise<Order>;
  createOrder(data: CreateOrderInput): Promise<Order>;
  updateOrder(id: string, data: UpdateOrderInput): Promise<Order>;
  changeOrderStatus(orderId: string, statusId: number): Promise<void>;

  // Notas Fiscais
  getInvoices(params?: InvoiceListParams): Promise<BlingResponse<Invoice>>;
  getInvoice(id: string): Promise<Invoice>;
  createInvoice(data: CreateInvoiceInput): Promise<Invoice>;
  downloadInvoiceDocument(chaveAcesso: string, format: 'pdf' | 'xml'): Promise<Buffer>;

  // Contas a Receber
  getAccountsReceivable(params?: AccountListParams): Promise<BlingResponse<AccountReceivable>>;
  getAccountReceivable(id: string): Promise<AccountReceivable>;
  createAccountReceivable(data: CreateAccountReceivableInput): Promise<AccountReceivable>;
  receiveAccountReceivable(id: string, data: ReceiveAccountInput): Promise<AccountReceivable>;
  getAccountReceivableBoletos(contaReceberId: string): Promise<BlingResponse<Boleto>>;
  getAccountReceivableBoleto(contaReceberId: string, boletoId: string): Promise<Boleto>;
}

// ─── ERP Sync Engine ──────────────────────────────────────────────────────

export interface ErpSyncResult {
  provider: string;
  resource: string;
  direction: 'push' | 'pull';
  synced: number;
  errors: number;
  details?: string[];
}

export interface ErpSyncOptions {
  resources?: ('products' | 'orders' | 'contacts' | 'invoices' | 'finances')[];
  since?: Date;
  fullSync?: boolean;
}
```

---

## 6. Estrutura de Arquivos — Implementação Detalhada

### 6.1 `erp/src/lib/erp/providers/bling/types.ts`

```typescript
// ─── Bling API Types ──────────────────────────────────────────────────────

export interface BlingResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface Contact {
  id: string;
  tipo: 'F' | 'J'; // Física ou Jurídica
  situacao: 'A' | 'I'; // Ativo/Inativo
  nome: string;
  email?: string;
  telefone?: string;
  cnpj?: string;
  cpf?: string;
  ie?: string;
  endereco?: BlingAddress;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
}

export interface BlingAddress {
  endereco: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

export interface Product {
  id: string;
  codigo: string;
  nome: string;
  tipo: 'P' | 'S'; // Produto ou Serviço
  situacao: 'A' | 'I';
  preco?: string;
  precoCusto?: string;
  estoque?: {
    geral: number;
    saldo: number;
  };
  categoria?: {
    id: string;
    descricao: string;
  };
  imagem?: string;
  volumes?: number;
  pesoLiq?: number;
  pesoBruto?: number;
}

export interface Order {
  id: string;
  numero: string;
  numeroPedidoIntegracao?: string;
  tipo: 'V' | 'C'; // Venda ou Compra
  situacao: OrderSituation;
  cliente?: Contact;
  data: string; // ISO timestamp
  dataSaida?: string;
  itens: {
    item: OrderItem[];
  };
  totalVenda: string;
  valorFrete: string;
  desconto: string;
  totalLiquido: string;
  parcelas?: {
    parcela: PaymentInstallment[];
  };
  obs?: string;
  obsInterna?: string;
}

export interface OrderSituation {
  id: number;
  nome: string;
}

export interface OrderItem {
  codigo: string;
  descricao: string;
  quantidade: string;
  valorUnitario: string;
  valorFrete: string;
  desconto: string;
  total: string;
}

export interface PaymentInstallment {
  data: string;
  valor: string;
  obs?: string;
}

export interface Invoice {
  id: string;
  numero: string;
  serie: string;
  modelo: string; // 55 = NF-e, 65 = NFC-e, etc
  chaveAcesso?: string;
  situacao: 'A' | 'C'; // Ativo/Cancelado
  cliente?: Contact;
 itens?: {
    item: InvoiceItem[];
  };
  valorFrete: string;
  valorDesconto: string;
  valorTotal: string;
  valorICMS?: string;
  valorPIS?: string;
  valorCOFINS?: string;
  valorII?: string;
  valorIPI?: string;
  dataEmissao: string;
  dataSaida?: string;
}

export interface InvoiceItem {
  codigo: string;
  descricao: string;
  ncm?: string;
  cfop?: string;
  quantidade: string;
  valorUnitario: string;
  valorFrete: string;
  valorDesconto: string;
  valorTotal: string;
  baseICMS?: string;
  valorICMS?: string;
  valorPIS?: string;
  valorCOFINS?: string;
}

export interface AccountReceivable {
  id: string;
  documento: string;
  dataEmissao: string;
  dataVencimento: string;
  dataCompetencia?: string;
  valorOriginal: string;
  valorJuros?: string;
  valorMulta?: string;
  valorDesconto?: string;
  valorFinal: string;
  valorRecebido?: string;
  situacao: 'A' | 'R' | 'C'; // Aberto/Recebido/Cancelado
  observacao?: string;
  cliente?: Contact;
  categoria?: {
    id: string;
    descricao: string;
  };
  idTransacao?: string;
}

export interface Boleto {
  id: string;
  contaReceberId: string;
  numeroDocumento: string;
  nossoNumero: string;
  codigoBarras: string;
  linhaDigitavel: string;
  urlBoleto?: string;
  dataEmissao: string;
  dataVencimento: string;
  valor: string;
  situacao: 'aberto' | 'quitado' | 'vencido' | 'cancelado';
  banco?: {
    id: number;
    nome: string;
  };
}

// ─── Input Types (criação/atualização) ────────────────────────────────────

export interface CreateContactInput {
  tipo: 'F' | 'J';
  nome: string;
  email?: string;
  telefone?: string;
  cnpj?: string;
  cpf?: String;
  ie?: string;
  endereco?: BlingAddress;
}

export interface UpdateContactInput extends Partial<CreateContactInput> {}

export interface CreateProductInput {
  codigo: string;
  nome: string;
  tipo: 'P' | 'S';
  preco?: string;
  precoCusto?: string;
  categoriaId?: string;
  ncm?: string;
  origem?: string;
  pesoLiq?: number;
  pesoBruto?: number;
  altura?: number;
  largura?: number;
  profundidade?: number;
  EstoqueGeral?: number;
}

export interface UpdateProductInput extends Partial<CreateProductInput> {}

export interface CreateOrderInput {
  numeroPedidoIntegracao?: string;
  clienteId: string;
  itens: {
    item: {
      codigo: string;
      quantidade: string;
      valorUnitario: string;
      desconto?: string;
    }[];
  };
  parcelas?: {
    parcela: {
      data: string;
      valor: string;
      obs?: string;
    }[];
  };
  dataPedido?: string;
  dataSaida?: string;
  valorFrete?: string;
  desconto?: string;
  obs?: string;
  obsInterna?: string;
}

export interface UpdateOrderInput extends Partial<CreateOrderInput> {}

export interface CreateInvoiceInput {
  numeroPedidoIntegracao?: string;
  clienteId: string;
  itens: {
    item: {
      codigo: string;
      quantidade: string;
      valorUnitario: string;
      desconto?: string;
      ncm?: string;
      cfop?: string;
    }[];
  };
  modalidadeFrete: 0 | 1 | 2 | 3 | 9; // 0=Contratação do Frete por conta do Remetente, etc
  transporteId?: string;
  cobrancaId?: string;
}

export interface CreateAccountReceivableInput {
  documento: string;
  clienteId: string;
  dataEmissao: string;
  dataVencimento: string;
  valorOriginal: string;
  observacao?: string;
  categoriaId?: string;
  idTransacao?: string;
}

export interface ReceiveAccountInput {
  dataRecebimento: string;
  valorRecebido: string;
  observacao?: string;
}

// ─── List Params ───────────────────────────────────────────────────────────

export interface ContactListParams {
  page?: number;
  pageSize?: number;
  situacao?: 'A' | 'I';
  tipo?: 'F' | 'J';
  cnpj?: string;
  cpf?: string;
}

export interface ProductListParams {
  page?: number;
  pageSize?: number;
  situacao?: 'A' | 'I';
  tipo?: 'P' | 'S';
  idCategoria?: string;
  dataInicial?: string;
  dataFinal?: string;
}

export interface OrderListParams {
  page?: number;
  pageSize?: number;
  situacao?: number;
  dataInicial?: string;
  dataFinal?: string;
  numeroPedidoIntegracao?: string;
}

export interface InvoiceListParams {
  page?: number;
  pageSize?: number;
  situacao?: 'A' | 'C';
  dataInicial?: string;
  dataFinal?: string;
}

export interface AccountListParams {
  page?: number;
  pageSize?: number;
  situacao?: 'A' | 'R' | 'C';
  dataInicial?: string;
  dataFinal?: string;
}
```

### 6.2 `erp/src/lib/erp/providers/bling/client.ts`

```typescript
// ─── Cliente HTTP do Bling com OAuth 2.0 ─────────────────────────────────

import { BlingCredentials, BlingClient } from '../../types';
import {
  Contact, Product, Order, Invoice, AccountReceivable,
  CreateContactInput, UpdateContactInput,
  CreateProductInput, UpdateProductInput,
  CreateOrderInput, UpdateOrderInput,
  CreateInvoiceInput,
  CreateAccountReceivableInput, ReceiveAccountInput,
  BlingResponse,
  ContactListParams, ProductListParams, OrderListParams,
  InvoiceListParams, AccountListParams
} from './types';

const BASE_URL = 'https://api.bling.com.br/Api/v3';
const TOKEN_URL = 'https://api.bling.com.br/oauth/token';

export class BlingApiClient implements BlingClient {
  private credentials: BlingCredentials;
  private baseUrl: string;

  constructor(credentials: BlingCredentials, sandbox = false) {
    this.credentials = credentials;
    this.baseUrl = sandbox
      ? 'https://api.bling.com.br/Api/v3'
      : BASE_URL;
  }

  // ─── Token Management ────────────────────────────────────────────────────

  async refreshAccessToken(): Promise<BlingCredentials> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.credentials.refreshToken,
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Bling token refresh failed: ${response.status}`);
    }

    const data = await response.json();
    this.credentials = {
      ...this.credentials,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };

    return this.credentials;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    // Check if token expired (Buffer: 5 minutes)
    if (this.credentials.expiresAt && Date.now() > this.credentials.expiresAt - 300000) {
      await this.refreshAccessToken();
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.credentials.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bling API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  // ─── Contatos ─────────────────────────────────────────────────────────────

  async getContacts(params?: ContactListParams): Promise<BlingResponse<Contact>> {
    const query = new URLSearchParams(this.cleanParams(params));
    return this.request('GET', `/contatos?${query}`);
  }

  async getContact(id: string): Promise<Contact> {
    const response = await this.request<{ data: Contact }>('GET', `/contatos/${id}`);
    return response.data;
  }

  async createContact(data: CreateContactInput): Promise<Contact> {
    const response = await this.request<{ data: Contact }>('POST', '/contatos', data);
    return response.data;
  }

  async updateContact(id: string, data: UpdateContactInput): Promise<Contact> {
    const response = await this.request<{ data: Contact }>('PUT', `/contatos/${id}`, data);
    return response.data;
  }

  // ─── Produtos ─────────────────────────────────────────────────────────────

  async getProducts(params?: ProductListParams): Promise<BlingResponse<Product>> {
    const query = new URLSearchParams(this.cleanParams(params));
    return this.request('GET', `/produtos?${query}`);
  }

  async getProduct(id: string): Promise<Product> {
    const response = await this.request<{ data: Product }>('GET', `/produtos/${id}`);
    return response.data;
  }

  async createProduct(data: CreateProductInput): Promise<Product> {
    const response = await this.request<{ data: Product }>('POST', '/produtos', data);
    return response.data;
  }

  async updateProduct(id: string, data: UpdateProductInput): Promise<Product> {
    const response = await this.request<{ data: Product }>('PUT', `/produtos/${id}`, data);
    return response.data;
  }

  // ─── Pedidos ──────────────────────────────────────────────────────────────

  async getOrders(params?: OrderListParams): Promise<BlingResponse<Order>> {
    const query = new URLSearchParams(this.cleanParams(params));
    return this.request('GET', `/pedidos/vendas?${query}`);
  }

  async getOrder(id: string): Promise<Order> {
    const response = await this.request<{ data: Order }>('GET', `/pedidos/vendas/${id}`);
    return response.data;
  }

  async createOrder(data: CreateOrderInput): Promise<Order> {
    const response = await this.request<{ data: Order }>('POST', '/pedidos/vendas', data);
    return response.data;
  }

  async updateOrder(id: string, data: UpdateOrderInput): Promise<Order> {
    const response = await this.request<{ data: Order }>('PUT', `/pedidos/vendas/${id}`, data);
    return response.data;
  }

  async changeOrderStatus(orderId: string, statusId: number): Promise<void> {
    await this.request('PATCH', `/pedidos/vendas/${orderId}/situacoes/${statusId}`);
  }

  // ─── Notas Fiscais ────────────────────────────────────────────────────────

  async getInvoices(params?: InvoiceListParams): Promise<BlingResponse<Invoice>> {
    const query = new URLSearchParams(this.cleanParams(params));
    return this.request('GET', `/nfes?${query}`);
  }

  async getInvoice(id: string): Promise<Invoice> {
    const response = await this.request<{ data: Invoice }>('GET', `/nfes/${id}`);
    return response.data;
  }

  async createInvoice(data: CreateInvoiceInput): Promise<Invoice> {
    const response = await this.request<{ data: Invoice }>('POST', '/nfes', data);
    return response.data;
  }

  async downloadInvoiceDocument(chaveAcesso: string, format: 'pdf' | 'xml'): Promise<Buffer> {
    const response = await fetch(
      `${this.baseUrl}/nfe/documento/${chaveAcesso}?formato=${format}`,
      {
        headers: {
          'Authorization': `Bearer ${this.credentials.accessToken}`,
          'Accept': format === 'pdf' ? 'application/pdf' : 'application/xml',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to download invoice: ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  // ─── Contas a Receber ────────────────────────────────────────────────────

  async getAccountsReceivable(params?: AccountListParams): Promise<BlingResponse<AccountReceivable>> {
    const query = new URLSearchParams(this.cleanParams(params));
    return this.request('GET', `/contas/receber?${query}`);
  }

  async getAccountReceivable(id: string): Promise<AccountReceivable> {
    const response = await this.request<{ data: AccountReceivable }>('GET', `/contas/receber/${id}`);
    return response.data;
  }

  async createAccountReceivable(data: CreateAccountReceivableInput): Promise<AccountReceivable> {
    const response = await this.request<{ data: AccountReceivable }>('POST', '/contas/receber', data);
    return response.data;
  }

  async receiveAccountReceivable(id: string, data: ReceiveAccountInput): Promise<AccountReceivable> {
    const response = await this.request<{ data: AccountReceivable }>(
      'PATCH',
      `/contas/receber/${id}/baixa`,
      data
    );
    return response.data;
  }

  // ─── Boletos (Contas a Receber) ──────────────────────────────────────────

  async getAccountReceivableBoletos(contaReceberId: string): Promise<BlingResponse<Boleto>> {
    const response = await this.request<{ data: Boleto[] }>(
      'GET',
      `/contas/receber/${contaReceberId}/boletos`
    );
    return { data: response.data, meta: { total: response.data.length, page: 1, pageSize: 50 } };
  }

  async getAccountReceivableBoleto(contaReceberId: string, boletoId: string): Promise<Boleto> {
    const response = await this.request<{ data: Boleto }>(
      'GET',
      `/contas/receber/${contaReceberId}/boletos/${boletoId}`
    );
    return response.data;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private cleanParams(params?: Record<string, unknown>): Record<string, string> {
    if (!params) return {};
    return Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
    ) as Record<string, string>;
  }
}
```

### 6.3 `erp/src/lib/erp/providers/bling/mappers.ts`

```typescript
// ─── Mapeamento Bling → Modelo Interno do ERP ─────────────────────────────

import { Contact, Product, Order, Invoice, AccountReceivable } from './types';
import type { Product as ErpProduct, Contact as ErpContact, Order as ErpOrder } from '@prisma/client';

// ─── Contact ───────────────────────────────────────────────────────────────

export function mapBlingContactToErp(bling: Contact): Partial<ErpContact> {
  return {
    name: bling.nome,
    email: bling.email,
    phone: bling.telefone,
    document: bling.cnpj || bling.cpf,
    documentType: bling.tipo === 'J' ? 'CNPJ' : 'CPF',
    ie: bling.ie,
    addressStreet: bling.endereco?.endereco,
    addressNumber: bling.endereco?.numero,
    addressComplement: bling.endereco?.complemento,
    addressNeighborhood: bling.endereco?.bairro,
    addressCity: bling.endereco?.cidade,
    addressState: bling.endereco?.uf,
    addressZipCode: bling.endereco?.cep,
    status: bling.situacao === 'A' ? 'ACTIVE' : 'INACTIVE',
  };
}

export function mapErpContactToBling(erp: Partial<ErpContact>): Partial<Contact> {
  return {
    nome: erp.name!,
    email: erp.email,
    telefone: erp.phone,
    cnpj: erp.documentType === 'CNPJ' ? erp.document : undefined,
    cpf: erp.documentType === 'CPF' ? erp.document : undefined,
    ie: erp.ie,
    tipo: erp.documentType === 'CNPJ' ? 'J' : 'F',
    endereco: erp.addressStreet ? {
      endereco: erp.addressStreet,
      numero: erp.addressNumber || '',
      complemento: erp.addressComplement,
      bairro: erp.addressNeighborhood || '',
      cidade: erp.addressCity || '',
      uf: erp.addressState || '',
      cep: erp.addressZipCode || '',
    } : undefined,
  };
}

// ─── Product ───────────────────────────────────────────────────────────────

export function mapBlingProductToErp(bling: Product): Partial<ErpProduct> {
  return {
    name: bling.nome,
    sku: bling.codigo,
    price: bling.preco ? parseFloat(bling.preco) : null,
    costPrice: bling.precoCusto ? parseFloat(bling.precoCusto) : null,
    stockQuantity: bling.estoque?.geral ?? null,
    category: bling.categoria?.descricao,
    status: bling.situacao === 'A' ? 'ACTIVE' : 'INACTIVE',
    type: bling.tipo === 'S' ? 'SERVICE' : 'PRODUCT',
  };
}

export function mapErpProductToBling(erp: Partial<ErpProduct>): Partial<Product> {
  return {
    codigo: erp.sku!,
    nome: erp.name!,
    tipo: erp.type === 'SERVICE' ? 'S' : 'P',
    preco: erp.price?.toString(),
    precoCusto: erp.costPrice?.toString(),
    EstoqueGeral: erp.stockQuantity ?? 0,
  };
}

// ─── Order ─────────────────────────────────────────────────────────────────

export function mapBlingOrderToErp(bling: Order): Partial<ErpOrder> & { items: OrderItem[] } {
  return {
    number: bling.numero,
    integrationCode: bling.numeroPedidoIntegracao,
    status: mapBlingOrderStatus(bling.situacao.id),
    customerId: bling.cliente?.id,
    issueDate: new Date(bling.data),
    dueDate: bling.dataSaida ? new Date(bling.dataSaida) : null,
    subtotal: parseFloat(bling.totalVenda),
    freight: parseFloat(bling.valorFrete),
    discount: parseFloat(bling.desconto),
    total: parseFloat(bling.totalLiquido),
    notes: bling.obs,
    items: bling.itens.item.map(item => ({
      productSku: item.codigo,
      description: item.descricao,
      quantity: parseFloat(item.quantidade),
      unitPrice: parseFloat(item.valorUnitario),
      total: parseFloat(item.total),
      discount: parseFloat(item.desconto),
    })),
  };
}

function mapBlingOrderStatus(blingStatusId: number): string {
  const map: Record<number, string> = {
    1: 'DRAFT',
    2: 'PENDING_APPROVAL',
    3: 'INVOICED',
    4: 'NON_TAXABLE',
    5: 'CANCELLED',
  };
  return map[blingStatusId] || 'UNKNOWN';
}
```

### 6.4 `erp/src/lib/erp/providers/bling/sync.ts`

```typescript
// ─── Sync Engine do Bling ──────────────────────────────────────────────────

import { BlingApiClient } from './client';
import { mapBlingContactToErp, mapBlingProductToErp, mapBlingOrderToErp } from './mappers';
import type { BlingCredentials, ErpSyncResult, ErpSyncOptions } from '../../types';

export class BlingSyncEngine {
  constructor(private client: BlingApiClient) {}

  async syncAll(
    options: ErpSyncOptions = {},
    onProgress?: (result: ErpSyncResult) => void
  ): Promise<ErpSyncResult[]> {
    const results: ErpSyncResult[] = [];
    const resources = options.resources || ['products', 'orders', 'contacts', 'invoices', 'finances'];

    for (const resource of resources) {
      try {
        const result = await this.syncResource(resource, options);
        results.push(result);
        onProgress?.(result);
      } catch (error) {
        results.push({
          provider: 'bling',
          resource,
          direction: 'pull',
          synced: 0,
          errors: 1,
          details: [error instanceof Error ? error.message : 'Unknown error'],
        });
      }
    }

    return results;
  }

  private async syncResource(
    resource: string,
    options: ErpSyncOptions
  ): Promise<ErpSyncResult> {
    switch (resource) {
      case 'products':
        return this.syncProducts(options);
      case 'orders':
        return this.syncOrders(options);
      case 'contacts':
        return this.syncContacts(options);
      case 'invoices':
        return this.syncInvoices(options);
      case 'finances':
        return this.syncFinances(options);
      default:
        return { provider: 'bling', resource, direction: 'pull', synced: 0, errors: 0 };
    }
  }

  // ─── Products ─────────────────────────────────────────────────────────────

  private async syncProducts(options: ErpSyncOptions): Promise<ErpSyncResult> {
    let page = 1;
    let totalSynced = 0;
    const errors: string[] = [];

    while (true) {
      const response = await this.client.getProducts({
        page,
        pageSize: 100,
        ...(options.since && {
          dataInicial: options.since.toISOString().split('T')[0],
        }),
      });

      for (const blingProduct of response.data) {
        try {
          const erpData = mapBlingProductToErp(blingProduct);
          // Upsert logic: find by blingId or sku, then update or create
          await this.upsertProduct(blingProduct.id, erpData);
          totalSynced++;
        } catch (e) {
          errors.push(`Product ${blingProduct.id}: ${e instanceof Error ? e.message : 'Unknown'}`);
        }
      }

      if (page >= Math.ceil(response.meta.total / response.meta.pageSize)) break;
      page++;
    }

    return {
      provider: 'bling',
      resource: 'products',
      direction: 'pull',
      synced: totalSynced,
      errors: errors.length,
      details: errors.slice(0, 5), // Keep first 5 errors
    };
  }

  private async upsertProduct(blingId: string, data: Record<string, unknown>): Promise<void> {
    // Implementation depends on Prisma repository
    // prisma.product.upsert({ where: { blingId }, create: {...}, update: {...} })
  }

  // ─── Orders ───────────────────────────────────────────────────────────────

  private async syncOrders(options: ErpSyncOptions): Promise<ErpSyncResult> {
    let page = 1;
    let totalSynced = 0;
    const errors: string[] = [];

    while (true) {
      const response = await this.client.getOrders({
        page,
        pageSize: 100,
        ...(options.since && {
          dataInicial: options.since.toISOString().split('T')[0],
        }),
      });

      for (const blingOrder of response.data) {
        try {
          const erpData = mapBlingOrderToErp(blingOrder);
          await this.upsertOrder(blingOrder.id, erpData);
          totalSynced++;
        } catch (e) {
          errors.push(`Order ${blingOrder.id}: ${e instanceof Error ? e.message : 'Unknown'}`);
        }
      }

      if (page >= Math.ceil(response.meta.total / response.meta.pageSize)) break;
      page++;
    }

    return {
      provider: 'bling',
      resource: 'orders',
      direction: 'pull',
      synced: totalSynced,
      errors: errors.length,
      details: errors.slice(0, 5),
    };
  }

  private async upsertOrder(blingId: string, data: Record<string, unknown>): Promise<void> {
    // prisma.proposal.upsert({ where: { blingOrderId }, ... })
  }

  // ─── Contacts ─────────────────────────────────────────────────────────────

  private async syncContacts(options: ErpSyncOptions): Promise<ErpSyncResult> {
    let page = 1;
    let totalSynced = 0;
    const errors: string[] = [];

    while (true) {
      const response = await this.client.getContacts({ page, pageSize: 100 });

      for (const blingContact of response.data) {
        try {
          const erpData = mapBlingContactToErp(blingContact);
          await this.upsertContact(blingContact.id, erpData);
          totalSynced++;
        } catch (e) {
          errors.push(`Contact ${blingContact.id}: ${e instanceof Error ? e.message : 'Unknown'}`);
        }
      }

      if (page >= Math.ceil(response.meta.total / response.meta.pageSize)) break;
      page++;
    }

    return {
      provider: 'bling',
      resource: 'contacts',
      direction: 'pull',
      synced: totalSynced,
      errors: errors.length,
      details: errors.slice(0, 5),
    };
  }

  private async upsertContact(blingId: string, data: Record<string, unknown>): Promise<void> {
    // prisma.contact.upsert({ where: { blingId }, ... })
  }

  // ─── Invoices ─────────────────────────────────────────────────────────────

  private async syncInvoices(options: ErpSyncOptions): Promise<ErpSyncResult> {
    // Similar pagination pattern
    return { provider: 'bling', resource: 'invoices', direction: 'pull', synced: 0, errors: 0 };
  }

  // ─── Finances ─────────────────────────────────────────────────────────────

  private async syncFinances(options: ErpSyncOptions): Promise<ErpSyncResult> {
    // Similar pagination pattern
    return { provider: 'bling', resource: 'finances', direction: 'pull', synced: 0, errors: 0 };
  }
}
```

---

## 7. Registro no Registry

```typescript
//erp/src/lib/erp/registry.ts

import { BlingApiClient } from './providers/bling/client';
import { BlingSyncEngine } from './providers/bling/sync';
import type { ErpProviderDefinition, BlingCredentials } from './types';

export const ERP_PROVIDER_REGISTRY: Record<string, ErpProviderDefinition> = {
  bling: {
    id: 'bling',
    name: 'Bling ERP',
    configSchema: [
      {
        key: 'clientId',
        label: 'Client ID',
        type: 'text',
        required: true,
        placeholder: 'Seu Client ID do Bling',
        group: 'credentials',
      },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        type: 'password',
        required: true,
        placeholder: 'Seu Client Secret',
        group: 'credentials',
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        type: 'password',
        required: true,
        placeholder: 'Bearer token',
        helpText: 'Gere em: Bling → Configurações → Aplicativos → API',
        group: 'credentials',
      },
      {
        key: 'refreshToken',
        label: 'Refresh Token',
        type: 'password',
        required: true,
        group: 'credentials',
      },
      {
        key: 'storeId',
        label: 'ID da Loja',
        type: 'text',
        required: false,
        helpText: 'Deixe em branco para usar a loja principal',
        group: 'settings',
      },
    ],
  },
};

// ─── Factory ───────────────────────────────────────────────────────────────

export function createBlingClient(credentials: BlingCredentials, sandbox = false): BlingApiClient {
  return new BlingApiClient(credentials, sandbox);
}

export function createBlingSyncEngine(client: BlingApiClient): BlingSyncEngine {
  return new BlingSyncEngine(client);
}
```

---

## 8. Fluxo de OAuth (Frontend)

Para credenciar o Bling, o usuário precisa fazer OAuth flow:

1. **Frontend** redireciona para:
```
https://api.bling.com.br/Authorization/Authorize?
  response_type=code&
  client_id={CLIENT_ID}&
  redirect_uri={REDIRECT_URI}&
  state={STATE}
```

2. **Usuário autoriza** no Bling

3. **Bling redireciona** para `{REDIRECT_URI}?code={CODE}`

4. **Backend** troca o code por tokens:
```typescript
async function exchangeCodeForTokens(code: string, credentials: BlingCredentials) {
  const response = await fetch('https://api.bling.com.br/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: REDIRECT_URI,
    }),
  });
  return response.json(); // { access_token, refresh_token, expires_in }
}
```

5. **Backend** encripta e salva tokens no banco

---

## 9. Webhooks (Event-Driven)

O Bling soporta webhooks para notificações em tempo real. Webhooks são mais eficientes que polling, pois notificam immediately quando um evento ocorre.

### 9.1 Recursos Disponíveis

| Recurso | Escopo | Descrição |
|---------|--------|----------|
| `order` | Pedido de Venda | Criação, atualização, exclusão de pedidos |
| `product` | Produto | Mudanças em produtos |
| `stock` | Estoque | Movimentações físicas de estoque |
| `virtual_stock` | Estoque Virtual | Reservas de vendas e atualizações de saldo em produtos com composição |
| `product_supplier` | Produto Fornecedor | Links entre produtos e fornecedores |
| `invoice` | Nota Fiscal | NF-e emitida |
| `consumer_invoice` | NFC-e | Nota Fiscal de Consumidor Eletrônica |

### 9.2 Ações (Event Types)

| Ação | Descrição |
|------|----------|
| `created` | Ocorre quando um recurso é criado |
| `updated` | Ocorre quando um recurso é atualizado |
| `deleted` | Ocorre quando um recurso é deletado definitivamente |

> ⚠️ **Nota:** Alterar a situação de um recurso para "excluído" gera um evento `updated`, não `deleted`.

### 9.3 Autenticação — HMAC Signature

O Bling autentica as mensagens via header `X-Bling-Signature-256`, que contém um hash HMAC-SHA256 do payload JSON + `client_secret` do aplicativo.

**Validação do hash:**
```typescript
import crypto from 'crypto';

function verifyBlingWebhook(signature: string | null, payload: string, clientSecret: string): boolean {
  if (!signature) return false;
  
  const expectedHash = crypto
    .createHmac('sha256', clientSecret)
    .update(payload)
    .digest('hex');
  
  const expectedSignature = `sha256=${expectedHash}`;
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}
```

### 9.4 Entrega Não Ordenada

> ⚠️ **Não há garantia de ordem** na entrega dos eventos. Um webhook de atualização pode ser recebido antes do de criação. É recomendado processar webhooks de forma **assíncrona usando filas**.

### 9.5 Formato do Payload

```json
{
  "eventId": "01945027-150e-72b4-e7cf-4943a042cd9c",
  "date": "2025-01-10T12:18:46Z",
  "version": "v1",
  "event": "product.updated",
  "companyId": "d4475854366a36c86a37e792f9634a51",
  "data": {
    "id": 12345678,
    "nome": "Nome do Produto",
    ...
  }
}
```

### 9.6 Exemplo de Payload por Recurso

**Order (Pedido de Venda):**
```json
{
  "id": 12345678,
  "data": "2024-09-25",
  "numero": 123,
  "numeroLoja": "Loja_123",
  "total": 123.45,
  "contato": { "id": 12345678 },
  "vendedor": { "id": 12345678 },
  "loja": { "id": 12345678 }
}
```

**Product (Produto):**
```json
{
  "id": 12345678,
  "nome": "Copo do Bling",
  "codigo": "COD-4587",
  "tipo": "P",
  "situacao": "A",
  "preco": 4.99,
  "unidade": "UN",
  "formato": "S",
  "idProdutoPai": 12345678
}
```

**Stock (Estoque):**
```json
{
  "produto": { "id": 12345678 },
  "deposito": {
    "id": 12345678,
    "saldoFisico": 1250.75,
    "saldoVirtual": 1250.75
  },
  "operacao": "E",
  "quantidade": 25,
  "saldoFisicoTotal": 1500.75
}
```

**Invoice (Nota Fiscal):**
```json
{
  "id": 12345678,
  "tipo": 1,
  "situacao": 1,
  "numero": "1234",
  "dataEmissao": "2024-09-27 11:24:56",
  "dataOperacao": "2024-09-27 11:00:00",
  "contato": { "id": 12345678 },
  "naturezaOperacao": "..."
}
```

### 9.7 Rota do Webhook

```typescript
//erp/src/app/api/webhooks/erp/bling/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { verifyBlingWebhook } from '@/lib/erp/providers/bling/webhook';

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-bling-signature-256');
  const body = await req.text();

  // Obter clientSecret do banco de dados pelo companyId do payload
  const clientSecret = await getBlingClientSecret(req.headers.get('x-bling-company-id'));

  if (!verifyBlingWebhook(signature, body, clientSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(body);
  await processBlingEvent(event);

  return NextResponse.json({ ok: true });
}
```

---

## 10. Rate Limit Handling

```typescript
//erp/src/lib/erp/providers/bling/rate-limiter.ts

const RATE_LIMIT = {
  maxRequests: 3,
  windowMs: 1000, // 1 second
  dailyLimit: 120000,
};

```typescript
//erp/src/lib/erp/providers/bling/rate-limiter.ts

const RATE_LIMIT = {
  maxRequests: 3,
  windowMs: 1000, // 1 second
};

export class BlingRateLimiter {
  private queue: Array<() => Promise<unknown>> = [];
  private processing = false;
  private requestCount = 0;
  private windowStart = Date.now();

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      // Reset window if expired
      if (Date.now() - this.windowStart >= RATE_LIMIT.windowMs) {
        this.requestCount = 0;
        this.windowStart = Date.now();
      }

      // Wait if rate limit reached
      if (this.requestCount >= RATE_LIMIT.maxRequests) {
        const waitTime = RATE_LIMIT.windowMs - (Date.now() - this.windowStart);
        await new Promise(r => setTimeout(r, waitTime));
        this.requestCount = 0;
        this.windowStart = Date.now();
      }

      this.requestCount++;
      const fn = this.queue.shift()!;
      await fn();
    }

    this.processing = false;
  }
}
```

---

## 11. Migração para JWT

O Bling está migrando de tokens opacos para **JSON Web Tokens (JWT)**. Tokens JWT são auto-contidos e validados criptograficamente, sem necessidade de consulta a banco de dados.

### 11.1 Por Que Migrar?

- **Redução de I/O:** Validação é feita via CPU (criptografia), não precisa de consultas a banco/cache
- **Menor latência:** Menos operações de rede/disco por requisição
- **Tokens auto-contidos:** Não precisa de servidor de sessão para validar

### 11.2 Tamanho do Token

> ⚠️ JWTs são significativamente maiores que tokens opacos:
> - **1.500 a 3.000 caracteres** (vs ~50 caracteres de tokens opacos)
> 
> A aplicação **deve estar preparada** para armazenar e trafegar strings desse tamanho nos headers de autorização.

### 11.3 Como Obter JWT

Adicione o header `enable-jwt: 1` na requisição ao endpoint `POST /oauth/token`:

```bash
curl -X POST "https://api.bling.com.br/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic [base64_das_credenciais_do_client_app]" \
  -H "enable-jwt: 1" \
  -d "grant_type=authorization_code&code=[authorization_code]"
```

```http
POST /Api/v3/oauth/token? HTTP/1.1
Host: https://api.bling.com.br
Content-Type: application/x-www-form-urlencoded
Accept: 1.0
Authorization: Basic [base64_das_credenciais_do_client_app]
enable-jwt: 1

grant_type=authorization_code&code=[authorization_code]
```

### 11.4 Renovação de Token JWT

Mesma mecânica de refresh token, mas incluindo o header `enable-jwt: 1`:

```bash
curl -X POST "https://api.bling.com.br/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic [base64_das_credenciais_do_client_app]" \
  -H "enable-jwt: 1" \
  -d "grant_type=refresh_token&refresh_token=[refresh_token]"
```

### 11.5 Usando o JWT nas Requisições

> ⚠️ O header `enable-jwt: 1` **deve ser mantido em todas as requisições** subsequentes para garantir compatibilidade e processamento correto.

```typescript
const response = await fetch('https://api.bling.com.br/Api/v3/produtos', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'enable-jwt': '1',  // IMPORTANTE: manter em todas as requisições
  },
});
```

### 11.6 Tratamento de Erros

| Código | Significado | Solução |
|--------|-------------|---------|
| `401 Unauthorized` | Token expirou ou inválido | Renovar usando refresh_token ou refazer OAuth |
| `400 Bad Request` | Token malformado ou erro na sintaxe do header | Verificar formato: `Authorization: Bearer {token}` |

### 11.7 Implementação Sugerida

```typescript
class BlingAuth {
  private accessToken: string;
  private refreshToken: string;
  private expiresAt: Date;

  async getAccessToken(): Promise<string> {
    if (this.isExpired()) {
      await this.refresh();
    }
    return this.accessToken;
  }

  private isExpired(): boolean {
    return new Date() >= this.expiresAt;
  }

  private async refresh(): Promise<void> {
    const response = await fetch('https://api.bling.com.br/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${this.getBasicAuth()}`,
        'enable-jwt': '1',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      }),
    });

    const data = await response.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  }
}
```

---

## 12. Cron Job — Sincronização Periódica

```typescript
//erp/src/lib/erp/scheduler.ts

import { createBlingClient, createBlingSyncEngine } from './registry';
import { prisma } from '@/lib/prisma';

export async function runBlingSync(companyId: string) {
  const provider = await prisma.erpProvider.findFirst({
    where: { companyId, provider: 'bling', isActive: true },
  });

  if (!provider) return;

  const credentials = decryptCredentials(provider.credentials);
  const client = createBlingClient(credentials, provider.sandbox);
  const syncEngine = createBlingSyncEngine(client);

  // Get last sync timestamp
  const lastSync = provider.lastSyncAt;

  const results = await syncEngine.syncAll({
    since: lastSync,
    resources: ['products', 'orders', 'contacts'],
  });

  // Update last sync timestamp
  await prisma.erpProvider.update({
    where: { id: provider.id },
    data: { lastSyncAt: new Date() },
  });

  // Log results
  for (const result of results) {
    if (result.errors > 0) {
      console.error(`Bling sync error [${result.resource}]:`, result.details);
    }
  }

  return results;
}
```

---

## 13. Testes

```typescript
//erp/src/lib/erp/providers/bling/__tests__/client.test.ts

describe('BlingApiClient', () => {
  const mockCredentials: BlingCredentials = {
    accessToken: 'test_token',
    refreshToken: 'test_refresh',
    clientId: 'test_client',
    clientSecret: 'test_secret',
    expiresAt: Date.now() + 3600000,
  };

  it('should fetch contacts with pagination', async () => {
    const client = new BlingApiClient(mockCredentials);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: '1', nome: 'Test', tipo: 'J', situacao: 'A' },
        ],
        meta: { total: 1, page: 1, pageSize: 50 },
      }),
    }) as jest.Mock;

    const result = await client.getContacts({ page: 1, pageSize: 50 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].nome).toBe('Test');
  });

  it('should handle rate limiting gracefully', async () => {
    // Test that rate limiter waits when limit is hit
  });
});
```

---

## 14. Variáveis de Ambiente

```bash
#erp/.env
BLING_REDIRECT_URI=https://seu-dominio.com/api/auth/bling/callback
```

---

## 15. Checklist de Implementação

### Fase 1 — Core (MVP)
- [ ] `erp/src/lib/erp/types.ts` — interfaces ErpProvider
- [ ] `erp/src/lib/erp/registry.ts` — registro + factory
- [ ] `erp/src/lib/erp/providers/bling/types.ts` — tipos do Bling
- [ ] `erp/src/lib/erp/providers/bling/client.ts` — cliente HTTP
- [ ] `erp/src/lib/erp/providers/bling/mappers.ts` — mapeamento
- [ ] `erp/src/lib/erp/providers/bling/sync.ts` — motor de sync
- [ ] Migration Prisma para ErpProvider
- [ ] Encrypt/decrypt credentials
- [ ] API route: GET/PUT /api/companies/[id]/erp-providers
- [ ] Testes unitários básicos

### Fase 2 — Sync Completo
- [ ] Sync de Products (full CRUD)
- [ ] Sync de Contacts (full CRUD)
- [ ] Sync de Orders (pull + push)
- [ ] Sync de Invoices
- [ ] Sync de Accounts Receivable
- [ ] Rate limiter implementation

### Fase 3 — Webhooks + UI
- [ ] Rota de webhook `/api/webhooks/erp/bling`
- [ ] Validação de assinatura
- [ ] Processamento de eventos
- [ ] UI de configuração do provider
- [ ] UI de status de sincronização
- [ ] OAuth flow no frontend

### Fase 4 — Prod Ready
- [ ] Testes de integração
- [ ] Error handling robusto
- [ ] Retry logic com exponential backoff
- [ ] Logging detalhado
- [ ] Monitoramento (Sentry/DataDog)
- [ ] Documentation

---

## 16. Glossário

| Termo | Significado |
|-------|-------------|
| NF-e | Nota Fiscal Eletrônica (produtos/serviços) |
| NFC-e | Nota Fiscal de Consumidor Eletrônica |
| NFS-e | Nota Fiscal de Serviço Eletrônica |
| CFOP | Código Fiscal de Operações e Prestações |
| NCM | Nomenclatura Comum do Mercosul |
| IE | Inscrição Estadual |
| OAuth 2.0 | Protocolo de autenticação/autorização |
| Access Token | Token temporário para API |
| Refresh Token | Token para renovar access token |
| Rate Limit | Limite de requisições por tempo |

---

## 17. Referências

- **Bling Developer Portal:** https://developer.bling.com.br
- **Bling API Reference:** https://developer.bling.com.br/referencia
- **Bling Authentication:** https://developer.bling.com.br/bling-api
- **Bling Changelog:** https://developer.bling.com.br/changelogs
- **Bling Webhooks:** https://developer.bling.com.br/webhooks
- **Bling Rate Limits:** https://developer.bling.com.br/limites
- **Bling JWT Migration:** https://developer.bling.com.br/migracao-jwt
- **Bling npm package (referência):** https://github.com/AlexandreBellas/bling-erp-api-js
