import { randomUUID } from 'crypto';
import { prisma } from './prisma.js';
import { processAgentMessage } from './processMessage.js';
import { projectMonths, simulatePurchase } from './projectionEngine.js';
import { computeSafeToSpend } from './insightsEngine.js';
import { invoiceForPurchase, fmtDate } from './creditCard.js';

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function resolveOccurredAt(iso: string | null): Date {
  if (!iso) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return new Date();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isNaN(d.getTime()) ? new Date() : d;
}

// Global in-memory chat histories (last 10 turns)
const chatHistories = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();

export async function handleIncomingMessage(
  text: string,
  sendReply: (message: string) => Promise<void>,
  log: { error: (err: unknown, msg: string) => void },
  chatId?: number | string,
) {
  const workspace = await prisma.workspace.findFirst({
    include: { categories: true, accounts: true, creditCards: true },
  });

  if (!workspace) {
    const errorMsg = '❌ Nenhum workspace configurado.';
    await sendReply(errorMsg);
    return { success: false, error: errorMsg };
  }

  // Capture chat/Telegram
  if (chatId !== undefined && String(chatId) !== (workspace as any).telegramChatId) {
    await prisma.workspace.update({ where: { id: workspace.id }, data: { telegramChatId: String(chatId) } }).catch(() => {});
  }

  const ctxKey = String(chatId ?? 'default');
  const now = new Date();

  // 1. Gather all contextual data for the Agent System Prompt

  // Credit Card cycle statuses
  let creditCardsStatus = '';
  for (const card of workspace.creditCards) {
    const unpaid = await prisma.transaction.findMany({
      where: { workspaceId: workspace.id, creditCardId: card.id, paidAt: null },
    });
    const invoicesMap = new Map<string, number>();
    for (const ut of unpaid) {
      if (ut.dueDate) {
        const mLabel = `${MONTH_NAMES[ut.dueDate.getMonth()]}/${ut.dueDate.getFullYear()}`;
        const val = ut.type === 'INCOME' ? -Number(ut.amount) : Number(ut.amount);
        invoicesMap.set(mLabel, (invoicesMap.get(mLabel) ?? 0) + val);
      }
    }
    creditCardsStatus += `💳 Card: "${card.name}" (ID: ${card.id})\n`;
    if (invoicesMap.size === 0) {
      creditCardsStatus += `  - Fatura em aberto limpa.\n`;
    } else {
      for (const [mLabel, total] of invoicesMap.entries()) {
        creditCardsStatus += `  - Fatura vencimento ${mLabel}: R$ ${total.toFixed(2)}\n`;
      }
    }
  }

  // Monthly breakdown summary
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

  const incomeTot = Number(incomeAgg._sum.amount ?? 0);
  const expenseTot = Number(expenseAgg._sum.amount ?? 0);
  let monthSummary = `Resumo de ${MONTH_NAMES[now.getMonth()]}/${now.getFullYear()}\n`;
  monthSummary += `- Receitas: R$ ${incomeTot.toFixed(2)}\n`;
  monthSummary += `- Despesas: R$ ${expenseTot.toFixed(2)}\n`;
  monthSummary += `- Saldo: R$ ${(incomeTot - expenseTot).toFixed(2)}\n`;
  if (catBreakdown.length > 0) {
    monthSummary += `Gastos por categoria:\n`;
    for (const cb of catBreakdown) {
      const cat = workspace.categories.find(c => c.id === cb.categoryId);
      monthSummary += `  - ${cat?.name ?? 'Sem categoria'}: R$ ${Number(cb._sum.amount ?? 0).toFixed(2)}\n`;
    }
  }

  // Recent 15 transactions
  const recentTxs = await prisma.transaction.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ createdAt: 'desc' }, { occurredAt: 'desc' }],
    take: 15,
  });
  let recentTransactionsList = '';
  for (const rx of recentTxs) {
    const dateStr = rx.occurredAt.toISOString().split('T')[0];
    const instTxt = rx.installmentGroup ? ` (Parc. ${rx.installmentCurrent}/${rx.installmentTotal}, Grupo ID: ${rx.installmentGroup})` : '';
    const details = rx.creditCardId ? `Cartão ID: ${rx.creditCardId}` : (rx.accountId ? `Conta ID: ${rx.accountId}` : 'Sem vínculo');
    recentTransactionsList += `- ID: ${rx.id} | Data: ${dateStr} | Desc: "${rx.description}" | Valor: R$ ${Number(rx.amount).toFixed(2)} | Tipo: ${rx.type} | PG: ${rx.paymentMethod || 'débito'} | ${details}${instTxt}\n`;
  }

  // History memory
  const history = chatHistories.get(ctxKey) || [];

  const cards = workspace.creditCards.map(c => ({ id: c.id, name: c.name, billingDay: c.billingDay, closingDay: c.closingDay }));
  const cats = workspace.categories.map(c => ({ id: c.id, name: c.name }));
  const accounts = workspace.accounts.map(a => ({ id: a.id, name: a.name, balance: a.balance }));

  // Call Agent
  const response = await processAgentMessage(
    text,
    cats,
    accounts,
    cards,
    creditCardsStatus,
    monthSummary,
    recentTransactionsList,
    history,
  );

  // 2. Execute Actions Sequence
  for (const act of response.actions) {
    try {
      if (act.action === 'create_transaction') {
        const isCredit = act.paymentMethod === 'credit';
        const matchedCard = act.creditCardId ? workspace.creditCards.find(c => c.id === act.creditCardId) : null;
        const occurredAt = resolveOccurredAt(act.occurredAt || null);

        let dueDate: Date | null = null;
        let creditCardId = matchedCard?.id ?? null;

        if (isCredit && matchedCard) {
          const cycle = invoiceForPurchase(matchedCard, occurredAt);
          dueDate = cycle.dueDate;
        } else if (isCredit) {
          dueDate = new Date(occurredAt.getFullYear(), occurredAt.getMonth() + 1, 10);
        }

        const actType = act.type === 'INCOME' ? 'INCOME' as const : 'EXPENSE' as const;

        await prisma.transaction.create({
          data: {
            type: actType,
            amount: act.amount ?? 0,
            description: act.description || 'Lançamento',
            occurredAt,
            source: 'agent',
            paymentMethod: act.paymentMethod || 'debit',
            dueDate,
            creditCardId,
            workspaceId: workspace.id,
            categoryId: act.categoryId || null,
            accountId: isCredit ? null : (workspace.accounts[0]?.id ?? null),
          },
        });

        if (!isCredit && workspace.accounts[0]) {
          const delta = actType === 'INCOME' ? (act.amount ?? 0) : -(act.amount ?? 0);
          await prisma.account.update({
            where: { id: workspace.accounts[0].id },
            data: { balance: { increment: delta } },
          });
        }
      }

      if (act.action === 'create_installment') {
        if (!act.amount || !act.installments || act.installments < 2) {
          log.error(
            { action: act },
            'create_installment ignorado: amount/installments inválidos (installments deve ser >= 2)',
          );
          continue;
        }
        const installmentAmount = Math.round((act.amount / act.installments) * 100) / 100;
        const groupId = randomUUID();
        const baseDate = resolveOccurredAt(act.occurredAt || null);
        const matchedCard = act.creditCardId ? workspace.creditCards.find(c => c.id === act.creditCardId) : null;
        const isCredit = act.paymentMethod === 'credit' || !!matchedCard;

        for (let i = 0; i < act.installments; i++) {
          const date = new Date(baseDate);
          date.setMonth(date.getMonth() + i);

          let dueDate: Date | null = null;
          let creditCardId: string | null = null;
          if (isCredit && matchedCard) {
            const cycle = invoiceForPurchase(matchedCard, date);
            dueDate = cycle.dueDate;
            creditCardId = matchedCard.id;
          }

          await prisma.transaction.create({
            data: {
              type: 'EXPENSE',
              amount: installmentAmount,
              description: `${act.description || 'Parcelado'} (${i + 1}/${act.installments})`,
              occurredAt: date,
              status: isCredit ? 'CONFIRMED' : (i === 0 ? 'CONFIRMED' : 'SCHEDULED'),
              source: 'agent',
              paymentMethod: isCredit ? 'credit' : 'debit',
              dueDate,
              creditCardId,
              installmentGroup: groupId,
              installmentCurrent: i + 1,
              installmentTotal: act.installments,
              workspaceId: workspace.id,
              categoryId: act.categoryId || null,
              accountId: isCredit ? null : (workspace.accounts[0]?.id ?? null),
            },
          });
        }

        if (!isCredit && workspace.accounts[0]) {
          await prisma.account.update({
            where: { id: workspace.accounts[0].id },
            data: { balance: { increment: -installmentAmount } },
          });
        }
      }

      if (act.action === 'update_transaction') {
        if (!act.transactionId) continue;
        const existingTx = await prisma.transaction.findUnique({
          where: { id: act.transactionId },
        });
        if (!existingTx) continue;

        const originalAmount = Number(existingTx.amount);
        const originalType = existingTx.type;
        const originalAccountId = existingTx.accountId;
        const originalCreditCardId = existingTx.creditCardId;

        if (existingTx.installmentGroup) {
          const groupTxs = await prisma.transaction.findMany({
            where: { installmentGroup: existingTx.installmentGroup, workspaceId: workspace.id },
            orderBy: { installmentCurrent: 'asc' },
          });

          const baseDate = act.occurredAt ? resolveOccurredAt(act.occurredAt) : null;
          const matchedCard = act.creditCardId ? workspace.creditCards.find(c => c.id === act.creditCardId) : (originalCreditCardId ? workspace.creditCards.find(c => c.id === originalCreditCardId) : null);
          const isCredit = act.paymentMethod === 'credit' || (act.paymentMethod !== 'debit' && !!matchedCard);

          for (const gTx of groupTxs) {
            const idxDiff = (gTx.installmentCurrent ?? 1) - (existingTx.installmentCurrent ?? 1);
            const updateData: any = {};

            if (baseDate) {
              const itemDate = new Date(baseDate);
              itemDate.setMonth(itemDate.getMonth() + idxDiff);
              updateData.occurredAt = itemDate;

              if (isCredit && matchedCard) {
                const cycle = invoiceForPurchase(matchedCard, itemDate);
                updateData.dueDate = cycle.dueDate;
              }
            } else if (act.creditCardId !== undefined && isCredit && matchedCard) {
              const cycle = invoiceForPurchase(matchedCard, gTx.occurredAt);
              updateData.dueDate = cycle.dueDate;
            }

            if (act.amount !== undefined) {
              updateData.amount = act.amount;
            }
            if (act.description !== undefined) {
              let newDesc = act.description;
              if (gTx.installmentCurrent && gTx.installmentTotal) {
                newDesc = `${act.description.replace(/\s\(\d+\/\d+\)$/, '')} (${gTx.installmentCurrent}/${gTx.installmentTotal})`;
              }
              updateData.description = newDesc;
            }
            if (act.categoryId !== undefined) updateData.categoryId = act.categoryId;
            if (act.creditCardId !== undefined) updateData.creditCardId = act.creditCardId;
            if (act.paymentMethod !== undefined) updateData.paymentMethod = act.paymentMethod;

            await prisma.transaction.update({
              where: { id: gTx.id },
              data: updateData,
            });
          }
        } else {
          const updateData: any = {};
          const occurredAt = act.occurredAt ? resolveOccurredAt(act.occurredAt) : existingTx.occurredAt;

          if (act.occurredAt !== undefined) updateData.occurredAt = occurredAt;
          if (act.amount !== undefined) updateData.amount = act.amount;
          if (act.description !== undefined) updateData.description = act.description;
          if (act.categoryId !== undefined) updateData.categoryId = act.categoryId;
          if (act.paymentMethod !== undefined) updateData.paymentMethod = act.paymentMethod;
          if (act.creditCardId !== undefined) updateData.creditCardId = act.creditCardId;

          const matchedCard = act.creditCardId ? workspace.creditCards.find(c => c.id === act.creditCardId) : (existingTx.creditCardId ? workspace.creditCards.find(c => c.id === existingTx.creditCardId) : null);
          const isCredit = act.paymentMethod === 'credit' || (act.paymentMethod !== 'debit' && !!matchedCard);

          if (isCredit && matchedCard) {
            const cycle = invoiceForPurchase(matchedCard, occurredAt);
            updateData.dueDate = cycle.dueDate;
            updateData.accountId = null;
          } else if (act.paymentMethod === 'debit') {
            updateData.dueDate = null;
            updateData.creditCardId = null;
            updateData.accountId = workspace.accounts[0]?.id ?? null;
          }

          await prisma.transaction.update({
            where: { id: existingTx.id },
            data: updateData,
          });

          // Revert balance adjustments
          if (originalAccountId && workspace.accounts[0]) {
            const revertDelta = originalType === 'INCOME' ? -originalAmount : originalAmount;
            await prisma.account.update({
              where: { id: workspace.accounts[0].id },
              data: { balance: { increment: revertDelta } },
            });
          }

          if (!isCredit && workspace.accounts[0]) {
            const newAmount = act.amount !== undefined ? act.amount : originalAmount;
            const newType = existingTx.type;
            const applyDelta = newType === 'INCOME' ? newAmount : -newAmount;
            await prisma.account.update({
              where: { id: workspace.accounts[0].id },
              data: { balance: { increment: applyDelta } },
            });
          }
        }
      }

      if (act.action === 'delete_transaction') {
        if (!act.transactionId) continue;
        const existingTx = await prisma.transaction.findUnique({
          where: { id: act.transactionId },
        });
        if (!existingTx) continue;

        if (existingTx.accountId && !existingTx.creditCardId && workspace.accounts[0]) {
          const reverseDelta = existingTx.type === 'INCOME' ? -Number(existingTx.amount) : Number(existingTx.amount);
          await prisma.account.update({
            where: { id: workspace.accounts[0].id },
            data: { balance: { increment: reverseDelta } },
          });
        }

        await prisma.transaction.delete({
          where: { id: existingTx.id },
        });
      }

      if (act.action === 'pay_invoice') {
        if (!act.creditCardId) continue;
        const card = workspace.creditCards.find(c => c.id === act.creditCardId);
        if (!card) continue;

        const all = await prisma.transaction.findMany({
          where: { workspaceId: workspace.id, creditCardId: card.id },
        });
        const unpaid = all.filter((t: any) => !t.paidAt && t.dueDate);
        if (unpaid.length === 0) continue;

        unpaid.sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
        const firstDue = new Date(unpaid[0].dueDate!);
        const invoice = unpaid.filter((t: any) => {
          const d = new Date(t.dueDate!);
          return d.getFullYear() === firstDue.getFullYear() && d.getMonth() === firstDue.getMonth();
        });

        const total = invoice.reduce((s, t) => s + (t.type === 'INCOME' ? -Number(t.amount) : Number(t.amount)), 0);

        const paidAtDate = act.paidAt ? resolveOccurredAt(act.paidAt) : new Date();

        await prisma.transaction.updateMany({
          where: { id: { in: invoice.map((t: any) => t.id) } },
          data: { paidAt: paidAtDate },
        });

        if (workspace.accounts[0]) {
          await prisma.account.update({
            where: { id: workspace.accounts[0].id },
            data: { balance: { increment: -total } },
          });
        }
      }
    } catch (actErr) {
      log.error(actErr, `Erro ao processar acao ${act.action}`);
    }
  }

  // 3. Update Chat History
  // Só gravamos no histórico quando a IA realmente processou a mensagem. Se a
  // chamada falhou (response.ok === false), NADA foi salvo no banco — então não
  // poluímos o histórico com a mensagem de erro. Assim, quando o usuário repete
  // os mesmos dados, o agente trata como uma criação nova (e não como "já fiz").
  if (response.ok) {
    const updatedHistory = [...history];
    updatedHistory.push({ role: 'user', content: text });
    updatedHistory.push({ role: 'assistant', content: response.reply });
    if (updatedHistory.length > 20) {
      updatedHistory.splice(0, updatedHistory.length - 20);
    }
    chatHistories.set(ctxKey, updatedHistory);
  }

  // 4. Send Agent Reply
  await sendReply(response.reply);
  return { success: true, reply: response.reply };
}
