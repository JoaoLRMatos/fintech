import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { billWindowByDueMonth, nextUpcomingDueMonth } from '../lib/creditCard.js';

export async function creditCardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // LIST -- inclui limite usado, disponivel e proximo vencimento
  app.get('/api/credit-cards', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    // groupBy nao e suportado no MongoDB pelo Prisma; usar findMany + agregacao JS
    const [cards, unpaidCreditTxs] = await Promise.all([
      prisma.creditCard.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } }),
      prisma.transaction.findMany({
        where: { workspaceId, paymentMethod: 'credit', paidAt: null, creditCardId: { not: null } },
        select: { creditCardId: true, amount: true },
      }),
    ]);

    return cards.map(card => {
      const usedAmount = unpaidCreditTxs
        .filter(t => t.creditCardId === card.id)
        .reduce((s, t) => s + Number(t.amount), 0);
      const limit = card.limit ? Number(card.limit) : null;
      const availableLimit = limit !== null ? Math.max(0, limit - usedAmount) : null;
      const next = nextUpcomingDueMonth(card);
      return { ...card, limit, usedAmount, availableLimit, nextDueMonth: next.month, nextDueYear: next.year, nextDueDate: next.dueDate };
    });
  });

  // CREATE
  app.post('/api/credit-cards', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const body = z.object({
      name: z.string().min(1),
      billingDay: z.number().int().min(1).max(31),
      closingDay: z.number().int().min(1).max(31).default(3),
      limit: z.number().positive().optional(),
    }).parse(request.body);

    return prisma.creditCard.create({ data: { ...body, workspaceId } });
  });

  // UPDATE
  app.put('/api/credit-cards/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      name: z.string().min(1).optional(),
      billingDay: z.number().int().min(1).max(31).optional(),
      closingDay: z.number().int().min(1).max(31).optional(),
      limit: z.number().positive().nullable().optional(),
    }).parse(request.body);

    const existing = await prisma.creditCard.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Cartao nao encontrado.');

    return prisma.creditCard.update({ where: { id }, data: body });
  });

  // DELETE
  app.delete('/api/credit-cards/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const existing = await prisma.creditCard.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Cartao nao encontrado.');

    await prisma.creditCard.delete({ where: { id } });
    return { success: true };
  });

  // GET bill -- year/month sao o MES DE VENCIMENTO (pagamento)
  // Ex.: ?year=2026&month=7 -> fatura que vence em 10/07 (compras de junho)
  app.get('/api/credit-cards/:id/bill', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const now = new Date();
    const { year, month } = z.object({
      year: z.coerce.number().default(now.getFullYear()),
      month: z.coerce.number().min(1).max(12).default(now.getMonth() + 1),
    }).parse(request.query);

    const card = await prisma.creditCard.findFirst({ where: { id, workspaceId } });
    if (!card) throw new Error('Cartao nao encontrado.');

    // Buscar por dueDate dentro do mes de vencimento (mais confiavel que janela por occurredAt)
    const dueMonthStart = new Date(year, month - 1, 1);
    const dueMonthEnd = new Date(year, month, 0, 23, 59, 59, 999); // ultimo dia do mes
    // Calcular a janela de compras para exibir no subtitulo da fatura
    const { start, end, dueDate } = billWindowByDueMonth(card, year, month);

    const transactions = await prisma.transaction.findMany({
      where: { workspaceId, creditCardId: id, dueDate: { gte: dueMonthStart, lte: dueMonthEnd } },
      include: { category: true },
      orderBy: { occurredAt: 'desc' },
    });

    const total = transactions.reduce((s, t) => s + Number(t.amount), 0);
    const paidTotal = transactions.filter(t => t.paidAt).reduce((s, t) => s + Number(t.amount), 0);
    const isPaid = transactions.length > 0 && transactions.every(t => t.paidAt);

    return { card, period: { start, end }, dueDate, dueMonth: { year, month }, transactions, total, paidTotal, isPaid };
  });

  // PAY bill -- { year, month } sao o mes de VENCIMENTO
  app.post('/api/credit-cards/:id/pay-bill', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { year, month, accountId } = z.object({
      year: z.coerce.number(),
      month: z.coerce.number().min(1).max(12),
      accountId: z.string().optional(),
    }).parse(request.body);

    const card = await prisma.creditCard.findFirst({ where: { id, workspaceId } });
    if (!card) throw new Error('Cartao nao encontrado.');

    const dueMonthStart = new Date(year, month - 1, 1);
    const dueMonthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const { dueDate } = billWindowByDueMonth(card, year, month);

    const txs = await prisma.transaction.findMany({
      where: { workspaceId, creditCardId: id, paidAt: null, dueDate: { gte: dueMonthStart, lte: dueMonthEnd } },
    });
    if (txs.length === 0) return { success: true, paid: 0, count: 0, dueDate };

    const total = txs.reduce((s, t) => s + Number(t.amount), 0);
    await prisma.transaction.updateMany({
      where: { id: { in: txs.map(t => t.id) } },
      data: { paidAt: new Date() },
    });

    // Debita da conta (o saldo impacta so ao pagar a fatura)
    const account = accountId
      ? await prisma.account.findFirst({ where: { id: accountId, workspaceId } })
      : await prisma.account.findFirst({ where: { workspaceId } });
    if (account) {
      await prisma.account.update({ where: { id: account.id }, data: { balance: { increment: -total } } });
    }

    return { success: true, paid: total, count: txs.length, dueDate };
  });
}
