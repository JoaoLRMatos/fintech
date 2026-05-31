import { randomUUID } from 'crypto';
import { prisma } from './prisma.js';
import { processWhatsAppMessage } from './processMessage.js';
import { projectMonths, simulatePurchase } from './projectionEngine.js';
import { computeSafeToSpend } from './insightsEngine.js';

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Quantos meses à frente está o próximo mês-alvo (1-12). 0 se for o mês atual. */
function monthsUntil(targetMonth: number, from = new Date()): number {
  const cur = from.getMonth() + 1;
  let diff = targetMonth - cur;
  if (diff < 0) diff += 12;
  return diff;
}

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
    await sendReply('❌ Nenhum workspace configurado.');
    return { success: false, error: 'Nenhum workspace configurado.' };
  }

  // Captura o chat p/ permitir alertas proativos (Telegram).
  if (chatId !== undefined && String(chatId) !== (workspace as any).telegramChatId) {
    await prisma.workspace.update({ where: { id: workspace.id }, data: { telegramChatId: String(chatId) } }).catch(() => {});
  }

  const categoryNames = workspace.categories.map((c: { name: string }) => c.name);
  const creditCardList = (workspace as any).creditCards?.map((c: any) => ({ id: c.id, name: c.name })) ?? [];
  const parsed = await processWhatsAppMessage(text, categoryNames, creditCardList);
  const account = workspace.accounts[0];
  const creditCards = (workspace as any).creditCards ?? [];
  const defaultCard = creditCards[0] ?? null;

  function findCreditCard() {
    if (!parsed.creditCardHint) return defaultCard;
    const hint = parsed.creditCardHint.toLowerCase();
    return creditCards.find((c: any) =>
      c.name.toLowerCase().includes(hint) || hint.includes(c.name.toLowerCase())
    ) ?? defaultCard;
  }

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
    const matchedCard = findCreditCard();

    let dueDate: Date | null = null;
    let creditCardId: string | null = null;
    if (isCredit && matchedCard) {
      const now = new Date();
      dueDate = new Date(now.getFullYear(), now.getMonth() + 1, matchedCard.billingDay);
      creditCardId = matchedCard.id;
    } else if (isCredit) {
      const now = new Date();
      dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 10);
    }

    const tx = await prisma.transaction.create({
      data: {
        type: txType,
        amount: parsed.amount,
        description: parsed.description,
        occurredAt: new Date(),
        source: 'telegram',
        paymentMethod: parsed.paymentMethod,
        dueDate,
        creditCardId,
        workspaceId: workspace.id,
        categoryId: category?.id ?? null,
        accountId: isCredit ? null : (account?.id ?? null),
      },
    });

    if (!isCredit && account) {
      const delta = parsed.type === 'income' ? parsed.amount : -parsed.amount;
      await prisma.account.update({ where: { id: account.id }, data: { balance: { increment: delta } } });
    }

    const emoji = parsed.type === 'income' ? '💰' : (isCredit ? '💳' : '💸');
    let msg = `${emoji} Registrado: ${fmt(parsed.amount)} — ${parsed.description} (${parsed.category})`;
    if (isCredit) {
      const venc = dueDate ? dueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) : 'dia 10 do próximo mês';
      const cardName = matchedCard?.name ?? parsed.creditCardHint ?? 'cartão';
      msg += `\n💳 Fatura: ${cardName} — vencimento: ${venc}`;
      if (!matchedCard) msg += `\n💡 Dica: cadastre seu cartão de crédito no sistema para controle automático da fatura.`;
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
          // 1ª parcela já é paga; as demais ficam agendadas (futuro vs já pago)
          status: i === 0 ? 'CONFIRMED' : 'SCHEDULED',
          source: 'telegram',
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

    // Mostra o impacto futuro da compra (o diferencial: ver o futuro antes/depois de gastar)
    let impacto = '';
    try {
      const proj = await projectMonths(workspace.id, { horizon: parsed.installments });
      const neg = proj.find(m => m.closingBalance < 0);
      if (neg) {
        impacto = `\n⚠️ Atenção: seu saldo previsto fica negativo em *${neg.label}* (${fmt(neg.closingBalance)}).`;
      } else {
        impacto = `\n🔮 Saldo segue positivo nos próximos meses. ✅`;
      }
    } catch { /* projeção é best-effort */ }

    await sendReply(
      `🛒 Parcelamento registrado!\n` +
      `${parsed.description}: ${fmt(parsed.amount)} em ${parsed.installments}x de ${fmt(installmentAmount)}\n` +
      `Parcelas lançadas de ${new Date().toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })} ` +
      `até ${txs[txs.length - 1].occurredAt.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}` +
      impacto
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
    const day = parsed.dayOfMonth && parsed.dayOfMonth >= 1 && parsed.dayOfMonth <= 31
      ? parsed.dayOfMonth
      : now.getDate();

    const rule = await prisma.recurringRule.create({
      data: {
        type: txType,
        amount: parsed.amount,
        description: parsed.description,
        frequency: parsed.frequency || 'MONTHLY',
        dayOfMonth: day,
        nextDueDate: new Date(now.getFullYear(), now.getMonth() + 1, day),
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

  // ── INTENT: register_planned_event (receita/despesa pontual futura) ──
  if (parsed.intent === 'register_planned_event') {
    if (!parsed.amount) {
      await sendReply('❌ Não consegui identificar o valor. Tente: "vou receber 13º em dezembro 2500"');
      return { success: false };
    }
    const category = findCategory(parsed.category);
    const now = new Date();
    const ahead = parsed.targetMonth ? monthsUntil(parsed.targetMonth, now) : 1;
    const monthIdx = (now.getMonth() + ahead) % 12;
    const year = now.getFullYear() + Math.floor((now.getMonth() + ahead) / 12);
    const expectedAt = new Date(year, monthIdx, 15);

    const event = await prisma.plannedEvent.create({
      data: {
        type: parsed.type === 'income' ? 'INCOME' : 'EXPENSE',
        amount: parsed.amount,
        description: parsed.description,
        expectedAt,
        categoryId: category?.id ?? null,
        workspaceId: workspace.id,
      },
    });

    const emoji = parsed.type === 'income' ? '💰' : '📌';
    await sendReply(
      `${emoji} Evento futuro registrado!\n` +
      `${parsed.description}: ${fmt(parsed.amount)} previsto para *${MONTH_NAMES[monthIdx]} de ${year}*.\n` +
      `🔮 Já incluí na sua projeção de saldo.`
    );
    return { success: true, plannedEvent: event };
  }

  // ── INTENT: simulate_purchase ("posso comprar?") ──
  if (parsed.intent === 'simulate_purchase') {
    if (!parsed.amount) {
      await sendReply('❌ Não entendi o valor da compra. Tente: "posso comprar uma TV de 3600 em 12x?"');
      return { success: false };
    }
    const installments = parsed.installments && parsed.installments >= 1 ? parsed.installments : 1;
    const sim = await simulatePurchase(
      workspace.id,
      { total: parsed.amount, installments, description: parsed.description },
      { horizon: 12 },
    );

    const baseAvg = sim.base.reduce((s, m) => s + m.saldoMes, 0) / (sim.base.length || 1);
    const newAvg = sim.withPurchase.reduce((s, m) => s + m.saldoMes, 0) / (sim.withPurchase.length || 1);
    const parcelaTxt = installments > 1 ? `${installments}x de ${fmt(sim.perInstallment)}` : 'à vista';

    let msg = `🔮 *Simulação* — ${parsed.description}: ${fmt(parsed.amount)} (${parcelaTxt})\n\n`;
    msg += `Sobra média/mês: ${fmt(baseAvg)} → ${fmt(newAvg)}\n`;
    msg += `Comprometimento máx. da renda: ${Math.round(sim.maxCommittedRatio * 100)}%\n\n`;
    if (sim.affordable) {
      msg += `✅ Cabe no seu orçamento — o saldo nunca fica negativo.`;
    } else {
      msg += `⚠️ Não recomendado: seu saldo fica negativo em *${sim.firstNegativeMonth!.label}* (${fmt(sim.firstNegativeMonth!.closingBalance)}).`;
      if (installments < 18) msg += `\n💡 Dica: diluir em mais parcelas reduz o impacto mensal.`;
    }
    await sendReply(msg);
    return { success: true, simulation: { affordable: sim.affordable } };
  }

  // ── INTENT: query_projection (saldo futuro) ──
  if (parsed.intent === 'query_projection') {
    const now = new Date();
    let horizon = parsed.horizonMonths && parsed.horizonMonths >= 1 ? parsed.horizonMonths : 6;
    if (parsed.targetMonth) horizon = Math.max(1, monthsUntil(parsed.targetMonth, now));
    horizon = Math.min(horizon, 12);

    const proj = await projectMonths(workspace.id, { horizon });
    if (parsed.targetMonth) {
      const target = proj[proj.length - 1];
      let msg = `📈 *Saldo previsto — ${target.label}*\n\n`;
      msg += `Entradas: ${fmt(target.income)}\n`;
      msg += `Saídas: ${fmt(target.expense)}\n`;
      msg += `Saldo acumulado: ${fmt(target.closingBalance)} ${target.closingBalance < 0 ? '🔴' : '✅'}`;
      await sendReply(msg);
    } else {
      let msg = `📈 *Projeção dos próximos ${proj.length} meses*\n\n`;
      for (const m of proj) {
        const icon = m.closingBalance < 0 ? '🔴' : '🟢';
        msg += `${icon} ${m.label}: ${fmt(m.closingBalance)}\n`;
      }
      const avg = proj.reduce((s, m) => s + m.saldoMes, 0) / (proj.length || 1);
      msg += `\nSobra média prevista: ${fmt(avg)}/mês`;
      await sendReply(msg);
    }
    return { success: true };
  }

  // ── INTENT: query_safe_to_spend (limite saudável) ──
  if (parsed.intent === 'query_safe_to_spend') {
    const safe = await computeSafeToSpend(workspace.id);
    let msg = `💡 *Limite saudável de gasto*\n\n`;
    if (safe.amount > 0) {
      msg += `Você pode gastar *${fmt(safe.amount)}* livremente até o fim do mês.\n\n`;
    } else {
      msg += `⚠️ Sem margem livre este mês (faltam ${fmt(Math.abs(safe.amount))} para os compromissos).\n\n`;
    }
    msg += `Saldo hoje: ${fmt(safe.currentBalance)}\n`;
    msg += `+ entradas a receber: ${fmt(safe.remainingIncome)}\n`;
    msg += `− compromissos restantes: ${fmt(safe.remainingCommitted)}`;
    await sendReply(msg);
    return { success: true, safeToSpend: safe.amount };
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
      const cats = catIds.length > 0 ? await prisma.category.findMany({ where: { id: { in: catIds } } }) : [];
      msg += `\n📋 *Gastos por categoria:*\n`;
      for (const cb of catBreakdown) {
        const cat = cats.find((c: any) => c.id === (cb as any).categoryId);
        msg += `  • ${cat?.name ?? 'Sem categoria'}: ${fmt(Number((cb as any)._sum.amount ?? 0))}\n`;
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

    const where: any = { workspaceId: workspace.id, occurredAt: { gte: startOfMonth, lte: endOfMonth } };
    if (category) where.categoryId = category.id;

    const [agg, txs] = await Promise.all([
      prisma.transaction.aggregate({ where, _sum: { amount: true }, _count: true }),
      prisma.transaction.findMany({ where, orderBy: { occurredAt: 'desc' }, take: 10 }),
    ]);

    const total = Number(agg._sum.amount ?? 0);
    const monthName = now.toLocaleDateString('pt-BR', { month: 'long' });
    let msg = `📋 *${category?.name ?? filterName} em ${monthName}*\n\n`;
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
    await sendReply(
      `🤖 *Assistente Financeiro*\n\n` +
      `💸 *Registrar gasto*\n` +
      `  "250 gasolina"\n` +
      `  "45 almoço"\n\n` +
      `💳 *Gasto no crédito*\n` +
      `  "230 barbeiro crédito"\n\n` +
      `🏦 *Gasto no débito*\n` +
      `  "80 farmácia débito"\n\n` +
      `💰 *Registrar entrada*\n` +
      `  "recebi 5000 salário"\n\n` +
      `🛒 *Parcelamento*\n` +
      `  "200 em 6x tênis"\n\n` +
      `🔄 *Recorrente*\n` +
      `  "salário recorrente todo dia 5"\n\n` +
      `📌 *Evento futuro*\n` +
      `  "vou receber 13º em dezembro 2500"\n\n` +
      `🔮 *Simular compra*\n` +
      `  "posso comprar uma TV de 3600 em 12x?"\n\n` +
      `📈 *Projeção / futuro*\n` +
      `  "como vai estar meu saldo em setembro?"\n` +
      `  "saldo dos próximos 6 meses"\n` +
      `  "quanto posso gastar esse mês?"\n\n` +
      `📊 *Consultas*\n` +
      `  "quanto gastei esse mês?"\n` +
      `  "gastos com alimentação"\n` +
      `  "qual meu saldo?"`
    );
    return { success: true };
  }

  await sendReply(`🤔 Não entendi sua mensagem.\n\nDigite *ajuda* para ver os comandos disponíveis.`);
  return { success: false, message: 'Intent não reconhecido' };
}
