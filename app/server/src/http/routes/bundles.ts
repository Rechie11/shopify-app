import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { DbOrTx } from '@ember-and-ash/db/client';
import { bundlePricingMode, bundleStatus, flavorProfile } from '@ember-and-ash/db';
import { createAdminClient } from '../../shopify/admin-client.js';
import { NotFoundError } from '../../errors.js';
import {
  findBundleByPublicId,
  listBundles,
  updateBundle,
} from '../../repositories/bundle.repository.js';
import { getScoreHistory } from '../../repositories/score.repository.js';
import {
  createDraftBundle,
  deleteBundle,
  pauseBundle,
  publishBundle,
  saveBundleComposition,
} from '../../services/bundle.service.js';
import { requireShopContext } from '../plugins/auth.js';
import { decodeCursor, encodeCursor } from '../pagination.js';

export interface BundleRoutesOptions {
  db: DbOrTx;
  apiVersion: string;
}

const createBundleSchema = z.object({
  handle: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  subtitle: z.string().max(255).optional(),
  minItems: z.number().int().min(1).max(255),
  maxItems: z.number().int().min(1).max(255),
  pricingMode: z.enum(bundlePricingMode),
  fixedPriceCents: z.number().int().min(0).optional(),
});

const updateBundleSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  subtitle: z.string().max(255).nullable().optional(),
  minItems: z.number().int().min(1).max(255).optional(),
  maxItems: z.number().int().min(1).max(255).optional(),
  pricingMode: z.enum(bundlePricingMode).optional(),
  fixedPriceCents: z.number().int().min(0).nullable().optional(),
});

const bundleItemSchema = z.object({
  productGid: z.string().min(1),
  variantGid: z.string().min(1),
  inventoryItemGid: z.string().optional(),
  sku: z.string().optional(),
  productTitleCache: z.string().optional(),
  variantTitleCache: z.string().optional(),
  imageUrlCache: z.string().optional(),
  unitPriceCents: z.number().int().min(0).optional(),
  unitCostCents: z.number().int().min(0).optional(),
  position: z.number().int().min(0),
  isRequired: z.boolean(),
  heatLevel: z.number().int().min(0).max(5).optional(),
  flavorProfile: z.enum(flavorProfile).optional(),
});

const priceTierSchema = z.object({
  minQuantity: z.number().int().min(1),
  discountBps: z.number().int().min(0).max(10000),
});

const compositionSchema = z.object({
  items: z.array(bundleItemSchema),
  tiers: z.array(priceTierSchema),
});

const listQuerySchema = z.object({
  status: z.enum(bundleStatus).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const publicIdParamSchema = z.object({ publicId: z.string().min(1) });

export async function bundleRoutes(app: FastifyInstance, opts: BundleRoutesOptions): Promise<void> {
  app.get('/bundles', async (request) => {
    const shop = requireShopContext(request);
    const query = listQuerySchema.parse(request.query);
    const limit = query.limit ?? 30;

    const rows = await listBundles(opts.db, shop.shopId, {
      status: query.status,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      limit,
    });

    return {
      bundles: rows,
      nextCursor: rows.length === limit ? encodeCursor(rows[rows.length - 1]!.id) : null,
    };
  });

  app.post('/bundles', async (request, reply) => {
    const shop = requireShopContext(request);
    const input = createBundleSchema.parse(request.body);
    const bundle = await createDraftBundle(opts.db, shop.shopId, input);
    return reply.code(201).send(bundle);
  });

  app.get('/bundles/:publicId', async (request) => {
    const shop = requireShopContext(request);
    const { publicId } = publicIdParamSchema.parse(request.params);
    const bundle = await findBundleByPublicId(opts.db, shop.shopId, publicId);
    if (!bundle) {
      throw new NotFoundError('Bundle not found');
    }
    return bundle;
  });

  app.get('/bundles/:publicId/score/history', async (request) => {
    const shop = requireShopContext(request);
    const { publicId } = publicIdParamSchema.parse(request.params);
    const bundle = await findBundleByPublicId(opts.db, shop.shopId, publicId);
    if (!bundle) {
      throw new NotFoundError('Bundle not found');
    }
    return { history: await getScoreHistory(opts.db, bundle.id) };
  });

  app.patch('/bundles/:publicId', async (request) => {
    const shop = requireShopContext(request);
    const { publicId } = publicIdParamSchema.parse(request.params);
    const patch = updateBundleSchema.parse(request.body);
    await updateBundle(opts.db, shop.shopId, publicId, patch);
    return { ok: true };
  });

  app.put('/bundles/:publicId/composition', async (request) => {
    const shop = requireShopContext(request);
    const { publicId } = publicIdParamSchema.parse(request.params);
    const input = compositionSchema.parse(request.body);
    const adminClient = createAdminClient({
      shopDomain: shop.shopDomain,
      accessToken: shop.accessToken,
      apiVersion: opts.apiVersion,
    });
    await saveBundleComposition(adminClient, opts.db, shop.shopId, publicId, input);
    return { ok: true };
  });

  app.post('/bundles/:publicId/publish', async (request) => {
    const shop = requireShopContext(request);
    const { publicId } = publicIdParamSchema.parse(request.params);
    const adminClient = createAdminClient({
      shopDomain: shop.shopDomain,
      accessToken: shop.accessToken,
      apiVersion: opts.apiVersion,
    });
    await publishBundle(adminClient, opts.db, shop.shopId, publicId);
    return { ok: true };
  });

  app.post('/bundles/:publicId/pause', async (request) => {
    const shop = requireShopContext(request);
    const { publicId } = publicIdParamSchema.parse(request.params);
    const adminClient = createAdminClient({
      shopDomain: shop.shopDomain,
      accessToken: shop.accessToken,
      apiVersion: opts.apiVersion,
    });
    await pauseBundle(adminClient, opts.db, shop.shopId, publicId);
    return { ok: true };
  });

  app.delete('/bundles/:publicId', async (request, reply) => {
    const shop = requireShopContext(request);
    const { publicId } = publicIdParamSchema.parse(request.params);
    await deleteBundle(opts.db, shop.shopId, publicId);
    return reply.code(204).send();
  });
}
