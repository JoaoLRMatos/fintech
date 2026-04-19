import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parseFinancialMessage } from '../lib/parseFinancialMessage.js';

export async function whatsappRoutes(app: FastifyInstance) {
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

    const parsed = parseFinancialMessage(body.text);

    if (!parsed.success || !parsed.amount) {
      return { success: false, message: 'Não consegui interpretar. Tente: "250 gasolina"' };
    }

    const workspace = await prisma.workspace.findFirst({
      include: { categories: true, accounts: true },
    });

    if (!workspace) {
      return reply.status(500).send({ error: 'Nenhum workspace configurado.' });
    }

    const category = workspace.categories.find((c: { name: string; kind: string }) =>
      c.name.toLowerCase() === parsed.category.toLowerCase() ||
      c.kind === (parsed.type === 'income' ? 'INCOME' : 'EXPENSE')
    );

    const account = workspace.accounts[0];

    const tx = await prisma.transaction.create({
      data: {
        type: parsed.type === 'income' ? 'INCOME' : 'EXPENSE',
        amount: parsed.amount,
        description: parsed.description,
        occurredAt: new Date(),
        source: 'whatsapp',
        workspaceId: workspace.id,
        categoryId: category?.id ?? null,
        accountId: account?.id ?? null,
      },
    });

    if (account) {
      const delta = parsed.type === 'income' ? parsed.amount : -parsed.amount;
      await prisma.account.update({ where: { id: account.id }, data: { balance: { increment: delta } } });
    }

    const emoji = parsed.type === 'income' ? '💰' : '💸';
    const confirmMsg = `${emoji} Registrado: R$ ${parsed.amount.toFixed(2)} — ${parsed.description} (${parsed.category})`;

    const whatsappUrl = process.env.WHATSAPP_BASE_URL;
    if (whatsappUrl) {
      try {
        await fetch(`${whatsappUrl}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: body.clientId,
            number: body.from,
            message: confirmMsg,
          }),
        });
      } catch (err) {
        request.log.error(err, 'Falha ao enviar confirmação WhatsApp');
      }
    }

    return { success: true, transaction: tx, confirmation: confirmMsg };
  });

  app.get('/api/whatsapp/parser-preview', async (request) => {
    const query = z.object({ text: z.string().default('250 gasolina do carro') }).parse(request.query);
    return parseFinancialMessage(query.text);
  });
}
