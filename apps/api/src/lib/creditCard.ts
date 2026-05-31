/**
 * Lógica de ciclo de fatura de cartão de crédito (modelo brasileiro):
 *  - a fatura FECHA no dia `closingDay`
 *  - a fatura VENCE no dia `billingDay`
 *  - compras feitas até o fechamento entram na fatura que vence no próximo vencimento;
 *    compras após o fechamento já caem na fatura seguinte.
 */

export interface CardCycleInput {
  closingDay: number;
  billingDay: number;
}

/** Garante um dia válido dentro do mês (ex.: dia 31 em fevereiro vira o último dia). */
function clampDay(year: number, monthIndex: number, day: number): number {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(Math.max(day, 1), last);
}

function makeDate(year: number, monthIndex: number, day: number, endOfDay = false): Date {
  // new Date normaliza overflow/underflow de mês automaticamente
  const ref = new Date(year, monthIndex, 1);
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const d = clampDay(y, m, day);
  return endOfDay ? new Date(y, m, d, 23, 59, 59, 999) : new Date(y, m, d);
}

/**
 * Em qual fatura uma COMPRA cai e quando ela vence.
 * Retorna o dia de fechamento dessa fatura e o vencimento.
 */
export function invoiceForPurchase(card: CardCycleInput, purchaseDate: Date): {
  closingDate: Date;
  dueDate: Date;
  invoiceYear: number;
  invoiceMonth: number; // 1-12, mês do fechamento
} {
  const purchaseDay = purchaseDate.getDate();
  let closeY = purchaseDate.getFullYear();
  let closeM = purchaseDate.getMonth();

  // Se a compra foi feita DEPOIS do fechamento deste mês, vai para a próxima fatura.
  if (purchaseDay > card.closingDay) closeM += 1;

  const closingDate = makeDate(closeY, closeM, card.closingDay, true);

  // Vencimento: normalmente alguns dias após o fechamento. Se o dia de vencimento
  // for <= dia de fechamento, o vencimento cai no mês seguinte ao fechamento.
  let dueM = closingDate.getMonth();
  const dueY = closingDate.getFullYear();
  if (card.billingDay <= card.closingDay) dueM += 1;
  const dueDate = makeDate(dueY, dueM, card.billingDay);

  return {
    closingDate,
    dueDate,
    invoiceYear: closingDate.getFullYear(),
    invoiceMonth: closingDate.getMonth() + 1,
  };
}

/**
 * Janela de uma fatura identificada por (ano, mês-do-fechamento).
 * Cobre do dia seguinte ao fechamento anterior até o fechamento deste mês.
 */
export function billWindow(card: CardCycleInput, year: number, month1to12: number): {
  start: Date;
  end: Date;
  dueDate: Date;
} {
  const m = month1to12 - 1;
  const start = makeDate(year, m - 1, card.closingDay + 1, false);
  const end = makeDate(year, m, card.closingDay, true);

  let dueM = m;
  if (card.billingDay <= card.closingDay) dueM += 1;
  const dueDate = makeDate(year, dueM, card.billingDay);

  return { start, end, dueDate };
}

/**
 * Identifica a fatura "pagável" no momento: a última que já FECHOU em relação à data ref.
 * É a que o usuário normalmente quer pagar ao dizer "paguei o cartão".
 */
export function currentPayableInvoice(card: CardCycleInput, ref = new Date()): {
  year: number;
  month: number; // 1-12 (mês do fechamento)
} {
  let y = ref.getFullYear();
  let m = ref.getMonth();
  const thisClosing = makeDate(y, m, card.closingDay, true);
  // Se ainda não fechou neste mês, a fatura pagável é a que fechou no mês anterior.
  if (ref <= thisClosing) m -= 1;
  const d = new Date(y, m, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/**
 * Janela de fatura pelo mês de VENCIMENTO (pagamento).
 * Ex: se vence dia 10/07, o usuário navega para "Julho" e vê as compras que fecharam em Junho.
 */
export function billWindowByDueMonth(card: CardCycleInput, dueYear: number, dueMonth1to12: number): {
  start: Date;
  end: Date;
  dueDate: Date;
} {
  let closeYear = dueYear;
  let closeMonth1to12: number;

  if (card.billingDay <= card.closingDay) {
    // vencimento é no mês SEGUINTE ao fechamento → fechamento = mês anterior ao vencimento
    closeMonth1to12 = dueMonth1to12 - 1;
    if (closeMonth1to12 < 1) { closeMonth1to12 = 12; closeYear -= 1; }
  } else {
    // vencimento é no MESMO mês do fechamento
    closeMonth1to12 = dueMonth1to12;
  }

  return billWindow(card, closeYear, closeMonth1to12);
}

/**
 * Em qual fatura uma compra feita HOJE cairia — e quando ela vence.
 * Usa invoiceForPurchase para calcular corretamente com base no closingDay.
 * Ex.: BB (fecha dia 30, vence dia 10) — hoje 31/mai → fatura de jul/10.
 */
export function nextUpcomingDueMonth(card: CardCycleInput, ref = new Date()): {
  year: number;
  month: number; // 1-12, mês do VENCIMENTO
  dueDate: Date;
} {
  const { dueDate } = invoiceForPurchase(card, ref);
  return { year: dueDate.getFullYear(), month: dueDate.getMonth() + 1, dueDate };
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
