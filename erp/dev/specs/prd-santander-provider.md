# PRD — Santander Provider (MendesERP)
**Versão:** 1.0  
**Data:** 19/03/2026  
**Status:** Draft — aguardando aprovação  
**Responsável:** Vex ⚡  
**Spec de referência:** `dev/erp/santander-api-cobranca-openapi.yaml`

---

## Contexto

O MendesERP já possui um módulo de pagamentos com arquitetura multi-provider (registry → factory → provider). Atualmente suporta **Pagar.me** (implementado) e **PinBank** (placeholder). O Santander precisa ser adicionado como terceiro provider para emissão de boletos via API de Cobrança v2.

### Diferenças fundamentais vs Pagar.me

| Aspecto | Pagar.me | Santander |
|---------|----------|-----------|
| Auth | Basic Auth (apiKey) | mTLS + OAuth 2.0 (Bearer JWT + X-Application-Key) |
| Certificado | Não | Certificado Digital A1 (.CRT + .KEY) |
| Conceito central | Order → Charge | Workspace → Bank Slip |
| Identificador boleto | `charge.id` | `nsuCode.nsuDate.environment.covenantCode.bankNumber` (composto) |
| Boleto híbrido | Não | Sim — código de barras + QR Code Pix nativo |
| Ambiente | Sandbox via flag | URLs separadas (trust-sandbox vs trust-open) |
| Webhook | Sim (genérico) | Sim — configurável por workspace (boleto e pix separados) |
| PDF do boleto | Via URL na response | Endpoint dedicado `POST /bills/{bill_id}/bank_slips` |

---

## Arquitetura da API Santander

### Base URLs
- **Produção:** `https://trust-open.api.santander.com.br/collection_bill_management/v2`
- **Sandbox:** `https://trust-sandbox.api.santander.com.br/collection_bill_management/v2`

### Autenticação (2 camadas)
1. **mTLS** — certificado digital A1 do cliente (.CRT + .KEY) na conexão TLS
2. **OAuth 2.0** — Bearer token JWT via `client_credentials` grant
3. **X-Application-Key** — header adicional com a client key

### Recursos principais

```
Workspaces (espaço de cobrança)
├── POST   /workspaces                              → criar workspace
├── GET    /workspaces                              → listar workspaces
├── GET    /workspaces/{id}                         → consultar workspace
├── PATCH  /workspaces/{id}                         → atualizar workspace
└── DELETE /workspaces/{id}                         → cancelar workspace

Bank Slips (boletos via workspace)
├── POST   /workspaces/{id}/bank_slips              → registrar boleto
├── PATCH  /workspaces/{id}/bank_slips              → instruções (até 10/req)
├── GET    /workspaces/{id}/bank_slips              → listar pagos (paginado)
└── GET    /workspaces/{id}/bank_slips/{slip_id}    → consulta sonda (até D+2)

Bills (consulta direta por nosso número)
├── GET    /bills?bankNumber=X&beneficiaryCode=Y    → busca por nosso número
├── GET    /bills/{bill_id}?tipoConsulta=TYPE       → consulta detalhada
└── POST   /bills/{bill_id}/bank_slips              → gerar PDF do boleto
```

### Campos obrigatórios para registro de boleto (RequestBankSlipBase)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `environment` | enum | PRODUCAO \| TESTE |
| `nsuCode` | string(20) | Identificador único por dia (alfanumérico) |
| `nsuDate` | date | Data do NSU |
| `covenantCode` | string(9) | Código do convênio |
| `bankNumber` | string(13) | Nosso número |
| `dueDate` | date | Vencimento |
| `issueDate` | date | Emissão |
| `nominalValue` | string | Valor (formato "10.15") |
| `payer` | object | Pagador (name, documentType, documentNumber, address, neighborhood, city, state, zipCode) |
| `documentKind` | enum | Espécie (DUPLICATA_MERCANTIL, RECIBO, etc.) |
| `paymentType` | enum | REGISTRO \| DIVERGENTE \| PARCIAL |

### Campos opcionais relevantes
- `clientNumber` — "Seu número" (referência interna)
- `discount` — desconto com até 3 faixas
- `finePercentage` / `fineQuantityDays` — multa
- `interestPercentage` — juros
- `protestType` / `protestQuantityDays` — protesto
- `writeOffQuantityDays` — dias para baixa automática
- `key` / `txId` — Pix (chave Dict + TxId para boleto híbrido)
- `messages` — até 4 mensagens no boleto

### Response do registro inclui
- `barcode` — código de barras
- `digitableLine` — linha digitável
- `qrCodePix` — QR Code Pix completo (EMV)
- `qrCodeUrl` — URL Pix
- `entryDate` — data de entrada

### Status do boleto
- `ATIVO` — registrado, aguardando pagamento
- `BAIXADO` — baixa operacional ou solicitada
- `LIQUIDADO` — pago integralmente
- `LIQUIDADO PARCIALMENTE` — pagamento parcial

### Instruções via PATCH (operation)
- `BAIXAR` — solicitar baixa
- `PROTESTAR` — enviar a protesto
- `CANCELAR_PROTESTO` — cancelar protesto

### Webhooks
- Configurados por workspace (URL única)
- Flags separadas: `bankSlipBillingWebhookActive` (boleto) + `pixBillingWebhookActive` (Pix)
- Notifica pagamento por boleto e por Pix independentemente

---

## Pré-requisitos bancários

Para usar a API em produção, o cliente precisa:

1. **Conta PJ Santander** com convênio de cobrança ativo
2. **Certificado Digital A1** válido (mín. 30 dias para vencimento)
3. **Cadastro no Portal do Desenvolvedor** (`developer.santander.com.br`)
4. **Gerar credenciais** (Client ID + Client Secret) no portal — requer upload do .CRT
5. **Criar workspace** via API ou portal
6. **Receber Key User** (ID do espaço de cobrança)

### Geração dos certificados (a partir do .PFX)
```bash
# Extrair .CRT (chave pública)
openssl pkcs12 -in certificado.pfx -clcerts -nokeys -out certificado.crt

# Extrair .KEY (chave privada)
openssl pkcs12 -in certificado.pfx -nocerts -nodes -out certificado.key
```

---

## Escopo do PRD

### Incluso
- Provider `santander` no registry, factory, constants e types
- `SantanderProvider` implementando `PaymentGateway`
- Autenticação mTLS + OAuth 2.0 com cache de token
- Registro de boleto (com suporte a boleto híbrido/Pix)
- Consulta de status
- Baixa/cancelamento (BAIXAR)
- Webhook para notificação de pagamento
- Download de PDF do boleto
- Tela de configuração no frontend (upload de certificado)
- Suporte a sandbox/produção

### Excluído (futuro)
- Protesto automático
- Pagamento parcial/divergente
- Gestão de workspace via API (será manual no portal Santander)
- Partilha (splitting)

---

## Decisões técnicas

### 1. Armazenamento do certificado
O certificado (.CRT + .KEY) será armazenado encriptado no campo `credentials` do `PaymentProvider`, junto com clientId, clientSecret e keyUser. A encriptação AES já existe no módulo.

### 2. Cache do OAuth token
O token JWT tem validade limitada. O provider deve cachear o token e renovar automaticamente antes da expiração (com margem de 60s).

### 3. mTLS com fetch nativo
Node.js suporta mTLS via `https.Agent` com `cert` e `key`. Usar `undici` ou `node:https` para requests com certificado client-side.

### 4. Identificador composto
O `bank_slip_id` do Santander é composto: `nsuCode.nsuDate.environment.covenantCode.bankNumber`. Armazenar no `gatewayId` do Boleto e parsear quando necessário.

### 5. Ambiente
Determinar pela flag `sandbox` do `PaymentProvider` existente. Se `sandbox=true`, usar URL de sandbox e `environment=TESTE`.

### 6. Nosso Número
O `bankNumber` (nosso número) precisa ser sequencial e único por convênio. Implementar geração automática baseada em counter por empresa/convênio.

---

## Mapping: PaymentGateway ↔ Santander API

| PaymentGateway method | Santander endpoint | Notas |
|----------------------|-------------------|-------|
| `createBoleto()` | `POST /workspaces/{id}/bank_slips` | Mapear CreateBoletoInput → RequestBankSlipBase |
| `getBoletoStatus()` | `GET /bills/{bill_id}?tipoConsulta=default` | bill_id = `covenantCode.bankNumber` |
| `cancelBoleto()` | `PATCH /workspaces/{id}/bank_slips` com `operation: BAIXAR` | Não é DELETE |
| `validateWebhook()` | Validar header/signature do webhook | TBD — verificar formato |
| `parseWebhookEvent()` | Parsear payload de liquidação | Mapear status Santander → nosso enum |
| `testConnection()` | `GET /workspaces` | Se 200 + lista, conexão OK |

### Mapping de status

| Santander | PaymentGateway |
|-----------|---------------|
| ATIVO | `pending` |
| LIQUIDADO | `paid` |
| LIQUIDADO PARCIALMENTE | `paid` (com flag) |
| BAIXADO | `cancelled` |

---

## User Stories (prd.json)

### US-SAN-001: Adicionar "santander" ao type system
- Adicionar `"santander"` ao `PRODUCTION_PROVIDER_TYPES` em constants.ts
- Adicionar definição no `PROVIDER_REGISTRY` em registry.ts com configSchema e settingsSchema
- Atualizar `isProviderType()` se necessário
- **configSchema:**
  - `clientId` (text, required) — Client ID do portal
  - `clientSecret` (password, required) — Client Secret
  - `keyUser` (text, required) — ID do workspace/espaço
  - `covenantCode` (text, required) — Código do convênio
  - `certificate` (password, required) — Conteúdo do .CRT (PEM)
  - `certificateKey` (password, required) — Conteúdo do .KEY (PEM)
  - `workspaceId` (text, required) — UUID do workspace
- **settingsSchema:**
  - `documentKind` (select, default: DUPLICATA_MERCANTIL)
  - `finePercentage` (number, optional) — Multa %
  - `fineQuantityDays` (number, optional) — Dias para multa
  - `interestPercentage` (number, optional) — Juros mensal %
  - `writeOffQuantityDays` (number, optional) — Dias para baixa
  - `protestType` (select, default: SEM_PROTESTO)
  - `defaultMessages` (text, optional) — Mensagens no boleto
  - `pixKeyType` (select, optional) — Tipo chave Pix
  - `pixDictKey` (text, optional) — Chave Pix

### US-SAN-002: SantanderAuthManager — mTLS + OAuth
- Classe `SantanderAuthManager` que gerencia:
  - Conexão mTLS com certificado .CRT/.KEY
  - Obtenção de token OAuth 2.0 via `client_credentials`
  - Cache de token com renovação automática (margem 60s)
  - `getAuthHeaders()` retorna `{ Authorization: "Bearer ...", "X-Application-Key": "..." }`
  - `getHttpsAgent()` retorna agent com certificado client
- Endpoint OAuth: `POST /oauth/token` (verificar URL exata no portal)
- Testes: mock do endpoint OAuth, verificar cache, verificar renovação

### US-SAN-003: SantanderProvider — createBoleto
- `SantanderProvider` implementa `PaymentGateway`
- `createBoleto(input)`:
  - Mapear `CreateBoletoInput` → `RequestBankSlipBase`
  - Gerar `nsuCode` único (timestamp + random)
  - Gerar `bankNumber` sequencial (ou receber do ERP)
  - `POST /workspaces/{workspaceId}/bank_slips`
  - Auth via `SantanderAuthManager`
  - Response → `CreateBoletoResult`:
    - `gatewayId` = `nsuCode.nsuDate.ENV.covenantCode.bankNumber`
    - `barcode` = response.barcode
    - `line` = response.digitableLine
    - `qrCode` = response.qrCodePix
    - `url` = response.qrCodeUrl (ou null)
    - `nossoNumero` = response.bankNumber
- Tratar erros HTTP com mensagens claras (usar ErrorTemplate da API)
- Factory: mapear `"santander"` → `SantanderProvider`

### US-SAN-004: SantanderProvider — getBoletoStatus + cancelBoleto
- `getBoletoStatus(gatewayId)`:
  - Parsear gatewayId composto
  - `GET /bills/{covenantCode}.{bankNumber}?tipoConsulta=default`
  - Mapear status: ATIVO→pending, LIQUIDADO→paid, BAIXADO→cancelled
  - Se `tipoConsulta=settlement`, extrair `paidAt` e `paidAmount`
- `cancelBoleto(gatewayId)`:
  - `PATCH /workspaces/{workspaceId}/bank_slips`
  - Body: `{ covenantCode, bankNumber, operation: "BAIXAR" }`
  - Return `{ success: true }` se resposta 201
- `testConnection()`:
  - `GET /workspaces`
  - Se 200, ok; se 401/403, credenciais inválidas

### US-SAN-005: Webhook receiver para Santander
- Novo endpoint `POST /api/webhooks/santander/{providerId}`
- Registrar URL do webhook na workspace do Santander
- Parsear payload de liquidação (boleto e pix)
- Mapear para `WebhookEvent`:
  - Status LIQUIDADO → `boleto.paid`
  - Status BAIXADO → `boleto.cancelled`
- Atualizar receivable/boleto no banco
- Segurança: validar que request vem do Santander (IP allowlist ou signature)

### US-SAN-006: Download PDF do boleto
- Novo método no provider: `getBankSlipPdf(gatewayId, payerDocument)`
- `POST /bills/{bill_id}/bank_slips` com `{ payerDocumentNumber }`
- Retorna `{ link: "url_do_pdf" }`
- Expor via API route no ERP para o frontend buscar o PDF
- Botão "Baixar PDF" na interface de boletos quando provider=santander

### US-SAN-007: Frontend — configuração do provider Santander
- Tela de config suporta upload de certificado (.CRT/.KEY ou .PFX)
- Se .PFX: converter client-side ou server-side via OpenSSL
- Campos do configSchema renderizados dinamicamente (já funciona pelo registry)
- Campos do settingsSchema com defaults do Santander
- Botão "Testar Conexão" funcional
- Toggle sandbox/produção

### US-SAN-008: Gerador de Nosso Número
- Implementar counter sequencial por `companyId + covenantCode`
- Novo campo ou tabela: `SantanderSequence { companyId, covenantCode, lastNumber }`
- Incrementar atomicamente (transaction Prisma)
- Formato: numérico, até 13 dígitos
- Permitir override manual (caso cliente já tenha numeração do banco)

---

## Prioridade de implementação

```
1. US-SAN-001 (types/registry)     → base
2. US-SAN-002 (auth manager)       → sem auth não faz nada
3. US-SAN-008 (nosso número)       → necessário pro createBoleto
4. US-SAN-003 (createBoleto)       → funcionalidade core
5. US-SAN-004 (status/cancel)      → consulta e baixa
6. US-SAN-005 (webhooks)           → notificação automática
7. US-SAN-006 (PDF)                → UX
8. US-SAN-007 (frontend)           → configuração
```

---

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Certificado A1 expira | Boletos param de funcionar | Cron que verifica validade e alerta 30 dias antes |
| Token OAuth expira durante operação | Request falha | Cache com margem de 60s + retry automático |
| mTLS não suportado em runtime | Provider não funciona | Testar com `node:https` Agent; fallback para `undici` |
| Nosso número duplicado | Rejeição pelo banco | Sequence atômica com transaction |
| Webhook sem autenticação forte | Segurança | IP allowlist + verificar headers do Santander |
| Sandbox com comportamento diferente de produção | Bugs em prod | Testar com dados reais em homologação |

---

*Spec completa: `dev/erp/santander-api-cobranca-openapi.yaml`*
