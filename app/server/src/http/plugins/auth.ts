import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Db } from '@ember-and-ash/db/client';
import { decryptToken, encryptToken } from '../../shopify/crypto.js';
import {
  TokenExchangeError,
  exchangeToken,
  shopDomainFromSessionToken,
  verifySessionToken,
} from '../../shopify/auth.js';
import {
  findOrCreateShopByDomain,
  readShopAccessToken,
  saveShopAccessToken,
} from '../../repositories/shop.repository.js';

export interface ShopContext {
  shopId: number;
  shopDomain: string;
  accessToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    shop?: ShopContext;
  }
}

export interface AuthPluginOptions {
  db: Db;
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
}

// Verifies the session token, then resolves an offline access token for
// the shop - from the encrypted cache if present, or via token exchange
// otherwise. The one behavior that must not regress: a 400 from Shopify's
// exchange endpoint is answered 401 + X-Shopify-Retry-Invalid-Session-Request
// so App Bridge fetches a fresh id token and replays the request. Without
// that header the app appears to log the merchant out at random after 24
// hours. See ARCHITECTURE.md §5.2.
async function authPlugin(app: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Missing bearer session token' } });
    }
    const idToken = header.slice('Bearer '.length);

    let payload;
    try {
      payload = verifySessionToken(idToken, {
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
      });
    } catch (err) {
      request.log.warn({ err }, 'session token verification failed');
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Invalid session token' } });
    }

    const shopDomain = shopDomainFromSessionToken(payload);
    const shopRow = await findOrCreateShopByDomain(opts.db, shopDomain);

    const cached = readShopAccessToken(shopRow);
    if (cached) {
      request.shop = {
        shopId: shopRow.id,
        shopDomain,
        accessToken: decryptToken(cached, opts.encryptionKey),
      };
      return;
    }

    try {
      const exchanged = await exchangeToken(shopDomain, idToken, {
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
      });
      const encrypted = encryptToken(exchanged.accessToken, opts.encryptionKey);
      await saveShopAccessToken(opts.db, shopRow.id, encrypted, exchanged.scope);
      request.shop = { shopId: shopRow.id, shopDomain, accessToken: exchanged.accessToken };
    } catch (err) {
      if (err instanceof TokenExchangeError) {
        request.log.warn({ err }, 'token exchange failed');
        if (err.shouldRetryWithFreshToken) {
          return reply
            .code(401)
            .header('X-Shopify-Retry-Invalid-Session-Request', '1')
            .send({
              error: {
                code: 'invalid_session',
                message: 'Session token rejected by Shopify, retry with a fresh token',
              },
            });
        }
        return reply.code(502).send({
          error: { code: 'shopify_api_error', message: 'Failed to exchange session token' },
        });
      }
      throw err;
    }
  });
}

export default fp(authPlugin, { name: 'auth-plugin' });
