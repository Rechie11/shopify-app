import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Db } from '@ember-and-ash/db/client';
import { isTimestampFresh, verifyAppProxySignature, type AppProxyQuery } from '../../shopify/app-proxy.js';
import { findShopByDomain } from '../../repositories/shop.repository.js';
import type { ShopContext } from './auth.js';

export interface AppProxyPluginOptions {
  db: Db;
  clientSecret: string;
}

// Every /proxy/* request is a storefront request forwarded by Shopify,
// signed with the app's client secret and time-bounded to 60 seconds - the
// same trust boundary the embedded app's session token is for admin
// requests, but for anonymous shoppers. See ARCHITECTURE.md §6.2.
async function appProxyPlugin(app: FastifyInstance, opts: AppProxyPluginOptions): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    const query = request.query as AppProxyQuery;

    if (!verifyAppProxySignature(query, opts.clientSecret)) {
      request.log.warn('app proxy signature verification failed');
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Invalid proxy signature' } });
    }

    if (!isTimestampFresh(query.timestamp)) {
      request.log.warn('app proxy request timestamp outside the 60s window');
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Request timestamp is stale' } });
    }

    const shopDomain = query.shop;
    if (typeof shopDomain !== 'string') {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'Missing shop' } });
    }

    const shopRow = await findShopByDomain(opts.db, shopDomain);
    if (!shopRow) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Unknown shop' } });
    }

    // Storefront requests only ever read cached local data - no admin
    // access token is needed here, unlike the embedded /api routes.
    request.shop = { shopId: shopRow.id, shopDomain, accessToken: '' } satisfies ShopContext;
  });
}

export default fp(appProxyPlugin, { name: 'app-proxy-plugin' });
