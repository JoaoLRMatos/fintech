const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function groqChat(messages: GroqMessage[], temperature = 0.1, maxTokens = 1024): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada');

  const models = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'llama3-8b-8192',
  ];

  let lastError: Error | null = null;

  for (const model of models) {
    try {
      console.log(`[groqChat] Tentando chamar modelo: ${model}`);
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Groq API ${res.status}: ${body}`);
      }

      const data = await res.json() as { choices: { message: { content: string } }[] };
      const content = data.choices[0]?.message?.content;
      if (typeof content === 'string') {
        console.log(`[groqChat] Sucesso com o modelo: ${model}`);
        return content;
      }
    } catch (err) {
      console.warn(`[groqChat] Falha com o modelo ${model}:`, (err as Error).message || err);
      lastError = err as Error;
    }
  }

  throw lastError || new Error('Nenhum modelo Groq respondeu com sucesso');
}
