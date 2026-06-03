import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getFifthBusinessDayOfMonth } from '../lib/businessDays.js';
import { processRecurringRules } from '../lib/recurringProcessor.js';

export async function recurringRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/recurring', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    
    // Processa regras recorrentes pendentes para atualizar as datas
    await processRecurringRules().catch((err) => app.log.error(err, 'Erro ao processar recorrentes em tempo real (agenda)'));

    return prisma.recurringRule.findMany({
      where: { workspaceId },
      orderBy: { nextDueDate: 'asc' },
    });
  });

  app.post('/api/recurring', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { isFifthBusinessDay, ...body } = z.object({
      type: z.enum(['INCOME', 'EXPENSE']),
      amount: z.number().positive(),
      description: z.string().min(1),
      frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).default('MONTHLY'),
      dayOfMonth: z.number().min(1).max(31).optional(),
      isFifthBusinessDay: z.boolean().optional(),
      nextDueDate: z.string().transform(v => new Date(v)),
      endDate: z.string().transform(v => new Date(v)).optional(),
      categoryId: z.string().optional(),
      accountId: z.string().optional(),
    }).parse(request.body);

    let nextDueDate = body.nextDueDate;
    if (isFifthBusinessDay) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const fifthThisMonth = getFifthBusinessDayOfMonth(now.getFullYear(), now.getMonth());
      if (fifthThisMonth >= today) {
        nextDueDate = fifthThisMonth;
      } else {
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextDueDate = getFifthBusinessDayOfMonth(nextMonth.getFullYear(), nextMonth.getMonth());
      }
    }

    return prisma.recurringRule.create({
      data: {
        ...body,
        isFifthBusinessDay,
        nextDueDate,
        workspaceId,
      },
    });
  });

  app.put('/api/recurring/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { isFifthBusinessDay, ...body } = z.object({
      amount: z.number().positive().optional(),
      description: z.string().min(1).optional(),
      frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
      dayOfMonth: z.number().min(1).max(31).nullable().optional(),
      isFifthBusinessDay: z.boolean().nullable().optional(),
      nextDueDate: z.string().transform(v => new Date(v)).optional(),
      endDate: z.string().transform(v => new Date(v)).nullable().optional(),
      active: z.boolean().optional(),
      categoryId: z.string().nullable().optional(),
      accountId: z.string().nullable().optional(),
    }).parse(request.body);

    const existing = await prisma.recurringRule.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Regra recorrente não encontrada.');

    let nextDueDate = body.nextDueDate;
    const nextIsFifth = isFifthBusinessDay !== undefined ? (isFifthBusinessDay ?? false) : (existing.isFifthBusinessDay ?? false);
    if (nextIsFifth && (isFifthBusinessDay !== undefined || body.frequency === 'MONTHLY')) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const fifthThisMonth = getFifthBusinessDayOfMonth(now.getFullYear(), now.getMonth());
      if (fifthThisMonth >= today) {
        nextDueDate = fifthThisMonth;
      } else {
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextDueDate = getFifthBusinessDayOfMonth(nextMonth.getFullYear(), nextMonth.getMonth());
      }
    }

    return prisma.recurringRule.update({
      where: { id },
      data: {
        ...body,
        isFifthBusinessDay,
        ...(nextDueDate ? { nextDueDate } : {}),
      },
    });
  });

  app.delete('/api/recurring/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const existing = await prisma.recurringRule.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Regra recorrente não encontrada.');

    await prisma.recurringRule.delete({ where: { id } });
    return { success: true };
  });
}
