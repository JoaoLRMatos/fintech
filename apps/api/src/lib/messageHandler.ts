import { randomUUID } from 'crypto';
import { prisma } from './prisma.js';
import { processWhatsAppMessage } from './processMessage.js';
import { projectMonths, simulatePurchase } from './projectionEngine.js';
import { computeSafeToSpend } from './insightsEngine.js';
import { invoiceForPurchase, fmtDate } from './creditCard.js';

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

/**
 * Resolve a data do lançamento a partir do ISO "YYYY-MM-DD" que a IA extraiu
 * ("ontem", "dia 28"...). Usa meio-dia local para evitar problemas de fuso.
 * Sem data → agora. Datas futuras absurdas (> hoje) são aceitas mas raras.
 */
function resolveOccurredAt(iso: string | null): Date {
  if (!iso) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return new Date();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isNaN(d.getTime()) ? new Date() : d;
}

/** True se a data não é de hoje (lançamento retroativo/futuro). */
function isDifferentDay(d: Date, ref = new Date()): boolean {
  return d.getFullYear() !== ref.getFullYear() || d.getMonth() !== ref.getMonth() || d.getDate() !== ref.getDate();
}

/** Quantas vezes uma regra recorrente dispara dentro de [start, end]. */
function recurrenceCountInMonth(rule: any, start: Date, end: Date): number {
  const adv = (x: Date) => {
    const n = new Date(x);
    if (rule.frequency === 'DAILY') n.setDate(n.getDate() + 1);
    else if (rule.frequency === 'WEEKLY') n.setDate(n.getDate() + 7);
    else if (rule.frequency === 'YEARLY') n.setFullYear(n.getFullYear() + 1);
    else n.setMonth(n.getMonth() + 1);
    return n;
  };
  let d = new Date(rule.nextDueDate);
  let guard = 0;
  while (d < start && guard < 5000) { d = adv(d); guard++; }
  let c = 0;
  while (d <= end && guard < 5000) {
    if (rule.endDate && d > new Date(rule.endDate)) break;
    c++; d = adv(d); guard++;
  }
  return c;
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
    const occurredAt = resolveOccurredAt(parsed.occurredAt); // data informada ("ontem") ou hoje

    let dueDate: Date | null = null;
    let closingDate: Date | null = null;
    let creditCardId: string | null = null;
    if (isCredit && matchedCard) {
      // Usa a DATA DA COMPRA (pode ser retroativa) para decidir em qual fatura cai.
      const cycle = invoiceForPurchase(matchedCard, occurredAt);
      dueDate = cycle.dueDate;
      closingDate = cycle.closingDate;
      creditCardId = matchedCard.id;
    } else if (isCredit) {
      dueDate = new Date(occurredAt.getFullYear(), occurredAt.getMonth() + 1, 10);
    }

    const tx = await prisma.transaction.create({
      data: {
        type: txType,
        amount: parsed.amount,
        description: parsed.description,
        occurredAt,
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
    if (isDifferentDay(occurredAt)) {
      msg += `\n📆 Lançado em ${fmtDate(occurredAt)}`;
    }
    if (isCredit) {
      const cardName = matchedCard?.name ?? parsed.creditCardHint ?? 'cartão';
      if (matchedCard && closingDate && dueDate) {
        msg += `\n💳 *${cardName}*`;
        msg += `\n🔒 Entra na fatura que fecha em ${fmtDate(closingDate)}`;
        msg += `\n📅 Vencimento: ${fmtDate(dueDate)}`;
      } else {
        const venc = dueDate ? dueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) : 'dia 10 do próximo mês';
        msg += `\n💳 Fatura: ${cardName} — vencimento: ${venc}`;
        msg += `\n💡 Dica: cadastre o cartão (com dia de fechamento e vencimento) para o controle automático da fatura.`;
      }
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
    const baseDate = resolveOccurredAt(parsed.occurredAt); // 1ª parcela na data informada (ou hoje)
    const txs = [];

    for (let i = 0; i < parsed.installments; i++) {
      const date = new Date(baseDate);
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

  // ── INTENT: pay_invoice ("paguei o cartão BB") ──
  if (parsed.intent === 'pay_invoice') {
    const card = findCreditCard();
    if (!card) {
      await sendReply('❌ Não identifiquei o cartão. Cadastre seus cartões e tente: "paguei o cartão BB".');
      return { success: false };
    }
    // Busca todas as despesas do cartão e filtra "não pagas" em JS
    // (Prisma+MongoDB não casa paidAt:null com campo ausente).
    const all = await prisma.transaction.findMany({
      where: { workspaceId: workspace.id, creditCardId: card.id, type: 'EXPENSE' },
    });
    const unpaid: any[] = all.filter((t: any) => !t.paidAt && t.dueDate);

    if (unpaid.length === 0) {
      await sendReply(`✅ Nenhuma fatura em aberto no *${card.name}*.`);
      return { success: true, paid: 0 };
    }

    // Paga a fatura mais próxima (menor data de vencimento em aberto)
    unpaid.sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    const firstDue = new Date(unpaid[0].dueDate);
    const invoice = unpaid.filter((t: any) => {
      const d = new Date(t.dueDate);
      return d.getFullYear() === firstDue.getFullYear() && d.getMonth() === firstDue.getMonth();
    });

    const total = invoice.reduce((s: number, t: any) => s + Number(t.amount), 0);
    await prisma.transaction.updateMany({
      where: { id: { in: invoice.map((t: any) => t.id) } },
      data: { paidAt: new Date() },
    });
    if (account) {
      await prisma.account.update({ where: { id: account.id }, data: { balance: { increment: -total } } });
    }

    await sendReply(
      `✅ Fatura do *${card.name}* paga!\n` +
      `💰 Total: ${fmt(total)} (${invoice.length} ${invoice.length === 1 ? 'lançamento' : 'lançamentos'})\n` +
      `📅 Vencimento: ${fmtDate(firstDue)}\n` +
      `🏦 Saldo da conta atualizado.`
    );
    return { success: true, paid: total };
  }

  // ── INTENT: delete_transaction ("exclui o lanche de 40 de ontem") ──
  if (parsed.intent === 'delete_transaction') {
    const since = new Date();
    since.setDate(since.getDate() - 120);
    const candidates = await prisma.transaction.findMany({
      where: { workspaceId: workspace.id, occurredAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });

    if (candidates.length === 0) {
      await sendReply('🤷 Não há lançamentos recentes para excluir.');
      return { success: false };
    }

    // "último/última" → remove o mais recente (opcionalmente filtrando por descrição)
    const wantsLast = /\bultim|\búltim/i.test(text);
    const wantAmount = parsed.amount;
    const rawDesc = (parsed.description || '').toLowerCase().trim();
    const STOP = ['ultimo', 'último', 'ultima', 'última', 'last', 'lançamento', 'lancamento', 'gasto', 'transação', 'transacao'];
    const wantDesc = STOP.includes(rawDesc) ? '' : rawDesc;
    const wantDay = parsed.occurredAt ? resolveOccurredAt(parsed.occurredAt) : null;

    let best: any = null;
    if (wantsLast && wantAmount == null) {
      const pool = (wantDesc && wantDesc.length >= 3)
        ? candidates.filter((t: any) => t.description.toLowerCase().includes(wantDesc))
        : candidates;
      best = pool[0] ?? candidates[0]; // candidates já vem por createdAt desc
    } else {
      let bestScore = 0;
      for (const t of candidates) {
        let score = 0;
        if (wantAmount != null && Math.abs(Number(t.amount) - wantAmount) < 0.01) score += 2;
        if (wantDesc && wantDesc.length >= 3 && t.description.toLowerCase().includes(wantDesc)) score += 2;
        if (wantDay && !isDifferentDay(t.occurredAt, wantDay)) score += 1;
        if (score > bestScore) { bestScore = score; best = t; }
      }
      if (bestScore < 2) best = null; // sem match confiável, não arrisca excluir errado
    }

    if (!best) {
      let msg = `🤔 Não achei com certeza qual excluir. Seja específico (valor + descrição), ex.: "exclui o lanche de 40".\n\nÚltimos lançamentos:\n`;
      for (const t of candidates.slice(0, 6)) {
        const d = t.occurredAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        msg += `• ${d} — ${t.description}: ${fmt(Number(t.amount))}\n`;
      }
      await sendReply(msg);
      return { success: false };
    }

    // Reverte o saldo se o lançamento havia impactado a conta (crédito não impacta até pagar)
    if (best.accountId && account && best.id) {
      const reverse = best.type === 'INCOME' ? -Number(best.amount) : Number(best.amount);
      await prisma.account.update({ where: { id: best.accountId }, data: { balance: { increment: reverse } } });
    }
    await prisma.transaction.delete({ where: { id: best.id } });

    const d = best.occurredAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    let msg = `🗑️ Excluído: ${best.description} — ${fmt(Number(best.amount))} (${d})`;
    if (best.installmentGroup) msg += `\n⚠️ Era uma parcela. As outras parcelas continuam — me diga se quer excluir todas.`;
    if (best.accountId) msg += `\n🏦 Saldo da conta ajustado.`;
    await sendReply(msg);
    return { success: true, deleted: best.id };
  }

  // ── INTENT: query_recent (últimos lançamentos) ──
  if (parsed.intent === 'query_recent') {
    const txs = await prisma.transaction.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { occurredAt: 'desc' },
      take: 10,
      include: { category: true },
    });
    if (txs.length === 0) {
      await sendReply('📭 Nenhum lançamento ainda.');
      return { success: true };
    }
    let msg = `🧾 *Últimos lançamentos*\n\n`;
    for (const t of txs) {
      const d = t.occurredAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const sign = t.type === 'INCOME' ? '➕' : '➖';
      const cat = (t as any).category?.name ? ` · ${(t as any).category.name}` : '';
      msg += `${sign} ${d} — ${t.description}: ${fmt(Number(t.amount))}${cat}\n`;
    }
    await sendReply(msg);
    return { success: true, count: txs.length };
  }

  // ── INTENT: query_payments (o que tenho a pagar em tal mês) ──
  if (parsed.intent === 'query_payments') {
    const now = new Date();
    const ahead = parsed.targetMonth ? monthsUntil(parsed.targetMonth, now) : 1; // default "mês que vem"
    const target = new Date(now.getFullYear(), now.getMonth() + ahead, 1);
    const year = target.getFullYear();
    const m0 = target.getMonth();
    const start = new Date(year, m0, 1);
    const end = new Date(year, m0 + 1, 0, 23, 59, 59, 999);
    const monthLabel = `${MONTH_NAMES[m0]}/${year}`;

    // 1) Faturas de cartão que vencem nesse mês (ainda não pagas)
    // Filtra paidAt em JS — Prisma+MongoDB não casa paidAt:null com campo ausente.
    const creditTxRaw = await prisma.transaction.findMany({
      where: { workspaceId: workspace.id, creditCardId: { not: null }, dueDate: { gte: start, lte: end } },
    });
    const byCard = new Map<string, number>();
    for (const t of creditTxRaw) {
      if (t.paidAt) continue;          // já paga
      if (t.type !== 'EXPENSE') continue; // só o que se paga (ignora estorno/crédito)
      const k = t.creditCardId as string;
      byCard.set(k, (byCard.get(k) ?? 0) + Number(t.amount));
    }

    // 2) Recorrentes: receita entra na base (p/ dízimo) e despesas vão para a lista
    const rules = await prisma.recurringRule.findMany({ where: { workspaceId: workspace.id, active: true } });
    let incomeBase = 0;
    const recExpenses: { desc: string; amount: number }[] = [];
    for (const r of rules) {
      const n = recurrenceCountInMonth(r, start, end);
      if (n === 0) continue;
      const total = Number(r.amount) * n;
      if (r.type === 'INCOME') incomeBase += total;
      else recExpenses.push({ desc: r.description, amount: total });
    }

    // 3) Eventos pontuais do mês
    const events = await prisma.plannedEvent.findMany({
      where: { workspaceId: workspace.id, realized: false, expectedAt: { gte: start, lte: end } },
    });
    const eventExpenses: { desc: string; amount: number }[] = [];
    for (const e of events) {
      if (e.type === 'INCOME') incomeBase += Number(e.amount);
      else eventExpenses.push({ desc: e.description, amount: Number(e.amount) });
    }

    // 4) Proporcionais à renda (ex.: dízimo = 10% da renda do mês)
    const proRules = await prisma.proportionalRule.findMany({ where: { workspaceId: workspace.id, active: true } });
    const proExpenses = proRules.map((p: any) => ({
      desc: `${p.description} (${Math.round(Number(p.percent) * 100)}%)`,
      amount: Number(p.percent) * incomeBase,
    }));

    // 5) Parcelas (não-crédito) que caem no mês e ainda não foram pagas
    const installmentTxRaw = await prisma.transaction.findMany({
      where: { workspaceId: workspace.id, type: 'EXPENSE', creditCardId: null, installmentGroup: { not: null }, occurredAt: { gte: start, lte: end } },
    });
    const installmentTx = installmentTxRaw.filter((t: any) => !t.paidAt);

    let total = 0;
    let msg = `📅 *A pagar em ${monthLabel}*\n`;

    if (byCard.size > 0) {
      msg += `\n💳 *Faturas de cartão:*\n`;
      for (const [cardId, amount] of byCard) {
        const card = creditCards.find((c: any) => c.id === cardId);
        const venc = card ? ` (vence dia ${card.billingDay})` : '';
        msg += `  • ${card?.name ?? 'Cartão'}: ${fmt(amount)}${venc}\n`;
        total += amount;
      }
    }

    if (recExpenses.length > 0 || proExpenses.length > 0) {
      msg += `\n🔄 *Recorrentes/fixos:*\n`;
      for (const r of recExpenses) { msg += `  • ${r.desc}: ${fmt(r.amount)}\n`; total += r.amount; }
      for (const p of proExpenses) { msg += `  • ${p.desc}: ${fmt(p.amount)}\n`; total += p.amount; }
    }

    if (installmentTx.length > 0) {
      msg += `\n🛒 *Parcelas:*\n`;
      for (const t of installmentTx) { msg += `  • ${t.description}: ${fmt(Number(t.amount))}\n`; total += Number(t.amount); }
    }

    if (eventExpenses.length > 0) {
      msg += `\n📌 *Outros:*\n`;
      for (const e of eventExpenses) { msg += `  • ${e.desc}: ${fmt(e.amount)}\n`; total += e.amount; }
    }

    if (total === 0) {
      await sendReply(`📅 *${monthLabel}*\n\n🎉 Nada previsto a pagar nesse mês.`);
      return { success: true, total: 0 };
    }

    msg += `\n💰 *Total a pagar: ${fmt(total)}*`;
    await sendReply(msg);
    return { success: true, total };
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
      `  "22 no crédito no cartão do banco do brasil"\n` +
      `  → mostra em qual fatura caiu e o vencimento\n\n` +
      `🧾 *Paguei a fatura*\n` +
      `  "paguei o cartão BB"\n\n` +
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
      `📆 *Lançar com data*\n` +
      `  "40 lanche ontem"\n` +
      `  "150 mercado dia 28 no crédito do BB"\n\n` +
      `🗑️ *Excluir*\n` +
      `  "exclui o lanche de 40"\n` +
      `  "remove o último lançamento"\n\n` +
      `🧾 *Últimos lançamentos*\n` +
      `  "o que registrei essa semana?"\n\n` +
      `💸 *O que tenho a pagar*\n` +
      `  "quanto tenho que pagar mês que vem?"\n` +
      `  "o que vence em junho?"\n\n` +
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
