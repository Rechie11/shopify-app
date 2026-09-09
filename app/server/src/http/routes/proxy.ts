import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { DbOrTx } from '@ember-and-ash/db/client';
import {
  findBundleByHandle,
  findBundleWithDetailsById,
  getMaxItemOverlapWithOtherActiveBundles,
  listActiveBundlesWithDetails,
} from '../../repositories/bundle.repository.js';
import { getLatestOnHand } from '../../repositories/metrics.repository.js';
import { buildFlightSnapshotPayload, type FlightSnapshotPayload } from '../../domain/flight-snapshot.js';
import { computeFlightPrice, computeNextTierNudge } from '../../domain/pricing.js';
import { evaluateBundleRules } from '../../domain/rules.js';
import { computeFlightCoaching, type FlightSlotItem } from '../../domain/flight-coaching.js';
import { requireShopContext } from '../plugins/auth.js';

export interface ProxyRoutesOptions {
  db: DbOrTx;
}

const validateSchema = z.object({
  bundleHandle: z.string().min(1),
  selections: z.array(z.object({ variantGid: z.string().min(1) })).min(1).max(12),
});

type SnapshotWithAvailability = FlightSnapshotPayload & {
  bundles: Array<
    FlightSnapshotPayload['bundles'][number] & {
      items: Array<FlightSnapshotPayload['bundles'][number]['items'][number] & { available: boolean }>;
    }
  >;
};

async function annotateAvailability(
  db: DbOrTx,
  shopId: number,
  payload: FlightSnapshotPayload,
): Promise<SnapshotWithAvailability> {
  const bundles = await Promise.all(
    payload.bundles.map(async (bundle) => ({
      ...bundle,
      items: await Promise.all(
        bundle.items.map(async (item) => ({
          ...item,
          available: (await getLatestOnHand(db, shopId, item.variantGid)) > 0,
        })),
      ),
    })),
  );
  return { ...payload, bundles };
}

// The storefront's live data source - GET /apps/flights/bundles - and the
// trust boundary for money - POST /apps/flights/validate. Both sit behind
// app-proxy signature verification (registered as a preHandler on this
// scope by index.ts). See ARCHITECTURE.md §6.2.
export async function proxyRoutes(app: FastifyInstance, opts: ProxyRoutesOptions): Promise<void> {
  app.get('/proxy/bundles', async (request) => {
    const shop = requireShopContext(request);
    const bundles = await listActiveBundlesWithDetails(opts.db, shop.shopId);
    const payload = buildFlightSnapshotPayload(bundles);
    return annotateAvailability(opts.db, shop.shopId, payload);
  });

  app.post('/proxy/validate', async (request, reply) => {
    const shop = requireShopContext(request);
    const input = validateSchema.parse(request.body);

    const bundleRow = await findBundleByHandle(opts.db, shop.shopId, input.bundleHandle);
    if (!bundleRow || bundleRow.status !== 'active') {
      return reply
        .code(404)
        .send({ error: { code: 'not_found', message: 'No active flight with that handle' } });
    }
    const bundle = await findBundleWithDetailsById(opts.db, shop.shopId, bundleRow.id);
    if (!bundle) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Bundle not found' } });
    }

    const itemsByVariant = new Map(bundle.items.map((item) => [item.variantGid, item]));
    const blocking: string[] = [];
    const soldOutVariantGids: string[] = [];
    const selectedItems: FlightSlotItem[] = [];
    const itemPricesCents: number[] = [];

    for (const selection of input.selections) {
      const item = itemsByVariant.get(selection.variantGid);
      if (!item) {
        blocking.push(`"${selection.variantGid}" is not part of this flight.`);
        continue;
      }
      const onHand = await getLatestOnHand(opts.db, shop.shopId, item.variantGid);
      if (onHand <= 0) {
        blocking.push(`${item.productTitleCache ?? 'One of your bottles'} just sold out.`);
        soldOutVariantGids.push(item.variantGid);
      }
      selectedItems.push({
        variantGid: item.variantGid,
        productTitle: item.productTitleCache ?? item.variantGid,
        heatLevel: item.heatLevel,
        flavorProfile: item.flavorProfile,
      });
      itemPricesCents.push(item.unitPriceCents ?? 0);
    }

    const quantity = selectedItems.length;
    if (quantity < bundle.minItems || quantity > bundle.maxItems) {
      blocking.push(
        `This flight needs between ${bundle.minItems} and ${bundle.maxItems} bottles (you have ${quantity}).`,
      );
    }

    const ruleViolations = evaluateBundleRules(
      bundle.rules.map((r) => ({
        ruleType: r.ruleType,
        config: r.config,
        isBlocking: r.isBlocking,
      })),
      selectedItems.map((i) => ({ heatLevel: i.heatLevel, flavorProfile: i.flavorProfile })),
    );
    for (const violation of ruleViolations) {
      if (violation.isBlocking) blocking.push(violation.message);
    }
    const advisory = ruleViolations.filter((v) => !v.isBlocking).map((v) => v.message);

    const price = computeFlightPrice({
      itemPricesCents,
      pricingMode: bundle.pricingMode,
      fixedPriceCents: bundle.fixedPriceCents,
      tiers: bundle.tiers,
    });
    const nextTierNudge = computeNextTierNudge(bundle.tiers, quantity, bundle.maxItems);

    const selectedVariantGids = selectedItems.map((i) => i.variantGid);
    const maxOverlap = await getMaxItemOverlapWithOtherActiveBundles(
      opts.db,
      shop.shopId,
      bundle.id,
      selectedVariantGids,
    );
    const candidates: FlightSlotItem[] = bundle.items
      .filter((item) => !selectedVariantGids.includes(item.variantGid))
      .map((item) => ({
        variantGid: item.variantGid,
        productTitle: item.productTitleCache ?? item.variantGid,
        heatLevel: item.heatLevel,
        flavorProfile: item.flavorProfile,
      }));
    const coaching = computeFlightCoaching(selectedItems, candidates, maxOverlap);

    // The "sold out mid-build" failure path: an inline, same-heat-tier
    // replacement for each slot that just went out of stock. See
    // THEME_SPEC.md §4.7.
    const soldOutReplacements = await Promise.all(
      soldOutVariantGids.map(async (variantGid) => {
        const soldOutItem = selectedItems.find((i) => i.variantGid === variantGid);
        let replacement: FlightSlotItem | null = null;
        for (const candidate of candidates) {
          if (candidate.heatLevel !== soldOutItem?.heatLevel) continue;
          const onHand = await getLatestOnHand(opts.db, shop.shopId, candidate.variantGid);
          if (onHand > 0) {
            replacement = candidate;
            break;
          }
        }
        return {
          variantGid,
          replacementVariantGid: replacement?.variantGid ?? null,
          replacementProductTitle: replacement?.productTitle ?? null,
        };
      }),
    );

    return {
      valid: blocking.length === 0,
      blocking,
      advisory,
      soldOutReplacements,
      price,
      nextTierNudge,
      balance: coaching.balance,
      suggestion: coaching.suggestion,
    };
  });
}
