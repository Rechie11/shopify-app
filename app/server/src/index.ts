import Fastify from 'fastify';
import { createDbClient } from '@ember-and-ash/db/client';
import { loadEnv } from './config/env.js';
import { healthRoutes } from './http/routes/health.js';

const env = loadEnv();

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers["x-shopify-access-token"]'],
  },
});

const db = createDbClient(env.DATABASE_URL);

await app.register(healthRoutes, { db });

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
