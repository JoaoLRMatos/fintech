import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function budgetRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** GET /api/budget?year=&month= — categorias de despesa com orçamento do mês */
  app.get('/api/budget', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { year, month } = z.object({
      year: z.coerce.number().default(new Date().getFullYear()),
      month: z.coerce.number().min(1).max(12).default(new Date().getMonth() + 1),
    }).parse(request.query);

    const [entries, categories] = await Promise.all([
      prisma.budgetEntry.findMany({ where: { workspaceId, year, month } }),
      prisma.category.findMany({ where: { workspaceId, kind: 'EXPENSE' }, orderBy: { name: 'asc' } }),
    ]);

    return categories.map(cat => {
      const entry = entries.find(e => e.categoryId === cat.id);
      return {
        categoryId: cat.id,
        categoryName: cat.name,
        categoryColor: cat.color,
        entryId: entry?.id ?? null,
        planned: entry?.planned ?? null,
        year,
        month,
      };
    });
  });

  /** POST /api/budget — cria ou atualiza orçamento de uma categoria/mês */
  app.post('/api/budget', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const body = z.object({
      categoryId: z.string(),
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      planned: z.number().positive(),
    }).parse(request.body);

    const existing = await prisma.budgetEntry.findFirst({
      where: { workspaceId, categoryId: body.categoryId, year: body.year, month: body.month },
    });

    if (existing) {
      return prisma.budgetEntry.update({ where: { id: existing.id }, data: { planned: body.planned } });
    }
    return prisma.budgetEntry.create({ data: { ...body, workspaceId } });
  });

  /** DELETE /api/budget/:id */
  app.delete('/api/budget/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.budgetEntry.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Entrada de orçamento não encontrada.');
    await prisma.budgetEntry.delete({ where: { id } });
    return { success: true };
  });
}
