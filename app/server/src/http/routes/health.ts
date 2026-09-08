import type { FastifyInstance } from 'fastify';
import type { Db } from '@ember-and-ash/db/client';
import { sql } from 'drizzle-orm';

// /healthz: process alive, no dependency checks. /readyz: DB reachable.
// A load balancer needs the first; a deploy gate needs the second.
export async function healthRoutes(app: FastifyInstance, opts: { db: Db }) {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_req, reply) => {
    try {
      await opts.db.execute(sql`SELECT 1`);
      return { status: 'ok' };
    } catch (err) {
      app.log.error({ err }, 'readiness check failed');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
