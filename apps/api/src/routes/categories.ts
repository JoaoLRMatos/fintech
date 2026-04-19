import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/categories', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    return prisma.category.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } });
  });

  app.post('/api/categories', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const body = z.object({
      name: z.string().min(1),
      kind: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
      color: z.string().optional(),
    }).parse(request.body);

    return prisma.category.create({ data: { ...body, workspaceId } });
  });

  app.put('/api/categories/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      name: z.string().min(1).optional(),
      color: z.string().optional(),
    }).parse(request.body);

    const cat = await prisma.category.findFirst({ where: { id, workspaceId } });
    if (!cat) throw new Error('Categoria não encontrada.');

    return prisma.category.update({ where: { id }, data: body });
  });

  app.delete('/api/categories/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const cat = await prisma.category.findFirst({ where: { id, workspaceId } });
    if (!cat) throw new Error('Categoria não encontrada.');

    await prisma.transaction.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
    await prisma.category.delete({ where: { id } });
    return { success: true };
  });
}
