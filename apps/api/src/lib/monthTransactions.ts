import { prisma } from './prisma.js';

/**
 * Retorna as transações que "pertencem" ao mês [start, end] com o critério do app:
 *  - não-crédito (débito, sem meio de pagamento, ausente ou null): pela data do
 *    lançamento (occurredAt);
 *  - crédito: pelo vencimento da fatura (dueDate).
 *
 * Por que não filtrar paymentMethod direto na query: no Prisma + MongoDB, tanto
 * `{ paymentMethod: { not: 'credit' } }` quanto `{ paymentMethod: null }` NÃO
 * casam com documentos onde o campo está AUSENTE (gasto lançado com "Meio de
 * pagamento: Nenhum"). Isso fazia esses lançamentos sumirem de todos os gráficos.
 * Aqui buscamos por data e separamos em JS (`!== 'credit'`), que trata ausente,
 * null e débito corretamente.
 */
export async function transactionsForMonth(
  workspaceId: string,
  start: Date,
  end: Date,
  include?: Record<string, unknown>,
): Promise<any[]> {
  const [byOccurred, credit] = await Promise.all([
    prisma.transaction.findMany({
      where: { workspaceId, occurredAt: { gte: start, lte: end } },
      ...(include ? { include } : {}),
    }),
    prisma.transaction.findMany({
      where: { workspaceId, paymentMethod: 'credit', dueDate: { gte: start, lte: end } },
      ...(include ? { include } : {}),
    }),
  ]);

  // Não-crédito conta pela data do lançamento; crédito (qualquer occurredAt) é
  // descartado aqui e recontado pela dueDate, evitando duplicar.
  const nonCredit = byOccurred.filter((t: any) => t.paymentMethod !== 'credit');
  return [...nonCredit, ...credit];
}
