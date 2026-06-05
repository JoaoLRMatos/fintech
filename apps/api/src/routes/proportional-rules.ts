import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function proportionalRuleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** GET /api/proportional-rules */
  app.get('/api/proportional-rules', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const [rules, categories] = await Promise.all([
      prisma.proportionalRule.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }),
      prisma.category.findMany({ where: { workspaceId } }),
    ]);
    return rules.map(r => ({
      ...r,
      category: r.categoryId ? (categories.find(c => c.id === r.categoryId) ?? null) : null,
    }));
  });

  /** POST /api/proportional-rules */
  app.post('/api/proportional-rules', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const body = z.object({
      description: z.string().min(1),
      percent: z.number().positive().max(1),
      categoryId: z.string().nullable().optional(),
    }).parse(request.body);

    return prisma.proportionalRule.create({ data: { ...body, workspaceId } });
  });

  /** PUT /api/proportional-rules/:id */
  app.put('/api/proportional-rules/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      description: z.string().min(1).optional(),
      percent: z.number().positive().max(1).optional(),
      categoryId: z.string().nullable().optional(),
      active: z.boolean().optional(),
    }).parse(request.body);

    const existing = await prisma.proportionalRule.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Regra proporcional não encontrada.');

    return prisma.proportionalRule.update({ where: { id }, data: body });
  });

  /** DELETE /api/proportional-rules/:id */
  app.delete('/api/proportional-rules/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.proportionalRule.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new Error('Regra proporcional não encontrada.');
    await prisma.proportionalRule.delete({ where: { id } });
    return { success: true };
  });
}
