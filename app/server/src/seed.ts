// Demo data seeding - see README.md "Demo data" and BUILD_PLAN.md Day 3.
//
// Builds on the 18 real products Day 0 seeded by hand in the dev store
// (18 sauces, 6 heat levels, 6 flavour profiles, cost on 16 of 18): reads
// them back over the Admin API, then creates 4 bundles -
//   - "Starter Flight"   (published, engineered to score healthy)
//   - "Weekend Warmer"   (published, engineered to score watch)
//   - "Reckless Reserve" (published, engineered to score at_risk on
//                          Charred Pineapple, ~6 days of cover - the exact
//                          scenario the demo script narrates)
//   - "Sampler Draft"    (left as draft - never scored)
//
// Inventory, velocity, order history, and cost-per-item on the at-risk
// and healthy bundles are all synthetic and deliberately engineered so the
// resulting Bundle Health Score is deterministic regardless of whatever
// real prices/costs Day 0 happened to set - see the comments on
// MARGIN_COST_RATIO and the inventory targets below for the arithmetic.
// Real Shopify data used as-is: product id, variant id, price,
// inventoryItem id, and (best-effort) the heat_level/flavor_profile
// metafields for balance-score realism.
//
// Requires a shop that has already completed installation (has a saved
// access token) - a fresh `npm run db:reset` wipes that row along with
// everything else, so open the app once in Shopify admin (completing
// token exchange) before running this standalone. See README.md.

import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { createDbClient } from '@ember-and-ash/db/client';
import { bundles, jobs, variantMetricsDaily, bundleOrders, shopOrderCountsDaily } from '@ember-and-ash/db';
import { loadEnv } from './config/env.js';
import { decryptToken } from './shopify/crypto.js';
import { createAdminClient } from './shopify/admin-client.js';
import {
  PRODUCTS_FOR_SEED_QUERY,
  DISCOUNT_AUTOMATIC_DELETE_MUTATION,
  type ProductsForSeedResult,
  type DiscountAutomaticDeleteResult,
} from './shopify/queries.js';
import { findShopByDomain, readShopAccessToken } from './repositories/shop.repository.js';
import type { BundleItemInput } from './repositories/bundle.repository.js';
import {
  createDraftBundle,
  saveBundleComposition,
  publishBundle,
} from './services/bundle.service.js';
import { recordInventorySnapshot } from './repositories/metrics.repository.js';
import { recomputeBundleScore } from './services/score.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEED_LOCATION_GID = 'gid://shopify/Location/seed-primary';
const FLAVOR_PROFILES = ['smoky', 'fruity', 'citrus', 'umami', 'herbal', 'sweet-heat'] as const;
type FlavorProfile = (typeof FLAVOR_PROFILES)[number];

// Deterministic PRNG so re-running the seed against the same product set
// produces the same-looking demo store every time.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260913);

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysAgo(n: number): Date {
  return startOfDay(new Date(Date.now() - n * DAY_MS));
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 5 || day === 6; // Fri/Sat/Sun
}

interface SeedProduct {
  productGid: string;
  variantGid: string;
  inventoryItemGid: string;
  handle: string;
  title: string;
  imageUrl: string | null;
  priceCents: number;
  heatLevel: number | null;
  flavorProfile: FlavorProfile | null;
}

function parseHeatLevel(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null;
}

function parseFlavorProfile(raw: string | null): FlavorProfile | null {
  if (raw == null) return null;
  return (FLAVOR_PROFILES as readonly string[]).includes(raw) ? (raw as FlavorProfile) : null;
}

// 90 days of daily units_sold for one variant, weekend-seasonal, with the
// most recent 7 days pinned to an exact daily figure so the trailing-7-day
// velocity the scoring engine reads (SCHEMA.md §4.2) comes out to exactly
// `exactRecentVelocity` units/day - everything older is flavour only.
function buildVariantMetricsHistory(
  shopId: number,
  variantGid: string,
  historicalBaselinePerDay: number,
  exactRecentVelocity: number,
): Array<typeof variantMetricsDaily.$inferInsert> {
  const rows: Array<typeof variantMetricsDaily.$inferInsert> = [];

  for (let i = 89; i >= 7; i--) {
    const day = daysAgo(i);
    const seasonal = historicalBaselinePerDay * (isWeekend(day) ? 1.6 : 0.85);
    const units = Math.max(0, Math.round(seasonal * (0.6 + rng() * 0.8)));
    if (units === 0) continue;
    rows.push({
      shopId,
      variantGid,
      day,
      unitsSold: units,
      orders: Math.max(1, Math.round(units / 2)),
      grossCents: 0,
    });
  }

  for (let i = 6; i >= 0; i--) {
    rows.push({
      shopId,
      variantGid,
      day: daysAgo(i),
      unitsSold: exactRecentVelocity,
      orders: exactRecentVelocity,
      grossCents: 0,
    });
  }

  return rows;
}

interface EngineeredBundleTarget {
  handle: string;
  title: string;
  subtitle: string;
  createdDaysAgo: number;
  items: SeedProduct[];
  // COGS as a fraction of price, applied uniformly across this bundle's
  // items - deliberately overrides whatever real "cost per item" Day 0
  // set, so the resulting margin score is exact and reproducible rather
  // than dependent on whatever the real catalog happens to contain.
  marginCostRatio: number;
  // { onHand, exactRecentVelocity } per item, indexed the same as `items`.
  // velocityPerDay = trailing-7-day average; daysOfCover = onHand/velocity
  // (SCHEMA.md §4.2). The limiting (lowest-cover) item drives the
  // inventory score and the bundle's primary_reason.
  inventory: Array<{ onHand: number; velocity: number }>;
  attachOrders30d: number;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDbClient(env.DATABASE_URL);
  const encryptionKey = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');

  const shopDomain = process.env.SEED_SHOP_DOMAIN;
  const shop = shopDomain
    ? await findShopByDomain(db, shopDomain)
    : await db.query.shops.findFirst();

  if (!shop) {
    console.error(
      'No shop found. Install the app first: run `shopify app dev`, open Bundle Studio ' +
        'in the Shopify admin once (this completes token exchange), then run `npm run seed` again.',
    );
    process.exit(1);
  }

  const encryptedToken = readShopAccessToken(shop);
  if (!encryptedToken) {
    console.error(
      `Shop "${shop.shopDomain}" has no saved access token yet. Open Bundle Studio in the ` +
        'Shopify admin once to complete installation, then run `npm run seed` again.',
    );
    process.exit(1);
  }
  const accessToken = decryptToken(encryptedToken, encryptionKey);

  const adminClient = createAdminClient({
    shopDomain: shop.shopDomain,
    accessToken,
    apiVersion: env.SHOPIFY_API_VERSION,
  });

  console.log(`Reading products from ${shop.shopDomain}...`);
  const result = await adminClient.request<ProductsForSeedResult>(PRODUCTS_FOR_SEED_QUERY, {
    first: 50,
  });

  const products: SeedProduct[] = result.products.nodes
    .map((p) => {
      const variant = p.variants.nodes[0];
      if (!variant) return null;
      return {
        productGid: p.id,
        variantGid: variant.id,
        inventoryItemGid: variant.inventoryItem.id,
        handle: p.handle,
        title: p.title,
        imageUrl: p.featuredImage?.url ?? null,
        priceCents: Math.round(Number.parseFloat(variant.price) * 100),
        heatLevel: parseHeatLevel(p.heatLevel?.value ?? null),
        flavorProfile: parseFlavorProfile(p.flavorProfile?.value ?? null),
      };
    })
    .filter((p): p is SeedProduct => p !== null);

  if (products.length < 10) {
    console.error(
      `Only found ${products.length} products with a variant - expected ~18 from Day 0's ` +
        'manual store seeding. Seed the store\'s products first (see BUILD_PLAN.md Day 0).',
    );
    process.exit(1);
  }
  console.log(`Found ${products.length} products.`);

  const charredPineapple = products.find((p) => p.handle === 'charred-pineapple');
  if (!charredPineapple) {
    console.error(
      'No product with handle "charred-pineapple" found - the demo script and batch-story ' +
        'section both name this product specifically. Seed it (see BUILD_PLAN.md Day 0) or ' +
        'update this script to use a different handle for the at-risk scenario.',
    );
    process.exit(1);
  }

  // Highest-margin-looking products (by real price, cost ignored - margin
  // is overridden per bundle below) go to the healthy bundle first, next
  // tier to watch, so the selection at least loosely tracks realistic
  // merchandising even though the scores themselves are fully engineered.
  const pool = products.filter((p) => p.handle !== 'charred-pineapple');
  const byPriceDesc = [...pool].sort((a, b) => b.priceCents - a.priceCents);

  const healthyItems = byPriceDesc.slice(0, 4);
  const watchItems = byPriceDesc.slice(4, 8);
  const atRiskOthers = byPriceDesc.slice(8, 10);
  const draftItems = byPriceDesc.slice(10, 13).length >= 3 ? byPriceDesc.slice(10, 13) : byPriceDesc.slice(0, 3);

  if (healthyItems.length < 3 || watchItems.length < 3 || atRiskOthers.length < 2) {
    console.error(
      `Not enough distinct products (${products.length}) to build 3 non-overlapping bundles ` +
        'of 3-4 items each plus Charred Pineapple. Add more products to the store.',
    );
    process.exit(1);
  }

  const targets: EngineeredBundleTarget[] = [
    {
      handle: 'starter-flight',
      title: 'Starter Flight',
      subtitle: 'An easy on-ramp into the heat scale.',
      createdDaysAgo: 35,
      items: healthyItems,
      marginCostRatio: 0.35, // -> ~65% margin, comfortably above the 55% target
      inventory: healthyItems.map(() => ({ onHand: 300, velocity: 1 })), // 300 days cover
      attachOrders30d: 25,
    },
    {
      handle: 'weekend-warmer',
      title: 'Weekend Warmer',
      subtitle: 'Built for a long weekend, not a quiet Tuesday.',
      createdDaysAgo: 35,
      items: watchItems,
      marginCostRatio: 0.48, // -> ~52% margin, mid-band
      inventory: watchItems.map(() => ({ onHand: 45, velocity: 3 })), // 15 days cover
      attachOrders30d: 10,
    },
    {
      handle: 'reckless-reserve',
      title: 'Reckless Reserve',
      subtitle: 'Not for the timid - or the well-stocked.',
      createdDaysAgo: 3, // <14 days old: traction stays excluded, not "unhealthy for being new"
      items: [charredPineapple, ...atRiskOthers],
      marginCostRatio: 0.75, // -> 25% margin, below the 30% floor -> margin score 0
      inventory: [
        { onHand: 30, velocity: 5 }, // Charred Pineapple: exactly 6 days of cover
        { onHand: 300, velocity: 1 },
        { onHand: 300, velocity: 1 },
      ],
      attachOrders30d: 0,
    },
  ];

  const shopId = shop.id;
  const createdBundleIds: number[] = [];

  // Re-runnable: this handle set is ours alone, so wipe any prior seed run
  // (including its live Shopify discount, if it published one) before
  // recreating from scratch. createBundle's handle uniqueness check does
  // not exempt soft-deleted rows, so a plain re-run without this would
  // fail on the first bundle every time.
  const allTargetHandles = [...targets.map((t) => t.handle), 'sampler-draft'];
  for (const handle of allTargetHandles) {
    const existing = await db.query.bundles.findFirst({
      where: (b, { and, eq: eqOp }) => and(eqOp(b.shopId, shopId), eqOp(b.handle, handle)),
    });
    if (!existing) continue;

    console.log(`Removing previous "${existing.title}" (handle: ${handle}) from an earlier seed run...`);
    if (existing.discountGid) {
      try {
        // Delete, not deactivate: Shopify enforces automatic-discount
        // title uniqueness against inactive discounts too, so a merely
        // deactivated one from a prior seed run would still block the
        // re-create below with "Title must be unique for automatic
        // discount."
        await adminClient.request<DiscountAutomaticDeleteResult>(DISCOUNT_AUTOMATIC_DELETE_MUTATION, {
          id: existing.discountGid,
        });
      } catch {
        // Best-effort - the discount may already be gone on Shopify's
        // side; the DB row is deleted regardless.
      }
    }
    // current_score_id points at bundle_scores, which in turn
    // cascade-deletes via bundle_id back to this row - null the pointer
    // first or MySQL refuses the delete as a FK constraint violation on
    // itself.
    await db.update(bundles).set({ currentScoreId: null }).where(eq(bundles.id, existing.id));
    // A failed publish from a prior run may have left a discount.reconcile
    // job queued (dedupeKey = the bundle's publicId, per publishBundle).
    // Without this it keeps retrying forever against a bundle.id that no
    // longer exists, dead-lettering with "Bundle not found" in the worker
    // log - harmless, but confusing noise on every seed re-run otherwise.
    await db.delete(jobs).where(eq(jobs.dedupeKey, existing.publicId));
    await db.delete(bundles).where(eq(bundles.id, existing.id));
  }

  // Full wipe of this shop's metrics tables, not just the bundle handles:
  // a bulk insert below assumes a clean slate for each (variant, day), and
  // any earlier real order-webhook testing against these same 3 products
  // (Ghost Peppers, Charred Pineapple, Basta pagkaon) would otherwise
  // silently throw off the precisely-engineered "6 days of cover" velocity.
  await db.delete(variantMetricsDaily).where(eq(variantMetricsDaily.shopId, shopId));
  await db.delete(shopOrderCountsDaily).where(eq(shopOrderCountsDaily.shopId, shopId));

  for (const target of targets) {
    console.log(`Creating "${target.title}"...`);
    const bundle = await createDraftBundle(db, shopId, {
      handle: target.handle,
      title: target.title,
      subtitle: target.subtitle,
      minItems: 3,
      maxItems: 6,
      pricingMode: 'tiered_percent',
    });

    const items: BundleItemInput[] = target.items.map((p, i) => ({
      productGid: p.productGid,
      variantGid: p.variantGid,
      inventoryItemGid: p.inventoryItemGid,
      productTitleCache: p.title,
      imageUrlCache: p.imageUrl ?? undefined,
      unitPriceCents: p.priceCents,
      unitCostCents: Math.round(p.priceCents * target.marginCostRatio),
      position: i,
      isRequired: true,
      heatLevel: p.heatLevel ?? undefined,
      flavorProfile: p.flavorProfile ?? undefined,
    }));

    await saveBundleComposition(adminClient, db, shopId, bundle.publicId, {
      items,
      tiers: [
        { minQuantity: 3, discountBps: 1000 },
        { minQuantity: 5, discountBps: 1500 },
      ],
    });

    await publishBundle(adminClient, db, shopId, bundle.publicId);
    await db
      .update(bundles)
      .set({ createdAt: daysAgo(target.createdDaysAgo) })
      .where(eq(bundles.id, bundle.id));

    for (let i = 0; i < target.items.length; i++) {
      const product = target.items[i]!;
      const { onHand, velocity } = target.inventory[i]!;
      await recordInventorySnapshot(db, {
        shopId,
        variantGid: product.variantGid,
        inventoryItemGid: product.inventoryItemGid,
        locationGid: SEED_LOCATION_GID,
        available: onHand,
      });

      const rows = buildVariantMetricsHistory(shopId, product.variantGid, velocity, velocity);
      if (rows.length > 0) {
        await db.insert(variantMetricsDaily).values(rows);
      }
    }

    createdBundleIds.push(bundle.id);
  }

  // The draft bundle: same shape, never published, never scored.
  console.log('Creating "Sampler Draft" (left unpublished)...');
  const draftBundle = await createDraftBundle(db, shopId, {
    handle: 'sampler-draft',
    title: 'Sampler Draft',
    subtitle: 'Still deciding on the lineup.',
    minItems: 3,
    maxItems: 6,
    pricingMode: 'tiered_percent',
  });
  await saveBundleComposition(adminClient, db, shopId, draftBundle.publicId, {
    items: draftItems.map((p, i) => ({
      productGid: p.productGid,
      variantGid: p.variantGid,
      inventoryItemGid: p.inventoryItemGid,
      productTitleCache: p.title,
      imageUrlCache: p.imageUrl ?? undefined,
      unitPriceCents: p.priceCents,
      unitCostCents: undefined, // one of the two "missing cost" products in the catalog
      position: i,
      isRequired: true,
      heatLevel: p.heatLevel ?? undefined,
      flavorProfile: p.flavorProfile ?? undefined,
    })),
    tiers: [{ minQuantity: 3, discountBps: 1000 }],
  });

  // Shop-wide order volume for the 30-day traction window (SCHEMA.md
  // §4.4): 100 orders total, weekend-seasonal, of which the bundles above
  // account for 35 - the rest are ordinary, non-bundle orders, so the
  // attach rate isn't an unrealistic 100%.
  console.log('Generating 30 days of shop-wide order counts...');
  const orderCountRows: Array<typeof shopOrderCountsDaily.$inferInsert> = [];
  {
    const dailyTargets: number[] = [];
    let remaining = 100;
    for (let i = 29; i >= 0; i--) {
      const day = daysAgo(i);
      const weight = isWeekend(day) ? 1.6 : 0.85;
      dailyTargets.push(weight);
    }
    const totalWeight = dailyTargets.reduce((s, w) => s + w, 0);
    for (let i = 29; i >= 0; i--) {
      const day = daysAgo(i);
      const weight = dailyTargets[29 - i]!;
      const count = i === 0 ? remaining : Math.round((weight / totalWeight) * 100);
      remaining -= count;
      orderCountRows.push({ shopId, day, orderCount: Math.max(0, count) });
    }
  }
  await db.insert(shopOrderCountsDaily).values(orderCountRows);

  console.log('Generating bundle-attributed orders (attach rate)...');
  const bundleOrderRows: Array<typeof bundleOrders.$inferInsert> = [];
  let orderSeq = 1;
  for (const target of targets) {
    if (target.attachOrders30d === 0) continue;
    const bundleRow = await db.query.bundles.findFirst({
      where: eq(bundles.handle, target.handle),
    });
    if (!bundleRow) continue;

    const subtotalCents = target.items.reduce((sum, p) => sum + p.priceCents, 0);
    for (let n = 0; n < target.attachOrders30d; n++) {
      const daysBack = Math.floor(rng() * 29);
      bundleOrderRows.push({
        shopId,
        bundleId: bundleRow.id,
        orderGid: `gid://shopify/Order/seed-${orderSeq}`,
        orderNumber: `SEED-${orderSeq}`,
        flightToken: ulid(),
        itemCount: target.items.length,
        subtotalCents,
        discountCents: Math.round(subtotalCents * 0.1),
        currency: shop.currency ?? 'USD',
        placedAt: daysAgo(daysBack),
      });
      orderSeq++;
    }
  }
  if (bundleOrderRows.length > 0) {
    await db.insert(bundleOrders).values(bundleOrderRows);
  }

  console.log('Computing bundle health scores...');
  for (const bundleId of createdBundleIds) {
    const score = await recomputeBundleScore(db, shopId, bundleId, {
      marginFloorBps: shop.marginFloorBps,
      marginTargetBps: shop.marginTargetBps,
    });
    if (score) {
      console.log(`  bundle ${bundleId}: score=${score.score} band=${score.band}`);
    }
  }

  console.log('\nDone. 4 bundles created (3 published + 1 draft).');
  console.log('Reload the Bundle Studio dashboard to see the seeded state.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
