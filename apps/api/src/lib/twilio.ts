// Twilio WhatsApp client using REST API (no SDK dependency)
// Docs: https://www.twilio.com/docs/messaging/api/message-resource

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !twilioPhone) return null;
  return { accountSid, authToken, twilioPhone };
}

export function isTwilioConfigured(): boolean {
  return getTwilioConfig() !== null;
}

export async function sendTwilioWhatsApp(to: string, message: string): Promise<{ success: boolean; sid?: string; error?: string }> {
  const config = getTwilioConfig();
  if (!config) return { success: false, error: 'Twilio não configurado' };

  // Normaliza número para formato whatsapp:+55...
  let normalized = to.replace(/\D/g, '');
  if (!normalized.startsWith('55') && normalized.length <= 11) {
    normalized = '55' + normalized;
  }
  const whatsappTo = `whatsapp:+${normalized}`;
  const whatsappFrom = `whatsapp:${config.twilioPhone}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');

  const body = new URLSearchParams({
    To: whatsappTo,
    From: whatsappFrom,
    Body: message,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('[Twilio] Erro ao enviar:', data.message || data);
    return { success: false, error: data.message || `HTTP ${res.status}` };
  }

  return { success: true, sid: data.sid };
}

/**
 * Valida a assinatura de um webhook do Twilio.
 * Em trial mode isso é simplificado — verifica se o AccountSid bate.
 */
export function validateTwilioWebhook(bodySid: string): boolean {
  const config = getTwilioConfig();
  if (!config) return false;
  return bodySid === config.accountSid;
}
