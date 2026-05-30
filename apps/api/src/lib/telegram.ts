const TELEGRAM_API = 'https://api.telegram.org';

function botUrl(token: string, method: string): string {
  return `${TELEGRAM_API}/bot${token}/${method}`;
}

export async function sendTelegramMessage(
  token: string,
  chatId: number | string,
  text: string,
): Promise<void> {
  const res = await fetch(botUrl(token, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram sendMessage failed: ${err}`);
  }
}

export async function setTelegramWebhook(
  token: string,
  webhookUrl: string,
  secretToken?: string,
): Promise<void> {
  const body: Record<string, string> = { url: webhookUrl };
  if (secretToken) body.secret_token = secretToken;
  const res = await fetch(botUrl(token, 'setWebhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`setWebhook failed: ${await res.text()}`);
}

export async function deleteTelegramWebhook(token: string): Promise<void> {
  await fetch(botUrl(token, 'deleteWebhook'), { method: 'POST' });
}

export async function getTelegramUpdates(
  token: string,
  offset?: number,
): Promise<TelegramUpdate[]> {
  const params = new URLSearchParams({ timeout: '30' });
  if (offset !== undefined) params.set('offset', String(offset));
  const res = await fetch(`${botUrl(token, 'getUpdates')}?${params}`);
  if (!res.ok) throw new Error(`getUpdates failed: ${await res.text()}`);
  const data = await res.json() as { ok: boolean; result: TelegramUpdate[] };
  return data.result ?? [];
}

export async function getTelegramBotInfo(token: string): Promise<{ id: number; username: string; first_name: string }> {
  const res = await fetch(botUrl(token, 'getMe'));
  if (!res.ok) throw new Error(`getMe failed: ${await res.text()}`);
  const data = await res.json() as { ok: boolean; result: any };
  return data.result;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  date: number;
}
