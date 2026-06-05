export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function claudeChat(
  messages: ClaudeMessage[],
  system?: string,
  temperature = 0.1,
  maxTokens = 1536
): Promise<string> {
  const apiKey = process.env['claude-api-key'] || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY ou claude-api-key não configurada no ambiente');
  }

  const MODEL = 'claude-3-5-sonnet-20241022';

  const body: any = {
    model: MODEL,
    messages,
    max_tokens: maxTokens,
    temperature,
  };

  if (system) {
    body.system = system;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errorText}`);
  }

  const data = await res.json() as any;
  const text = data.content?.[0]?.text || '';
  return text;
}

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Chama o Claude forçando o uso de uma "tool" (function calling). Diferente de
 * claudeChat, aqui o modelo NÃO devolve texto livre que precisa ser parseado:
 * ele é obrigado a chamar a tool com um input que respeita o input_schema, então
 * o resultado já vem como objeto válido. Isso elimina os erros de JSON.parse.
 *
 * Faz retry automático em falhas transitórias (rede / 429 / 5xx) e caso o modelo
 * não chame a tool na primeira vez.
 */
export async function claudeToolCall<T = any>(
  messages: ClaudeMessage[],
  system: string,
  tool: ClaudeTool,
  temperature = 0,
  maxTokens = 1536,
  maxRetries = 2,
): Promise<T> {
  const apiKey = process.env['claude-api-key'] || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY ou claude-api-key não configurada no ambiente');
  }

  const MODEL = 'claude-3-5-sonnet-20241022';

  const body = {
    model: MODEL,
    messages,
    system,
    max_tokens: maxTokens,
    temperature,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
  };

  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorText = await res.text();
        // 429 (rate limit) e 5xx são transitórios → vale a pena tentar de novo.
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          lastErr = new Error(`Claude API ${res.status}: ${errorText}`);
          await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        throw new Error(`Claude API ${res.status}: ${errorText}`);
      }

      const data = await res.json() as any;
      const toolUse = (data.content || []).find((b: any) => b.type === 'tool_use');
      if (!toolUse || !toolUse.input) {
        // Modelo respondeu em texto em vez de chamar a tool → tenta de novo.
        if (attempt < maxRetries) {
          lastErr = new Error('Modelo não chamou a tool esperada');
          continue;
        }
        throw new Error('Modelo não chamou a tool esperada');
      }

      return toolUse.input as T;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastErr ?? new Error('Falha desconhecida ao chamar o Claude');
}

export function cleanAndParseJSON(raw: string): any {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\s*/i, '');
    cleaned = cleaned.replace(/```\s*$/, '');
  }
  cleaned = cleaned.trim();
  return JSON.parse(cleaned);
}
