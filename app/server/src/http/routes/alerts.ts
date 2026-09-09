import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { DbOrTx } from '@ember-and-ash/db/client';
import { acknowledgeAlert, listOpenAlerts } from '../../repositories/alert.repository.js';
import { requireShopContext } from '../plugins/auth.js';

export interface AlertRoutesOptions {
  db: DbOrTx;
}

const alertIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export async function alertRoutes(app: FastifyInstance, opts: AlertRoutesOptions): Promise<void> {
  app.get('/alerts', async (request) => {
    const shop = requireShopContext(request);
    return { alerts: await listOpenAlerts(opts.db, shop.shopId) };
  });

  app.post('/alerts/:id/acknowledge', async (request) => {
    const shop = requireShopContext(request);
    const { id } = alertIdParamSchema.parse(request.params);
    await acknowledgeAlert(opts.db, shop.shopId, id);
    return { ok: true };
  });
}
