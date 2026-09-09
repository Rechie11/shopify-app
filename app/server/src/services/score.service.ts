import { inArray } from 'drizzle-orm';
import type { DbOrTx } from '@ember-and-ash/db/client';
import { bundleItems } from '@ember-and-ash/db';
import {
  buildPrimaryReason,
  computeBalanceScore,
  computeCompositeScore,
  computeInventoryScore,
  computeMarginScore,
  computeTractionScore,
  suggestSwap,
  type SwapCandidate,
} from '../domain/scoring.js';
import {
  findBundleWithDetailsById,
  getMaxItemOverlapWithOtherActiveBundles,
  listActiveBundleIds,
} from '../repositories/bundle.repository.js';
import {
  getLatestOnHand,
  getShopOrderCountSince,
  getTrailingVelocity,
} from '../repositories/metrics.repository.js';
import {
  countAllBundleOrdersForShop,
  countBundleOrders,
} from '../repositories/bundle-order.repository.js';
import { insertBundleScore, type BundleScore } from '../repositories/score.repository.js';
import { raiseAlert, resolveAlertByDedupeKey } from '../repositories/alert.repository.js';
import { writeActivity } from './activity.service.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface RecomputeOptions {
  marginFloorBps: number;
  marginTargetBps: number;
  now?: Date;
}

// Ties the pure functions in domain/scoring.ts to real data: velocity and
// on-hand from the metrics tables, margin from the bundle's own items,
// traction from bundle_orders (shrunk toward the shop's prior rate,
// benchmarked against the shop's own best bundle), and balance from the
// item composition. Triggers: orders/create, orders/cancelled,
// inventory_levels/update, products/update, any bundle edit,
// publish/pause, and the nightly sweep. See SCHEMA.md §4.7.
export async function recomputeBundleScore(
  db: DbOrTx,
  shopId: number,
  bundleId: number,
  opts: RecomputeOptions,
): Promise<BundleScore | undefined> {
  const now = opts.now ?? new Date();
  const bundle = await findBundleWithDetailsById(db, shopId, bundleId);
  if (!bundle || bundle.status !== 'active') {
    // Only active bundles are scored - a draft has no live discount to
    // protect and no order history to measure yet.
    return undefined;
  }

  // ---- Inventory ----
  const inventoryItems = await Promise.all(
    bundle.items.map(async (item) => ({
      variantGid: item.variantGid,
      isRequired: item.isRequired,
      velocityPerDay: await getTrailingVelocity(db, shopId, item.variantGid, now),
      onHand: await getLatestOnHand(db, shopId, item.variantGid),
    })),
  );
  const inventory = computeInventoryScore(inventoryItems);

  // ---- Margin ----
  const margin = computeMarginScore(
    bundle.items.map((i) => ({
      unitPriceCents: i.unitPriceCents ?? 0,
      unitCostCents: i.unitCostCents,
    })),
    bundle.items.length,
    bundle.tiers.map((t) => ({ minQuantity: t.minQuantity, discountBps: t.discountBps })),
    opts.marginFloorBps,
    opts.marginTargetBps,
  );

  // ---- Traction ----
  const since30d = new Date(now.getTime() - THIRTY_DAYS_MS);
  const [bundleOrders30d, totalOrders30d, allBundleOrders30d] = await Promise.all([
    countBundleOrders(db, shopId, bundleId, since30d),
    getShopOrderCountSince(db, shopId, since30d),
    countAllBundleOrdersForShop(db, shopId, since30d),
  ]);
  const shopPriorRate = totalOrders30d > 0 ? allBundleOrders30d / totalOrders30d : 0;
  const bundleAgeDays = Math.floor(
    (now.getTime() - bundle.createdAt.getTime()) / (24 * 60 * 60 * 1000),
  );

  // Benchmark against the shop's own best bundle: compute every active
  // bundle's shrunk rate with the same shop-wide inputs, take the max.
  const activeBundleIds = await listActiveBundleIds(db, shopId);
  const shrunkRates = await Promise.all(
    activeBundleIds.map(async (id) => {
      const orders = await countBundleOrders(db, shopId, id, since30d);
      return (orders + 20 * shopPriorRate) / (totalOrders30d + 20);
    }),
  );
  const benchmarkShrunkRate = shrunkRates.length > 0 ? Math.max(...shrunkRates) : 0;

  const traction = computeTractionScore({
    bundleOrders30d,
    totalOrders30d,
    shopPriorRate,
    benchmarkShrunkRate,
    bundleAgeDays,
  });

  // ---- Balance ----
  const maxOverlap = await getMaxItemOverlapWithOtherActiveBundles(
    db,
    shopId,
    bundleId,
    bundle.items.map((i) => i.variantGid),
  );
  const balanceScore = computeBalanceScore({
    items: bundle.items.map((i) => ({ heatLevel: i.heatLevel, flavorProfile: i.flavorProfile })),
    maxOverlapWithOtherActiveBundle: maxOverlap,
  });

  // ---- Composite, reason, swap ----
  const composite = computeCompositeScore({
    inventory: inventory.score,
    margin: margin.score,
    traction: traction.score,
    balance: balanceScore,
  });

  const limitingItem = bundle.items.find((i) => i.variantGid === inventory.limitingVariantGid);
  const primaryReason = buildPrimaryReason({
    inventory: {
      score: inventory.score,
      limitingVariantTitle: limitingItem?.productTitleCache ?? null,
      minDaysCover: inventory.minDaysCover,
    },
    margin: {
      score: margin.score,
      effectiveMarginBps: margin.effectiveMarginBps,
      floorBps: opts.marginFloorBps,
    },
    traction: { score: traction.score },
    balance: { score: balanceScore },
  });

  let recommendedAction: unknown = null;
  if (inventory.limitingVariantGid) {
    // Swap candidates: other bundle_items at this shop with the same heat
    // tier and enough cover. bundle_items is the only place heat/flavour
    // metadata is tracked today, so this is scoped to the merchant's
    // already-catalogued components, not the full product catalog.
    const candidateRows = await getSwapCandidates(db, shopId, bundleId);
    const suggestion = suggestSwap(
      bundle.items.map((i) => ({
        variantGid: i.variantGid,
        heatLevel: i.heatLevel,
        flavorProfile: i.flavorProfile,
      })),
      inventory.limitingVariantGid,
      candidateRows,
      maxOverlap,
    );
    if (suggestion) {
      recommendedAction = suggestion;
    }
  }

  const score = await insertBundleScore(db, {
    shopId,
    bundleId,
    score: composite.score,
    band: composite.band,
    inventoryScore: inventory.score,
    marginScore: margin.score,
    tractionScore: traction.score,
    balanceScore,
    minDaysCover: inventory.minDaysCover,
    limitingVariantGid: inventory.limitingVariantGid,
    effectiveMarginBps: margin.effectiveMarginBps,
    attachRateBps: traction.shrunkRate != null ? Math.round(traction.shrunkRate * 10000) : null,
    primaryReason,
    recommendedAction,
    breakdown: { inventory, margin, traction, balance: balanceScore, partial: composite.partial },
  });

  await handleBandChangeAlert(
    db,
    shopId,
    bundle,
    score,
    inventory.limitingVariantGid,
    primaryReason,
    recommendedAction,
  );

  return score;
}

async function getSwapCandidates(
  db: DbOrTx,
  shopId: number,
  excludeBundleId: number,
): Promise<SwapCandidate[]> {
  const activeIds = (await listActiveBundleIds(db, shopId)).filter((id) => id !== excludeBundleId);
  if (activeIds.length === 0) {
    return [];
  }

  const rows = await db.select().from(bundleItems).where(inArray(bundleItems.bundleId, activeIds));

  return Promise.all(
    rows.map(async (row) => {
      const [onHand, velocity] = await Promise.all([
        getLatestOnHand(db, shopId, row.variantGid),
        getTrailingVelocity(db, shopId, row.variantGid),
      ]);
      return {
        variantGid: row.variantGid,
        productTitle: row.productTitleCache ?? row.variantGid,
        daysOfCover: onHand / Math.max(velocity, 0.1),
        heatLevel: row.heatLevel,
        flavorProfile: row.flavorProfile,
      };
    }),
  );
}

// Alerts follow the score band, not the raw score - crossing 75/50 is
// what actually changes what a merchant should do. Auto-resolves when a
// recompute finds the condition cleared.
async function handleBandChangeAlert(
  db: DbOrTx,
  shopId: number,
  bundle: { id: number; title: string },
  score: BundleScore,
  limitingVariantGid: string | null,
  primaryReason: string,
  recommendedAction: unknown,
): Promise<void> {
  const dedupeKey = `stockout_risk:${bundle.id}:${limitingVariantGid ?? 'none'}`;

  if (score.band === 'at_risk' && limitingVariantGid) {
    const { isNew } = await raiseAlert(db, {
      shopId,
      bundleId: bundle.id,
      alertType: 'stockout_risk',
      severity: 'critical',
      title: `${bundle.title} is at risk`,
      body: primaryReason,
      recommendedAction,
      dedupeKey,
    });
    if (isNew) {
      await writeActivity(db, {
        shopId,
        actorType: 'system',
        actorLabel: 'Bundle Health Score',
        entityType: 'alert',
        entityId: bundle.id,
        action: 'alert.raised',
        after: { alertType: 'stockout_risk', dedupeKey },
      });
    }
  } else {
    const resolved = await resolveAlertByDedupeKey(db, shopId, dedupeKey);
    if (resolved) {
      await writeActivity(db, {
        shopId,
        actorType: 'system',
        actorLabel: 'Bundle Health Score',
        entityType: 'alert',
        entityId: bundle.id,
        action: 'alert.resolved',
        after: { dedupeKey },
      });
    }
  }
}
