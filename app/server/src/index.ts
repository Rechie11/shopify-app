import Fastify from 'fastify';
import { createDbClient } from '@ember-and-ash/db/client';
import { loadEnv } from './config/env.js';
import { healthRoutes } from './http/routes/health.js';
import { webhookRoutes } from './http/routes/webhooks.js';
import { authRoutes } from './http/routes/auth.js';
import { bundleRoutes } from './http/routes/bundles.js';
import { productRoutes } from './http/routes/products.js';
import { alertRoutes } from './http/routes/alerts.js';
import { dashboardRoutes } from './http/routes/dashboard.js';
import { proxyRoutes } from './http/routes/proxy.js';
import authPlugin from './http/plugins/auth.js';
import appProxyPlugin from './http/plugins/app-proxy.js';
import errorHandlerPlugin from './http/plugins/error-handler.js';
import rateLimitPlugin from '@fastify/rate-limit';
import { registerJobHandler, startWorkerLoop } from './jobs/worker.js';
import { handleShopUninstalled } from './jobs/handlers/shop-uninstalled.js';
import { handleCompliance } from './jobs/handlers/compliance.js';
import { createDiscountReconcileHandler } from './jobs/handlers/discount-reconcile.js';
import { handleInventorySync } from './jobs/handlers/inventory-sync.js';
import { handleProductsSync } from './jobs/handlers/products-sync.js';
import { handleMetricsRollup } from './jobs/handlers/metrics-rollup.js';
import { handleScoreRecompute } from './jobs/handlers/score-recompute.js';

const env = loadEnv();

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers["x-shopify-access-token"]'],
  },
});

const db = createDbClient(env.DATABASE_URL);
const encryptionKey = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');

await app.register(errorHandlerPlugin);

await app.register(healthRoutes, { db });

await app.register(webhookRoutes, { db, apiSecret: env.SHOPIFY_API_SECRET });

await app.register(authRoutes, {
  db,
  clientId: env.SHOPIFY_API_KEY,
  clientSecret: env.SHOPIFY_API_SECRET,
  scopes: env.SHOPIFY_SCOPES,
  appUrl: env.SHOPIFY_APP_URL,
  encryptionKey,
});

await app.register(
  async (apiScope) => {
    await apiScope.register(authPlugin, {
      db,
      clientId: env.SHOPIFY_API_KEY,
      clientSecret: env.SHOPIFY_API_SECRET,
      encryptionKey,
    });
    apiScope.get('/ping', async (request) => ({ shop: request.shop?.shopDomain }));
    await apiScope.register(bundleRoutes, { db, apiVersion: env.SHOPIFY_API_VERSION });
    await apiScope.register(productRoutes, { apiVersion: env.SHOPIFY_API_VERSION });
    await apiScope.register(alertRoutes, { db });
    await apiScope.register(dashboardRoutes, { db });
  },
  { prefix: '/api' },
);

// The storefront-facing scope: app-proxy signature verified, not
// session-token verified, and rate limited since it's reachable by any
// anonymous shopper. See ARCHITECTURE.md §6.2 and §6.4.
await app.register(async (proxyScope) => {
  await proxyScope.register(rateLimitPlugin, { max: 120, timeWindow: '1 minute' });
  await proxyScope.register(appProxyPlugin, { db, clientSecret: env.SHOPIFY_API_SECRET });
  await proxyScope.register(proxyRoutes, { db });
});

registerJobHandler('shop.uninstalled', handleShopUninstalled);
registerJobHandler('compliance.process', handleCompliance);
registerJobHandler('inventory.sync', handleInventorySync);
registerJobHandler('products.sync', handleProductsSync);
registerJobHandler('metrics.rollup', handleMetricsRollup);
registerJobHandler('score.recompute', handleScoreRecompute);
registerJobHandler(
  'discount.reconcile',
  createDiscountReconcileHandler(encryptionKey, env.SHOPIFY_API_VERSION),
);

const worker = startWorkerLoop({ db, log: app.log });
app.addHook('onClose', async () => {
  worker.stop();
});

try {
  // '::' binds dual-stack (IPv4 + IPv6) so 'localhost' resolves whether the
  // OS prefers ::1 or 127.0.0.1 - Windows commonly tries ::1 first, which
  // was refusing connections when this only listened on 0.0.0.0.
  await app.listen({ port: env.PORT, host: '::' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
