import { prisma } from './prisma.js';
import { projectMonths, currentBalance, type MonthProjection } from './projectionEngine.js';

export type InsightLevel = 'danger' | 'warning' | 'info' | 'success';

export interface Insight {
  level: InsightLevel;
  code: string;
  title: string;
  message: string;
}

export interface SafeToSpend {
  amount: number;
  currentBalance: number;
  remainingIncome: number;
  remainingCommitted: number;
  reserve: number;
}

function fmt(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function advance(date: Date, frequency: string): Date {
  const d = new Date(date);
  if (frequency === 'DAILY') d.setDate(d.getDate() + 1);
  else if (frequency === 'WEEKLY') d.setDate(d.getDate() + 7);
  else if (frequency === 'YEARLY') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * "Limite saudável de gasto" — quanto ainda dá para gastar livremente este mês
 * sem furar os compromissos já assumidos (o "Gastos Livre" da planilha, porém dinâmico).
 *
 * safe = saldo hoje + receitas que ainda entram este mês
 *        − despesas comprometidas que ainda saem este mês (fixos + parcelas)
 *        − reserva (meta de investimento)
 */
export async function computeSafeToSpend(workspaceId: string, reserve = 0, baseDate = new Date()): Promise<SafeToSpend> {
  const monthEnd = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0, 23, 59, 59, 999);

  const [balance, rules, scheduled] = await Promise.all([
    currentBalance(workspaceId),
    prisma.recurringRule.findMany({ where: { workspaceId, active: true } }),
    // parcelas/agendados que ainda caem entre hoje e o fim do mês
    prisma.transaction.findMany({
      where: { workspaceId, occurredAt: { gt: baseDate, lte: monthEnd } },
      select: { amount: true, type: true },
    }),
  ]);

  let remainingIncome = 0;
  let remainingCommitted = 0;

  for (const tx of scheduled) {
    if (tx.type === 'INCOME') remainingIncome += Number(tx.amount);
    else remainingCommitted += Number(tx.amount);
  }

  for (const r of rules) {
    let d = new Date(r.nextDueDate);
    while (d <= monthEnd) {
      if (d > baseDate && (!r.endDate || d <= r.endDate)) {
        if (r.type === 'INCOME') remainingIncome += Number(r.amount);
        else remainingCommitted += Number(r.amount);
      }
      if (r.frequency === 'MONTHLY' || r.frequency === 'YEARLY') break;
      d = advance(d, r.frequency);
    }
  }

  const amount = balance + remainingIncome - remainingCommitted - reserve;
  return { amount, currentBalance: balance, remainingIncome, remainingCommitted, reserve };
}

const COMMITTED_WARN = 0.7; // 70% da renda comprometida

/**
 * Gera os insights inteligentes a partir da projeção:
 *  - risco de saldo negativo
 *  - comprometimento da renda
 *  - sobra média prevista
 *  - estouro de orçamento por categoria (mês atual)
 */
export async function buildInsights(
  workspaceId: string,
  opts: { horizon?: number; reserve?: number; baseDate?: Date } = {},
): Promise<{ projection: MonthProjection[]; safeToSpend: SafeToSpend; insights: Insight[] }> {
  const baseDate = opts.baseDate ?? new Date();
  const horizon = opts.horizon ?? 6;
  const [projection, safeToSpend] = await Promise.all([
    projectMonths(workspaceId, { horizon, baseDate }),
    computeSafeToSpend(workspaceId, opts.reserve ?? 0, baseDate),
  ]);

  const insights: Insight[] = [];

  // 1) Risco de saldo negativo
  const negative = projection.find(m => m.closingBalance < 0);
  if (negative) {
    insights.push({
      level: 'danger',
      code: 'negative_balance',
      title: 'Risco de saldo negativo',
      message: `⚠️ Seu saldo previsto fica negativo em *${negative.label}* (${fmt(negative.closingBalance)}).`,
    });
  }

  // 2) Comprometimento da renda
  const overcommitted = projection.find(m => m.committedRatio > COMMITTED_WARN);
  if (overcommitted) {
    insights.push({
      level: 'warning',
      code: 'high_commitment',
      title: 'Renda muito comprometida',
      message: `🟠 Em *${overcommitted.label}*, ${Math.round(overcommitted.committedRatio * 100)}% da renda já está comprometida com fixos e parcelas.`,
    });
  }

  // 3) Sobra média prevista
  if (projection.length > 0) {
    const avg = projection.reduce((s, m) => s + m.saldoMes, 0) / projection.length;
    insights.push({
      level: avg >= 0 ? 'success' : 'warning',
      code: 'avg_surplus',
      title: 'Sobra média prevista',
      message: avg >= 0
        ? `🟢 Sobra média prevista de ${fmt(avg)}/mês nos próximos ${projection.length} meses.`
        : `🔻 Déficit médio de ${fmt(Math.abs(avg))}/mês nos próximos ${projection.length} meses.`,
    });
  }

  // 4) Limite saudável de gasto
  insights.push({
    level: safeToSpend.amount > 0 ? 'info' : 'warning',
    code: 'safe_to_spend',
    title: 'Limite saudável de gasto',
    message: safeToSpend.amount > 0
      ? `💡 Você pode gastar ${fmt(safeToSpend.amount)} livremente até o fim do mês sem furar o planejado.`
      : `⚠️ Sem margem para gastos livres este mês (faltam ${fmt(Math.abs(safeToSpend.amount))} para os compromissos).`,
  });

  // 5) Estouro de orçamento por categoria (mês atual)
  const overflow = await categoryBudgetOverflow(workspaceId, baseDate);
  insights.push(...overflow);

  return { projection, safeToSpend, insights };
}

async function categoryBudgetOverflow(workspaceId: string, baseDate: Date): Promise<Insight[]> {
  const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const end = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0, 23, 59, 59, 999);

  const categories = await prisma.category.findMany({
    where: { workspaceId, monthlyBudget: { not: null } },
  });
  if (categories.length === 0) return [];

  const out: Insight[] = [];
  for (const cat of categories) {
    const budget = Number(cat.monthlyBudget);
    if (!budget) continue;
    const agg = await prisma.transaction.aggregate({
      where: { workspaceId, categoryId: cat.id, type: 'EXPENSE', occurredAt: { gte: start, lte: end } },
      _sum: { amount: true },
    });
    const spent = Number(agg._sum.amount ?? 0);
    if (spent > budget) {
      const pct = Math.round(((spent - budget) / budget) * 100);
      out.push({
        level: 'warning',
        code: 'budget_overflow',
        title: `Orçamento estourado: ${cat.name}`,
        message: `📉 ${cat.name} passou ${pct}% do orçamento (${fmt(spent)} de ${fmt(budget)}).`,
      });
    }
  }
  return out;
}
