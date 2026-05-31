import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { projectMonths, simulatePurchase } from '../lib/projectionEngine.js';
import { buildInsights, computeSafeToSpend } from '../lib/insightsEngine.js';

export async function projectionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Projeção do saldo acumulado dos próximos N meses. */
  app.get('/api/projection', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { months } = z.object({ months: z.coerce.number().min(1).max(24).default(6) }).parse(request.query);
    return projectMonths(workspaceId, { horizon: months, startOffset: 1 });
  });

  /** Insights inteligentes (risco, comprometimento, sobra, limite saudável). */
  app.get('/api/insights', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { months, reserve } = z.object({
      months: z.coerce.number().min(1).max(24).default(6),
      reserve: z.coerce.number().min(0).default(0),
    }).parse(request.query);
    return buildInsights(workspaceId, { horizon: months, reserve });
  });

  /** Limite saudável de gasto deste mês. */
  app.get('/api/projection/safe-to-spend', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const { reserve } = z.object({ reserve: z.coerce.number().min(0).default(0) }).parse(request.query);
    return computeSafeToSpend(workspaceId, reserve);
  });

  /** Simulação "e se?" — impacto de uma compra (parcelada ou à vista) no futuro. */
  app.post('/api/projection/simulate', async (request) => {
    const { workspaceId } = request.user as { workspaceId: string };
    const body = z.object({
      total: z.number().positive(),
      installments: z.number().int().min(1).max(120).default(1),
      startOffset: z.number().int().min(0).max(24).default(1),
      description: z.string().optional(),
    }).parse(request.body);

    return simulatePurchase(workspaceId, body, { horizon: 12 });
  });
}
