import { ulid } from 'ulid';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { DbOrTx } from '@ember-and-ash/db/client';
import {
  bundleItems,
  bundlePriceTiers,
  bundleRules,
  bundleScores,
  bundles,
  type bundlePricingMode,
  type bundleStatus,
} from '@ember-and-ash/db';
import { isMysqlErrorCode } from '../db/errors.js';
import { ValidationError } from '../errors.js';

export type Bundle = typeof bundles.$inferSelect;
export type BundleItem = typeof bundleItems.$inferSelect;
export type BundlePriceTier = typeof bundlePriceTiers.$inferSelect;
export type BundleRule = typeof bundleRules.$inferSelect;

export interface BundleWithDetails extends Bundle {
  items: BundleItem[];
  tiers: BundlePriceTier[];
  rules: BundleRule[];
}

export interface CreateBundleInput {
  handle: string;
  title: string;
  subtitle?: string | undefined;
  minItems: number;
  maxItems: number;
  pricingMode: (typeof bundlePricingMode)[number];
  fixedPriceCents?: number | undefined;
}

// Every repository method takes shopId first. This is the multi-tenancy
// boundary - never optional, never inferred from anything else. See
// SCHEMA.md §5.3.
export async function createBundle(
  db: DbOrTx,
  shopId: number,
  input: CreateBundleInput,
): Promise<Bundle> {
  const publicId = ulid();
  let result;
  try {
    [result] = await db
      .insert(bundles)
      .values({
        publicId,
        shopId,
        handle: input.handle,
        title: input.title,
        subtitle: input.subtitle,
        minItems: input.minItems,
        maxItems: input.maxItems,
        pricingMode: input.pricingMode,
        fixedPriceCents: input.fixedPriceCents,
      })
      .$returningId();
  } catch (err) {
    if (isMysqlErrorCode(err, 'ER_DUP_ENTRY')) {
      throw new ValidationError(`A bundle with the handle "${input.handle}" already exists`);
    }
    throw err;
  }

  const created = await db.query.bundles.findFirst({ where: eq(bundles.id, result!.id) });
  if (!created) {
    throw new Error(`Failed to read back newly created bundle ${publicId}`);
  }
  return created;
}

export async function findBundleByPublicId(
  db: DbOrTx,
  shopId: number,
  publicId: string,
): Promise<BundleWithDetails | undefined> {
  return db.query.bundles.findFirst({
    where: and(
      eq(bundles.shopId, shopId),
      eq(bundles.publicId, publicId),
      isNull(bundles.deletedAt),
    ),
    with: { items: true, tiers: true, rules: true },
  });
}

export async function findBundleWithDetailsById(
  db: DbOrTx,
  shopId: number,
  bundleId: number,
): Promise<BundleWithDetails | undefined> {
  return db.query.bundles.findFirst({
    where: and(eq(bundles.shopId, shopId), eq(bundles.id, bundleId), isNull(bundles.deletedAt)),
    with: { items: true, tiers: true, rules: true },
  });
}

export async function listActiveBundleIds(db: DbOrTx, shopId: number): Promise<number[]> {
  const rows = await db
    .select({ id: bundles.id })
    .from(bundles)
    .where(
      and(eq(bundles.shopId, shopId), eq(bundles.status, 'active'), isNull(bundles.deletedAt)),
    );
  return rows.map((r) => r.id);
}

// The overlap term in the balance score (SCHEMA.md §4.5) penalises a
// merchant for publishing several near-identical flights. Computed
// in-memory across the shop's other active bundles - fine at the scale
// a MySQL-first architecture already commits to (see ARCHITECTURE.md §14).
export async function getMaxItemOverlapWithOtherActiveBundles(
  db: DbOrTx,
  shopId: number,
  bundleId: number,
  variantGids: string[],
): Promise<number> {
  const otherActiveIds = (await listActiveBundleIds(db, shopId)).filter((id) => id !== bundleId);
  if (otherActiveIds.length === 0) {
    return 0;
  }

  const otherItems = await db
    .select({ bundleId: bundleItems.bundleId, variantGid: bundleItems.variantGid })
    .from(bundleItems)
    .where(inArray(bundleItems.bundleId, otherActiveIds));

  const variantSet = new Set(variantGids);
  const overlapByBundle = new Map<number, number>();
  for (const item of otherItems) {
    if (variantSet.has(item.variantGid)) {
      overlapByBundle.set(item.bundleId, (overlapByBundle.get(item.bundleId) ?? 0) + 1);
    }
  }
  return Math.max(0, ...overlapByBundle.values());
}

export interface ListBundlesOptions {
  status?: (typeof bundleStatus)[number] | undefined;
  cursor?: { id: number } | undefined;
  limit?: number | undefined;
}

// Cursor-based pagination (opaque to the caller here; the route encodes it
// as base64 of {id}) - offset pagination breaks under concurrent writes.
// See ARCHITECTURE.md §6.1.
export async function listBundles(
  db: DbOrTx,
  shopId: number,
  opts: ListBundlesOptions = {},
): Promise<Bundle[]> {
  const limit = opts.limit ?? 30;
  const conditions = [eq(bundles.shopId, shopId), isNull(bundles.deletedAt)];
  if (opts.status) {
    conditions.push(eq(bundles.status, opts.status));
  }
  if (opts.cursor) {
    conditions.push(lt(bundles.id, opts.cursor.id));
  }

  return db
    .select()
    .from(bundles)
    .where(and(...conditions))
    .orderBy(desc(bundles.id))
    .limit(limit);
}

export interface UpdateBundleInput {
  title?: string | undefined;
  subtitle?: string | null | undefined;
  minItems?: number | undefined;
  maxItems?: number | undefined;
  pricingMode?: (typeof bundlePricingMode)[number] | undefined;
  fixedPriceCents?: number | null | undefined;
}

export async function updateBundle(
  db: DbOrTx,
  shopId: number,
  publicId: string,
  patch: UpdateBundleInput,
): Promise<void> {
  await db
    .update(bundles)
    .set(patch)
    .where(and(eq(bundles.shopId, shopId), eq(bundles.publicId, publicId)));
}

export async function setBundleStatus(
  db: DbOrTx,
  shopId: number,
  publicId: string,
  status: (typeof bundleStatus)[number],
  extra: Partial<Pick<Bundle, 'discountGid'>> = {},
): Promise<void> {
  await db
    .update(bundles)
    .set({ status, ...extra })
    .where(and(eq(bundles.shopId, shopId), eq(bundles.publicId, publicId)));
}

export async function softDeleteBundle(
  db: DbOrTx,
  shopId: number,
  publicId: string,
): Promise<void> {
  await db
    .update(bundles)
    .set({ deletedAt: new Date(), status: 'archived' })
    .where(and(eq(bundles.shopId, shopId), eq(bundles.publicId, publicId)));
}

export interface BundleItemInput {
  productGid: string;
  variantGid: string;
  inventoryItemGid?: string | undefined;
  sku?: string | undefined;
  productTitleCache?: string | undefined;
  variantTitleCache?: string | undefined;
  imageUrlCache?: string | undefined;
  unitPriceCents?: number | undefined;
  unitCostCents?: number | undefined;
  position: number;
  isRequired: boolean;
  heatLevel?: number | undefined;
  flavorProfile?: BundleItem['flavorProfile'] | undefined;
}

// Replaces the full item set in one transaction - the editor always saves
// the complete composition, not a diff.
export async function replaceBundleItems(
  db: DbOrTx,
  bundleId: number,
  items: BundleItemInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(bundleItems).where(eq(bundleItems.bundleId, bundleId));
    if (items.length > 0) {
      await tx.insert(bundleItems).values(items.map((item) => ({ bundleId, ...item })));
    }
  });
}

export interface PriceTierInput {
  minQuantity: number;
  discountBps: number;
}

export async function replacePriceTiers(
  db: DbOrTx,
  bundleId: number,
  tiers: PriceTierInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(bundlePriceTiers).where(eq(bundlePriceTiers.bundleId, bundleId));
    if (tiers.length > 0) {
      await tx.insert(bundlePriceTiers).values(tiers.map((tier) => ({ bundleId, ...tier })));
    }
  });
}

export async function findBundleByIdForShop(
  db: DbOrTx,
  shopId: number,
  bundleId: number,
): Promise<Bundle | undefined> {
  return db.query.bundles.findFirst({
    where: and(eq(bundles.id, bundleId), eq(bundles.shopId, shopId), isNull(bundles.deletedAt)),
  });
}

// inventory_levels/update webhooks carry inventory_item_id, not a variant
// id - this is the resolution step. A variant has exactly one inventory
// item, so every row returned shares the same variant_gid; there can be
// several rows because the same variant may appear in more than one
// active bundle.
export async function findBundleItemsByInventoryItemGid(
  db: DbOrTx,
  shopId: number,
  inventoryItemGid: string,
): Promise<Array<{ bundleId: number; variantGid: string }>> {
  const rows = await db
    .select({ bundleId: bundleItems.bundleId, variantGid: bundleItems.variantGid })
    .from(bundleItems)
    .innerJoin(bundles, eq(bundleItems.bundleId, bundles.id))
    .where(
      and(
        eq(bundleItems.inventoryItemGid, inventoryItemGid),
        eq(bundles.shopId, shopId),
        eq(bundles.status, 'active'),
        isNull(bundles.deletedAt),
      ),
    );
  return rows;
}

export async function findBundleItemsByVariantGid(
  db: DbOrTx,
  shopId: number,
  variantGid: string,
): Promise<Array<{ bundleId: number; itemId: number }>> {
  const rows = await db
    .select({ bundleId: bundleItems.bundleId, itemId: bundleItems.id })
    .from(bundleItems)
    .innerJoin(bundles, eq(bundleItems.bundleId, bundles.id))
    .where(
      and(
        eq(bundleItems.variantGid, variantGid),
        eq(bundles.shopId, shopId),
        eq(bundles.status, 'active'),
        isNull(bundles.deletedAt),
      ),
    );
  return rows.map((r) => ({ bundleId: r.bundleId, itemId: r.itemId }));
}

export async function findBundleItemsByProductGid(
  db: DbOrTx,
  shopId: number,
  productGid: string,
): Promise<Array<{ bundleId: number; bundleTitle: string }>> {
  const rows = await db
    .select({ bundleId: bundleItems.bundleId, bundleTitle: bundles.title })
    .from(bundleItems)
    .innerJoin(bundles, eq(bundleItems.bundleId, bundles.id))
    .where(
      and(
        eq(bundleItems.productGid, productGid),
        eq(bundles.shopId, shopId),
        eq(bundles.status, 'active'),
        isNull(bundles.deletedAt),
      ),
    );
  // A bundle can include more than one variant of the deleted product.
  const seen = new Map<number, string>();
  for (const row of rows) {
    seen.set(row.bundleId, row.bundleTitle);
  }
  return [...seen.entries()].map(([bundleId, bundleTitle]) => ({ bundleId, bundleTitle }));
}

export async function refreshBundleItemCache(
  db: DbOrTx,
  itemId: number,
  patch: { productTitleCache?: string; variantTitleCache?: string; unitPriceCents?: number },
): Promise<void> {
  await db.update(bundleItems).set(patch).where(eq(bundleItems.id, itemId));
}

export interface BundleCounts {
  total: number;
  draft: number;
  publishing: number;
  active: number;
  paused: number;
  archived: number;
}

export async function getBundleCounts(db: DbOrTx, shopId: number): Promise<BundleCounts> {
  const rows = await db
    .select({ status: bundles.status, count: sql<number>`count(*)` })
    .from(bundles)
    .where(and(eq(bundles.shopId, shopId), isNull(bundles.deletedAt)))
    .groupBy(bundles.status);

  const counts: BundleCounts = {
    total: 0,
    draft: 0,
    publishing: 0,
    active: 0,
    paused: 0,
    archived: 0,
  };
  for (const row of rows) {
    counts[row.status] = Number(row.count);
    counts.total += Number(row.count);
  }
  return counts;
}

export interface ScoreDistribution {
  healthy: number;
  watch: number;
  at_risk: number;
}

// Reads through bundles.current_score_id - the denormalised pointer that
// makes this a single join instead of a correlated "latest score per
// bundle" subquery. See SCHEMA.md §4.7.
export async function getScoreDistribution(db: DbOrTx, shopId: number): Promise<ScoreDistribution> {
  const rows = await db
    .select({ band: bundleScores.band, count: sql<number>`count(*)` })
    .from(bundles)
    .innerJoin(bundleScores, eq(bundles.currentScoreId, bundleScores.id))
    .where(and(eq(bundles.shopId, shopId), eq(bundles.status, 'active'), isNull(bundles.deletedAt)))
    .groupBy(bundleScores.band);

  const distribution: ScoreDistribution = { healthy: 0, watch: 0, at_risk: 0 };
  for (const row of rows) {
    distribution[row.band] = Number(row.count);
  }
  return distribution;
}

export async function findBundleByHandle(
  db: DbOrTx,
  shopId: number,
  handle: string,
): Promise<Bundle | undefined> {
  return db.query.bundles.findFirst({
    where: and(eq(bundles.shopId, shopId), eq(bundles.handle, handle), isNull(bundles.deletedAt)),
  });
}
