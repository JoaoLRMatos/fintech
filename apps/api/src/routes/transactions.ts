import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function transactionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/transactions', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const query = z.object({
      type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
      categoryId: z.string().optional(),
      accountId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(30),
    }).parse(request.query);

    const where: Record<string, unknown> = { workspaceId };
    if (query.type) where.type = query.type;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.accountId) where.accountId = query.accountId;
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
      accountId: z.string().optional(),
      notes: z.string().optional(),
      source: z.string().default('manual'),
    }).parse(request.body);

    const tx = await prisma.transaction.create({
      data: { ...body, workspaceId },
      include: { category: true, account: true },
    });

    if (body.accountId) {
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
      notes: z.string().nullable().optional(),
    }).parse(request.body);

    const existing = await prisma.transaction.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Transação não encontrada.');

    if (existing.accountId && body.amount !== undefined) {
      const oldDelta = existing.type === 'INCOME' ? -Number(existing.amount) : Number(existing.amount);
      await prisma.account.update({ where: { id: existing.accountId }, data: { balance: { increment: oldDelta } } });
    }

    const tx = await prisma.transaction.update({
      where: { id },
      data: body,
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
