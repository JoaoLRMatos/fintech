import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

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

    // Fatura cobre do fechamento do mês anterior ao fechamento deste mês
    const closingDay = card.closingDay;
    // start = dia de fechamento do mês anterior
    const start = new Date(year, month - 2, closingDay + 1);
    // end = dia de fechamento do mês atual
    const end = new Date(year, month - 1, closingDay, 23, 59, 59);

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

    return {
      card,
      period: { start, end },
      dueDate: new Date(year, month - 1, card.billingDay),
      transactions,
      total,
    };
  });
}
