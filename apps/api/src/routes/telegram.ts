import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  sendTelegramMessage,
  setTelegramWebhook,
  deleteTelegramWebhook,
  getTelegramUpdates,
  getTelegramBotInfo,
  type TelegramUpdate,
} from '../lib/telegram.js';
import { handleIncomingMessage } from '../lib/messageHandler.js';

// Long-polling state
let pollingActive = false;
let pollingOffset = 0;

async function startPolling(token: string, log: any) {
  if (pollingActive) return;
  pollingActive = true;
  log.info('Telegram: long-polling iniciado');

  const poll = async () => {
    if (!pollingActive) return;
    try {
      const updates = await getTelegramUpdates(token, pollingOffset);
      for (const update of updates) {
        pollingOffset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text) continue;

        const chatId = msg.chat.id;
        const text = msg.text;

        const sendFn = async (reply: string) => {
          try {
            await sendTelegramMessage(token, chatId, reply);
          } catch (err) {
            log.error(err, 'Falha ao enviar mensagem Telegram');
          }
        };

        handleIncomingMessage(text, sendFn, log, chatId).catch((err) =>
          log.error(err, 'Erro ao processar mensagem Telegram')
        );
      }
    } catch (err) {
      log.error(err, 'Telegram polling error');
    }
    if (pollingActive) setTimeout(poll, 1000);
  };

  poll();
}

export async function telegramRoutes(app: FastifyInstance) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  const isProd = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
  // URL pública: Render seta RENDER_EXTERNAL_URL automaticamente.
  // Fallback: API_PUBLIC_URL definida manualmente pelo usuário no dashboard.
  const publicUrl = process.env.RENDER_EXTERNAL_URL
    || process.env.API_PUBLIC_URL
    || process.env.PUBLIC_URL;

  const usePolling = process.env.TELEGRAM_USE_POLLING === 'true' && !isProd;

  if (token && usePolling) {
    deleteTelegramWebhook(token).catch(() => {});
    startPolling(token, app.log);
  } else if (token && isProd && publicUrl) {
    // Produção: registra o webhook automaticamente.
    const webhookUrl = `${publicUrl.replace(/\/$/, '')}/api/telegram/webhook`;
    setTelegramWebhook(token, webhookUrl, webhookSecret)
      .then(() => app.log.info({ webhookUrl }, 'Telegram: webhook registrado'))
      .catch((err) => app.log.error(err, 'Telegram: falha ao registrar webhook'));
  } else if (token && isProd && !publicUrl) {
    app.log.warn('Telegram: RENDER_EXTERNAL_URL ou API_PUBLIC_URL não definido — webhook não registrado. Defina API_PUBLIC_URL=https://finance-api-le0h.onrender.com no Render.');
  }

  // ── Webhook: recebe mensagens do Telegram ──
  app.post('/api/telegram/webhook', async (request, reply) => {
    if (!token) return reply.status(503).send({ error: 'TELEGRAM_BOT_TOKEN não configurado.' });

    // Valida o secret token enviado pelo Telegram
    const secret = request.headers['x-telegram-bot-api-secret-token'];
    if (webhookSecret && secret !== webhookSecret) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as TelegramUpdate;
    const msg = body?.message;
    if (!msg?.text) return { ok: true };

    const chatId = msg.chat.id;
    const text = msg.text;

    const sendFn = async (message: string) => {
      try {
        await sendTelegramMessage(token, chatId, message);
      } catch (err) {
        request.log.error(err, 'Falha ao enviar mensagem Telegram');
      }
    };

    return handleIncomingMessage(text, sendFn, request.log, chatId);
  });

  // ── Configurar webhook (requer autenticação) ──
  app.post('/api/telegram/set-webhook', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!token) return reply.status(503).send({ error: 'TELEGRAM_BOT_TOKEN não configurado.' });

    const body = z.object({
      url: z.string().url('URL inválida'),
    }).parse(request.body);

    const fullUrl = body.url.endsWith('/api/telegram/webhook')
      ? body.url
      : `${body.url.replace(/\/$/, '')}/api/telegram/webhook`;

    await setTelegramWebhook(token, fullUrl, webhookSecret);

    // Para polling se estava ativo
    pollingActive = false;

    return { ok: true, webhookUrl: fullUrl };
  });

  // ── Ativar polling (requer autenticação) ──
  app.post('/api/telegram/start-polling', { preHandler: [app.authenticate] }, async (_request, reply) => {
    if (!token) return reply.status(503).send({ error: 'TELEGRAM_BOT_TOKEN não configurado.' });
    // Remove webhook para habilitar polling
    await deleteTelegramWebhook(token);
    startPolling(token, app.log);
    return { ok: true, mode: 'polling' };
  });

  // ── Parar polling ──
  app.post('/api/telegram/stop-polling', { preHandler: [app.authenticate] }, async () => {
    pollingActive = false;
    return { ok: true, stopped: true };
  });

  // ── Status do bot ──
  app.get('/api/telegram/status', { preHandler: [app.authenticate] }, async (_request, reply) => {
    if (!token) return reply.status(503).send({ error: 'TELEGRAM_BOT_TOKEN não configurado.' });
    try {
      const bot = await getTelegramBotInfo(token);
      return { ok: true, bot, polling: pollingActive };
    } catch (err) {
      return reply.status(500).send({ error: 'Não foi possível conectar ao bot.' });
    }
  });
}
