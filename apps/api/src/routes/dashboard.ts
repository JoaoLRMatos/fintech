import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/dashboard/summary', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [incomeAgg, expenseAgg, accounts, topCats] = await Promise.all([
      prisma.transaction.aggregate({
        where: { workspaceId, type: 'INCOME', occurredAt: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { workspaceId, type: 'EXPENSE', occurredAt: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true },
      }),
      prisma.account.findMany({ where: { workspaceId }, select: { balance: true } }),
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { workspaceId, type: 'EXPENSE', occurredAt: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
    ]);

    const categoryIds = topCats.map((c: { categoryId: string | null }) => c.categoryId).filter(Boolean) as string[];
    const categories = categoryIds.length > 0
      ? await prisma.category.findMany({ where: { id: { in: categoryIds } } })
      : [];

    const balance = accounts.reduce((sum: number, a: { balance: any }) => sum + Number(a.balance), 0);
    const incomeMonth = Number(incomeAgg._sum.amount ?? 0);
    const expenseMonth = Number(expenseAgg._sum.amount ?? 0);

    return {
      balance,
      incomeMonth,
      expenseMonth,
      result: incomeMonth - expenseMonth,
      topCategories: topCats.map((c: { categoryId: string | null; _sum: { amount: any } }) => {
        const cat = categories.find((ct: { id: string }) => ct.id === c.categoryId);
        return { name: cat?.name ?? 'Sem categoria', color: cat?.color ?? '#64748b', total: Number(c._sum.amount ?? 0) };
      }),
    };
  });

  app.get('/api/dashboard/monthly', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const query = z.object({ months: z.coerce.number().min(1).max(24).default(6) }).parse(request.query);

    const now = new Date();
    const months: { month: string; income: number; expense: number }[] = [];

    for (let i = query.months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const label = start.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

      const [inc, exp] = await Promise.all([
        prisma.transaction.aggregate({ where: { workspaceId, type: 'INCOME', occurredAt: { gte: start, lte: end } }, _sum: { amount: true } }),
        prisma.transaction.aggregate({ where: { workspaceId, type: 'EXPENSE', occurredAt: { gte: start, lte: end } }, _sum: { amount: true } }),
      ]);

      months.push({ month: label, income: Number(inc._sum.amount ?? 0), expense: Number(exp._sum.amount ?? 0) });
    }

    return months;
  });
}
