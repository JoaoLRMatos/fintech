import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fjwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import { authRoutes } from './routes/auth.js';
import { transactionRoutes } from './routes/transactions.js';
import { categoryRoutes } from './routes/categories.js';
import { accountRoutes } from './routes/accounts.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { whatsappRoutes } from './routes/whatsapp.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
await app.register(fjwt, { secret: process.env.JWT_SECRET || 'dev-secret-change-me' });

app.decorate('authenticate', async (request: any, reply: any) => {
  try {
    const token = request.cookies.token || request.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.status(401).send({ error: 'Não autenticado.' });
    request.user = app.jwt.verify(token);
  } catch {
    return reply.status(401).send({ error: 'Token inválido ou expirado.' });
  }
});

app.get('/health', async () => ({ ok: true, service: 'finance-api' }));

await app.register(authRoutes);
await app.register(transactionRoutes);
await app.register(categoryRoutes);
await app.register(accountRoutes);
await app.register(dashboardRoutes);
await app.register(whatsappRoutes);

app.setErrorHandler((error: Error, _request, reply) => {
  if (error.name === 'ZodError') {
    return reply.status(400).send({ error: 'Dados inválidos.', details: error });
  }
  app.log.error(error);
  return reply.status(500).send({ error: 'Erro interno do servidor.' });
});

const port = Number(process.env.PORT || 3333);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
