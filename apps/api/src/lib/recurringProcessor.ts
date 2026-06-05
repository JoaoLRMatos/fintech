import { prisma } from './prisma.js';
import { getFifthBusinessDayOfMonth } from './businessDays.js';
import { invoiceForPurchase } from './creditCard.js';

export async function processRecurringRules() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const dueRules = await prisma.recurringRule.findMany({
    where: {
      active: true,
      nextDueDate: { lte: now },
    },
  });

  let created = 0;

  for (const rule of dueRules) {
    // Idempotência: verifica se já criou transação para esta data
    const sourceTag = `recurring:${rule.id}:${today.toISOString().slice(0, 10)}`;
    const exists = await prisma.transaction.findFirst({
      where: { source: sourceTag, workspaceId: rule.workspaceId },
    });
    if (exists) continue;

    // Recorrência no CARTÃO DE CRÉDITO: cria uma transação de crédito com a
    // dueDate calculada pelo ciclo do cartão. Como criamos só quando vence (uma
    // por mês), o limite do cartão só é consumido no mês do lançamento — nunca
    // de forma antecipada.
    const card = rule.creditCardId
      ? await prisma.creditCard.findUnique({ where: { id: rule.creditCardId } })
      : null;
    const isCredit = !!card;

    let dueDate: Date | null = null;
    if (isCredit && card) {
      dueDate = invoiceForPurchase(card, now).dueDate;
    }

    // Cria transação
    await prisma.transaction.create({
      data: {
        type: rule.type,
        amount: rule.amount,
        description: rule.description,
        occurredAt: now,
        source: sourceTag,
        paymentMethod: isCredit ? 'credit' : (rule.paymentMethod ?? undefined),
        dueDate,
        workspaceId: rule.workspaceId,
        categoryId: rule.categoryId,
        creditCardId: isCredit ? card!.id : null,
        // No crédito não há conta vinculada (sai na fatura, não no saldo agora).
        accountId: isCredit ? null : rule.accountId,
      },
    });

    // Atualiza saldo da conta apenas quando NÃO é cartão de crédito.
    if (!isCredit && rule.accountId) {
      const delta = rule.type === 'INCOME' ? Number(rule.amount) : -Number(rule.amount);
      await prisma.account.update({
        where: { id: rule.accountId },
        data: { balance: { increment: delta } },
      });
    }

    // Calcula próxima data
    let next: Date;
    if (rule.isFifthBusinessDay && rule.frequency === 'MONTHLY') {
      const nextMonth = new Date(rule.nextDueDate);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      next = getFifthBusinessDayOfMonth(nextMonth.getFullYear(), nextMonth.getMonth());
    } else {
      next = new Date(rule.nextDueDate);
      switch (rule.frequency) {
        case 'DAILY':
          next.setDate(next.getDate() + 1);
          break;
        case 'WEEKLY':
          next.setDate(next.getDate() + 7);
          break;
        case 'MONTHLY':
          next.setMonth(next.getMonth() + 1);
          break;
        case 'YEARLY':
          next.setFullYear(next.getFullYear() + 1);
          break;
      }
    }

    // Desativa se passou da data final
    const active = rule.endDate ? next <= rule.endDate : true;

    await prisma.recurringRule.update({
      where: { id: rule.id },
      data: { nextDueDate: next, active },
    });

    created++;
  }

  if (created > 0) {
    console.log(`[RecurringProcessor] ${created} transações recorrentes criadas.`);
  }

  return created;
}
