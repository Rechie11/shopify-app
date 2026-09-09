import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
  datetime,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { shops } from './shops.js';

// The velocity rollup. This table is the reason scoring is fast: computing
// 7-day velocity from raw orders at read time turns a 40ms dashboard into
// a multi-second one. Rolled up from order webhooks, reconciled nightly.
// See SCHEMA.md §3.7.
export const variantMetricsDaily = mysqlTable(
  'variant_metrics_daily',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    variantGid: varchar('variant_gid', { length: 255 }).notNull(),
    day: date('day').notNull(),
    unitsSold: int('units_sold', { unsigned: true }).notNull().default(0),
    orders: int('orders', { unsigned: true }).notNull().default(0),
    grossCents: bigint('gross_cents', { mode: 'number' }).notNull().default(0),
    refundedUnits: int('refunded_units', { unsigned: true }).notNull().default(0),

    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uq_variant_metrics_shop_variant_day').on(t.shopId, t.variantGid, t.day),
    index('ix_variant_metrics_shop_day').on(t.shopId, t.day),
  ],
);

// Append-only, 90-day retention. Kept as history rather than a single
// mutable "current" column so the app can show a trend ("12 days of cover
// on Tuesday, 6 today") - what actually makes a merchant act.
// See SCHEMA.md §3.8.
export const inventorySnapshots = mysqlTable(
  'inventory_snapshots',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    variantGid: varchar('variant_gid', { length: 255 }).notNull(),
    inventoryItemGid: varchar('inventory_item_gid', { length: 255 }).notNull(),
    locationGid: varchar('location_gid', { length: 255 }).notNull(),
    available: int('available').notNull(),
    capturedAt: datetime('captured_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index('ix_inventory_snapshots_variant_captured').on(t.shopId, t.variantGid, t.capturedAt),
    index('ix_inventory_snapshots_captured').on(t.capturedAt),
  ],
);

// Shop-wide order count, incremented on every orders/create regardless of
// bundle attribution. Not in SCHEMA.md's table list, but the traction
// formula's totalOrders30d denominator (§4.4) needs a shop-wide total,
// and bundle_orders only records attributed orders - counting those as
// the denominator would make attach rate always look artificially high.
// Same rollup shape as variant_metrics_daily, one grain up.
export const shopOrderCountsDaily = mysqlTable(
  'shop_order_counts_daily',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    orderCount: int('order_count', { unsigned: true }).notNull().default(0),

    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
  },
  (t) => [uniqueIndex('uq_shop_order_counts_shop_day').on(t.shopId, t.day)],
);
