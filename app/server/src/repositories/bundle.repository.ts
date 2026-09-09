import { ulid } from 'ulid';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import type { DbOrTx } from '@ember-and-ash/db/client';
import {
  bundleItems,
  bundlePriceTiers,
  bundleRules,
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
