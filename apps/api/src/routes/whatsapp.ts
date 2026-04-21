import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { processWhatsAppMessage } from '../lib/processMessage.js';
import { sendTwilioWhatsApp, isTwilioConfigured, validateTwilioWebhook } from '../lib/twilio.js';
import { randomUUID } from 'crypto';

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
          body: JSON.stringify({ clientId: body.clientId, number: body.from, message }),
        });
      } catch (err) {
        request.log.error(err, 'Falha ao enviar confirmação WhatsApp (Baileys)');
      }
    };

    return handleIncomingMessage(body.text, sendFn, request);
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

    const result = await handleIncomingMessage(text, sendFn, request);

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

  async function handleIncomingMessage(
    text: string,
    sendReply: (message: string) => Promise<void>,
    request: any,
  ) {
    const workspace = await prisma.workspace.findFirst({
      include: { categories: true, accounts: true, creditCards: true },
    });

    if (!workspace) {
      await sendReply('❌ Nenhum workspace configurado.');
      return { success: false, error: 'Nenhum workspace configurado.' };
    }

    const categoryNames = workspace.categories.map((c: { name: string }) => c.name);
    const parsed = await processWhatsAppMessage(text, categoryNames);
    const account = workspace.accounts[0];
    // Pega o primeiro cartão de crédito cadastrado (se houver)
    const defaultCard = (workspace as any).creditCards?.[0] ?? null;

    function findCategory(name: string) {
      return workspace!.categories.find((c: { name: string }) =>
        c.name.toLowerCase() === name.toLowerCase()
      );
    }

    function fmt(v: number) {
      return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    // ── INTENT: register_transaction ──
    if (parsed.intent === 'register_transaction') {
      if (!parsed.amount) {
        await sendReply('❌ Não consegui identificar o valor. Tente: "250 gasolina"');
        return { success: false };
      }

      const category = findCategory(parsed.category);
      const txType = parsed.type === 'income' ? 'INCOME' as const : 'EXPENSE' as const;
      const isCredit = parsed.paymentMethod === 'credit';
      const isDebit = parsed.paymentMethod === 'debit';

      // Para crédito: dueDate = dia de vencimento do próximo mês
      let dueDate: Date | null = null;
      let creditCardId: string | null = null;
      if (isCredit && defaultCard) {
        const now = new Date();
        dueDate = new Date(now.getFullYear(), now.getMonth() + 1, defaultCard.billingDay);
        creditCardId = defaultCard.id;
      } else if (isCredit) {
        // Sem cartão cadastrado, usa dia 10 do próximo mês como padrão
        const now = new Date();
        dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 10);
      }

      const tx = await prisma.transaction.create({
        data: {
          type: txType,
          amount: parsed.amount,
          description: parsed.description,
          occurredAt: new Date(),
          source: 'whatsapp',
          paymentMethod: parsed.paymentMethod,
          dueDate,
          creditCardId,
          workspaceId: workspace.id,
          categoryId: category?.id ?? null,
          // Crédito: não vincula à conta corrente; débito ou sem método: vincula
          accountId: isCredit ? null : (account?.id ?? null),
        },
      });

      // Só deduz da conta se for débito (ou método não informado)
      if (!isCredit && account) {
        const delta = parsed.type === 'income' ? parsed.amount : -parsed.amount;
        await prisma.account.update({ where: { id: account.id }, data: { balance: { increment: delta } } });
      }

      const emoji = parsed.type === 'income' ? '💰' : (isCredit ? '💳' : '💸');
      let msg = `${emoji} Registrado: ${fmt(parsed.amount)} — ${parsed.description} (${parsed.category})`;
      if (isCredit) {
        const venc = dueDate ? dueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) : 'dia 10 do próximo mês';
        msg += `\n📅 Fatura no cartão — vencimento: ${venc}`;
        if (!defaultCard) msg += `\n💡 Dica: cadastre seu cartão de crédito no sistema para controle automático da fatura.`;
      } else if (isDebit) {
        msg += `\n🏦 Lançado como débito — saldo atualizado.`;
      }
      await sendReply(msg);
      return { success: true, transaction: tx };
    }

    // ── INTENT: register_installment ──
    if (parsed.intent === 'register_installment') {
      if (!parsed.amount || !parsed.installments || parsed.installments < 2) {
        await sendReply('❌ Não entendi o parcelamento. Tente: "200 em 6x tênis"');
        return { success: false };
      }

      const category = findCategory(parsed.category);
      const installmentAmount = Math.round((parsed.amount / parsed.installments) * 100) / 100;
      const groupId = randomUUID();
      const txs = [];

      for (let i = 0; i < parsed.installments; i++) {
        const date = new Date();
        date.setMonth(date.getMonth() + i);

        const tx = await prisma.transaction.create({
          data: {
            type: 'EXPENSE',
            amount: installmentAmount,
            description: `${parsed.description} (${i + 1}/${parsed.installments})`,
            occurredAt: date,
            source: 'whatsapp',
            installmentGroup: groupId,
            installmentCurrent: i + 1,
            installmentTotal: parsed.installments,
            workspaceId: workspace.id,
            categoryId: category?.id ?? null,
            accountId: account?.id ?? null,
          },
        });
        txs.push(tx);
      }

      if (account) {
        await prisma.account.update({ where: { id: account.id }, data: { balance: { increment: -installmentAmount } } });
      }

      await sendReply(
        `🛒 Parcelamento registrado!\n` +
        `${parsed.description}: ${fmt(parsed.amount)} em ${parsed.installments}x de ${fmt(installmentAmount)}\n` +
        `Parcelas lançadas de ${new Date().toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })} ` +
        `até ${txs[txs.length - 1].occurredAt.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}`
      );
      return { success: true, installments: txs.length };
    }

    // ── INTENT: register_recurring ──
    if (parsed.intent === 'register_recurring') {
      if (!parsed.amount) {
        await sendReply('❌ Não consegui identificar o valor. Tente: "netflix todo mês 40"');
        return { success: false };
      }

      const category = findCategory(parsed.category);
      const txType = parsed.type === 'income' ? 'INCOME' as const : 'EXPENSE' as const;
      const now = new Date();

      const rule = await prisma.recurringRule.create({
        data: {
          type: txType,
          amount: parsed.amount,
          description: parsed.description,
          frequency: parsed.frequency || 'MONTHLY',
          dayOfMonth: now.getDate(),
          nextDueDate: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
          workspaceId: workspace.id,
          categoryId: category?.id ?? null,
          accountId: account?.id ?? null,
        },
      });

      await prisma.transaction.create({
        data: {
          type: txType,
          amount: parsed.amount,
          description: parsed.description,
          occurredAt: now,
          source: `recurring:${rule.id}:${now.toISOString().slice(0, 10)}`,
          workspaceId: workspace.id,
          categoryId: category?.id ?? null,
          accountId: account?.id ?? null,
        },
      });

      if (account) {
        const delta = parsed.type === 'income' ? parsed.amount : -parsed.amount;
        await prisma.account.update({ where: { id: account.id }, data: { balance: { increment: delta } } });
      }

      const freqLabel = { DAILY: 'diário', WEEKLY: 'semanal', MONTHLY: 'mensal', YEARLY: 'anual' }[parsed.frequency || 'MONTHLY'];
      const emoji = parsed.type === 'income' ? '💰' : '🔄';
      await sendReply(
        `${emoji} Recorrência criada!\n` +
        `${parsed.description}: ${fmt(parsed.amount)} (${freqLabel})\n` +
        `Categoria: ${parsed.category}\n` +
        `Primeira transação registrada. Próxima: dia ${rule.nextDueDate.getDate()} de cada mês.`
      );
      return { success: true, recurringRule: rule };
    }

    // ── INTENT: query_summary ──
    if (parsed.intent === 'query_summary') {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      const [incomeAgg, expenseAgg, catBreakdown] = await Promise.all([
        prisma.transaction.aggregate({
          where: { workspaceId: workspace.id, type: 'INCOME', occurredAt: { gte: startOfMonth, lte: endOfMonth } },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: { workspaceId: workspace.id, type: 'EXPENSE', occurredAt: { gte: startOfMonth, lte: endOfMonth } },
          _sum: { amount: true },
        }),
        prisma.transaction.groupBy({
          by: ['categoryId'],
          where: { workspaceId: workspace.id, type: 'EXPENSE', occurredAt: { gte: startOfMonth, lte: endOfMonth } },
          _sum: { amount: true },
          orderBy: { _sum: { amount: 'desc' } },
        }),
      ]);

      const income = Number(incomeAgg._sum.amount ?? 0);
      const expense = Number(expenseAgg._sum.amount ?? 0);
      const monthName = now.toLocaleDateString('pt-BR', { month: 'long' });

      let msg = `📊 *Resumo de ${monthName}*\n\n`;
      msg += `💰 Entradas: ${fmt(income)}\n`;
      msg += `💸 Saídas: ${fmt(expense)}\n`;
      msg += `📈 Saldo do mês: ${fmt(income - expense)}\n`;

      if (catBreakdown.length > 0) {
        const catIds = catBreakdown.map((c: any) => c.categoryId).filter(Boolean) as string[];
        const cats = catIds.length > 0
          ? await prisma.category.findMany({ where: { id: { in: catIds } } })
          : [];

        msg += `\n📋 *Gastos por categoria:*\n`;
        for (const cb of catBreakdown) {
          const cat = cats.find((c: any) => c.id === (cb as any).categoryId);
          const name = cat?.name ?? 'Sem categoria';
          msg += `  • ${name}: ${fmt(Number((cb as any)._sum.amount ?? 0))}\n`;
        }
      }

      await sendReply(msg);
      return { success: true, summary: { income, expense } };
    }

    // ── INTENT: query_category ──
    if (parsed.intent === 'query_category') {
      const filterName = parsed.categoryFilter || parsed.category || '';
      const category = workspace.categories.find((c: { name: string }) =>
        c.name.toLowerCase().includes(filterName.toLowerCase())
      );

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      const where: any = {
        workspaceId: workspace.id,
        occurredAt: { gte: startOfMonth, lte: endOfMonth },
      };
      if (category) where.categoryId = category.id;

      const [agg, txs] = await Promise.all([
        prisma.transaction.aggregate({ where, _sum: { amount: true }, _count: true }),
        prisma.transaction.findMany({ where, orderBy: { occurredAt: 'desc' }, take: 10 }),
      ]);

      const total = Number(agg._sum.amount ?? 0);
      const catName = category?.name ?? filterName;
      const monthName = now.toLocaleDateString('pt-BR', { month: 'long' });

      let msg = `📋 *${catName} em ${monthName}*\n\n`;
      msg += `Total: ${fmt(total)} (${agg._count} lançamentos)\n`;

      if (txs.length > 0) {
        msg += `\nÚltimos lançamentos:\n`;
        for (const tx of txs) {
          const date = tx.occurredAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
          msg += `  • ${date} — ${tx.description}: ${fmt(Number(tx.amount))}\n`;
        }
      }

      await sendReply(msg);
      return { success: true, total, count: agg._count };
    }

    // ── INTENT: query_balance ──
    if (parsed.intent === 'query_balance') {
      const accounts = await prisma.account.findMany({ where: { workspaceId: workspace.id } });
      const total = accounts.reduce((s: number, a: any) => s + Number(a.balance), 0);

      let msg = `🏦 *Saldo das contas*\n\n`;
      for (const acc of accounts) {
        msg += `  • ${acc.name}: ${fmt(Number(acc.balance))}\n`;
      }
      msg += `\n💵 Total: ${fmt(total)}`;

      await sendReply(msg);
      return { success: true, balance: total };
    }

    // ── INTENT: help ──
    if (parsed.intent === 'help') {
      const helpMsg =
        `🤖 *Jarvis - Assistente Financeiro*\n\n` +
        `Posso ajudar com:\n\n` +
        `💸 *Registrar gasto*\n` +
        `  "250 gasolina"\n` +
        `  "45 almoço"\n\n` +
        `� *Gasto no crédito*\n` +
        `  "230 barbeiro crédito"\n` +
        `  "150 supermercado no cartão"\n\n` +
        `🏦 *Gasto no débito*\n` +
        `  "80 farmácia débito"\n\n` +
        `�💰 *Registrar entrada*\n` +
        `  "recebi 5000 salário"\n\n` +
        `🛒 *Parcelamento*\n` +
        `  "200 em 6x tênis"\n` +
        `  "12x67 celular"\n\n` +
        `🔄 *Gasto recorrente*\n` +
        `  "netflix todo mês 40"\n` +
        `  "academia mensal 100"\n\n` +
        `📊 *Consultas*\n` +
        `  "quanto gastei esse mês?"\n` +
        `  "gastos com alimentação"\n` +
        `  "qual meu saldo?"`;

      await sendReply(helpMsg);
      return { success: true };
    }

    // ── INTENT: unknown ──
    await sendReply(
      `🤔 Não entendi sua mensagem.\n\nDigite *ajuda* para ver os comandos disponíveis.`
    );
    return { success: false, message: 'Intent não reconhecido' };
  }

  app.get('/api/whatsapp/parser-preview', async (request) => {
    const query = z.object({ text: z.string().default('250 gasolina do carro') }).parse(request.query);
    const workspace = await prisma.workspace.findFirst({ include: { categories: true } });
    const categoryNames = workspace?.categories.map((c: { name: string }) => c.name) ?? [];
    return processWhatsAppMessage(query.text, categoryNames);
  });
}
