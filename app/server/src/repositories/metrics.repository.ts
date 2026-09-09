import { and, eq, gte, sql, sum } from 'drizzle-orm';
import type { DbOrTx } from '@ember-and-ash/db/client';
import { inventorySnapshots, shopOrderCountsDaily, variantMetricsDaily } from '@ember-and-ash/db';

export interface RollupUnitsSoldInput {
  shopId: number;
  variantGid: string;
  day: Date;
  unitsSold: number;
  orders: number;
  grossCents: number;
}

// Upsert-add: a variant can appear in multiple line items across multiple
// orders on the same day, so this accumulates rather than overwrites.
export async function addToVariantMetricsDaily(
  db: DbOrTx,
  input: RollupUnitsSoldInput,
): Promise<void> {
  await db
    .insert(variantMetricsDaily)
    .values({
      shopId: input.shopId,
      variantGid: input.variantGid,
      day: input.day,
      unitsSold: input.unitsSold,
      orders: input.orders,
      grossCents: input.grossCents,
    })
    .onDuplicateKeyUpdate({
      set: {
        unitsSold: sql`${variantMetricsDaily.unitsSold} + values(${variantMetricsDaily.unitsSold})`,
        orders: sql`${variantMetricsDaily.orders} + values(${variantMetricsDaily.orders})`,
        grossCents: sql`${variantMetricsDaily.grossCents} + values(${variantMetricsDaily.grossCents})`,
      },
    });
}

export async function addRefundedUnits(
  db: DbOrTx,
  shopId: number,
  variantGid: string,
  day: Date,
  refundedUnits: number,
): Promise<void> {
  await db
    .insert(variantMetricsDaily)
    .values({ shopId, variantGid, day, refundedUnits })
    .onDuplicateKeyUpdate({
      set: {
        refundedUnits: sql`${variantMetricsDaily.refundedUnits} + values(${variantMetricsDaily.refundedUnits})`,
      },
    });
}

// velocity(variant) = Σ units_sold over trailing 7 days / 7. See SCHEMA.md §4.2.
export async function getTrailingVelocity(
  db: DbOrTx,
  shopId: number,
  variantGid: string,
  asOf: Date = new Date(),
): Promise<number> {
  const since = new Date(asOf);
  since.setDate(since.getDate() - 7);

  const [row] = await db
    .select({ total: sum(variantMetricsDaily.unitsSold) })
    .from(variantMetricsDaily)
    .where(
      and(
        eq(variantMetricsDaily.shopId, shopId),
        eq(variantMetricsDaily.variantGid, variantGid),
        gte(variantMetricsDaily.day, since),
      ),
    );

  const total = Number(row?.total ?? 0);
  return total / 7;
}

export async function incrementShopOrderCount(
  db: DbOrTx,
  shopId: number,
  day: Date,
): Promise<void> {
  await db
    .insert(shopOrderCountsDaily)
    .values({ shopId, day, orderCount: 1 })
    .onDuplicateKeyUpdate({
      set: { orderCount: sql`${shopOrderCountsDaily.orderCount} + 1` },
    });
}

export async function getShopOrderCountSince(
  db: DbOrTx,
  shopId: number,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: sum(shopOrderCountsDaily.orderCount) })
    .from(shopOrderCountsDaily)
    .where(and(eq(shopOrderCountsDaily.shopId, shopId), gte(shopOrderCountsDaily.day, since)));
  return Number(row?.total ?? 0);
}

export async function recordInventorySnapshot(
  db: DbOrTx,
  input: {
    shopId: number;
    variantGid: string;
    inventoryItemGid: string;
    locationGid: string;
    available: number;
  },
): Promise<void> {
  await db.insert(inventorySnapshots).values(input);
}

// Latest snapshot for a variant, across all locations, summed - "on hand"
// for scoring purposes is total available inventory.
export async function getLatestOnHand(
  db: DbOrTx,
  shopId: number,
  variantGid: string,
): Promise<number> {
  const rows = await db
    .select({
      locationGid: inventorySnapshots.locationGid,
      available: inventorySnapshots.available,
      capturedAt: inventorySnapshots.capturedAt,
    })
    .from(inventorySnapshots)
    .where(
      and(eq(inventorySnapshots.shopId, shopId), eq(inventorySnapshots.variantGid, variantGid)),
    )
    .orderBy(sql`${inventorySnapshots.capturedAt} desc`)
    .limit(50);

  // Keep only the most recent snapshot per location, then sum.
  const latestPerLocation = new Map<string, number>();
  for (const row of rows) {
    if (!latestPerLocation.has(row.locationGid)) {
      latestPerLocation.set(row.locationGid, row.available);
    }
  }
  return [...latestPerLocation.values()].reduce((sum, v) => sum + v, 0);
}
