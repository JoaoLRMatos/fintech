import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { projectMonths, currentBalance, pendingRecurringForMonth } from '../lib/projectionEngine.js';
import { processRecurringRules } from '../lib/recurringProcessor.js';

export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /**
   * GET /api/reports/monthly?pastMonths=6&futureMonths=3
   * Retorna histórico dos últimos N meses + projeção dos próximos M meses
   * (projeção usa as regras recorrentes ativas)
   */
  app.get('/api/reports/monthly', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    
    // Processa regras pendentes para garantir dados sempre atualizados!
    await processRecurringRules().catch((err) => app.log.error(err, 'Erro ao processar recorrentes em tempo real (relatório)'));

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

      // Busca todas as transações, depois filtra pelo campo correto:
      // - cartão de crédito pendente: usa dueDate (quando vai sair do bolso)
      // - demais: usa occurredAt
      const allTx = await prisma.transaction.findMany({
        where: {
          workspaceId,
          OR: [
            // débito / manual: data do lançamento dentro do mês
            { paymentMethod: { not: 'credit' }, occurredAt: { gte: start, lte: end } },
            { paymentMethod: null, occurredAt: { gte: start, lte: end } },
            // crédito: vencimento da fatura dentro do mês
            { paymentMethod: 'credit', dueDate: { gte: start, lte: end } },
          ],
        },
        include: { category: true, account: true, creditCard: true },
        orderBy: { occurredAt: 'desc' },
      });

      let income = 0;
      let expense = 0;
      for (const tx of allTx) {
        if (tx.type === 'INCOME') income += Number(tx.amount);
        else if (tx.type === 'EXPENSE') expense += Number(tx.amount);
      }

      // Mês atual (i === 0): inclui as recorrentes que ainda vão cair (salário,
      // vale, contas) que ainda não viraram lançamento, sem duplicar as já caídas.
      const transactions: any[] = [...allTx];
      if (i === 0) {
        const pending = await pendingRecurringForMonth(workspaceId, start, end);
        income += pending.income;
        expense += pending.expense;
        transactions.push(...pending.entries);
      }

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
          transactions: m.transactions,
        });
      }
    }

    return result;
  });

  /**
   * GET /api/reports/month-detail?year=2026&month=5
   * Detalhe de UM mês específico: receitas, despesas, saldo e a quebra por
   * categoria (ranking de onde foi cada gasto/ganho). Crédito conta no mês de
   * vencimento da fatura (dueDate); o resto, no mês do lançamento (occurredAt).
   */
  app.get('/api/reports/month-detail', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { year, month } = z.object({
      year: z.coerce.number().min(2000).max(2100),
      month: z.coerce.number().min(1).max(12),
    }).parse(request.query);

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);
    const label = start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    type CatAgg = { categoryId: string; name: string; color: string; total: number; count: number };
    const toRanked = (map: Map<string, CatAgg>, totalSum: number) =>
      [...map.values()]
        .sort((a, b) => b.total - a.total)
        .map((c) => ({ ...c, percent: totalSum > 0 ? (c.total / totalSum) * 100 : 0 }));

    const aggregate = (txs: Array<{ type: string; amount: any; categoryId?: string | null; category?: any }>) => {
      const expenseMap = new Map<string, CatAgg>();
      const incomeMap = new Map<string, CatAgg>();
      let income = 0;
      let expense = 0;
      for (const tx of txs) {
        const amount = Number(tx.amount);
        const catId = tx.category?.id ?? tx.categoryId ?? '__none__';
        const name = tx.category?.name ?? 'Sem categoria';
        const color = tx.category?.color ?? '#64748b';
        const map = tx.type === 'INCOME' ? incomeMap : expenseMap;
        if (tx.type === 'INCOME') income += amount;
        else expense += amount;
        const cur = map.get(catId) ?? { categoryId: catId, name, color, total: 0, count: 0 };
        cur.total += amount;
        cur.count += 1;
        map.set(catId, cur);
      }
      return { income, expense, expenseMap, incomeMap };
    };

    // Materializa recorrentes vencidas para o mês atual refletir o que já caiu.
    await processRecurringRules().catch((err) => app.log.error(err, 'Erro ao processar recorrentes (month-detail)'));

    // ── Mês futuro: usa a projeção (recorrentes + parcelas + eventos + orçamento) ──
    const now = new Date();
    const offset = (year - now.getFullYear()) * 12 + (month - (now.getMonth() + 1));
    if (offset > 0) {
      // Projeta de 1..offset para acumular o saldo corretamente e pega o mês alvo.
      const opening = await currentBalance(workspaceId);
      const projected = await projectMonths(workspaceId, {
        horizon: offset,
        startOffset: 1,
        openingBalance: opening,
        baseDate: now,
      });
      const m = projected[offset - 1];
      if (!m) {
        return { year, month, label, income: 0, expense: 0, balance: 0, transactionCount: 0, isProjection: true, transactions: [], expenseByCategory: [], incomeByCategory: [] };
      }
      const projTxs = (m.transactions ?? []).map((t: any) => ({
        id: t.id,
        description: t.description,
        amount: Number(t.amount),
        type: t.type,
        occurredAt: t.occurredAt,
        categoryId: t.category?.id ?? null,
        category: t.category ? { id: t.category.id, name: t.category.name, color: t.category.color } : null,
        paymentMethod: t.paymentMethod ?? null,
        isProjection: true,
      }));
      const { expenseMap, incomeMap } = aggregate(projTxs);
      return {
        year,
        month,
        label: m.label,
        income: m.income,
        expense: m.expense,
        balance: m.saldoMes,
        openingBalance: m.openingBalance,
        closingBalance: m.closingBalance,
        isProjection: true,
        transactionCount: projTxs.length,
        transactions: projTxs,
        expenseByCategory: toRanked(expenseMap, m.expense),
        incomeByCategory: toRanked(incomeMap, m.income),
      };
    }

    // ── Mês passado/atual: dados reais ──
    const allTx = await prisma.transaction.findMany({
      where: {
        workspaceId,
        OR: [
          { paymentMethod: { not: 'credit' }, occurredAt: { gte: start, lte: end } },
          { paymentMethod: null, occurredAt: { gte: start, lte: end } },
          { paymentMethod: 'credit', dueDate: { gte: start, lte: end } },
        ],
      },
      include: { category: true },
    });

    const realTxs = allTx.map((t) => ({
      id: t.id,
      description: t.description,
      amount: Number(t.amount),
      type: t.type,
      occurredAt: t.occurredAt,
      categoryId: t.categoryId ?? null,
      category: t.category ? { id: t.category.id, name: t.category.name, color: t.category.color } : null,
      paymentMethod: t.paymentMethod ?? null,
      isProjection: false,
    }));

    // Mês atual: soma as recorrentes que ainda vão cair este mês (salário/vale/contas),
    // sem duplicar as já lançadas. Mostradas como "[Previsto]" e não-editáveis.
    let pendingEntries: any[] = [];
    if (offset === 0) {
      const pending = await pendingRecurringForMonth(workspaceId, start, end);
      pendingEntries = pending.entries.map((e) => ({ ...e, paymentMethod: null }));
    }

    const combined = [...realTxs, ...pendingEntries];
    const { income, expense, expenseMap, incomeMap } = aggregate(combined);

    return {
      year,
      month,
      label,
      income,
      expense,
      balance: income - expense,
      isProjection: false,
      hasPending: pendingEntries.length > 0,
      transactionCount: combined.length,
      transactions: combined,
      expenseByCategory: toRanked(expenseMap, expense),
      incomeByCategory: toRanked(incomeMap, income),
    };
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

      // Mesmo critério: crédito usa dueDate, demais usam occurredAt
      const allTx = await prisma.transaction.findMany({
        where: {
          workspaceId,
          OR: [
            { paymentMethod: { not: 'credit' }, occurredAt: { gte: start, lte: end } },
            { paymentMethod: null, occurredAt: { gte: start, lte: end } },
            { paymentMethod: 'credit', dueDate: { gte: start, lte: end } },
          ],
        },
        select: { amount: true, type: true },
      });

      let income = 0;
      let expense = 0;
      for (const tx of allTx) {
        if (tx.type === 'INCOME') income += Number(tx.amount);
        else if (tx.type === 'EXPENSE') expense += Number(tx.amount);
      }

      months.push({ month: label, monthIndex: m + 1, income, expense });
    }

    const totalIncome = months.reduce((s, m) => s + m.income, 0);
    const totalExpense = months.reduce((s, m) => s + m.expense, 0);

    return { year, months, totalIncome, totalExpense, totalBalance: totalIncome - totalExpense };
  });
}
