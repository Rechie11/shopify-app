import type { FastifyInstance } from 'fastify';
import type { DbOrTx } from '@ember-and-ash/db/client';
import { getBundleCounts, getScoreDistribution } from '../../repositories/bundle.repository.js';
import { listOpenAlerts } from '../../repositories/alert.repository.js';
import { listRecentActivity } from '../../services/activity.service.js';
import { requireShopContext } from '../plugins/auth.js';

export interface DashboardRoutesOptions {
  db: DbOrTx;
}

// KPI tiles, score distribution, open alerts, recent activity - one call
// for the page merchants land on first. See ARCHITECTURE.md §6.1.
export async function dashboardRoutes(
  app: FastifyInstance,
  opts: DashboardRoutesOptions,
): Promise<void> {
  app.get('/dashboard/summary', async (request) => {
    const shop = requireShopContext(request);

    const [bundleCounts, scoreDistribution, openAlerts, recentActivity] = await Promise.all([
      getBundleCounts(opts.db, shop.shopId),
      getScoreDistribution(opts.db, shop.shopId),
      listOpenAlerts(opts.db, shop.shopId),
      listRecentActivity(opts.db, shop.shopId, 10),
    ]);

    return { bundleCounts, scoreDistribution, openAlerts, recentActivity };
  });
}
