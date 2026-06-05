import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { invoiceForPurchase } from '../lib/creditCard.js';

export async function transactionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/transactions', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const query = z.object({
      type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
      categoryId: z.string().optional(),
      accountId: z.string().optional(),
      creditCardId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      search: z.string().optional(),
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(30),
    }).parse(request.query);

    const where: Record<string, unknown> = { workspaceId };
    if (query.type) where.type = query.type;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.accountId) where.accountId = query.accountId;
    if (query.creditCardId) where.creditCardId = query.creditCardId;
    if (query.search) where.description = { contains: query.search, mode: 'insensitive' };
    if (query.from || query.to) {
      where.occurredAt = {};
      if (query.from) (where.occurredAt as Record<string, unknown>).gte = new Date(query.from);
      if (query.to) (where.occurredAt as Record<string, unknown>).lte = new Date(query.to);
    }

    const [data, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: { category: true, account: true },
        orderBy: { occurredAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    return { data, total, page: query.page, limit: query.limit };
  });

  app.post('/api/transactions', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const body = z.object({
      type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
      amount: z.number().positive(),
      description: z.string().min(1),
      occurredAt: z.string().transform(v => new Date(v)),
      categoryId: z.string().optional(),
      accountId: z.string().nullable().optional(),
      creditCardId: z.string().nullable().optional(),
      paymentMethod: z.enum(['debit', 'credit']).nullable().optional(),
      notes: z.string().optional(),
      source: z.string().default('manual'),
    }).parse(request.body);

    const isCredit = body.paymentMethod === 'credit';
    let dueDate: Date | null = null;
    if (isCredit && body.creditCardId) {
      const card = await prisma.creditCard.findFirst({ where: { id: body.creditCardId, workspaceId } });
      if (card) {
        const cycle = invoiceForPurchase(card, body.occurredAt);
        dueDate = cycle.dueDate;
      }
    }

    const tx = await prisma.transaction.create({
      data: {
        ...body,
        workspaceId,
        dueDate,
        // Crédito: não vincula à conta corrente
        accountId: isCredit ? null : (body.accountId ?? undefined),
      },
      include: { category: true, account: true },
    });

    if (!isCredit && body.accountId) {
      const delta = body.type === 'INCOME' ? body.amount : -body.amount;
      await prisma.account.update({ where: { id: body.accountId }, data: { balance: { increment: delta } } });
    }

    return tx;
  });

  app.put('/api/transactions/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
      amount: z.number().positive().optional(),
      description: z.string().min(1).optional(),
      occurredAt: z.string().transform(v => new Date(v)).optional(),
      categoryId: z.string().nullable().optional(),
      accountId: z.string().nullable().optional(),
      creditCardId: z.string().nullable().optional(),
      paymentMethod: z.enum(['debit', 'credit']).nullable().optional(),
      notes: z.string().nullable().optional(),
    }).parse(request.body);

    const existing = await prisma.transaction.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Transação não encontrada.');

    const isCredit = (body.paymentMethod !== undefined ? body.paymentMethod : existing.paymentMethod) === 'credit';
    const cardId = body.creditCardId !== undefined ? body.creditCardId : existing.creditCardId;
    const occurredAt = body.occurredAt !== undefined ? body.occurredAt : existing.occurredAt;

    let dueDate = existing.dueDate;
    if (body.paymentMethod !== undefined || body.creditCardId !== undefined || body.occurredAt !== undefined) {
      if (isCredit && cardId) {
        const card = await prisma.creditCard.findFirst({ where: { id: cardId, workspaceId } });
        if (card) {
          const cycle = invoiceForPurchase(card, occurredAt);
          dueDate = cycle.dueDate;
        } else {
          dueDate = null;
        }
      } else {
        dueDate = null;
      }
    }

    if (existing.accountId && body.amount !== undefined) {
      const oldDelta = existing.type === 'INCOME' ? -Number(existing.amount) : Number(existing.amount);
      await prisma.account.update({ where: { id: existing.accountId }, data: { balance: { increment: oldDelta } } });
    }

    const tx = await prisma.transaction.update({
      where: { id },
      data: { ...body, dueDate },
      include: { category: true, account: true },
    });

    const accId = body.accountId ?? existing.accountId;
    if (accId && body.amount !== undefined) {
      const type = body.type ?? existing.type;
      const newDelta = type === 'INCOME' ? body.amount : -body.amount;
      await prisma.account.update({ where: { id: accId }, data: { balance: { increment: newDelta } } });
    }

    return tx;
  });

  app.delete('/api/transactions/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const existing = await prisma.transaction.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Transação não encontrada.');

    if (existing.accountId) {
      const delta = existing.type === 'INCOME' ? -Number(existing.amount) : Number(existing.amount);
      await prisma.account.update({ where: { id: existing.accountId }, data: { balance: { increment: delta } } });
    }

    await prisma.transaction.delete({ where: { id } });
    return { success: true };
  });
}
