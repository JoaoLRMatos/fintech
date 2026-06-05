import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function plannedEventRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** GET /api/planned-events?from=&to=&includeRealized=false */
  app.get('/api/planned-events', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const query = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      includeRealized: z.string().optional(),
    }).parse(request.query);

    const includeRealized = query.includeRealized === 'true';
    const where: Record<string, unknown> = { workspaceId };
    if (!includeRealized) where.realized = false;
    if (query.from || query.to) {
      where.expectedAt = {} as Record<string, unknown>;
      if (query.from) (where.expectedAt as Record<string, unknown>).gte = new Date(query.from);
      if (query.to) (where.expectedAt as Record<string, unknown>).lte = new Date(query.to);
    }

    const [events, categories] = await Promise.all([
      prisma.plannedEvent.findMany({ where, orderBy: { expectedAt: 'asc' } }),
      prisma.category.findMany({ where: { workspaceId } }),
    ]);

    return events.map(e => ({
      ...e,
      category: e.categoryId ? (categories.find(c => c.id === e.categoryId) ?? null) : null,
    }));
  });

  /** POST /api/planned-events */
  app.post('/api/planned-events', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const body = z.object({
      type: z.enum(['INCOME', 'EXPENSE']),
      amount: z.number().positive(),
      description: z.string().min(1),
      expectedAt: z.string().transform(v => new Date(v)),
      categoryId: z.string().nullable().optional(),
    }).parse(request.body);

    return prisma.plannedEvent.create({ data: { ...body, workspaceId } });
  });

  /** PUT /api/planned-events/:id */
  app.put('/api/planned-events/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      type: z.enum(['INCOME', 'EXPENSE']).optional(),
      amount: z.number().positive().optional(),
      description: z.string().min(1).optional(),
      expectedAt: z.string().transform(v => new Date(v)).optional(),
      categoryId: z.string().nullable().optional(),
      realized: z.boolean().optional(),
    }).parse(request.body);

    const existing = await prisma.plannedEvent.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Evento não encontrado.');

    return prisma.plannedEvent.update({ where: { id }, data: body });
  });

  /** DELETE /api/planned-events/:id */
  app.delete('/api/planned-events/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.plannedEvent.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Evento não encontrado.');
    await prisma.plannedEvent.delete({ where: { id } });
    return { success: true };
  });
}
