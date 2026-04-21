import { groqChat } from './groqAI.js';
import { parseFinancialMessage } from './parseFinancialMessage.js';

export type MessageIntent =
  | 'register_transaction'
  | 'register_installment'
  | 'register_recurring'
  | 'query_summary'
  | 'query_category'
  | 'query_balance'
  | 'help'
  | 'unknown';

export interface ProcessedMessage {
  intent: MessageIntent;
  type: 'income' | 'expense';
  amount: number | null;
  description: string;
  category: string;
  installments: number | null;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | null;
  paymentMethod: 'debit' | 'credit' | null;
  creditCardHint: string | null;
  categoryFilter: string | null;
  period: string | null;
  aiResponse: string | null;
}

function buildSystemPrompt(
  categoryNames: string[],
  today: string,
  creditCards: { id: string; name: string }[],
): string {
  const cardsInfo = creditCards.length > 0
    ? creditCards.map(c => `- "${c.name}"`).join('\n')
    : '- Nenhum cartão cadastrado';

  return `Você é um assistente financeiro inteligente que interpreta mensagens do WhatsApp em português brasileiro.

DATA DE HOJE: ${today}

CATEGORIAS DISPONÍVEIS NO SISTEMA:
${categoryNames.length > 0 ? categoryNames.map(c => `- ${c}`).join('\n') : '- Nenhuma categoria cadastrada'}

CARTÕES DE CRÉDITO CADASTRADOS:
${cardsInfo}

Analise a mensagem do usuário e retorne APENAS um JSON (sem markdown, sem texto extra) com esta estrutura:

{
  "intent": "register_transaction" | "register_installment" | "register_recurring" | "query_summary" | "query_category" | "query_balance" | "help" | "unknown",
  "type": "income" | "expense",
  "amount": number | null,
  "description": "descrição curta do gasto/receita",
  "category": "nome da categoria mais adequada das disponíveis",
  "installments": number | null,
  "frequency": "MONTHLY" | "WEEKLY" | "DAILY" | "YEARLY" | null,
  "paymentMethod": "credit" | "debit" | null,
  "creditCardHint": "nome exato do cartão cadastrado que melhor corresponde" | null,
  "categoryFilter": "nome da categoria filtrada" | null,
  "period": "month" | "week" | "year" | null,
  "aiResponse": null
}

REGRAS DE CLASSIFICAÇÃO DE INTENT:

1. **register_transaction**: Registro simples de gasto ou receita.
   Exemplos: "250 gasolina", "recebi 5000 salário", "almocei 35", "uber 22", "r$ 150 mercado"

2. **register_installment**: Compra parcelada. Detecte padrões como "6x", "em 6 vezes", "12x67", "parcelado".
   Exemplos: "200 em 6x tênis", "12x67 celular", "notebook 3000 em 10x", "comprei um sofá 2400 em 8 vezes"

3. **register_recurring**: Gasto ou receita recorrente/fixo. Palavras-chave: "todo mês", "mensal", "fixo", "assinatura", "recorrente".
   Exemplos: "netflix todo mês 40", "academia mensal 100", "aluguel fixo 1500", "salário mensal 5000"

4. **query_summary**: Pergunta sobre resumo financeiro geral do período.
   Exemplos: "quanto gastei esse mês?", "resumo do mês", "como estão minhas finanças?", "gastos de abril"

5. **query_category**: Pergunta sobre gastos de uma categoria específica.
   Exemplos: "quanto gastei de alimentação?", "gastos com transporte", "quanto foi de gasolina esse mês?"
   → Preencha "categoryFilter" com o nome da categoria mais próxima das disponíveis.

6. **query_balance**: Pergunta sobre saldo.
   Exemplos: "qual meu saldo?", "quanto tenho na conta?", "saldo atual"

7. **help**: Pedido de ajuda ou dúvida sobre o bot.
   Exemplos: "o que você faz?", "ajuda", "como funciona?", "comandos"

8. **unknown**: Não se encaixa em nenhum intent acima. Mensagens irrelevantes.

REGRAS DE MEIO DE PAGAMENTO (paymentMethod):
- "crédito", "no crédito", "no cartão", "cartão de crédito" → paymentMethod = "credit"
- "débito", "no débito", "no cheque" → paymentMethod = "debit"
- Se mencionar qualquer cartão cadastrado → paymentMethod = "credit" automaticamente
- Se não mencionado → paymentMethod = null

REGRAS DE CARTÃO (creditCardHint):
- Compare o que o usuário disse com os CARTÕES CADASTRADOS acima e retorne o nome EXATO do cartão correspondente
- Use seu conhecimento de apelidos brasileiros de bancos e cartões:
  • "BB", "banco do brasil", "ourocard" → cartão com "Banco do Brasil" ou "BB" no nome
  • "roxinho", "nubank", "nu" → cartão com "Nubank" no nome
  • "laranjinha", "inter", "banco inter" → cartão com "Inter" no nome
  • "itaú", "itauzinho" → cartão com "Itaú" no nome
  • "brad", "bradesco", "next" → cartão com "Bradesco" ou "Next" no nome
  • "c6", "c6 bank" → cartão com "C6" no nome
  • "xp" → cartão com "XP" no nome
  • "santander" → cartão com "Santander" no nome
  • "caixa", "cef" → cartão com "Caixa" no nome
  • "avenue", "will", "wise" → cartões internacionais com esses nomes
- Se nenhum cartão cadastrado corresponder mas o usuário mencionou um cartão → retorne o apelido que o usuário usou
- Se não mencionou nenhum cartão → null

REGRAS DE VALOR POR SERVIÇO (amount):
- Se o usuário NÃO informar o valor mas mencionar um serviço de assinatura conhecido, use o seu melhor conhecimento sobre o preço atual no Brasil para aquele plano específico.
- Os preços de assinaturas mudam com frequência. Se não tiver certeza do valor exato para o plano mencionado → deixe amount = null e o usuário informará manualmente.
- Prefira deixar amount = null a colocar um valor errado.

REGRAS DE CATEGORIZAÇÃO:
- Gasolina, combustível, uber, 99, ônibus, metrô → Transporte
- Mercado, supermercado, padaria, ifood, lanche, restaurante, almoço, jantar, café → Alimentação
- Barbeiro, salão, beleza, academia, farmácia → Pessoal
- Salário, freela, freelance, venda, pix recebido → Receita
- Netflix, spotify, youtube, disney, streaming → Assinatura/Entretenimento
- Aluguel, condomínio, luz, água, internet, celular → Moradia
- Escola, curso, livro, faculdade → Educação
- Médico, dentista, exame, consulta → Saúde
- Se a categoria existe nas CATEGORIAS DISPONÍVEIS, use exatamente o nome de lá.
- Se não existe nenhuma compatível, sugira o nome mais adequado.

REGRAS GERAIS:
- Valores com vírgula (ex: "25,90") são decimais brasileiros → interprete como 25.90
- "recebi", "salário", "entrada", "ganhei", "venda" → type = "income"
- Todo o resto → type = "expense"
- Para installments, o amount é o valor TOTAL (não da parcela). Se o user diz "12x67", amount=804, installments=12
- Para recurring, frequency geralmente é "MONTHLY" salvo indicação contrária
- Para queries, amount/description/category podem ser null`;
}

export async function processWhatsAppMessage(
  text: string,
  categoryNames: string[],
  creditCards: { id: string; name: string }[] = [],
): Promise<ProcessedMessage> {
  const today = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  try {
    const raw = await groqChat([
      { role: 'system', content: buildSystemPrompt(categoryNames, today, creditCards) },
      { role: 'user', content: text },
    ]);

    const parsed = JSON.parse(raw) as ProcessedMessage;

    // Garante campos obrigatórios
    if (!parsed.intent) parsed.intent = 'unknown';
    if (!parsed.type) parsed.type = 'expense';
    if (!parsed.description) parsed.description = text;
    if (!parsed.category) parsed.category = 'Geral';
    if (!parsed.paymentMethod) parsed.paymentMethod = null;
    if (!parsed.creditCardHint) parsed.creditCardHint = null;
    parsed.aiResponse = null;

    return parsed;
  } catch (err) {
    console.error('[processMessage] Groq falhou, usando fallback regex:', (err as Error).message);

    // Fallback para o parser regex
    const fallback = parseFinancialMessage(text);
    return {
      intent: fallback.success ? 'register_transaction' : 'unknown',
      type: fallback.type,
      amount: fallback.amount,
      description: fallback.description,
      category: fallback.category,
      installments: null,
      frequency: null,
      paymentMethod: fallback.paymentMethod,
      creditCardHint: null,
      categoryFilter: null,
      period: null,
      aiResponse: null,
    };
  }
}
