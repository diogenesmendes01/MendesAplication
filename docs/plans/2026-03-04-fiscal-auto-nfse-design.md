# Design: Emissao Automatica de NFS-e e Integracao Fiscal

**Data:** 2026-03-04
**Status:** Aprovado

## Objetivo

Automatizar a emissao de NFS-e quando boletos sao pagos, integrar acoes fiscais no fluxo de reembolso, e criar pagina de configuracao fiscal por empresa.

## Modelo: FiscalConfig

Um registro por empresa (1:1 com Company):

- **Regime tributario:** SIMPLES_NACIONAL | LUCRO_PRESUMIDO | LUCRO_REAL
- **Aliquotas:** issRate, pisRate, cofinsRate, irpjRate, csllRate (Decimal 5,2)
- **Dados do prestador:** cnae, inscricaoMunicipal, codigoMunicipio
- **NFS-e:** nfseSerieNumber (texto), nfseNextNumber (int, auto-incrementa)
- **Flags:** autoEmitNfse (boolean)
- **Timestamps:** createdAt, updatedAt

## Fluxo 1: Boleto PAID → NFS-e Automatica

Trigger direto em `updateBoletoStatus` (Opcao A — sem fila):

1. Boleto muda para PAID
2. Busca `FiscalConfig` da empresa (cache in-memory 5min)
3. Se `autoEmitNfse = true`:
   - Emite NFS-e via provider (mock por enquanto)
   - Usa aliquotas do FiscalConfig (nao mais hardcoded 5%)
   - **Sucesso:** Invoice status `ISSUED` + nfNumber + email ao cliente + cria TaxEntries
   - **Falha:** Invoice status `PENDING` + log de erro para resolucao manual
4. Se `autoEmitNfse = false`: nao faz nada

### TaxEntries criadas na emissao

Para cada imposto com aliquota > 0 no FiscalConfig, cria um TaxEntry:
- type: ISS, PIS, COFINS, IRPJ, CSLL
- value: valor_nota * (aliquota / 100)
- period: mes/ano da emissao
- status: PENDING
- dueDate: baseado no regime tributario

## Fluxo 2: Reembolso → Acao Fiscal

Ajustes no `executeRefund` existente:

| invoiceAction | Acao fiscal |
|---|---|
| CANCEL_INVOICE | Cancela invoices ISSUED vinculadas (ja existe) + cancela TaxEntries correspondentes (novo) |
| CREDIT_NOTE | Cria Invoice tipo CREDIT_NOTE com aliquotas do FiscalConfig (ajuste) + cria TaxEntries negativos para estorno (novo) |
| NONE | Nenhuma acao |

## Pagina de Configuracao Fiscal

Nova rota: `/configuracoes/fiscal`

### Secoes do formulario:
1. **Regime Tributario** — Select com 3 opcoes
2. **Aliquotas (%)** — Inputs numericos: ISS, PIS, COFINS, IRPJ, CSLL
3. **Dados do Prestador** — CNAE, Inscricao Municipal, Codigo do Municipio
4. **NFS-e** — Serie, Proximo numero, Toggle emissao automatica

### Comportamento:
- Se nao existe FiscalConfig, mostra formulario vazio com defaults (ISS 5%, demais 0%, auto-emit off)
- Salvar faz upsert (cria ou atualiza)
- Link no menu Configuracoes

## Mudancas em Codigo Existente

- `updateBoletoStatus` → adicionar trigger de emissao automatica
- `emitInvoiceForBoleto` → usar aliquotas do FiscalConfig, criar TaxEntries
- `executeRefund` → cancelar/estornar TaxEntries nas acoes CANCEL_INVOICE e CREDIT_NOTE
- Sidebar/menu → adicionar link "Fiscal" em Configuracoes

## Decisoes Tecnicas

- **Sem fila/cron:** trigger direto no updateBoletoStatus — volume baixo (dezenas/dia), latencia aceitavel
- **Cache FiscalConfig:** in-memory com TTL 5min (mesmo padrao do SLA cache)
- **Provider NFS-e:** mock por enquanto, provider pattern permite trocar para integracao real
- **NFS-e nao altera contas a receber:** o boleto ja representa a cobranca, a nota e so formalizacao fiscal
- **Erro na emissao:** cria Invoice PENDING para resolucao manual, nao bloqueia o pagamento do boleto
