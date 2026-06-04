import { claudeChat, ClaudeMessage, cleanAndParseJSON } from './claudeAI.js';

export interface AgentAction {
  action: 'create_transaction' | 'create_installment' | 'update_transaction' | 'delete_transaction' | 'pay_invoice';
  type?: 'INCOME' | 'EXPENSE';
  amount?: number;
  description?: string;
  occurredAt?: string; // YYYY-MM-DD
  paymentMethod?: 'credit' | 'debit';
  creditCardId?: string;
  categoryId?: string;
  transactionId?: string;
  installments?: number;
  paidAt?: string; // YYYY-MM-DD
}

export interface AgentResponse {
  actions: AgentAction[];
  reply: string;
}

export async function processAgentMessage(
  text: string,
  categories: { id: string; name: string }[],
  accounts: { id: string; name: string; balance: unknown }[],
  creditCards: { id: string; name: string; billingDay: number; closingDay: number }[],
  creditCardsStatus: string,
  monthSummary: string,
  recentTransactionsList: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<AgentResponse> {
  const now = new Date();
  const today = now.toLocaleDateString('pt-BR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const categoriesStr = categories.map(c => `- "${c.name}" (ID: ${c.id})`).join('\n');
  const accountsStr = accounts.map(a => `- "${a.name}" (ID: ${a.id}, Saldo: ${a.balance})`).join('\n');
  const cardsStr = creditCards.map(c => `- "${c.name}" (ID: ${c.id}, Fechamento: dia ${c.closingDay}, Vencimento: dia ${c.billingDay})`).join('\n');

  const systemMessage = `Você é o assistente financeiro de Inteligência Artificial da Fintech.
Você fala em português brasileiro de forma natural, amigável, acolhedora e empática (como uma pessoa de verdade, não um bot engessado).

Seu papel é conversar de forma livre e inteligente com o usuário e, ao mesmo tempo, decidir se precisa realizar ações no banco de dados para criar, atualizar, excluir transações ou registrar pagamento de faturas.

HOJE É: ${today} (ISO: ${todayISO})

ESTADO ATUAL DO BANCO DE DATOS:

Categorias Cadastradas:
${categoriesStr || '- Nenhuma'}

Contas Cadastradas:
${accountsStr || '- Nenhuma'}

Cartões de Crédito Cadastrados:
${cardsStr || '- Nenhum'}

Faturas de Cartão (Valores em Aberto por Mês de Vencimento):
${creditCardsStatus || '- Nenhuma informação de fatura'}

Resumo Financeiro do Mês Atual:
${monthSummary}

Últimos 15 Lançamentos Registrados na Conta (Mais Recentes Primeiro):
${recentTransactionsList || '- Nenhum lançamento registrado'}

DIRETRIZES DA IA PARA ROBUSTEZ:

1. ASSISTENTE INTELIGENTE vs CADASTROS:
   - Se o usuário fizer uma pergunta, tirar dúvidas sobre o seu saldo, faturas de cartão, resumo ou projeções (por exemplo: "como está o banco do brasil, fatura quem vence agora em junho?"), você deve analisar o "ESTADO ATUAL DO BANCO DE DATOS" (por exemplo, faturas de cartão, lançamentos, contas) e responder de forma direta, clara e humana na propriedade "reply", mantendo o array "actions" vazio: [].
   - Nunca crie transações duplicadas se o usuário estiver apenas tirando dúvidas ou se o histórico de conversas mostrar que o lançamento já foi processado ou se a última resposta deu erro e o usuário está apenas repetindo os dados para confirmar a inserção. Se for uma repetição após uma falha de conexão anterior, emita a ação necessária com precisão.

2. COMBATE ÀS FORMALIDADES DE COMANDO:
   - Responda como um parceiro de finanças real, empático e de forma relaxada em português brasileiro. Use emojis de forma natural e moderada.

3. DECISÃO DE AÇÕES SEQUENCIAIS ("actions"):
   - Você pode indicar uma ou mais ações no array "actions" para realizar modificações de dados baseadas nas intenções reais do usuário.
   - Ações Suportadas:
     * {"action": "create_transaction", "type": "INCOME"|"EXPENSE", "amount": number, "description": string, "occurredAt": "YYYY-MM-DD", "paymentMethod": "credit"|"debit", "creditCardId": "ID_DO_CARTÃO_SE_CREDITO", "categoryId": "ID_DA_CATEGORIA"}
     * {"action": "create_installment", "amount": VALOR_TOTAL_DA_COMPRA, "installments": number, "description": string, "occurredAt": "YYYY-MM-DD", "paymentMethod": "credit"|"debit", "creditCardId": string, "categoryId": string}
     * {"action": "update_transaction", "transactionId": "ID_DO_LANCAMENTO", "amount": number, "description": string, "occurredAt": "YYYY-MM-DD", "categoryId": string, "paymentMethod": "credit"|"debit", "creditCardId": string}
     * {"action": "delete_transaction", "transactionId": "ID_DO_LANCAMENTO"}
     * {"action": "pay_invoice", "creditCardId": "ID_DO_CARTÃO", "paidAt": "YYYY-MM-DD"}

4. TRATAMENTO DE CORREÇÕES, EXCLUSÕES E REPETIÇÕES:
   - Se o usuário pedir para alterar ou excluir um valor, analise os "Últimos 15 Lançamentos" e o histórico para encontrar o ID da transação correspondente. Use "update_transaction" ou "delete_transaction".
   - Se ele disser para alterar um parcelamento (grupo de parcelas), pegue o ID de qualquer uma destas parcelas recentes, e envie "update_transaction" com o ID correspondente e o novo valor total ou nova data. O backend recalculará o grupo inteiro automaticamente.
   - Ao calcular datas ("dia 16/05", "ontem", "semana passada"), use a data de hoje (${todayISO}) como base para obter o ano correto. "16/05" vira "2026-05-16".

5. CARTÕES DE CRÉDITO E CONTAS:
   - Ao citar um cartão (ex: "Banco do Brasil", "BB", "Itaú", "roxinho", "Nubank"), encontre o ID perfeito nas listas cadastradas. Por exemplo, se ele mencionar "banco do brasil", procure o cartão com nome que contém "banco do brasil" ou "bb".
   - Sempre que a compra for no crédito ou em cartões, "paymentMethod" deve ser "credit" e especifique o "creditCardId".

RETORNE EXCLUSIVAMENTE UM OBJETO JSON COMPATÍVEL COM ESTE SCHEMA (sem markdown de bloco code, sem texto antes ou depois):

{
  "actions": [ ... ],
  "reply": "Sua resposta amigável e natural aqui."
}`;

  const messages: ClaudeMessage[] = [];

  // Adicionar histórico recente (limitar a 10)
  for (const h of history.slice(-10)) {
    messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
  }

  // Adicionar mensagem atual
  messages.push({ role: 'user', content: text });

  try {
    const rawResponse = await claudeChat(messages, systemMessage, 0.1, 1536);
    const parsed = cleanAndParseJSON(rawResponse) as AgentResponse;

    if (!parsed.actions) parsed.actions = [];
    if (!parsed.reply) parsed.reply = 'Ok, processei seu pedido.';

    return parsed;
  } catch (err) {
    console.error('[processAgentMessage] Erro na chamada do Agent:', err);
    return {
      actions: [],
      reply: 'Desculpe, tive um probleminha para processar essa mensagem agora. Pode tentar novamente?',
    };
  }
}


