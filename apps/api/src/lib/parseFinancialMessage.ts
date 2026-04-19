type ParsedTransaction = {
  success: boolean;
  type: 'income' | 'expense';
  amount: number | null;
  description: string;
  category: string;
};

const categoryRules = [
  { test: /gasolina|combust|uber|99|onibus|ônibus|metro|metrô/i, category: 'Transporte' },
  { test: /mercado|supermercado|padaria|ifood|lanche|restaurante/i, category: 'Alimentação' },
  { test: /barbeiro|sal[aã]o|beleza|academia/i, category: 'Pessoal' },
  { test: /sal[aá]rio|freela|recebi|pix recebido|venda/i, category: 'Receita' },
];

export function parseFinancialMessage(text: string): ParsedTransaction {
  const cleanText = text.trim();
  const normalized = cleanText.replace(',', '.');
  const match = normalized.match(/^\s*(?:r\$\s*)?(\d+(?:\.\d{1,2})?)\s+(.+)$/i);

  if (!match) {
    return {
      success: false,
      type: 'expense',
      amount: null,
      description: cleanText,
      category: 'Sem categoria',
    };
  }

  const amount = Number(match[1]);
  const description = match[2].trim();
  const type = /sal[aá]rio|recebi|entrada|ganhei|venda/i.test(description) ? 'income' : 'expense';
  const category = categoryRules.find((rule) => rule.test.test(description))?.category ?? (type === 'income' ? 'Receita' : 'Geral');

  return {
    success: true,
    type,
    amount,
    description,
    category,
  };
}
