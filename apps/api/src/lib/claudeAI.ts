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

export function cleanAndParseJSON(raw: string): any {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\s*/i, '');
    cleaned = cleaned.replace(/```\s*$/, '');
  }
  cleaned = cleaned.trim();
  return JSON.parse(cleaned);
}
