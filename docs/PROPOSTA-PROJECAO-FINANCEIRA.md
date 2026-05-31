# Proposta de Evolução: Motor de Projeção Financeira

> De um registrador de movimentações para um **copiloto financeiro preditivo** — capaz de mostrar o futuro do saldo *antes* de o usuário gastar.
> Documento de arquitetura de produto baseado na engenharia reversa da planilha `_finanças pessoais.xlsx`.

---

## 1. Engenharia reversa da planilha

A planilha não é uma "lista de gastos". É um **modelo de projeção em matriz** com lógica embutida. Abaixo, a estrutura real extraída dos XMLs internos.

### 1.1 Abas e seus papéis

| Aba | Estado | Papel real (descoberto) |
|-----|--------|--------------------------|
| `2025` | oculta | Template/ano anterior — base copiada para o ano seguinte |
| `2026` | visível | **Plano anual** — projeção mês a mês (Jan→Dez) |
| `Detalhes` | visível | **Realizado** — valores efetivamente lançados, por pessoa (`JOÃO`) numa **janela móvel de 18 meses** (AGO→DEZ do ano seguinte) |
| `Página6` | visível | Versão "limpa" do plano, com o bloco de **SALDO FINAL** e **Investimento** como linha de despesa |

**Padrão oculto nº 1 — duas camadas.** A planilha separa *plano/previsto* (`2026`) de *realizado* (`Detalhes`). A diferença entre as duas é exatamente o conceito que o usuário pediu: **"gasto já pago" vs "gasto futuro"**.

**Padrão oculto nº 2 — rolling forecast.** A aba de realizado usa janela móvel de 18 meses começando em agosto, não ano-calendário. O foco é *"para onde estou indo"*, não *"o que aconteceu em janeiro"*.

### 1.2 A matriz: categorias (linhas) × meses (colunas)

Cada coluna é um mês; cada linha é uma categoria. As linhas são agrupadas em **blocos com subtotais**:

```
RECEITA
  Salário · Valuu · Marcia · Micro ondas · Férias · 13º salário   → Total receita

DESPESAS
  FIXAS:      Dízimo · Água · Internet(VIVO) · Gastos Livre · Academia  → Total fixas
  VARIÁVEIS:  (lançamentos avulsos)                                      → Total variáveis
  EXTRAS:     Mc ...                                                     → Total extras
  OPCIONAIS:  Lazer · Viagens · casa mercado livre · Presentes          → Total adicionais
  CRÉDITO:    Cartão BB · Cartão Nubank · Doação · Financiamento (×2)    → Total em crédito

SALDO TOTAL
  Receita − Fixas − Variáveis − Extras − Adicionais − (Crédito+Financiamento) = SALDO FINAL

META DE INVESTIMENTOS (manual)
  Quanto consigo investir/mês · Quanto tenho investido · Quanto falta p/ meta
```

**Padrão oculto nº 3 — taxonomia em 2 níveis.** Existe `categoria → grupo` (FIXAS/VARIÁVEIS/EXTRAS/OPCIONAIS/CRÉDITO). O sistema atual só tem `kind` (INCOME/EXPENSE) — falta a dimensão **grupo**, que é o eixo organizador da planilha.

### 1.3 A fórmula-mestre (extraída das células)

Da aba `Página6`, linhas 33–39 (e idêntica em `2026` R68–74):

```
Saldo FINAL[mês] = Receita[mês]
                 − Despesas fixas[mês]
                 − Despesas variáveis[mês]
                 − Despesas extras[mês]
                 − Despesas adicionais[mês]
                 − (Cartão de crédito + Financiamento)[mês]
```

Fórmula real da célula: `=C33 - SUM(C34:C38)`. Cada total de bloco é `=SUM(...)` da sua faixa de linhas.

**Padrão oculto nº 4 — sem saldo acumulado.** O `Saldo FINAL` é a **sobra isolada de cada mês**. A planilha **não** carrega o saldo de um mês para o outro. Isso é a maior limitação dela — e a maior oportunidade do nosso sistema (ver §4.2).

### 1.4 Como a planilha "projeta" o futuro

Não há mágica: o usuário **arrasta valores para frente**. Evidências nas células:

- **Recorrências** = mesmo valor repetido em todas as colunas. Salário `2486.93` em Jul→Dez; Dízimo `370`; Água `120`; Internet `119.99`; Academia `500`. → *recorrência por preenchimento manual*.
- **Parcelas** = valores **decrescentes** na linha do cartão. Cartão BB: Jan `679,57` → Fev `2.277,04` → Mar `690,57` → … → Jun `150` → Jul–Dez `100`. Cada célula é a **soma das parcelas que caem naquela fatura**. Quando uma compra parcelada termina, o valor cai. → *a linha do cartão é o agregado das parcelas ativas no mês*.
- **Eventos sazonais** = valores pontuais inseridos à mão: Maio cai para `1700` (férias), `13º salário` aparece só em dezembro. → *receitas/despesas pontuais futuras*.

**Padrão oculto nº 5 — regras proporcionais.** Dízimo = `370` ≈ **10% da receita** (~3.700). É uma despesa calculada como **% da renda**, não valor fixo.

**Padrão oculto nº 6 — pague-se primeiro.** `Investimento` (500/mês) aparece como **linha de despesa planejada**, e há uma meta de investimento separada. A sobra não é "o que sobrou" — é uma meta a ser reservada *antes* do gasto livre.

**Padrão oculto nº 7 — "Gastos Livre" (200/mês)** é um **orçamento discricionário fixo**: o teto do que pode gastar sem culpa. É o embrião do "limite saudável de gasto".

### 1.5 Resumo dos padrões ocultos

| # | Padrão | Implicação para o sistema |
|---|--------|---------------------------|
| 1 | Plano vs Realizado em abas separadas | Modelar **orçamento previsto** distinto de **transação realizada** |
| 2 | Rolling forecast de 18 meses | Projeção móvel, não ano fixo |
| 3 | Taxonomia categoria→grupo | Adicionar campo **`group`** à categoria |
| 4 | Saldo do mês isolado (sem carry) | **Adicionar saldo acumulado** — salto de inteligência |
| 5 | Recorrência por arrasto | Recorrentes + parcelas geram projeção automática |
| 6 | Dízimo = % da renda | Regras de despesa **proporcional à renda** |
| 7 | Investimento como "despesa" + meta | Pague-se-primeiro + meta de investimento |
| 8 | Gastos Livre = teto fixo | **Limite saudável de gasto** |

---

## 2. Diagnóstico do sistema atual

O código já está **surpreendentemente perto** do necessário. O que existe:

| Já existe | Onde | Status |
|-----------|------|--------|
| Transação com parcelas | `schema.prisma` (`installmentGroup/Current/Total`) | ✅ |
| Parcelas geram N transações futuras datadas | `messageHandler.ts:115` | ✅ |
| `RecurringRule` + processador idempotente | `recurringProcessor.ts` | ✅ |
| Cartão de crédito (`billingDay`, `closingDay`, `limit`) | `schema.prisma` | ✅ |
| IA interpreta intent (transação/parcela/recorrente/consulta) | `processMessage.ts` | ✅ |
| Projeção futura básica (só recorrentes) | `reports.ts:/api/reports/monthly` | ⚠️ parcial |

### 2.1 Lacunas críticas (o que falta para igualar + superar a planilha)

1. **🔴 A projeção futura ignora as parcelas.** Em `reports.ts:75-128`, os meses futuros somam **apenas `RecurringRule`**. Mas as parcelas já existem como `Transaction` com `occurredAt` no futuro — e **não são contadas**. Um notebook 12×300 não aparece na projeção de 6 meses. *Bug de produto central.*
2. **🔴 Não há saldo acumulado.** Tanto `dashboard.ts` quanto `reports.ts` calculam `balance = income − expense` por mês isolado. Ninguém responde *"qual meu saldo previsto em setembro?"* somando os meses.
3. **🔴 Categoria não tem grupo** (fixa/variável/crédito). Impossível replicar os subtotais da planilha ou separar "comprometido" de "discricionário".
4. **🟡 Saldo da conta é ambíguo.** Compras no crédito não mexem no saldo; parcelas debitam só 1 parcela na hora; recorrentes debitam imediato. Não há um conceito limpo de **saldo projetado**.
5. **🟡 Sem orçamento por categoria** (o "previsto" das variáveis). A planilha estima variáveis; o sistema só conhece o realizado.
6. **🟡 Sem insights/alertas** (risco de negativo, comprometimento, sobra, limite de gasto).
7. **🟡 Telegram não simula** ("posso comprar X?") nem consulta projeção ("como fica setembro?").

---

## 3. Modelo de arquitetura proposto

Princípio diretor: **separar três camadas temporais** que a planilha mistura à mão.

```
PASSADO            PRESENTE              FUTURO
realizado          saldo real            previsto
(Transaction)      (Account.balance)     (recorrentes + parcelas + orçamento + pontuais)
        \________________ MOTOR DE PROJEÇÃO ________________/
                              │
                    saldo acumulado mês a mês + insights
```

### 3.1 Mudanças no schema (Prisma / MongoDB)

#### Alterações em modelos existentes

```prisma
enum CategoryGroup {
  INCOME        // receitas
  FIXED         // fixas (aluguel, internet, academia)
  VARIABLE      // variáveis (mercado, lazer livre)
  EXTRA         // extras pontuais
  OPTIONAL      // opcionais (viagens, presentes)
  CREDIT        // cartão / financiamento
  INVESTMENT    // pague-se-primeiro
}

model Category {
  // ...campos atuais...
  group        CategoryGroup @default(VARIABLE)  // ← NOVO: eixo organizador da planilha
  isEssential  Boolean       @default(false)     // ← NOVO: essencial vs supérfluo (p/ "limite saudável")
  monthlyBudget Float?                            // ← NOVO: teto previsto p/ variáveis ("Gastos Livre")
}

model Transaction {
  // ...campos atuais...
  status  TxStatus @default(CONFIRMED)  // ← NOVO: CONFIRMED (pago) vs SCHEDULED (parcela/futuro)
  // parcelas futuras passam a nascer como SCHEDULED → distinguimos "já pago" de "vai pagar"
}

enum TxStatus { CONFIRMED  SCHEDULED  CANCELLED }
```

> `status` resolve diretamente o pedido *"diferença entre gasto já pago e gasto futuro"*: parcelas e recorrências futuras nascem `SCHEDULED`; o `recurringProcessor` as promove a `CONFIRMED` no dia.

#### Modelos novos

```prisma
// Orçamento previsto por categoria/mês — a "coluna" da planilha p/ variáveis
model BudgetEntry {
  id          String   @id @default(cuid()) @map("_id")
  workspaceId String
  categoryId  String
  year        Int
  month       Int      // 1-12
  planned     Float    // valor previsto
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  @@unique([workspaceId, categoryId, year, month])
}

// Receita/despesa pontual futura (13º, férias, bônus, IPVA) — sazonalidade da planilha
model PlannedEvent {
  id          String          @id @default(cuid()) @map("_id")
  workspaceId String
  type        TransactionType
  amount      Float
  description String
  expectedAt  DateTime
  categoryId  String?
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
}

// Snapshot do saldo previsto por mês (cache do motor + base p/ alertas)
model MonthlyProjection {
  id              String   @id @default(cuid()) @map("_id")
  workspaceId     String
  year            Int
  month           Int
  openingBalance  Float    // saldo acumulado que entra no mês
  income          Float
  expense         Float
  closingBalance  Float    // openingBalance + income − expense  ← CARRY-FORWARD
  committedRatio  Float    // (fixos+parcelas) / receita  → comprometimento da renda
  computedAt      DateTime @default(now())
  workspace       Workspace @relation(fields: [workspaceId], references: [id])
  @@unique([workspaceId, year, month])
}

// Regra de despesa proporcional à renda (Dízimo = 10%)
model ProportionalRule {
  id          String   @id @default(cuid()) @map("_id")
  workspaceId String
  description String   // "Dízimo"
  percent     Float    // 0.10
  categoryId  String?
  active      Boolean  @default(true)
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
}
```

`RecurringRule` ganha campo opcional `installmentTotal` reaproveitável — mas parcelas continuam como `Transaction` `SCHEDULED` (já funciona). Adicionar a `RecurringRule` o campo `group`/`categoryId` já basta.

### 3.2 Regras de negócio

| Regra | Definição |
|-------|-----------|
| **R1 — Saldo do mês** | `income[m] − expense[m]` (igual à planilha) |
| **R2 — Saldo acumulado** | `closing[m] = closing[m-1] + saldoMes[m]`, com `closing[-1] = saldo real das contas hoje` |
| **R3 — Composição da despesa futura** | `Σ SCHEDULED(parcelas) + Σ recorrentes EXPENSE + Σ BudgetEntry(variáveis) + Σ PlannedEvent(despesa) + Σ proporcionais` |
| **R4 — Composição da receita futura** | `Σ recorrentes INCOME + Σ PlannedEvent(receita)` |
| **R5 — Despesa proporcional** | `valor = percent × receita prevista do mês` (Dízimo) |
| **R6 — Comprometimento** | `committedRatio = (fixos + parcelas) / receita` |
| **R7 — Não dupla-contagem** | recorrente já materializada como `CONFIRMED` no mês não é re-somada pela regra |

---

## 4. O motor de projeção

Serviço novo: `apps/api/src/lib/projectionEngine.ts`. Função pura, testável, sem efeito colateral.

### 4.1 Algoritmo

```ts
async function projectMonths(workspaceId: string, horizon = 6): Promise<MonthRow[]> {
  const openingBalance = await currentAccountsBalance(workspaceId); // saldo real hoje
  const rules    = await activeRecurringRules(workspaceId);
  const budgets  = await budgetEntries(workspaceId);               // variáveis previstas
  const events   = await plannedEvents(workspaceId);               // 13º, férias...
  const proRules = await proportionalRules(workspaceId);           // dízimo

  let carry = openingBalance;
  const rows: MonthRow[] = [];

  for (let i = 0; i < horizon; i++) {
    const { year, month, start, end } = monthWindow(i);

    // 1) Transações já agendadas (parcelas SCHEDULED + recorrentes confirmadas)  ← corrige o bug
    const scheduled = await sumTransactions(workspaceId, start, end); // inclui parcelas!

    // 2) Recorrentes que ainda não viraram transação nesse mês
    const recurring = sumRecurringFor(rules, start, end, scheduled);

    // 3) Variáveis previstas (orçamento) que não têm realizado
    const variable  = sumBudgetsNotRealized(budgets, year, month);

    // 4) Eventos pontuais
    const planned   = sumEvents(events, start, end);

    const income  = scheduled.income  + recurring.income  + planned.income;
    let   expense = scheduled.expense + recurring.expense + variable + planned.expense;

    // 5) Despesas proporcionais à renda (dízimo)
    expense += proRules.reduce((s, r) => s + r.percent * income, 0);

    const saldoMes = income - expense;
    carry += saldoMes;                                   // ← CARRY-FORWARD (a planilha não faz)

    rows.push({
      year, month,
      openingBalance: carry - saldoMes,
      income, expense,
      closingBalance: carry,
      committedRatio: (recurring.fixed + scheduled.installments) / (income || 1),
    });
  }
  return rows;
}
```

### 4.2 O salto sobre a planilha: saldo acumulado

A planilha responde *"sobra de setembro: R$ 892"*. O motor responde *"**saldo acumulado** em setembro: R$ 3.140 — e em **outubro vira −R$ 210**, porque o financiamento + a 8ª parcela do notebook coincidem"*. Isso só é possível com o carry-forward de R2. **É a diferença entre uma planilha e um copiloto.**

### 4.3 Simulação "e se?" (núcleo do produto)

```ts
function simulatePurchase(base: MonthRow[], purchase: {total, installments, startMonth}): MonthRow[]
```

Aplica uma compra hipotética sobre a projeção e devolve a nova curva — usado tanto na web quanto no Telegram (*"posso comprar?"*). **O usuário vê o futuro antes de gastar** — exatamente o objetivo declarado.

---

## 5. Funcionalidades inteligentes (insights)

Serviço `insightsEngine.ts` consome a saída do motor e gera alertas acionáveis.

| Insight | Regra de cálculo | Mensagem ao usuário |
|---------|------------------|---------------------|
| **🔴 Risco de saldo negativo** | primeiro mês com `closingBalance < 0` | "⚠️ Seu saldo fica negativo em **OUT** (−R$ 210). O vilão: financiamento + parcela do notebook." |
| **🟠 Comprometimento da renda** | `committedRatio > 0.7` | "70% da sua renda de novembro já está comprometida com fixos e parcelas." |
| **🟢 Sobra prevista** | média de `saldoMes` futuro | "Sobra média prevista: R$ 540/mês nos próximos 6 meses." |
| **💡 Limite saudável de gasto** | `(saldo hoje − compromissos confirmados até fim do mês − meta de investimento)` | "Você pode gastar **R$ 380** livremente até o fim do mês sem furar o planejado." |
| **📉 Excesso de gasto** | realizado da categoria > `monthlyBudget` | "Alimentação já passou 20% do orçamento (R$ 600 de R$ 500)." |
| **🎯 Meta de investimento** | `Σ investido / meta` | "Você atingiu 65% da meta de investimento do ano." |
| **🔮 Impacto de parcela** | delta na curva pós-`simulatePurchase` | "Esse parcelamento empurra seu saldo de março para o vermelho." |

Esses insights rodam (a) no dashboard web, (b) sob demanda no Telegram, e (c) **proativamente** via job diário/semanal que dispara mensagem no Telegram quando um risco aparece.

---

## 6. Adaptação ao fluxo do Telegram

Novos intents em `processMessage.ts` (`MessageIntent`) e tratadores em `messageHandler.ts`:

### 6.1 Novos intents

| Intent | Gatilho | Exemplo |
|--------|---------|---------|
| `register_installment` *(existe)* | "12x", "parcelado" | "comprei um notebook 12x de 300" |
| `register_recurring` *(existe, melhorar dia)* | "todo dia 5", "mensal" | "salário recorrente todo dia 5 de 2486" |
| `register_planned_event` *(novo)* | data futura + valor único | "vou receber 13º em dezembro 2500" |
| `simulate_purchase` *(novo)* | "posso comprar", "dá pra" | "posso comprar uma TV de 3600 em 12x?" |
| `query_projection` *(novo)* | "como fica", "saldo em" | "como vai estar meu saldo em setembro?" / "próximos 6 meses" |
| `query_safe_to_spend` *(novo)* | "quanto posso gastar" | "quanto posso gastar esse mês?" |

### 6.2 Exemplos de diálogo (a "cara" do produto)

```
👤 comprei um notebook 12x de 300
🤖 🛒 Notebook — R$ 3.600 em 12× de R$ 300
   📅 Parcelas: jun/2026 → mai/2027
   🔮 Impacto no saldo: comprometeu R$ 300/mês.
      ⚠️ Atenção: em OUT seu saldo previsto fica negativo (−R$ 210).
      Quer que eu sugira diluir em 18×? (responda "sim")

👤 salário recorrente todo dia 5
🤖 💰 Quanto é o salário? (responda só o valor)
👤 2486
🤖 ✅ Salário de R$ 2.486 recorrente todo dia 5. Já incluí na projeção.

👤 posso comprar uma TV de 3600 em 12x?
🤖 🔮 Simulação — TV R$ 3.600 em 12×:
   Sobra média cai de R$ 540 → R$ 240/mês.
   Saldo nunca fica negativo. ✅ Cabe no seu orçamento.
   Mas comprometeria 58% da sua renda em jul. Confirma? 

👤 como vai estar meu saldo em setembro?
🤖 📈 Projeção até SET/2026:
   jun  R$ 3.140   jul  R$ 4.030   ago  R$ 4.920
   set  R$ 5.810 ✅
   Sobra prevista: R$ 890/mês.

👤 quanto posso gastar esse mês?
🤖 💡 Limite saudável: R$ 380
   (saldo R$ 1.240 − fixos restantes R$ 660 − meta invest. R$ 200)
```

**Princípio de UX:** o Telegram nunca devolve só "registrado". Sempre devolve **a consequência futura** — porque é isso que diferencia do que ele já tem.

---

## 7. Plano de implementação faseado

| Fase | Entrega | Esforço | Destrava |
|------|---------|---------|----------|
| **0 — Fundação de dados** | `Category.group`, `Transaction.status`, migrações; backfill dos dados atuais | P | Tudo |
| **1 — Corrigir projeção** | `reports.ts` passa a incluir transações `SCHEDULED` (parcelas) nos meses futuros + **saldo acumulado** | P | Núcleo |
| **2 — Motor dedicado** | `projectionEngine.ts` (função pura + testes), `MonthlyProjection` como cache | M | Insights/simulação |
| **3 — Orçamento e eventos** | `BudgetEntry`, `PlannedEvent`, `ProportionalRule` + CRUD/rotas | M | Previsão de variáveis |
| **4 — Insights** | `insightsEngine.ts`: risco negativo, comprometimento, limite saudável, sobra | M | Valor percebido |
| **5 — Telegram preditivo** | novos intents (`simulate_purchase`, `query_projection`, `query_safe_to_spend`) + respostas com impacto futuro | M | Diferencial |
| **6 — Web** | `ReportsPage` vira tela de projeção com curva de saldo acumulado + simulador "e se?" | M | Visualização |
| **7 — Proatividade** | job diário que empurra alertas de risco no Telegram | P | Retenção |

Recomendação: **Fases 0→1→2** já entregam o salto principal (projeção correta + saldo acumulado) com baixo risco, reaproveitando 80% do que existe.

---

## 8. Melhorias além da planilha

A planilha é estática e reativa. O sistema pode ser **dinâmico e preditivo**:

1. **Previsão antes do gasto** — simulação "e se?" no Telegram (a planilha exige editar célula e conferir à mão).
2. **Saldo acumulado real** — carry-forward que a planilha não tem (§4.2).
3. **Alertas proativos** — o sistema avisa *antes* do vermelho; a planilha só mostra se você abrir.
4. **Categorização automática por IA** — já existe; a planilha era 100% manual.
5. **Detecção de recorrência automática** — IA percebe que "Netflix 40" se repete há 3 meses e sugere virar recorrente.
6. **Cenários ("conservador / realista / otimista")** — projetar variáveis pela média dos últimos 3 meses ± desvio.
7. **Limite saudável dinâmico** — recalculado a cada gasto, não um número fixo (`Gastos Livre`).
8. **Reserva de emergência como meta paralela** à de investimento (pague-se-primeiro automatizado).
9. **"Quando posso comprar X?"** — o inverso da simulação: o sistema diz em que mês a compra cabe sem risco.
10. **Importação da própria planilha** — `import.ts` já existe; mapear as colunas Jan→Dez para `BudgetEntry`/recorrentes e migrar o histórico do usuário num clique.

---

## 9. Resumo executivo

- A planilha é um **modelo de projeção em matriz** (categoria × mês) cuja fórmula-mestre é `Saldo = Receita − Σ(grupos de despesa)`, com projeção feita por **arrasto manual** de recorrentes, **soma de parcelas** na linha do cartão e **eventos sazonais** inseridos à mão.
- Seus **padrões ocultos** mais valiosos: separação plano/realizado, taxonomia categoria→grupo, dízimo como % da renda, investimento como "despesa", e a **ausência de saldo acumulado** — a maior oportunidade.
- O **sistema atual já tem 80%** da fundação (parcelas, recorrentes, cartões, IA), mas a **projeção ignora parcelas e não acumula saldo**.
- A evolução proposta entrega um **copiloto preditivo**: motor de projeção com saldo acumulado, insights de risco/comprometimento/limite saudável, e um Telegram que **mostra o futuro do saldo antes de cada gasto** — fazendo o que nenhuma planilha faz.

> **Próximo passo sugerido:** implementar Fases 0→1 (grupo de categoria, status de transação, projeção com parcelas + saldo acumulado). É a menor mudança com o maior salto de valor. Posso começar por aí se você aprovar.
