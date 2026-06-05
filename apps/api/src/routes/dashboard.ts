import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { pendingRecurringForMonth } from '../lib/projectionEngine.js';
import { processRecurringRules } from '../lib/recurringProcessor.js';
import { transactionsForMonth } from '../lib/monthTransactions.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/dashboard/summary', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };

    // Materializa recorrentes vencidas para refletir o que já caiu.
    await processRecurringRules().catch((err) => app.log.error(err, 'Erro ao processar recorrentes (dashboard summary)'));

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [incomeAgg, monthTx, accounts, categories] = await Promise.all([
      prisma.transaction.aggregate({
        where: { workspaceId, type: 'INCOME', occurredAt: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true },
      }),
      // Despesas: débito/sem meio usa occurredAt, crédito usa dueDate (helper trata ausente)
      transactionsForMonth(workspaceId, startOfMonth, endOfMonth),
      prisma.account.findMany({ where: { workspaceId }, select: { balance: true } }),
      prisma.category.findMany({ where: { workspaceId } }),
    ]);

    const allExpenses = monthTx.filter((t: any) => t.type === 'EXPENSE');
    const balance = accounts.reduce((sum: number, a: { balance: any }) => sum + Number(a.balance), 0);
    let incomeMonth = Number(incomeAgg._sum.amount ?? 0);
    let expenseMonth = allExpenses.reduce((s, t) => s + Number(t.amount), 0);

    // Despesas por categoria (realizadas)
    const catMap = new Map<string, number>();
    for (const e of allExpenses) {
      const k = e.categoryId ?? '__none__';
      catMap.set(k, (catMap.get(k) ?? 0) + Number(e.amount));
    }

    // Recorrentes que ainda vão cair este mês (salário, vale, contas) — sem duplicar
    // as já lançadas — para também aparecerem nos números e gráficos do dashboard.
    const pending = await pendingRecurringForMonth(workspaceId, startOfMonth, endOfMonth);
    incomeMonth += pending.income;
    expenseMonth += pending.expense;
    for (const e of pending.entries) {
      if (e.type === 'EXPENSE') {
        const k = e.categoryId ?? '__none__';
        catMap.set(k, (catMap.get(k) ?? 0) + e.amount);
      }
    }

    const topCategories = [...catMap.entries()]
      .map(([id, total]) => {
        const cat = id === '__none__' ? undefined : categories.find((c: { id: string }) => c.id === id);
        return { name: cat?.name ?? 'Sem categoria', color: cat?.color ?? '#64748b', total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      balance,
      incomeMonth,
      expenseMonth,
      result: incomeMonth - expenseMonth,
      topCategories,
    };
  });

  app.get('/api/dashboard/monthly', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const query = z.object({ months: z.coerce.number().min(1).max(24).default(6) }).parse(request.query);

    await processRecurringRules().catch((err) => app.log.error(err, 'Erro ao processar recorrentes (dashboard monthly)'));

    const now = new Date();
    const months: { month: string; income: number; expense: number }[] = [];

    for (let i = query.months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const label = start.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

      const [incAgg, monthTx] = await Promise.all([
        prisma.transaction.aggregate({ where: { workspaceId, type: 'INCOME', occurredAt: { gte: start, lte: end } }, _sum: { amount: true } }),
        transactionsForMonth(workspaceId, start, end),
      ]);

      let income = Number(incAgg._sum.amount ?? 0);
      let expense = monthTx.filter((t: any) => t.type === 'EXPENSE').reduce((s, t) => s + Number(t.amount), 0);

      // Mês atual: inclui as recorrentes que ainda vão cair.
      if (i === 0) {
        const pending = await pendingRecurringForMonth(workspaceId, start, end);
        income += pending.income;
        expense += pending.expense;
      }

      months.push({ month: label, income, expense });
    }

    return months;
  });
}
