import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { projectMonths, currentBalance } from '../lib/projectionEngine.js';

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
      balance: number; // saldo do mês (income − expense)
      closingBalance?: number; // saldo acumulado (carry-forward) — só na projeção
      committedRatio?: number;
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

    // ── Meses futuros (projeção com saldo acumulado) ──
    // Usa o motor de projeção: inclui recorrentes, PARCELAS (transações futuras),
    // eventos pontuais, orçamento de variáveis e despesas proporcionais — além de
    // carregar o saldo de um mês para o outro (carry-forward), que a planilha não fazia.
    if (futureMonths > 0) {
      const opening = await currentBalance(workspaceId);
      const projected = await projectMonths(workspaceId, {
        horizon: futureMonths,
        startOffset: 1,
        openingBalance: opening,
        baseDate: now,
      });

      for (const m of projected) {
        result.push({
          key: m.key,
          label: m.label,
          year: m.year,
          month: m.month,
          income: m.income,
          expense: m.expense,
          balance: m.saldoMes,
          closingBalance: m.closingBalance,
          committedRatio: m.committedRatio,
          isProjection: true,
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
