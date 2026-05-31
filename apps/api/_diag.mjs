import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();

function d(x) { return x ? new Date(x).toISOString().slice(0, 10) : null; }

const ws = await prisma.workspace.findFirst();
console.log('WORKSPACE:', ws?.id, ws?.name);
const wsId = ws.id;

const cards = await prisma.creditCard.findMany({ where: { workspaceId: wsId } });
console.log('\n=== CARTÕES ===');
for (const c of cards) console.log(`- ${c.name} | id=${c.id} | fecha dia ${c.closingDay} | vence dia ${c.billingDay}`);

const rules = await prisma.recurringRule.findMany({ where: { workspaceId: wsId } });
console.log('\n=== RECORRENTES ===', rules.length);
for (const r of rules) console.log(`- ${r.description} | ${r.type} | R$${r.amount} | freq=${r.frequency} | next=${d(r.nextDueDate)} | active=${r.active}`);

const pro = await prisma.proportionalRule.findMany({ where: { workspaceId: wsId } });
console.log('\n=== PROPORCIONAIS (dízimo) ===', pro.length);
for (const p of pro) console.log(`- ${p.description} | ${(p.percent*100)}% | active=${p.active}`);

const events = await prisma.plannedEvent.findMany({ where: { workspaceId: wsId } });
console.log('\n=== EVENTOS PONTUAIS ===', events.length);
for (const e of events) console.log(`- ${e.description} | ${e.type} | R$${e.amount} | em ${d(e.expectedAt)} | realized=${e.realized}`);

const creditTx = await prisma.transaction.findMany({
  where: { workspaceId: wsId, creditCardId: { not: null } },
  orderBy: { occurredAt: 'desc' }, take: 30,
});
console.log('\n=== TRANSAÇÕES COM creditCardId ===', creditTx.length);
for (const t of creditTx) console.log(`- ${t.description} | R$${t.amount} | occurred=${d(t.occurredAt)} | due=${d(t.dueDate)} | card=${t.creditCardId} | paid=${d(t.paidAt)}`);

const allTx = await prisma.transaction.findMany({ where: { workspaceId: wsId }, orderBy: { occurredAt: 'desc' }, take: 30 });
console.log('\n=== ÚLTIMAS 30 TRANSAÇÕES (todas) ===', allTx.length);
for (const t of allTx) console.log(`- ${t.description} | ${t.type} | R$${t.amount} | occurred=${d(t.occurredAt)} | due=${d(t.dueDate)} | pay=${t.paymentMethod} | card=${t.creditCardId ?? '-'} | instGroup=${t.installmentGroup ?? '-'} | paidAt=${d(t.paidAt)}`);

await prisma.$disconnect();
