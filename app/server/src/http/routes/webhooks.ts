import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '@ember-and-ash/db/client';
import { verifyWebhookHmac } from '../../shopify/webhooks.js';
import { recordWebhookEvent } from '../../repositories/webhook-event.repository.js';
import { findShopByDomain } from '../../repositories/shop.repository.js';
import { enqueue } from '../../jobs/queue.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export interface WebhookRoutesOptions {
  db: Db;
  apiSecret: string;
}

// Handler contract, identical for every topic: verify -> record -> enqueue,
// never process inline. Shopify's delivery timeout is short and it retries
// on non-2xx; doing scoring work inline is how apps get their webhook
// subscriptions removed for repeated failures. See ARCHITECTURE.md §6.3.
export async function webhookRoutes(
  app: FastifyInstance,
  opts: WebhookRoutesOptions,
): Promise<void> {
  // Preserve the raw body for HMAC verification - computing HMAC over a
  // re-serialized JSON body is the classic bug here. Scoped to this
  // plugin's routes only (Fastify plugins are encapsulated by default).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const buf = body as Buffer;
    request.rawBody = buf;
    try {
      done(null, JSON.parse(buf.toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  async function handleWebhook(
    request: FastifyRequest,
    reply: FastifyReply,
    jobType: (topic: string) => string,
    dedupeKeyFor?: (topic: string, webhookId: string) => string | undefined,
  ): Promise<FastifyReply> {
    const hmacHeader = request.headers['x-shopify-hmac-sha256'];
    const topic = request.headers['x-shopify-topic'];
    const webhookId = request.headers['x-shopify-webhook-id'];
    const apiVersion = request.headers['x-shopify-api-version'];
    const shopDomain = request.headers['x-shopify-shop-domain'];

    if (
      typeof hmacHeader !== 'string' ||
      typeof topic !== 'string' ||
      typeof webhookId !== 'string' ||
      typeof apiVersion !== 'string'
    ) {
      return reply.code(400).send();
    }

    if (!request.rawBody || !verifyWebhookHmac(request.rawBody, hmacHeader, opts.apiSecret)) {
      request.log.warn({ topic }, 'webhook HMAC verification failed');
      return reply.code(401).send();
    }

    const shop =
      typeof shopDomain === 'string' ? await findShopByDomain(opts.db, shopDomain) : undefined;

    const payloadHash = createHash('sha256').update(request.rawBody).digest('base64');
    const { isNew } = await recordWebhookEvent(opts.db, {
      shopId: shop?.id,
      webhookId,
      topic,
      apiVersion,
      payloadHash,
    });

    if (isNew && shop) {
      await enqueue(opts.db, {
        shopId: shop.id,
        type: jobType(topic),
        payload: { topic, body: JSON.parse(request.rawBody.toString('utf8')) } as unknown,
        dedupeKey: dedupeKeyFor?.(topic, webhookId),
      });
    }

    return reply.code(200).send();
  }

  app.post('/webhooks/app', (request, reply) =>
    handleWebhook(request, reply, () => 'shop.uninstalled'),
  );

  // inventory_levels/update -> inventory.sync: record the snapshot and
  // fan out a debounced score.recompute per affected bundle.
  app.post('/webhooks/inventory', (request, reply) =>
    handleWebhook(
      request,
      reply,
      () => 'inventory.sync',
      (_topic, webhookId) => webhookId,
    ),
  );

  // products/update, products/delete -> products.sync: cache refresh or
  // the broken-component alert.
  app.post('/webhooks/products', (request, reply) =>
    handleWebhook(
      request,
      reply,
      () => 'products.sync',
      (_topic, webhookId) => webhookId,
    ),
  );

  // orders/create, orders/cancelled -> metrics.rollup: velocity rollup +
  // bundle attribution from the _flight_id line-item property.
  app.post('/webhooks/orders', (request, reply) =>
    handleWebhook(
      request,
      reply,
      () => 'metrics.rollup',
      (_topic, webhookId) => webhookId,
    ),
  );

  // Mandatory GDPR webhooks (customers/data_request, customers/redact,
  // shop/redact) all land on one URI - X-Shopify-Topic distinguishes them.
  app.post('/webhooks/compliance', (request, reply) =>
    handleWebhook(
      request,
      reply,
      () => 'compliance.process',
      (_topic, webhookId) => webhookId,
    ),
  );
}
