import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
// Twilio env loaded

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
import { recurringRoutes } from './routes/recurring.js';
import { creditCardRoutes } from './routes/credit-cards.js';
import { reportRoutes } from './routes/reports.js';
import { importRoutes } from './routes/import.js';
import { processRecurringRules } from './lib/recurringProcessor.js';
import multipart from '@fastify/multipart';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: (origin, cb) => {
    const allowed = process.env.FRONTEND_URL || 'http://localhost:5173';
    const allowList = allowed.split(',').map(s => s.trim());
    // Permite requests sem origin (mobile, curl, Postman) e origins permitidas
    if (!origin || allowList.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} não permitido`), false);
  },
  credentials: true,
});
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

// Twilio envia webhooks como application/x-www-form-urlencoded
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
  const parsed = Object.fromEntries(new URLSearchParams(body as string));
  done(null, parsed);
});

await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

await app.register(authRoutes);
await app.register(transactionRoutes);
await app.register(categoryRoutes);
await app.register(accountRoutes);
await app.register(dashboardRoutes);
await app.register(whatsappRoutes);
await app.register(recurringRoutes);
await app.register(creditCardRoutes);
await app.register(reportRoutes);
await app.register(importRoutes);

app.setErrorHandler((error: Error, _request, reply) => {
  if (error.name === 'ZodError') {
    return reply.status(400).send({ error: 'Dados inválidos.', details: error });
  }
  app.log.error(error);
  return reply.status(500).send({ error: 'Erro interno do servidor.' });
});

const port = Number(process.env.PORT || 3333);

app.listen({ port, host: '0.0.0.0' }).then(() => {
  // Cron: processa regras recorrentes a cada 1 hora
  setInterval(() => {
    processRecurringRules().catch((err) => app.log.error(err, 'Erro no processamento recorrente'));
  }, 60 * 60 * 1000);
  // Roda uma vez imediatamente ao iniciar
  processRecurringRules().catch((err) => app.log.error(err, 'Erro no processamento recorrente (startup)'));
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
