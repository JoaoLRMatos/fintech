import { claudeToolCall, ClaudeMessage, type ClaudeTool } from './claudeAI.js';

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
  /** false quando a chamada ao modelo falhou de fato (não houve interpretação). */
  ok: boolean;
}

const AGENT_TOOL: ClaudeTool = {
  name: 'executar_acoes_financeiras',
  description:
    'Registra a sua resposta amigável ao usuário e a lista de ações que devem ser executadas no banco de dados financeiro. SEMPRE chame esta tool.',
  input_schema: {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description:
          'Resposta amigável e natural em português brasileiro para o usuário. Quando registrar/alterar algo, confirme com os números reais (valor, parcelas, cartão, data).',
      },
      actions: {
        type: 'array',
        description:
          'Lista de ações a executar. Vazio ([]) quando o usuário só faz perguntas ou conversa.',
        items: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [
                'create_transaction',
                'create_installment',
                'update_transaction',
                'delete_transaction',
                'pay_invoice',
              ],
            },
            type: { type: 'string', enum: ['INCOME', 'EXPENSE'] },
            amount: {
              type: 'number',
              description:
                'Em create_installment é o VALOR TOTAL da compra (não o valor da parcela).',
            },
            description: { type: 'string' },
            occurredAt: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
            paymentMethod: { type: 'string', enum: ['credit', 'debit'] },
            creditCardId: { type: 'string' },
            categoryId: { type: 'string' },
            transactionId: { type: 'string' },
            installments: {
              type: 'integer',
              description: 'Número de parcelas (>= 2). Obrigatório em create_installment.',
            },
            paidAt: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
          },
          required: ['action'],
        },
      },
    },
    required: ['reply', 'actions'],
  },
};

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

REGRAS (siga à risca):

1. CRIAR vs ATUALIZAR — a regra mais importante:
   - O DEFAULT é SEMPRE CRIAR um novo lançamento (create_transaction ou create_installment).
   - Só use "update_transaction" / "delete_transaction" quando o usuário pedir EXPLICITAMENTE para mudar/corrigir/apagar algo ("muda", "corrige", "troca", "apaga", "estava errado") E você conseguir achar o lançamento exato na lista "Últimos 15 Lançamentos" pelo ID.
   - NUNCA atualize um lançamento que não esteja listado nos "Últimos 15 Lançamentos". Se não existe na lista, ele NÃO foi salvo — então CRIE.
   - ATENÇÃO ÀS REPETIÇÕES APÓS ERRO: se no histórico a sua resposta anterior foi uma mensagem de erro ("tive um probleminha", "tente novamente"), então NADA foi salvo no banco. Se o usuário repetir os mesmos dados, isso é uma NOVA CRIAÇÃO — use create_transaction/create_installment. NÃO use update.
   - Antes de dizer que "atualizou", confira se realmente existe o ID na lista. Na dúvida, crie. É proibido afirmar que salvou/atualizou algo que você não emitiu como ação.

2. PARCELAMENTO (crédito em Nx) — atenção total:
   - Se o usuário mencionar parcelas de QUALQUER forma ("4x", "em 4 vezes", "parcelei em 4", "dividido em 4"), você é OBRIGADO a usar "create_installment" com "installments" = número de parcelas (>= 2).
   - Em create_installment, "amount" é o VALOR TOTAL da compra. O sistema divide pelas parcelas automaticamente. (Ex: "241,53 em 4x" → amount: 241.53, installments: 4.)
   - É PROIBIDO registrar uma compra parcelada como create_transaction (valor inteiro sem parcelas).
   - Para alterar um parcelamento existente: pegue o ID de qualquer parcela do grupo na lista e use update_transaction com o novo valor TOTAL e/ou nova data; o backend recalcula o grupo inteiro.

3. PERGUNTAS / CONVERSA:
   - Se o usuário só pergunta, tira dúvida sobre saldo/fatura/resumo ou conversa (ex: "como está o banco do brasil?"), responda usando o ESTADO ATUAL DO BANCO DE DADOS e deixe "actions" como [] (vazio). Nunca crie nada nesse caso.

4. CARTÕES E DATAS:
   - Ao citar um cartão ("Banco do Brasil", "BB", "Itaú", "roxinho", "Nubank"), ache o ID correspondente nas listas. Para compra no crédito/cartão, paymentMethod = "credit" e informe o creditCardId.
   - Datas: use hoje (${todayISO}) como base. "16/05" → "2026-05-16"; "ontem", "semana passada" → calcule a partir de hoje.

5. TOM:
   - Fale como um parceiro de finanças real, empático e relaxado em pt-BR. Emojis com moderação.
   - Na confirmação de um lançamento, repita os números reais (valor, parcelas, cartão, data) para o usuário ter certeza do que foi salvo.

Você DEVE responder chamando a tool "executar_acoes_financeiras" com "reply" (sua resposta) e "actions" (lista, ou [] se for só conversa).`;

  const messages: ClaudeMessage[] = [];

  // Adicionar histórico recente (limitar a 10)
  for (const h of history.slice(-10)) {
    messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
  }

  // Adicionar mensagem atual
  messages.push({ role: 'user', content: text });

  try {
    const parsed = await claudeToolCall<{ actions?: AgentAction[]; reply?: string }>(
      messages,
      systemMessage,
      AGENT_TOOL,
      0,
      1536,
    );

    return {
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      reply: parsed.reply || 'Ok, processei seu pedido.',
      ok: true,
    };
  } catch (err) {
    console.error('[processAgentMessage] Erro na chamada do Agent:', err);
    return {
      actions: [],
      reply: 'Desculpe, tive um probleminha para processar essa mensagem agora. Pode tentar novamente?',
      ok: false,
    };
  }
}


