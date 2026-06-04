import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendTwilioWhatsApp, isTwilioConfigured, validateTwilioWebhook } from '../lib/twilio.js';
import { handleIncomingMessage as handleFinanceMessage } from '../lib/messageHandler.js';

// Provider ativo no runtime (pode trocar sem reiniciar)
let activeProvider: 'baileys' | 'twilio' = 'baileys';

export async function whatsappRoutes(app: FastifyInstance) {
  const baileysUrl = process.env.WHATSAPP_BASE_URL || 'http://localhost:3030/whatsapp';

  // Helper: faz proxy para o Baileys e lida com erros graciosamente
  async function baileysProxy(url: string, options?: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
    try {
      const res = await fetch(url, options);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return { ok: false, status: 503, data: { error: 'Baileys microservice indisponível ou não configurado.' } };
      }
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 503, data: { error: 'Baileys microservice indisponível. Verifique se está rodando.' } };
    }
  }

  // ── Proxy: QR code (JSON com imagem base64) ──
  app.get('/api/whatsapp/qr/:clientId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const { ok, status, data } = await baileysProxy(`${baileysUrl}/qr-json/${clientId}`);
    if (!ok) return reply.status(status).send(data);
    return data;
  });

  // ── Proxy: Status ──
  app.get('/api/whatsapp/status/:clientId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const { ok, status, data } = await baileysProxy(`${baileysUrl}/status/${clientId}`);
    if (!ok) return reply.status(status).send(data);
    return data;
  });

  // ── Proxy: Pairing code ──
  app.post('/api/whatsapp/pair/:clientId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const body = z.object({ phoneNumber: z.string() }).parse(request.body);
    const { ok, status, data } = await baileysProxy(`${baileysUrl}/pair/${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!ok) return reply.status(status).send(data);
    return data;
  });

  // ── Proxy: Disconnect ──
  app.post('/api/whatsapp/disconnect/:clientId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const { ok, status, data } = await baileysProxy(`${baileysUrl}/disconnect/${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forgetAuth: true }),
    });
    if (!ok) return reply.status(status).send(data);
    return data;
  });

  // ── Proxy: Webhook group name ──
  app.get('/api/whatsapp/webhook-group', { preHandler: [app.authenticate] }, async (_request, reply) => {
    const { ok, status, data } = await baileysProxy(`${baileysUrl}/webhook-group`);
    if (!ok) return reply.status(status).send(data);
    return data;
  });

  app.put('/api/whatsapp/webhook-group', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = z.object({ groupName: z.string() }).parse(request.body);
    const { ok, status, data } = await baileysProxy(`${baileysUrl}/webhook-group`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!ok) return reply.status(status).send(data);
    return data;
  });

  // ── Webhook: recebe mensagens do Baileys ──
  app.post('/api/whatsapp/webhook', async (request, reply) => {
    const secret = request.headers['x-webhook-secret'];
    if (secret !== process.env.WHATSAPP_WEBHOOK_SECRET) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = z.object({
      clientId: z.string(),
      from: z.string(),
      text: z.string(),
      messageId: z.string().optional(),
      timestamp: z.number().optional(),
    }).parse(request.body);

    const sendFn = async (message: string) => {
      const whatsappUrl = process.env.WHATSAPP_BASE_URL;
      if (!whatsappUrl) return;
      try {
        await fetch(`${whatsappUrl}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: body.clientId, number: body.from, message: `*🤖 Financeiro*\n\n${message}` }),
        });
      } catch (err) {
        request.log.error(err, 'Falha ao enviar confirmação WhatsApp (Baileys)');
      }
    };

    return handleFinanceMessage(body.text, sendFn, request.log, `whatsapp:${body.from}`);
  });

  // ── Webhook: recebe mensagens do Twilio ──
  app.post('/api/whatsapp/twilio-webhook', async (request, reply) => {
    const body = request.body as Record<string, string>;
    request.log.info({ bodyKeys: Object.keys(body || {}), accountSid: body?.AccountSid }, 'Twilio webhook received');

    // Valida que veio do nosso account
    if (!validateTwilioWebhook(body.AccountSid)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const from = body.From || '';      // whatsapp:+5511999999999
    const text = body.Body || '';

    if (!text.trim()) {
      return reply.status(200).send('<Response></Response>');
    }

    const sendFn = async (message: string) => {
      const result = await sendTwilioWhatsApp(from.replace('whatsapp:', ''), message);
      if (!result.success) {
        request.log.error(result.error, 'Falha ao enviar confirmação WhatsApp (Twilio)');
      }
    };

    const result = await handleFinanceMessage(text, sendFn, request.log, `whatsapp:${from}`);

    // Twilio espera TwiML como resposta, mas podemos retornar vazio
    // porque já enviamos via API
    reply.header('Content-Type', 'text/xml');
    return '<Response></Response>';
  });

  // ── Provider config ──
  app.get('/api/whatsapp/provider', { preHandler: [app.authenticate] }, async () => {
    return {
      active: activeProvider,
      twilioConfigured: isTwilioConfigured(),
      twilioPhone: process.env.TWILIO_PHONE_NUMBER || null,
    };
  });

  app.put('/api/whatsapp/provider', { preHandler: [app.authenticate] }, async (request) => {
    const body = z.object({
      provider: z.enum(['baileys', 'twilio']),
    }).parse(request.body);
    activeProvider = body.provider;
    return { active: activeProvider };
  });

}
