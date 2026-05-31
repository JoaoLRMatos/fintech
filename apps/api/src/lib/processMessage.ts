import { groqChat } from './groqAI.js';
import { parseFinancialMessage } from './parseFinancialMessage.js';

export type MessageIntent =
  | 'register_transaction'
  | 'register_installment'
  | 'register_recurring'
  | 'register_planned_event'
  | 'simulate_purchase'
  | 'pay_invoice'
  | 'delete_transaction'
  | 'query_summary'
  | 'query_category'
  | 'query_balance'
  | 'query_projection'
  | 'query_safe_to_spend'
  | 'query_recent'
  | 'query_payments'
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
  dayOfMonth: number | null; // "salário todo dia 5" → 5
  targetMonth: number | null; // mês-alvo 1-12 ("em setembro", "13º em dezembro")
  horizonMonths: number | null; // "próximos 6 meses" → 6
  occurredAt: string | null; // data do lançamento (ISO YYYY-MM-DD) p/ lançamentos retroativos ("ontem", "dia 28")
  aiResponse: string | null;
}

function buildSystemPrompt(
  categoryNames: string[],
  today: string,
  creditCards: { id: string; name: string }[],
  todayISO: string,
): string {
  const cardsInfo = creditCards.length > 0
    ? creditCards.map(c => `- "${c.name}"`).join('\n')
    : '- Nenhum cartão cadastrado';

  return `Você é um assistente financeiro inteligente que interpreta mensagens do WhatsApp em português brasileiro.

DATA DE HOJE: ${today}
DATA DE HOJE (ISO): ${todayISO}

CATEGORIAS DISPONÍVEIS NO SISTEMA:
${categoryNames.length > 0 ? categoryNames.map(c => `- ${c}`).join('\n') : '- Nenhuma categoria cadastrada'}

CARTÕES DE CRÉDITO CADASTRADOS:
${cardsInfo}

Analise a mensagem do usuário e retorne APENAS um JSON (sem markdown, sem texto extra) com esta estrutura:

{
  "intent": "register_transaction" | "register_installment" | "register_recurring" | "register_planned_event" | "simulate_purchase" | "pay_invoice" | "delete_transaction" | "query_summary" | "query_category" | "query_balance" | "query_projection" | "query_safe_to_spend" | "query_recent" | "query_payments" | "help" | "unknown",
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
  "dayOfMonth": number | null,
  "targetMonth": number | null,
  "horizonMonths": number | null,
  "occurredAt": "YYYY-MM-DD" | null,
  "aiResponse": null
}

REGRAS DE CLASSIFICAÇÃO DE INTENT:

1. **register_transaction**: Registro simples de gasto ou receita.
   Exemplos: "250 gasolina", "recebi 5000 salário", "almocei 35", "uber 22", "r$ 150 mercado"

2. **register_installment**: Compra parcelada. Detecte padrões como "6x", "em 6 vezes", "12x67", "parcelado".
   Exemplos: "200 em 6x tênis", "12x67 celular", "notebook 3000 em 10x", "comprei um sofá 2400 em 8 vezes"

3. **register_recurring**: Gasto ou receita recorrente/fixo. Palavras-chave: "todo mês", "mensal", "fixo", "assinatura", "recorrente", "todo dia X".
   Exemplos: "netflix todo mês 40", "academia mensal 100", "aluguel fixo 1500", "salário recorrente todo dia 5"
   → Se mencionar um dia ("todo dia 5", "dia 10"), preencha "dayOfMonth".

4. **register_planned_event**: Receita ou despesa PONTUAL FUTURA, num mês específico (não recorrente).
   Exemplos: "vou receber 13º em dezembro 2500", "férias em julho 1800", "IPVA em janeiro 1200", "bônus em março 3000"
   → Preencha "targetMonth" (1-12) com o mês do evento e "type" (income/expense).

5. **simulate_purchase**: Usuário quer SIMULAR se pode/deve fazer uma compra antes de comprar.
   Palavras-chave: "posso comprar", "dá pra comprar", "consigo comprar", "vale a pena", "e se eu comprar".
   Exemplos: "posso comprar uma TV de 3600 em 12x?", "dá pra comprar um celular de 2000?", "consigo um notebook 10x de 300?"
   → Preencha "amount" (valor TOTAL) e "installments" (1 se à vista).

6. **pay_invoice**: Usuário avisa que PAGOU a fatura de um cartão de crédito.
   Palavras-chave: "paguei o cartão", "paguei a fatura", "quitei o cartão", "fatura paga".
   Exemplos: "paguei o cartão BB", "quitei a fatura do nubank", "paguei a fatura do inter"
   → Preencha "creditCardHint" com o nome do cartão correspondente.

6b. **delete_transaction**: Usuário quer APAGAR/EXCLUIR/REMOVER um lançamento que já registrou (ou corrigir um erro).
   Palavras-chave: "exclui", "apaga", "remove", "deleta", "cancela o lançamento", "errei", "não era esse".
   Exemplos: "exclui o lanche de 40 de ontem", "apaga aquele uber de 22", "remove o último lançamento", "deleta o mercado de 150"
   → Preencha "amount" e/ou "description" com o que identifica o lançamento, e "occurredAt" se mencionar a data.

6c. **query_recent**: Usuário quer ver os ÚLTIMOS lançamentos registrados.
   Exemplos: "últimos lançamentos", "o que registrei hoje?", "mostra meus gastos recentes", "lista as últimas transações"

6d. **query_payments**: Usuário quer saber o que TEM A PAGAR / o que VENCE num mês (faturas de cartão + recorrentes/fixos).
   Palavras-chave: "quanto tenho que pagar", "o que tenho que pagar", "o que vence", "contas de", "minhas contas".
   Exemplos: "quanto tenho que pagar mês que vem?", "o que tenho que pagar em junho?", "contas de junho", "o que vence esse mês?"
   → Preencha "targetMonth" (1-12). Para "mês que vem"/"próximo mês", use o número do PRÓXIMO mês. Para "esse mês", use o mês atual.

7. **query_summary**: Pergunta sobre resumo financeiro geral do período.
   Exemplos: "quanto gastei esse mês?", "resumo do mês", "como estão minhas finanças?", "gastos de abril"

7. **query_category**: Pergunta sobre gastos de uma categoria específica.
   Exemplos: "quanto gastei de alimentação?", "gastos com transporte", "quanto foi de gasolina esse mês?"
   → Preencha "categoryFilter" com o nome da categoria mais próxima das disponíveis.

8. **query_balance**: Pergunta sobre saldo ATUAL das contas.
   Exemplos: "qual meu saldo?", "quanto tenho na conta?", "saldo atual"

9. **query_projection**: Pergunta sobre saldo FUTURO/previsto ou projeção.
   Exemplos: "como vai estar meu saldo em setembro?", "saldo dos próximos 6 meses", "como fica meu financeiro até dezembro?", "vou ficar no vermelho?"
   → Se citar um mês ("em setembro"), preencha "targetMonth" (1-12). Se citar quantidade ("próximos 6 meses"), preencha "horizonMonths".

10. **query_safe_to_spend**: Pergunta quanto pode gastar com segurança.
    Exemplos: "quanto posso gastar esse mês?", "quanto posso gastar livre?", "tenho margem pra gastar?"

11. **help**: Pedido de ajuda ou dúvida sobre o bot.
    Exemplos: "o que você faz?", "ajuda", "como funciona?", "comandos"

12. **unknown**: Não se encaixa em nenhum intent acima. Mensagens irrelevantes.

REGRAS DE MESES (targetMonth): janeiro=1, fevereiro=2, ..., dezembro=12.

REGRAS DE DATA DO LANÇAMENTO (occurredAt):
- Use a DATA DE HOJE (ISO) acima como referência para calcular datas relativas.
- "hoje" ou sem menção de data → occurredAt = null (será hoje).
- "ontem" → data de hoje menos 1 dia. "anteontem" → menos 2 dias.
- "dia 28", "no dia 3" → dia desse número no mês atual (se já passou muito, pode ser o mês atual mesmo; mantenha o mês atual salvo indício claro).
- "semana passada" → 7 dias atrás. "segunda passada", "sexta" → a data mais recente desse dia da semana.
- SEMPRE retorne occurredAt no formato ISO "YYYY-MM-DD". Ex.: se hoje é 2026-05-31 e o usuário diz "ontem", occurredAt = "2026-05-30".
- Isso vale para register_transaction, register_installment e delete_transaction (para localizar o lançamento certo).

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
  const now = new Date();
  const today = now.toLocaleDateString('pt-BR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  // Âncora ISO em horário local para o modelo calcular datas relativas ("ontem" etc.)
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  try {
    const raw = await groqChat([
      { role: 'system', content: buildSystemPrompt(categoryNames, today, creditCards, todayISO) },
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
    if (parsed.dayOfMonth === undefined) parsed.dayOfMonth = null;
    if (parsed.targetMonth === undefined) parsed.targetMonth = null;
    if (parsed.horizonMonths === undefined) parsed.horizonMonths = null;
    if (parsed.occurredAt === undefined) parsed.occurredAt = null;
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
      dayOfMonth: null,
      targetMonth: null,
      horizonMonths: null,
      occurredAt: null,
      aiResponse: null,
    };
  }
}
