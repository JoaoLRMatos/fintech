import { prisma } from './prisma.js';
import { buildInsights } from './insightsEngine.js';
import { sendTelegramMessage } from './telegram.js';

// Dedupe em memória: evita reenviar o mesmo alerta no mesmo dia.
const lastSent = new Map<string, string>(); // workspaceId → 'YYYY-MM-DD'

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Varre os workspaces com chat do Telegram capturado e envia alertas de risco
 * (apenas nível "danger"/"warning") no máximo uma vez por dia.
 *
 * Gated por env TELEGRAM_PROACTIVE_ALERTS=true — desligado por padrão para não
 * enviar mensagens não solicitadas.
 */
export async function runProactiveAlerts(log: { info: (o: any, m?: string) => void; error: (e: unknown, m?: string) => void }) {
  if (process.env.TELEGRAM_PROACTIVE_ALERTS !== 'true') return 0;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return 0;

  const workspaces = await prisma.workspace.findMany({
    where: { telegramChatId: { not: null } },
    select: { id: true, telegramChatId: true },
  });

  let sent = 0;
  for (const ws of workspaces) {
    const chatId = ws.telegramChatId!;
    if (lastSent.get(ws.id) === today()) continue;

    try {
      const { insights } = await buildInsights(ws.id, { horizon: 6 });
      const critical = insights.filter(i => i.level === 'danger' || (i.level === 'warning' && i.code === 'high_commitment'));
      if (critical.length === 0) continue;

      const body = ['🔔 *Alerta financeiro*', '', ...critical.map(i => i.message)].join('\n');
      await sendTelegramMessage(token, chatId, body);
      lastSent.set(ws.id, today());
      sent++;
    } catch (err) {
      log.error(err, 'Falha ao enviar alerta proativo');
    }
  }

  if (sent > 0) log.info({ sent }, 'Alertas proativos enviados');
  return sent;
}
