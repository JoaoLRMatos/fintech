import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (request, reply) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(6),
      fullName: z.string().min(2),
    }).parse(request.body);

    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) return reply.status(409).send({ error: 'E-mail já cadastrado.' });

    const passwordHash = await bcrypt.hash(body.password, 10);

    const user = await prisma.user.create({
      data: { email: body.email, passwordHash, fullName: body.fullName },
    });

    const org = await prisma.organization.create({
      data: {
        name: `Org de ${body.fullName}`,
        memberships: { create: { userId: user.id, role: 'owner' } },
        workspaces: {
          create: {
            name: 'Pessoal',
            currency: 'BRL',
            categories: {
              create: [
                { name: 'Alimentação', kind: 'EXPENSE', color: '#ef4444' },
                { name: 'Transporte', kind: 'EXPENSE', color: '#f97316' },
                { name: 'Moradia', kind: 'EXPENSE', color: '#8b5cf6' },
                { name: 'Saúde', kind: 'EXPENSE', color: '#06b6d4' },
                { name: 'Pessoal', kind: 'EXPENSE', color: '#ec4899' },
                { name: 'Lazer', kind: 'EXPENSE', color: '#14b8a6' },
                { name: 'Educação', kind: 'EXPENSE', color: '#6366f1' },
                { name: 'Geral', kind: 'EXPENSE', color: '#64748b' },
                { name: 'Salário', kind: 'INCOME', color: '#22c55e' },
                { name: 'Freelance', kind: 'INCOME', color: '#10b981' },
                { name: 'Investimentos', kind: 'INCOME', color: '#3b82f6' },
                { name: 'Outros', kind: 'INCOME', color: '#a3e635' },
              ],
            },
            accounts: {
              create: [
                { name: 'Carteira', type: 'cash', balance: 0 },
                { name: 'Conta Bancária', type: 'bank', balance: 0 },
              ],
            },
          },
        },
      },
      include: { workspaces: true },
    });

    const workspace = org.workspaces[0];
    const token = app.jwt.sign({ userId: user.id, workspaceId: workspace.id }, { expiresIn: '7d' });

    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7,
    });

    return { user: { id: user.id, email: user.email, fullName: user.fullName }, token, workspaceId: workspace.id };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }).parse(request.body);

    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: { memberships: { include: { organization: { include: { workspaces: true } } } } },
    });

    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.status(401).send({ error: 'Credenciais inválidas.' });
    }

    const workspace = user.memberships[0]?.organization?.workspaces[0];
    if (!workspace) return reply.status(500).send({ error: 'Nenhum workspace encontrado.' });

    const token = app.jwt.sign({ userId: user.id, workspaceId: workspace.id }, { expiresIn: '7d' });

    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7,
    });

    return { user: { id: user.id, email: user.email, fullName: user.fullName }, token, workspaceId: workspace.id };
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    const { userId, workspaceId } = request.user as { userId: string; workspaceId: string };
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true } });
    return { user, workspaceId };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { success: true };
  });
}
