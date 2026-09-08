import { createHmac, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';
import type { Db } from '@ember-and-ash/db/client';
import { encryptToken } from '../../shopify/crypto.js';
import {
  findOrCreateShopByDomain,
  saveShopAccessToken,
} from '../../repositories/shop.repository.js';

const SHOP_DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export interface AuthRoutesOptions {
  db: Db;
  clientId: string;
  clientSecret: string;
  scopes: string;
  appUrl: string;
  encryptionKey: Buffer;
}

// The classic OAuth redirect flow with state nonce + hmac verification.
// Unused in the embedded happy path (token exchange handles that) but
// covers a non-embedded entry: someone hitting the app URL directly with
// ?shop=. See ARCHITECTURE.md §5.4.
export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions): Promise<void> {
  app.get('/auth', async (request, reply) => {
    const { shop } = request.query as Record<string, string | undefined>;
    if (!shop || !SHOP_DOMAIN_RE.test(shop)) {
      return reply.code(400).send({
        error: { code: 'invalid_shop', message: 'shop must be a valid myshopify.com domain' },
      });
    }

    // Self-encoding, signed state: no server-side session store needed.
    // Verified on the way back by re-verifying the signature and expiry.
    const state = jwt.sign({ shop }, opts.clientSecret, { expiresIn: '10m' });

    const redirectUri = new URL('/auth/callback', opts.appUrl).toString();
    const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', opts.clientId);
    authorizeUrl.searchParams.set('scope', opts.scopes);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);

    return reply.redirect(authorizeUrl.toString());
  });

  app.get('/auth/callback', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const { shop, hmac, code, state } = query;

    if (!shop || !hmac || !code || !state || !SHOP_DOMAIN_RE.test(shop)) {
      return reply.code(400).send();
    }

    let statePayload: { shop: string };
    try {
      statePayload = jwt.verify(state, opts.clientSecret) as { shop: string };
    } catch {
      return reply.code(401).send();
    }
    if (statePayload.shop !== shop) {
      return reply.code(401).send();
    }

    if (!verifyOAuthCallbackHmac(query, opts.clientSecret)) {
      return reply.code(401).send();
    }

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: opts.clientId, client_secret: opts.clientSecret, code }),
    });
    if (!tokenResponse.ok) {
      request.log.error({ status: tokenResponse.status }, 'OAuth code exchange failed');
      return reply.code(502).send();
    }

    const { access_token: accessToken, scope } = (await tokenResponse.json()) as {
      access_token: string;
      scope: string;
    };

    const shopRow = await findOrCreateShopByDomain(opts.db, shop);
    await saveShopAccessToken(
      opts.db,
      shopRow.id,
      encryptToken(accessToken, opts.encryptionKey),
      scope,
    );

    return reply.redirect(`https://${shop}/admin/apps/${opts.clientId}`);
  });
}

// Take all query params except hmac, sort keys alphabetically, join as
// key=value pairs with '&', HMAC-SHA256 with the client secret, hex
// compare. This is the classic OAuth callback format - distinct from the
// app proxy's no-separator format. See ARCHITECTURE.md §6.2 for the
// contrasting proxy signature scheme.
function verifyOAuthCallbackHmac(
  query: Record<string, string | undefined>,
  secret: string,
): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('&');
  const expected = createHmac('sha256', secret).update(message).digest('hex');

  let receivedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    receivedBuf = Buffer.from(hmac, 'hex');
    expectedBuf = Buffer.from(expected, 'hex');
  } catch {
    return false;
  }
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}
