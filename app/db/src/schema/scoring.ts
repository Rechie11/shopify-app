import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  bigint,
  char,
  datetime,
  decimal,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  smallint,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { shops } from './shops.js';
import { bundles } from './bundles.js';

// Attribution reads the _flight_id line-item property from the order
// payload. When absent, the order is not attributed - attach rate
// measures the builder, and inflating it with coincidental baskets would
// make the metric lie. See SCHEMA.md §3.9.
export const bundleOrders = mysqlTable(
  'bundle_orders',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    bundleId: bigint('bundle_id', { mode: 'number', unsigned: true })
      .notNull()
      .references((): AnyMySqlColumn => bundles.id, { onDelete: 'cascade' }),

    orderGid: varchar('order_gid', { length: 255 }).notNull(),
    orderNumber: varchar('order_number', { length: 64 }),
    flightToken: char('flight_token', { length: 26 }).notNull(),
    itemCount: tinyint('item_count', { unsigned: true }).notNull(),
    subtotalCents: bigint('subtotal_cents', { mode: 'number' }).notNull(),
    discountCents: bigint('discount_cents', { mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull(),
    // Base64, not VARBINARY - see shops.ts for why.
    customerHash: varchar('customer_hash', { length: 64 }),

    placedAt: datetime('placed_at', { fsp: 3 }).notNull(),
    cancelledAt: datetime('cancelled_at', { fsp: 3 }),
  },
  (t) => [
    uniqueIndex('uq_bundle_orders_shop_order_bundle').on(t.shopId, t.orderGid, t.bundleId),
    index('ix_bundle_orders_bundle_placed').on(t.shopId, t.bundleId, t.placedAt),
  ],
);

export const bundleScoreBand = ['healthy', 'watch', 'at_risk'] as const;

// Never updated, only inserted: a trend sparkline for free, and when a
// merchant asks "why was this flagged last Thursday?" the exact inputs
// are still there. See SCHEMA.md §3.10.
export const bundleScores = mysqlTable(
  'bundle_scores',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    bundleId: bigint('bundle_id', { mode: 'number', unsigned: true })
      .notNull()
      .references((): AnyMySqlColumn => bundles.id, { onDelete: 'cascade' }),

    score: decimal('score', { precision: 5, scale: 2 }).notNull(),
    band: mysqlEnum('band', bundleScoreBand).notNull(),

    inventoryScore: decimal('inventory_score', { precision: 5, scale: 2 }),
    marginScore: decimal('margin_score', { precision: 5, scale: 2 }),
    tractionScore: decimal('traction_score', { precision: 5, scale: 2 }),
    balanceScore: decimal('balance_score', { precision: 5, scale: 2 }),

    minDaysCover: decimal('min_days_cover', { precision: 6, scale: 2 }),
    limitingVariantGid: varchar('limiting_variant_gid', { length: 255 }),
    effectiveMarginBps: smallint('effective_margin_bps'),
    attachRateBps: smallint('attach_rate_bps', { unsigned: true }),

    primaryReason: varchar('primary_reason', { length: 255 }),
    recommendedAction: json('recommended_action'),
    breakdown: json('breakdown'),

    computedAt: datetime('computed_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index('ix_bundle_scores_bundle_computed').on(t.bundleId, t.computedAt)],
);

export const alertType = [
  'stockout_risk',
  'margin_breach',
  'component_deleted',
  'traction_drop',
  'bundle_expiring',
] as const;
export const alertSeverity = ['info', 'warning', 'critical'] as const;
export const alertStatus = ['open', 'acknowledged', 'resolved'] as const;

// dedupe_key is unique only while the alert is open, using the same
// generated-column technique as jobs (ops.ts) - one open alert per
// condition, while resolved history accumulates freely. Without this the
// merchant gets the same stock-out warning every time an inventory
// webhook fires. Alert fatigue is a product bug, fixed in the schema.
// See SCHEMA.md §3.12.
export const alerts = mysqlTable(
  'alerts',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // RESTRICT, not CASCADE: shop_id feeds the open_key generated column
    // below, and MySQL disallows a cascading action on a column a STORED
    // generated column in the same table depends on. See ops.ts (jobs)
    // for the same pattern and the fuller explanation.
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    bundleId: bigint('bundle_id', { mode: 'number', unsigned: true }).references(
      (): AnyMySqlColumn => bundles.id,
      { onDelete: 'cascade' },
    ),

    alertType: mysqlEnum('alert_type', alertType).notNull(),
    severity: mysqlEnum('severity', alertSeverity).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: varchar('body', { length: 1024 }),
    recommendedAction: json('recommended_action'),

    status: mysqlEnum('status', alertStatus).notNull().default('open'),
    dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),

    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    acknowledgedAt: datetime('acknowledged_at', { fsp: 3 }),
    resolvedAt: datetime('resolved_at', { fsp: 3 }),

    openKey: varchar('open_key', { length: 320 }).generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`(if(\`status\` = 'open', concat(\`shop_id\`, ':', \`dedupe_key\`), NULL))`,
      { mode: 'stored' },
    ),
  },
  (t) => [
    uniqueIndex('uq_alerts_open').on(t.openKey),
    index('ix_alerts_shop_status').on(t.shopId, t.status, t.createdAt),
  ],
);
