import Fastify from 'fastify';
import { createDbClient } from '@ember-and-ash/db/client';
import { loadEnv } from './config/env.js';
import { healthRoutes } from './http/routes/health.js';
import { webhookRoutes } from './http/routes/webhooks.js';
import { authRoutes } from './http/routes/auth.js';
import { bundleRoutes } from './http/routes/bundles.js';
import { productRoutes } from './http/routes/products.js';
import authPlugin from './http/plugins/auth.js';
import errorHandlerPlugin from './http/plugins/error-handler.js';
import { registerJobHandler, startWorkerLoop } from './jobs/worker.js';
import { handleShopUninstalled } from './jobs/handlers/shop-uninstalled.js';
import { handleCompliance } from './jobs/handlers/compliance.js';
import { handleWebhookProcess } from './jobs/handlers/webhook-process.js';
import { createDiscountReconcileHandler } from './jobs/handlers/discount-reconcile.js';

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
  },
  { prefix: '/api' },
);

registerJobHandler('shop.uninstalled', handleShopUninstalled);
registerJobHandler('compliance.process', handleCompliance);
registerJobHandler('webhook.process', handleWebhookProcess);
registerJobHandler(
  'discount.reconcile',
  createDiscountReconcileHandler(encryptionKey, env.SHOPIFY_API_VERSION),
);

const worker = startWorkerLoop({ db, log: app.log });
app.addHook('onClose', async () => {
  worker.stop();
});

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
