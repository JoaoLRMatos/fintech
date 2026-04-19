import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/accounts', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    return prisma.account.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } });
  });

  app.post('/api/accounts', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const body = z.object({
      name: z.string().min(1),
      type: z.string().min(1),
      balance: z.number().default(0),
    }).parse(request.body);

    return prisma.account.create({ data: { ...body, workspaceId } });
  });

  app.put('/api/accounts/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      name: z.string().min(1).optional(),
      type: z.string().optional(),
    }).parse(request.body);

    const acc = await prisma.account.findFirst({ where: { id, workspaceId } });
    if (!acc) throw new Error('Conta não encontrada.');

    return prisma.account.update({ where: { id }, data: body });
  });

  app.delete('/api/accounts/:id', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const acc = await prisma.account.findFirst({ where: { id, workspaceId } });
    if (!acc) throw new Error('Conta não encontrada.');

    await prisma.transaction.updateMany({ where: { accountId: id }, data: { accountId: null } });
    await prisma.account.delete({ where: { id } });
    return { success: true };
  });
}
