## 🔍 Code Review — PR #35: Integrações Bancárias

Análise end-to-end completa: schema Prisma → types/registry/factory → providers → router → webhook → server actions → UI.

---

### 🔴 BUG 1 — BLOCKER: `$transaction` com chamadas de API externa gera boletos órfãos

**`erp/src/app/(app)/comercial/propostas/actions.ts` (~L721-809)**

O `prisma.$transaction` contém um loop que chama `gateway.createBoleto()` (HTTP externo) por parcela. Se falha na parcela 4, o Prisma faz rollback das parcelas 1-3, mas os boletos **já registrados no gateway** (Pagar.me) **não são revertidos**. Resultado: boletos órfãos no banco gerando cobrança indevida ao cliente.

**Fix:** Separar em duas fases — (1) criar boletos no gateway **fora** da transação, coletando resultados; (2) persistir tudo no banco. Em falha parcial, compensar com `cancelBoleto`.

---

### 🔴 BUG 2 — CRÍTICO: Credenciais mascaradas sobrescrevem valores reais ao editar

**`configuracoes/integracoes-bancarias/page.tsx` (~L330) + `actions.ts` (~L204-208)**

`openEdit` copia credenciais **mascaradas** (`****abcd`) para o form. Ao submeter sem alterar, o servidor recebe `"****abcd"`. A lógica `if (!value && existingCredentials[key])` **não dispara** (string truthy). Credencial mascarada é criptografada e salva — **destruindo a original irreversivelmente**.

**Fix:** No `openEdit`, setar campos `password` como `""` em vez de copiar o valor mascarado.

---

### 🔴 BUG 3 — CRÍTICO: Webhook sem transação e sem idempotência

**`erp/src/app/api/webhooks/payment/[provider]/route.ts` (~L148-200)**

1. Update do boleto e do AccountReceivable **não estão em transação** — se um falha, ficam dessincronizados.
2. Sem deduplicação — provedores reenviam webhooks. O `findFirst` pode dar match na **receivable errada**.

**Fix:** `prisma.$transaction()` + early return se `boleto.status === newStatus`.

---

### 🔴 BUG 4 — CRÍTICO: Reconciliação heurística com janela de ±15 dias

**`route.ts` (~L165-170)**

`findFirst` com tolerância de ±15 dias e ±R$0.01. Para parcelas mensais de mesmo valor (3x R$500 vencendo 10/03, 10/04, 10/05), casa com **a parcela errada**.

**Fix:** Adicionar FK `boletoId` na `AccountReceivable` e usar join direto em vez de matching heurístico.

---

### 🔴 BUG 5 — CRÍTICO: `setMonth` gera datas de vencimento erradas

**`propostas/actions.ts` (~L725)**

```javascript
dueDate.setMonth(dueDate.getMonth() + (i - 1));
```

31/Jan + 1 mês = **03/Mar** (JS avança automaticamente quando o dia não existe). Todas as parcelas subsequentes ficam erradas.

**Fix:** Usar `date-fns/addMonths` ou clamping manual no último dia do mês.

---

### 🔴 BUG 6 — CRÍTICO: Fallback silencioso para Mock quando decrypt falha

**`propostas/actions.ts` (~L619-647)**

O `catch` genérico engole erros de decrypt (credenciais corrompidas) e cai no fallback mock. Usuário gera **boletos mock achando que são reais**, sem nenhum aviso.

**Fix:** Propagar erros de decrypt/factory. Só fallback mock quando realmente não existe nenhum provider.

---

### 🟠 BUG 7 — ALTO: Mismatch routing — preview ≠ geração real

**`propostas/[id]/page.tsx` (~L342) vs `propostas/actions.ts` (~L714)**

Preview usa **valor total** da proposta, geração real usa **valor da parcela**. Se regras têm threshold ("> R$1000"), preview mostra Provider X (total R$5000) mas geração usa Provider Y (parcela R$500).

**Fix:** Ambos devem usar o valor da parcela.

---

### 🟠 BUG 8 — ALTO: `webhookSecret` exposto em plain text

**`configuracoes/integracoes-bancarias/actions.ts` (~L140)**

`getPaymentProviders` retorna `webhookSecret` sem mascaramento. XSS ou extensão maliciosa captura e pode forjar webhooks para marcar boletos como pagos.

**Fix:** Mascarar ou omitir da resposta de listagem.

---

### 🟠 BUG 9 — ALTO: PinBankProvider sem credenciais na factory

**`erp/src/lib/payment/factory.ts` (~L46)**

Registry exige 6 campos obrigatórios, mas factory chama `new PinBankProvider()` sem nenhum. Explode em runtime.

**Fix:** Passar credenciais (como Pagar.me) ou lançar `throw new Error("Not implemented")`.

---

### 🟠 BUG 10 — ALTO: Race condition — boletos duplicados

**`propostas/actions.ts` (~L700-702)**

Verificação `proposal.boletos.length > 0` **fora** da transação. Double-click rápido gera boletos duplicados.

**Fix:** Mover para dentro da `$transaction` com advisory lock.

---

### 🟠 BUG 11 — ALTO: Body read failure retorna 200 — evento perdido

**`route.ts` (~L33-36)**

Se leitura do body falha, retorna 200. Provedor **não retenta** e evento de pagamento é permanentemente perdido.

**Fix:** Retornar 500 para forçar retry.

---

### 🟠 BUG 12 — ALTO: `newBoletoStatus` pode ser `undefined`

**`route.ts` (~L148)**

Se `event.type` não está no map, `newBoletoStatus` é `undefined`. Passado ao Prisma update, pode gravar `null` no status.

**Fix:** `if (!newBoletoStatus) { console.warn(...); return 200; }`.

---

### 🟠 BUG 13 — ALTO: Regras não deletadas ao remover todas

**`configuracoes/integracoes-bancarias/page.tsx` (~L399-405)**

Se `formRules.length === 0`, `saveRoutingRules` nunca é chamada. Regras antigas permanecem.

**Fix:** Chamar `saveRoutingRules` sempre, mesmo com array vazio.

---

### 🟠 BUG 14 — ALTO: Webhook URL idêntica para múltiplas instâncias

**`configuracoes/integracoes-bancarias/actions.ts` (~L257)**

```javascript
const webhookUrl = `https://boletoapi.com/api/webhooks/payment/${data.provider}`;
```

Dois Pagar.me = mesma URL. Impossível rotear para a instância correta.

**Fix:** Incluir ID do provider: `.../${result.id}`.

---

### 🟠 BUG 15 — ALTO: Update/delete sem `companyId` no where (TOCTOU)

**`configuracoes/integracoes-bancarias/actions.ts` (~L227, 312, 479, 524)**

`findFirst` com `companyId` antes, mas `update`/`delete` usa só `{ id }`. Race condition pode operar em registro de outra empresa.

**Fix:** Adicionar `companyId` no `where`.

---

### 🟡 BUG 16 — MÉDIO: Overpaid silenciosamente mapeado para "paid"

**`pagarme.provider.ts` (~L297)**

Sem flag de overpaid. Excedente do cliente é ignorado sem alerta de devolução.

---

### 🟡 BUG 17 — MÉDIO: Type assertions inseguras na factory

**`factory.ts` (~L34)**

`decryptedCredentials.apiKey as string` — se `undefined`, passa silenciosamente. Validar campos obrigatórios contra `configSchema`.

---

### 🟡 BUG 18 — MÉDIO: Provider inativo pode ser usado via override manual

**`propostas/actions.ts` (~L600-616)**

`getProviderById` não filtra `isActive`. Provider desativado entre abertura do dialog e clique em "Gerar" é usado normalmente.

---

### 🟡 BUG 19 — MÉDIO: Sem timeout no fetch da Pagar.me

**`pagarme.provider.ts` (~L74)**

Fetch sem timeout. API lenta = request pendurado indefinidamente.

**Fix:** `AbortController` com ~15s.

---

### 🟡 BUG 20 — MÉDIO: `isDefault` sem constraint — múltiplos defaults possíveis

**`schema.prisma` — `PaymentProvider`**

Sem unique partial index para `(companyId, isDefault=true)`. O unset+set de default não está em transação.

---

### Resumo

| Severidade | Qtd | Bugs |
|---|---|---|
| 🔴 BLOCKER | 1 | #1 |
| 🔴 CRÍTICO | 5 | #2, #3, #4, #5, #6 |
| 🟠 ALTO | 9 | #7–#15 |
| 🟡 MÉDIO | 5 | #16–#20 |

Os **6 primeiros** afetam diretamente **integridade financeira** e devem ser resolvidos antes do merge. O #1 pode gerar cobrança indevida, o #2 corrompe credenciais irreversivelmente, e o #4/#5 envolvem valores e datas erradas em boletos bancários.

