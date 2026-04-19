import { z } from 'zod';

export const whatsappWebhookSchema = z.object({
  clientId: z.string().min(1),
  from: z.string().min(1),
  text: z.string().min(1),
  messageId: z.string().optional(),
  timestamp: z.number().optional(),
});

export const transactionSchema = z.object({
  type: z.enum(['income', 'expense', 'transfer']),
  amount: z.number().positive(),
  description: z.string().min(2),
  category: z.string().min(2),
});

export type WhatsAppWebhookInput = z.infer<typeof whatsappWebhookSchema>;
export type TransactionInput = z.infer<typeof transactionSchema>;
