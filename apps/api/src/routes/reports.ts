import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

/** Avança nextDueDate de uma regra recorrente para projections */
function nextDate(current: Date, frequency: string): Date {
  const d = new Date(current);
  if (frequency === 'DAILY') d.setDate(d.getDate() + 1);
  else if (frequency === 'WEEKLY') d.setDate(d.getDate() + 7);
  else if (frequency === 'MONTHLY') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'YEARLY') d.setFullYear(d.getFullYear() + 1);
  return d;
}

export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /**
   * GET /api/reports/monthly?pastMonths=6&futureMonths=3
   * Retorna histórico dos últimos N meses + projeção dos próximos M meses
   * (projeção usa as regras recorrentes ativas)
   */
  app.get('/api/reports/monthly', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { pastMonths, futureMonths } = z.object({
      pastMonths: z.coerce.number().min(1).max(36).default(6),
      futureMonths: z.coerce.number().min(0).max(12).default(3),
    }).parse(request.query);

    const now = new Date();
    const result: Array<{
      key: string;
      label: string;
      year: number;
      month: number; // 1-indexed
      income: number;
      expense: number;
      balance: number;
      isProjection: boolean;
      transactions?: any[];
    }> = [];

    // ── Meses passados (dados reais) ──
    for (let i = pastMonths - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const year = start.getFullYear();
      const month = start.getMonth() + 1;
      const label = start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const key = `${year}-${String(month).padStart(2, '0')}`;

      const [incAgg, expAgg, transactions] = await Promise.all([
        prisma.transaction.aggregate({
          where: { workspaceId, type: 'INCOME', occurredAt: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: { workspaceId, type: 'EXPENSE', occurredAt: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
        prisma.transaction.findMany({
          where: { workspaceId, occurredAt: { gte: start, lte: end } },
          include: { category: true, account: true, creditCard: true },
          orderBy: { occurredAt: 'desc' },
        }),
      ]);

      const income = Number(incAgg._sum.amount ?? 0);
      const expense = Number(expAgg._sum.amount ?? 0);

      result.push({ key, label, year, month, income, expense, balance: income - expense, isProjection: false, transactions });
    }

    // ── Meses futuros (projeção com recorrentes) ──
    if (futureMonths > 0) {
      const activeRules = await prisma.recurringRule.findMany({
        where: { workspaceId, active: true },
      });

      for (let i = 1; i <= futureMonths; i++) {
        const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 0, 23, 59, 59);
        const year = start.getFullYear();
        const month = start.getMonth() + 1;
        const label = start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const key = `${year}-${String(month).padStart(2, '0')}`;

        let projectedIncome = 0;
        let projectedExpense = 0;
        const projected: any[] = [];

        for (const rule of activeRules) {
          if (rule.endDate && rule.endDate < start) continue;

          // Simula se a regra dispara nesse mês
          let d = new Date(rule.nextDueDate);
          // Avança até chegarmos no período futuro
          while (d < start) d = nextDate(d, rule.frequency);

          if (d >= start && d <= end) {
            const amount = Number(rule.amount);
            if (rule.type === 'INCOME') projectedIncome += amount;
            else projectedExpense += amount;

            projected.push({
              id: `proj-${rule.id}-${key}`,
              description: rule.description,
              amount,
              type: rule.type,
              occurredAt: d,
              isProjection: true,
              source: `recurring:${rule.id}`,
            });
          }
        }

        result.push({
          key,
          label,
          year,
          month,
          income: projectedIncome,
          expense: projectedExpense,
          balance: projectedIncome - projectedExpense,
          isProjection: true,
          transactions: projected,
        });
      }
    }

    return result;
  });

  /**
   * GET /api/reports/year-summary?year=2025
   * Totais mês a mês do ano completo
   */
  app.get('/api/reports/year-summary', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { year } = z.object({ year: z.coerce.number().default(new Date().getFullYear()) }).parse(request.query);

    const months = [];
    for (let m = 0; m < 12; m++) {
      const start = new Date(year, m, 1);
      const end = new Date(year, m + 1, 0, 23, 59, 59);
      const label = start.toLocaleDateString('pt-BR', { month: 'short' });

      const [inc, exp] = await Promise.all([
        prisma.transaction.aggregate({ where: { workspaceId, type: 'INCOME', occurredAt: { gte: start, lte: end } }, _sum: { amount: true } }),
        prisma.transaction.aggregate({ where: { workspaceId, type: 'EXPENSE', occurredAt: { gte: start, lte: end } }, _sum: { amount: true } }),
      ]);

      months.push({
        month: label,
        monthIndex: m + 1,
        income: Number(inc._sum.amount ?? 0),
        expense: Number(exp._sum.amount ?? 0),
      });
    }

    const totalIncome = months.reduce((s, m) => s + m.income, 0);
    const totalExpense = months.reduce((s, m) => s + m.expense, 0);

    return { year, months, totalIncome, totalExpense, totalBalance: totalIncome - totalExpense };
  });
}
