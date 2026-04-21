const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function groqChat(messages: GroqMessage[], temperature = 0.1, maxTokens = 1024): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
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
  return data.choices[0]?.message?.content ?? '';
}
