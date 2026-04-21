import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { groqChat } from '../lib/groqAI.js';
import * as XLSX from 'xlsx';

// Detecta se uma string parece uma data
function parseDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof val === 'number' && val > 1000) {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      return new Date(d.y, d.m - 1, d.d);
    } catch { return null; }
  }
  if (typeof val === 'string') {
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

function parseMoney(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  const s = String(val).replace(/[R$\s]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.abs(n);
}

// Fallback: detecção de colunas por regex (sem IA)
function detectColumns(headers: string[]) {
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
    amountCol: find([/valor|amount|value|total|debito|créd|credit|debit/]),
    typeCol: find([/tipo|type|natureza|operacao|operação/]),
    categoryCol: find([/categ/]),
    debitCol: find([/débito|debito/]),
    creditCol: find([/crédito|credito/]),
  };
}

function applyColMap(rows: any[][], colMap: ReturnType<typeof detectColumns>): any[] {
  const result: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c: any) => c === '' || c === null || c === undefined)) continue;

    const rawDate = colMap.dateCol >= 0 ? row[colMap.dateCol] : null;
    let rawAmount: any = colMap.amountCol >= 0 ? row[colMap.amountCol] : null;
    let rawType: any = colMap.typeCol >= 0 ? row[colMap.typeCol] : null;
    const rawDesc = colMap.descCol >= 0 ? row[colMap.descCol] : row.find((c: any) => typeof c === 'string' && c.length > 2);
    const rawCategory = colMap.categoryCol >= 0 ? row[colMap.categoryCol] : null;

    // Planilhas com colunas separadas de débito/crédito (ex: extrato bancário)
    let isIncome: boolean | null = null;
    if (colMap.debitCol >= 0 || colMap.creditCol >= 0) {
      const debitVal = colMap.debitCol >= 0 ? parseMoney(row[colMap.debitCol]) : null;
      const creditVal = colMap.creditCol >= 0 ? parseMoney(row[colMap.creditCol]) : null;
      if (creditVal && creditVal > 0) { rawAmount = creditVal; isIncome = true; }
      else if (debitVal && debitVal > 0) { rawAmount = debitVal; isIncome = false; }
    }

    const date = parseDate(rawDate);
    const amount = parseMoney(rawAmount);
    const description = String(rawDesc ?? '').trim();
    if (!amount || !description) continue;

    if (isIncome === null) {
      const typeStr = String(rawType ?? '').toLowerCase();
      isIncome = /entrada|receita|credit|crédito|c$/.test(typeStr) ||
        /salário|recebi|recebimento/i.test(description);
    }

    result.push({
      rowIndex: i,
      date: date ? date.toISOString().slice(0, 10) : null,
      description,
      amount,
      type: isIncome ? 'INCOME' : 'EXPENSE',
      category: String(rawCategory ?? '').trim() || null,
    });
  }
  return result;
}

/**
 * Analisa a planilha com Groq AI.
 * Envia cabeçalho + até 30 linhas de amostra.
 * Retorna linhas normalizadas + mapeamento de colunas.
 */
async function analyzeWithAI(headers: string[], sampleRows: any[][]): Promise<{
  rows: Array<{ rowIndex: number; date: string | null; description: string; amount: number; type: 'INCOME' | 'EXPENSE'; category: string | null }>;
  colMap: { dateCol: number; descCol: number; amountCol: number; typeCol: number; categoryCol: number; debitCol: number; creditCol: number };
  explanation: string;
}> {
  const sampleText = sampleRows
    .slice(0, 30)
    .map((row, i) => `Linha ${i + 1}: ${row.map((c: any) => String(c ?? '')).join(' | ')}`)
    .join('\n');

  const system = `Você é um especialista em análise de planilhas financeiras brasileiras.
Você receberá o cabeçalho e uma amostra de linhas de uma planilha (separadas por |).
Sua tarefa é:
1. Identificar qual coluna contém: data, descrição, valor, tipo (entrada/saída), categoria
2. Alguns extratos têm colunas separadas para débito e crédito
3. Normalizar as linhas da amostra para o formato padrão

Retorne APENAS JSON válido, sem markdown, com esta estrutura:
{
  "colMap": {
    "dateCol": número do índice (0-based) ou -1 se não encontrado,
    "descCol": número do índice ou -1,
    "amountCol": número do índice ou -1,
    "typeCol": número do índice ou -1,
    "categoryCol": número do índice ou -1,
    "debitCol": número do índice ou -1,
    "creditCol": número do índice ou -1
  },
  "rows": [
    {
      "rowIndex": número da linha original (começa em 1),
      "date": "YYYY-MM-DD" ou null,
      "description": "descrição limpa",
      "amount": número positivo,
      "type": "INCOME" ou "EXPENSE",
      "category": "nome sugerido" ou null
    }
  ],
  "explanation": "breve explicação de como interpretou a planilha"
}

REGRAS:
- Datas no formato dd/mm/aaaa, dd/mm/aa, ou número serial do Excel
- Valores: sempre positivos (o tipo determina entrada/saída)
- Se houver colunas separadas de débito e crédito: débito = EXPENSE, crédito = INCOME
- "salário", "recebimento", "crédito", "pix recebido" = INCOME
- Ignore linhas vazias, cabeçalhos extras, linhas de total/saldo
- Sugira categorias: Alimentação, Transporte, Saúde, Moradia, Educação, Lazer, Receita, etc.`;

  const user = `CABEÇALHO (${headers.length} colunas):
${headers.map((h, i) => `[${i}] ${h}`).join(' | ')}

AMOSTRA DE DADOS:
${sampleText}`;

  const raw = await groqChat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], 0.1, 4096);

  return JSON.parse(raw);
}

export async function importRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /**
   * POST /api/import/preview
   * Analisa a planilha com IA (Groq) e retorna preview normalizado.
   * Fallback para regex se IA falhar.
   */
  app.post('/api/import/preview', async (request, reply) => {
    const fileData = await request.file();
    if (!fileData) return reply.status(400).send({ error: 'Nenhum arquivo enviado.' });

    const buffer = await fileData.toBuffer();
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (allRows.length < 2) return reply.status(400).send({ error: 'Planilha sem dados suficientes.' });

    const headers = allRows[0].map((h: any) => String(h).trim());
    const dataRows = allRows.slice(1).filter(row => !row.every((c: any) => c === '' || c === null || c === undefined));

    let preview: any[] = [];
    let colMap: any = null;
    let aiExplanation: string | null = null;
    let usedAI = false;

    // Tenta análise com IA
    try {
      const aiResult = await analyzeWithAI(headers, dataRows);
      colMap = aiResult.colMap;
      aiExplanation = aiResult.explanation;
      usedAI = true;

      // Usa as linhas normalizadas pela IA para a amostra
      preview = aiResult.rows;

      // Para as linhas além das 30 da amostra, aplica o colMap encontrado pela IA
      if (dataRows.length > 30) {
        const remaining = applyColMap(
          [headers, ...dataRows.slice(30)],
          colMap,
        ).map(r => ({ ...r, rowIndex: r.rowIndex + 30 }));
        preview = [...preview, ...remaining];
      }
    } catch (err) {
      app.log.warn({ err }, 'IA falhou na análise da planilha, usando fallback regex');
      colMap = detectColumns(headers);
      preview = applyColMap(allRows, colMap);
    }

    return {
      headers,
      detectedColumns: colMap,
      totalRows: dataRows.length,
      preview: preview.slice(0, 20),
      previewCount: preview.length,
      allRows: preview, // frontend usa para confirmar
      usedAI,
      aiExplanation,
    };
  });

  /**
   * POST /api/import/confirm — salva os lançamentos confirmados
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
      })).min(1).max(1000),
    }).parse(request.body);

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

    if (body.accountId) {
      const incomeTotal = body.rows.filter(r => r.type === 'INCOME').reduce((s, r) => s + r.amount, 0);
      const expenseTotal = body.rows.filter(r => r.type === 'EXPENSE').reduce((s, r) => s + r.amount, 0);
      await prisma.account.update({
        where: { id: body.accountId },
        data: { balance: { increment: incomeTotal - expenseTotal } },
      });
    }

    return { success: true, imported: created.count };
  });
}

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
