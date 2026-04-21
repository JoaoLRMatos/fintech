import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import * as XLSX from 'xlsx';

// Detecta se uma string parece uma data
function parseDate(val: unknown): Date | null {
  if (!val) return null;
  // Excel serial number
  if (typeof val === 'number' && val > 1000) {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      return new Date(d.y, d.m - 1, d.d);
    } catch { return null; }
  }
  if (typeof val === 'string') {
    // dd/mm/yyyy ou dd/mm/yy
    const br = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (br) {
      const [, d, m, y] = br;
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      return new Date(year, Number(m) - 1, Number(d));
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Normaliza um valor de moeda para número
function parseMoney(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  const s = String(val).replace(/[R$\s]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.abs(n);
}

// Tenta detectar qual coluna é o quê baseado nos headers
function detectColumns(headers: string[]): {
  dateCol: number;
  descCol: number;
  amountCol: number;
  typeCol: number;
  categoryCol: number;
} {
  const lower = headers.map(h => String(h).toLowerCase().trim());

  const find = (patterns: RegExp[]) => {
    for (const p of patterns) {
      const i = lower.findIndex(h => p.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };

  return {
    dateCol: find([/data|date|dia|vencimento/]),
    descCol: find([/descri|histor|memo|estabelecimento|lancamento|lançamento|titulo|título/]),
    amountCol: find([/valor|amount|value|total|debito|crédito|credit|debit/]),
    typeCol: find([/tipo|type|natureza|operacao|operação/]),
    categoryCol: find([/categ/]),
  };
}

export async function importRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /**
   * POST /api/import/preview — recebe arquivo, retorna preview das linhas
   * Content-Type: multipart/form-data
   * field: file (xlsx/csv)
   */
  app.post('/api/import/preview', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'Nenhum arquivo enviado.' });

    const buffer = await data.toBuffer();
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) return reply.status(400).send({ error: 'Planilha sem dados suficientes.' });

    const headers = rows[0].map((h: any) => String(h).trim());
    const cols = detectColumns(headers);
    const preview: any[] = [];

    for (let i = 1; i < Math.min(rows.length, 201); i++) {
      const row = rows[i];
      if (row.every((c: any) => c === '' || c === null || c === undefined)) continue;

      const rawDate = cols.dateCol >= 0 ? row[cols.dateCol] : null;
      const rawDesc = cols.descCol >= 0 ? row[cols.descCol] : row.find((c: any) => typeof c === 'string' && c.length > 2);
      const rawAmount = cols.amountCol >= 0 ? row[cols.amountCol] : null;
      const rawType = cols.typeCol >= 0 ? row[cols.typeCol] : null;
      const rawCategory = cols.categoryCol >= 0 ? row[cols.categoryCol] : null;

      const date = parseDate(rawDate);
      const amount = parseMoney(rawAmount);
      const description = String(rawDesc ?? '').trim();

      if (!amount || !description) continue;

      // Tenta inferir se é entrada ou saída
      const typeStr = String(rawType ?? '').toLowerCase();
      const isIncome = /entrada|receita|credit|crédito|c$/.test(typeStr) ||
        /salário|recebi|recebimento/i.test(description);

      preview.push({
        rowIndex: i,
        date: date ? date.toISOString().slice(0, 10) : null,
        description,
        amount,
        type: isIncome ? 'INCOME' : 'EXPENSE',
        category: String(rawCategory ?? '').trim() || null,
        raw: row,
      });
    }

    return {
      headers,
      detectedColumns: cols,
      totalRows: rows.length - 1,
      preview: preview.slice(0, 20),
      previewCount: preview.length,
    };
  });

  /**
   * POST /api/import/confirm — recebe as linhas formatadas e salva
   */
  app.post('/api/import/confirm', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const body = z.object({
      accountId: z.string().optional(),
      rows: z.array(z.object({
        date: z.string().nullable(),
        description: z.string(),
        amount: z.number().positive(),
        type: z.enum(['INCOME', 'EXPENSE']),
        category: z.string().nullable().optional(),
      })).min(1).max(500),
    }).parse(request.body);

    // Carrega categorias do workspace para fazer match
    const categories = await prisma.category.findMany({ where: { workspaceId } });

    const findCategory = (name: string | null | undefined) => {
      if (!name) return undefined;
      const n = name.toLowerCase();
      return categories.find(c => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase()));
    };

    const transactions = body.rows.map(row => ({
      type: row.type,
      amount: row.amount,
      description: row.description,
      occurredAt: row.date ? new Date(row.date) : new Date(),
      source: 'import',
      workspaceId,
      accountId: body.accountId ?? undefined,
      categoryId: findCategory(row.category)?.id ?? undefined,
    }));

    const created = await prisma.transaction.createMany({ data: transactions });

    // Atualiza saldo da conta se fornecida
    if (body.accountId) {
      const incomeTotal = body.rows
        .filter(r => r.type === 'INCOME')
        .reduce((s, r) => s + r.amount, 0);
      const expenseTotal = body.rows
        .filter(r => r.type === 'EXPENSE')
        .reduce((s, r) => s + r.amount, 0);
      const delta = incomeTotal - expenseTotal;
      await prisma.account.update({
        where: { id: body.accountId },
        data: { balance: { increment: delta } },
      });
    }

    return { success: true, imported: created.count };
  });
}
