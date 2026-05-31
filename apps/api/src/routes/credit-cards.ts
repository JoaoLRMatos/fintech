import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { billWindow } from '../lib/creditCard.js';

export async function creditCardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // LIST
  app.get('/api/credit-cards', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    return prisma.creditCard.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
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
    if (!existing) throw new Error('Cartão não encontrado.');

    return prisma.creditCard.update({ where: { id }, data: body });
  });

  // DELETE
  app.delete('/api/credit-cards/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const existing = await prisma.creditCard.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Cartão não encontrado.');

    await prisma.creditCard.delete({ where: { id } });
    return { success: true };
  });

  // GET bill for a specific month  — GET /api/credit-cards/:id/bill?year=2025&month=5
  app.get('/api/credit-cards/:id/bill', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { year, month } = z.object({
      year: z.coerce.number().default(new Date().getFullYear()),
      month: z.coerce.number().min(1).max(12).default(new Date().getMonth() + 1),
    }).parse(request.query);

    const card = await prisma.creditCard.findFirst({ where: { id, workspaceId } });
    if (!card) throw new Error('Cartão não encontrado.');

    const { start, end, dueDate } = billWindow(card, year, month);

    const transactions = await prisma.transaction.findMany({
      where: {
        workspaceId,
        creditCardId: id,
        occurredAt: { gte: start, lte: end },
      },
      include: { category: true },
      orderBy: { occurredAt: 'desc' },
    });

    const total = transactions.reduce((s, t) => s + Number(t.amount), 0);
    const paidTotal = transactions.filter(t => t.paidAt).reduce((s, t) => s + Number(t.amount), 0);
    const isPaid = transactions.length > 0 && transactions.every(t => t.paidAt);

    return {
      card,
      period: { start, end },
      dueDate,
      transactions,
      total,
      paidTotal,
      isPaid,
    };
  });

  // PAY bill — POST /api/credit-cards/:id/pay-bill  { year, month }
  app.post('/api/credit-cards/:id/pay-bill', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { year, month, accountId } = z.object({
      year: z.coerce.number(),
      month: z.coerce.number().min(1).max(12),
      accountId: z.string().optional(),
    }).parse(request.body);

    const card = await prisma.creditCard.findFirst({ where: { id, workspaceId } });
    if (!card) throw new Error('Cartão não encontrado.');

    const { start, end, dueDate } = billWindow(card, year, month);

    const txs = await prisma.transaction.findMany({
      where: { workspaceId, creditCardId: id, paidAt: null, occurredAt: { gte: start, lte: end } },
    });
    if (txs.length === 0) return { success: true, paid: 0, count: 0, dueDate };

    const total = txs.reduce((s, t) => s + Number(t.amount), 0);
    await prisma.transaction.updateMany({
      where: { id: { in: txs.map(t => t.id) } },
      data: { paidAt: new Date() },
    });

    // Debita o total da conta (a fatura só impacta o saldo ao ser paga)
    const account = accountId
      ? await prisma.account.findFirst({ where: { id: accountId, workspaceId } })
      : await prisma.account.findFirst({ where: { workspaceId } });
    if (account) {
      await prisma.account.update({ where: { id: account.id }, data: { balance: { increment: -total } } });
    }

    return { success: true, paid: total, count: txs.length, dueDate };
  });
}
