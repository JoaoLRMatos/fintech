import { prisma } from './prisma.js';

/**
 * Motor de projeção financeira.
 *
 * Replica e SUPERA a lógica da planilha `_finanças pessoais.xlsx`:
 *  - planilha:  Saldo[mês] = Receita − Σ(grupos de despesa)   (sobra ISOLADA por mês)
 *  - aqui:      além disso, fazemos CARRY-FORWARD do saldo de um mês para o outro,
 *               algo que a planilha não fazia, e incluímos as PARCELAS futuras
 *               (que hoje a rota de relatórios ignora).
 *
 * Composição da projeção de um mês futuro:
 *   receita  = recorrentes(INCOME) + eventos pontuais(INCOME) + transações agendadas(INCOME)
 *   despesa  = recorrentes(EXPENSE) + eventos pontuais(EXPENSE) + transações agendadas(EXPENSE: parcelas)
 *            + orçamento de variáveis ainda não realizado + despesas proporcionais à renda (dízimo)
 */

const MONTH_LABELS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export interface MonthBreakdown {
  recurringIncome: number;
  recurringExpense: number;
  scheduledIncome: number;
  scheduledExpense: number; // inclui parcelas
  budgetVariable: number;
  plannedIncome: number;
  plannedExpense: number;
  proportional: number; // dízimo etc.
  installments: number; // parte das parcelas (subconjunto de scheduledExpense)
  fixed: number; // despesas fixas recorrentes
}

export interface MonthProjection {
  key: string; // "2026-09"
  label: string; // "setembro de 2026"
  year: number;
  month: number; // 1-12
  openingBalance: number;
  income: number;
  expense: number;
  saldoMes: number; // income − expense (a "sobra" da planilha)
  closingBalance: number; // openingBalance + saldoMes (carry-forward)
  committedRatio: number; // (fixos + parcelas) / receita
  isProjection: boolean;
  breakdown: MonthBreakdown;
  transactions?: any[];
}

function monthWindow(base: Date, offset: number) {
  const start = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const end = new Date(base.getFullYear(), base.getMonth() + offset + 1, 0, 23, 59, 59, 999);
  const year = start.getFullYear();
  const month = start.getMonth() + 1;
  return {
    start,
    end,
    year,
    month,
    key: `${year}-${String(month).padStart(2, '0')}`,
    label: `${MONTH_LABELS[start.getMonth()]} de ${year}`,
  };
}

function advance(date: Date, frequency: string): Date {
  const d = new Date(date);
  if (frequency === 'DAILY') d.setDate(d.getDate() + 1);
  else if (frequency === 'WEEKLY') d.setDate(d.getDate() + 7);
  else if (frequency === 'MONTHLY') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'YEARLY') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** Quantas vezes uma regra recorrente dispara dentro de [start, end]. */
function recurrencesInWindow(nextDueDate: Date, frequency: string, endDate: Date | null, start: Date, end: Date): number {
  let d = new Date(nextDueDate);
  // adianta até a janela
  let guard = 0;
  while (d < start && guard < 5000) { d = advance(d, frequency); guard++; }
  let count = 0;
  while (d <= end && guard < 5000) {
    if (endDate && d > endDate) break;
    count++;
    d = advance(d, frequency);
    guard++;
  }
  return count;
}

export async function currentBalance(workspaceId: string): Promise<number> {
  const accounts = await prisma.account.findMany({ where: { workspaceId }, select: { balance: true } });
  return accounts.reduce((s, a) => s + Number(a.balance), 0);
}

export interface ProjectInput {
  /** Saldo inicial; default = soma das contas hoje. */
  openingBalance?: number;
  /** Quantos meses projetar. Default 6. */
  horizon?: number;
  /** A partir de qual mês relativo ao atual (1 = próximo mês). Default 1. */
  startOffset?: number;
  /** Data-base (default hoje). Injetável para testes. */
  baseDate?: Date;
  /** Parcelas hipotéticas a sobrepor (usado pela simulação "e se?"). */
  hypothetical?: HypotheticalPurchase[];
}

export interface HypotheticalPurchase {
  total: number;
  installments: number; // 1 = à vista
  /** offset relativo ao mês atual em que a 1ª parcela cai. Default 1 (próximo mês). */
  startOffset?: number;
  description?: string;
}

export async function projectMonths(workspaceId: string, input: ProjectInput = {}): Promise<MonthProjection[]> {
  const baseDate = input.baseDate ?? new Date();
  const horizon = input.horizon ?? 6;
  const startOffset = input.startOffset ?? 1;
  const opening = input.openingBalance ?? (await currentBalance(workspaceId));

  const rangeStart = monthWindow(baseDate, startOffset).start;
  const rangeEnd = monthWindow(baseDate, startOffset + horizon - 1).end;

  const [rules, events, budgets, proRules, futureTx, categories] = await Promise.all([
    prisma.recurringRule.findMany({ where: { workspaceId, active: true } }),
    prisma.plannedEvent.findMany({ where: { workspaceId, realized: false, expectedAt: { gte: rangeStart, lte: rangeEnd } } }),
    prisma.budgetEntry.findMany({ where: { workspaceId } }),
    prisma.proportionalRule.findMany({ where: { workspaceId, active: true } }),
    prisma.transaction.findMany({
      where: {
        workspaceId,
        OR: [
          { occurredAt: { gte: rangeStart, lte: rangeEnd } },
          { paymentMethod: 'credit', paidAt: null, dueDate: { gte: rangeStart, lte: rangeEnd } }
        ]
      },
      include: { category: true }
    }),
    prisma.category.findMany({ where: { workspaceId } }),
  ]);

  const hypothetical = input.hypothetical ?? [];

  let carry = opening;
  const rows: MonthProjection[] = [];

  for (let i = 0; i < horizon; i++) {
    const w = monthWindow(baseDate, startOffset + i);
    const monthTx: any[] = [];

    // 1) Transações já lançadas no futuro (parcelas + agendadas / faturas pendentes de cartão) por janela de data
    let scheduledIncome = 0;
    let scheduledExpense = 0;
    let installments = 0;
    const realizedByCategory = new Map<string, number>();
    for (const tx of futureTx) {
      const isCredit = tx.paymentMethod === 'credit';
      const targetDate = (isCredit && tx.dueDate) ? tx.dueDate : tx.occurredAt;
      if (targetDate < w.start || targetDate > w.end) continue;
      
      const amt = Number(tx.amount);
      if (tx.type === 'INCOME') {
        scheduledIncome += amt;
      } else if (tx.type === 'EXPENSE') {
        scheduledExpense += amt;
        if (tx.installmentGroup) installments += amt;
        if (tx.categoryId) realizedByCategory.set(tx.categoryId, (realizedByCategory.get(tx.categoryId) ?? 0) + amt);
      }

      monthTx.push({
        id: tx.id,
        description: tx.description,
        amount: amt,
        type: tx.type,
        occurredAt: targetDate,
        paymentMethod: tx.paymentMethod,
        category: tx.category,
        isProjection: true,
      });
    }

    // 2) Regras recorrentes que disparam no mês (ainda não materializadas no futuro)
    let recurringIncome = 0;
    let recurringExpense = 0;
    let fixed = 0;
    for (const r of rules) {
      const n = recurrencesInWindow(new Date(r.nextDueDate), r.frequency, r.endDate ?? null, w.start, w.end);
      if (n === 0) continue;
      const total = Number(r.amount) * n;
      if (r.type === 'INCOME') recurringIncome += total;
      else { recurringExpense += total; fixed += total; }

      const cat = r.categoryId ? categories.find(c => c.id === r.categoryId) : undefined;
      monthTx.push({
        id: `recur-${r.id}-${w.key}`,
        description: `[Fixo] ${r.description}`,
        amount: total,
        type: r.type,
        occurredAt: new Date(w.start),
        category: cat,
        isProjection: true,
      });
    }

    // 3) Eventos pontuais (13º, férias, IPVA...)
    let plannedIncome = 0;
    let plannedExpense = 0;
    for (const e of events) {
      if (e.expectedAt < w.start || e.expectedAt > w.end) continue;
      const amt = Number(e.amount);
      if (e.type === 'INCOME') plannedIncome += amt;
      else plannedExpense += amt;

      const cat = e.categoryId ? categories.find(c => c.id === e.categoryId) : undefined;
      monthTx.push({
        id: `event-${e.id}`,
        description: `[Planejado] ${e.description}`,
        amount: amt,
        type: e.type,
        occurredAt: e.expectedAt,
        category: cat,
        isProjection: true,
      });
    }

    // 4) Orçamento de variáveis ainda não realizado naquele mês
    let budgetVariable = 0;
    for (const b of budgets) {
      if (b.year !== w.year || b.month !== w.month) continue;
      const realized = realizedByCategory.get(b.categoryId) ?? 0;
      const amt = Math.max(0, Number(b.planned) - realized);
      if (amt > 0) {
        budgetVariable += amt;
        const cat = categories.find(c => c.id === b.categoryId);
        monthTx.push({
          id: `budget-${b.id}`,
          description: `[Previsto] Limite de gastos`,
          amount: amt,
          type: 'EXPENSE',
          occurredAt: new Date(w.start),
          category: cat,
          isProjection: true,
        });
      }
    }

    const income = scheduledIncome + recurringIncome + plannedIncome;

    // 5) Despesas proporcionais à renda (dízimo = % da receita do mês)
    let proportional = 0;
    for (const p of proRules) {
      const amt = Number(p.percent) * income;
      proportional += amt;
      const cat = p.categoryId ? categories.find(c => c.id === p.categoryId) : undefined;
      monthTx.push({
        id: `pro-${p.id}-${w.key}`,
        description: `[Proporcional] ${p.description}`,
        amount: amt,
        type: 'EXPENSE',
        occurredAt: new Date(w.start),
        category: cat,
        isProjection: true,
      });
    }

    let expense = scheduledExpense + recurringExpense + plannedExpense + budgetVariable + proportional;

    // 6) Compras hipotéticas (simulação "e se?")
    for (const h of hypothetical) {
      const hStart = h.startOffset ?? 1;
      const parcels = Math.max(1, h.installments);
      const per = h.total / parcels;
      // parcela cai neste mês?
      const monthIndexAbs = startOffset + i; // offset absoluto do mês corrente da projeção
      if (monthIndexAbs >= hStart && monthIndexAbs < hStart + parcels) {
        expense += per;
        installments += per;

        monthTx.push({
          id: `hypothetical-${h.description || 'compra'}-${w.key}`,
          description: `[Simulação] ${h.description || 'Compra'}`,
          amount: per,
          type: 'EXPENSE',
          occurredAt: new Date(w.start),
          isProjection: true,
        });
      }
    }

    const saldoMes = income - expense;
    const openingBalance = carry;
    carry += saldoMes;

    rows.push({
      key: w.key,
      label: w.label,
      year: w.year,
      month: w.month,
      openingBalance,
      income,
      expense,
      saldoMes,
      closingBalance: carry,
      committedRatio: income > 0 ? (fixed + installments) / income : 0,
      isProjection: true,
      transactions: monthTx,
      breakdown: {
        recurringIncome,
        recurringExpense,
        scheduledIncome,
        scheduledExpense,
        budgetVariable,
        plannedIncome,
        plannedExpense,
        proportional,
        installments,
        fixed,
      },
    });
  }

  return rows;
}

/**
 * Simulação "e se?": recalcula a projeção com uma compra hipotética sobreposta
 * e devolve as duas curvas + o impacto. Núcleo do "ver o futuro antes de gastar".
 */
export async function simulatePurchase(
  workspaceId: string,
  purchase: HypotheticalPurchase,
  opts: { horizon?: number } = {},
): Promise<{
  base: MonthProjection[];
  withPurchase: MonthProjection[];
  perInstallment: number;
  firstNegativeMonth: MonthProjection | null;
  affordable: boolean;
  maxCommittedRatio: number;
}> {
  const horizon = Math.max(opts.horizon ?? 6, (purchase.startOffset ?? 1) + Math.max(1, purchase.installments));
  const base = await projectMonths(workspaceId, { horizon });
  const withPurchase = await projectMonths(workspaceId, { horizon, hypothetical: [purchase] });

  const firstNegativeMonth = withPurchase.find(m => m.closingBalance < 0) ?? null;
  const maxCommittedRatio = withPurchase.reduce((mx, m) => Math.max(mx, m.committedRatio), 0);

  return {
    base,
    withPurchase,
    perInstallment: purchase.total / Math.max(1, purchase.installments),
    firstNegativeMonth,
    affordable: firstNegativeMonth === null,
    maxCommittedRatio,
  };
}
