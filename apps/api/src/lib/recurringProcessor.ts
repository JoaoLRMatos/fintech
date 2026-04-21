import { prisma } from './prisma.js';

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

    // Cria transação
    const tx = await prisma.transaction.create({
      data: {
        type: rule.type,
        amount: rule.amount,
        description: rule.description,
        occurredAt: now,
        source: sourceTag,
        workspaceId: rule.workspaceId,
        categoryId: rule.categoryId,
        accountId: rule.accountId,
      },
    });

    // Atualiza saldo da conta se vinculada
    if (rule.accountId) {
      const delta = rule.type === 'INCOME' ? Number(rule.amount) : -Number(rule.amount);
      await prisma.account.update({
        where: { id: rule.accountId },
        data: { balance: { increment: delta } },
      });
    }

    // Calcula próxima data
    const next = new Date(rule.nextDueDate);
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
