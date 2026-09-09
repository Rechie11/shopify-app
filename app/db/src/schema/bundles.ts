import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  smallint,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { shops } from './shops.js';

export const bundleStatus = ['draft', 'publishing', 'active', 'paused', 'archived'] as const;
export const bundlePricingMode = ['tiered_percent', 'fixed_price', 'per_item_percent'] as const;
export const flavorProfile = [
  'smoky',
  'fruity',
  'citrus',
  'umami',
  'herbal',
  'sweet-heat',
] as const;
export const bundleRuleType = [
  'max_per_heat_tier',
  'min_distinct_flavors',
  'require_heat_range',
  'exclude_together',
  'require_one_of',
] as const;

// The central entity. status='publishing' is the in-flight state
// protecting the external side effect (the Shopify discount) - see
// ARCHITECTURE.md §6.1. Invariants belong in the database, not only the
// service layer, hence the CHECK constraints. See SCHEMA.md §3.3.
export const bundles = mysqlTable(
  'bundles',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    publicId: char('public_id', { length: 26 }).notNull(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    handle: varchar('handle', { length: 120 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    subtitle: varchar('subtitle', { length: 255 }),

    status: mysqlEnum('status', bundleStatus).notNull().default('draft'),
    minItems: tinyint('min_items', { unsigned: true }).notNull().default(3),
    maxItems: tinyint('max_items', { unsigned: true }).notNull().default(6),

    pricingMode: mysqlEnum('pricing_mode', bundlePricingMode).notNull().default('tiered_percent'),
    fixedPriceCents: int('fixed_price_cents', { unsigned: true }),

    storefrontCollectionGid: varchar('storefront_collection_gid', { length: 255 }),
    discountGid: varchar('discount_gid', { length: 255 }),

    startsAt: datetime('starts_at', { fsp: 3 }),
    endsAt: datetime('ends_at', { fsp: 3 }),

    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime('deleted_at', { fsp: 3 }),
  },
  (t) => [
    uniqueIndex('uq_bundles_shop_handle').on(t.shopId, t.handle),
    index('ix_bundles_shop_status').on(t.shopId, t.status, t.deletedAt),
    index('ix_bundles_shop_ends').on(t.shopId, t.endsAt),
    check('chk_bundles_min_items', sql`${t.minItems} >= 1`),
    check('chk_bundles_max_gte_min', sql`${t.maxItems} >= ${t.minItems}`),
    check(
      'chk_bundles_fixed_price',
      sql`${t.fixedPriceCents} is not null or ${t.pricingMode} <> 'fixed_price'`,
    ),
  ],
);

// Components. The _cache columns are a deliberate denormalisation - the
// dashboard renders many bundles with several components each, and
// re-reading every title/price from the Admin API on each load would be
// rate-limited. Refreshed by products/update and the nightly sweep; the
// editor always reads live data before saving. See SCHEMA.md §3.4.
export const bundleItems = mysqlTable(
  'bundle_items',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    bundleId: bigint('bundle_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => bundles.id, { onDelete: 'cascade' }),

    productGid: varchar('product_gid', { length: 255 }).notNull(),
    variantGid: varchar('variant_gid', { length: 255 }).notNull(),
    inventoryItemGid: varchar('inventory_item_gid', { length: 255 }),
    sku: varchar('sku', { length: 128 }),

    productTitleCache: varchar('product_title_cache', { length: 255 }),
    variantTitleCache: varchar('variant_title_cache', { length: 255 }),
    imageUrlCache: varchar('image_url_cache', { length: 1024 }),

    unitPriceCents: int('unit_price_cents', { unsigned: true }),
    unitCostCents: int('unit_cost_cents', { unsigned: true }),

    position: tinyint('position', { unsigned: true }).notNull().default(0),
    isRequired: boolean('is_required').notNull().default(true),

    heatLevel: tinyint('heat_level', { unsigned: true }),
    flavorProfile: mysqlEnum('flavor_profile', flavorProfile),

    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uq_bundle_items_bundle_variant').on(t.bundleId, t.variantGid),
    // inventory_levels/update arrives keyed by variant and must fan out to
    // every affected bundle.
    index('ix_bundle_items_variant').on(t.variantGid),
  ],
);

// Resolution is "highest min_quantity <= selected count". See SCHEMA.md §3.5.
export const bundlePriceTiers = mysqlTable(
  'bundle_price_tiers',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    bundleId: bigint('bundle_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => bundles.id, { onDelete: 'cascade' }),

    minQuantity: tinyint('min_quantity', { unsigned: true }).notNull(),
    discountBps: smallint('discount_bps', { unsigned: true }).notNull(),

    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
  },
  (t) => [uniqueIndex('uq_bundle_price_tiers_bundle_qty').on(t.bundleId, t.minQuantity)],
);

// is_blocking separates two feedback classes the Flight Builder needs: a
// blocking rule stops add-to-cart; a non-blocking one is advice. See
// SCHEMA.md §3.6.
export const bundleRules = mysqlTable('bundle_rules', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  bundleId: bigint('bundle_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => bundles.id, { onDelete: 'cascade' }),

  ruleType: mysqlEnum('rule_type', bundleRuleType).notNull(),
  config: json('config').notNull(),
  isBlocking: boolean('is_blocking').notNull().default(false),

  createdAt: datetime('created_at', { fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime('updated_at', { fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
});

export const bundlesRelations = relations(bundles, ({ one, many }) => ({
  shop: one(shops, { fields: [bundles.shopId], references: [shops.id] }),
  items: many(bundleItems),
  tiers: many(bundlePriceTiers),
  rules: many(bundleRules),
}));

export const bundleItemsRelations = relations(bundleItems, ({ one }) => ({
  bundle: one(bundles, { fields: [bundleItems.bundleId], references: [bundles.id] }),
}));

export const bundlePriceTiersRelations = relations(bundlePriceTiers, ({ one }) => ({
  bundle: one(bundles, { fields: [bundlePriceTiers.bundleId], references: [bundles.id] }),
}));

export const bundleRulesRelations = relations(bundleRules, ({ one }) => ({
  bundle: one(bundles, { fields: [bundleRules.bundleId], references: [bundles.id] }),
}));
