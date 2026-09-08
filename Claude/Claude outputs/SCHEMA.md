# Ember & Ash — Data Model & Scoring Engine

**Database:** MySQL 8.0 · InnoDB · `utf8mb4_0900_ai_ci`
**ORM:** Drizzle ORM (`drizzle-orm/mysql2`) + `drizzle-kit` migrations

---

## 1. Modelling conventions

These are applied without exception; consistency is what makes a schema reviewable.

| Convention | Rule | Why |
|---|---|---|
| Primary keys | `BIGINT UNSIGNED AUTO_INCREMENT` | Monotonic inserts keep the clustered index from fragmenting. UUIDv4 PKs in InnoDB are a well-known write-throughput mistake |
| Public identifiers | `public_id CHAR(26)` (ULID) on user-facing rows | URLs and API responses never leak row counts or allow enumeration |
| Money | `INT`/`BIGINT` **cents** + `currency CHAR(3)` | Floats do not do money. No `DECIMAL` arithmetic scattered across the app |
| Percentages | **basis points** `SMALLINT` (2000 = 20.00%) | Exact integer math, no rounding drift when composing discounts |
| Shopify identifiers | full GIDs as `VARCHAR(255)` (`gid://shopify/Product/123`) | The API returns and accepts GIDs; storing bare numeric IDs forces string surgery on every call |
| Timestamps | `DATETIME(3)` in **UTC**, `created_at`/`updated_at` on every table | `TIMESTAMP` has a 2038 ceiling and silently applies session timezones |
| Deletes | soft delete via `deleted_at` on merchant-visible entities | An audit trail that references deleted rows is not an audit trail |
| Tenancy | **every** tenant table carries `shop_id`, and every composite index leads with it | Multi-tenant isolation enforced by the schema, not by developer discipline |
| Enums | MySQL `ENUM` mirrored by a TS union in Drizzle | Type-safe at both ends; invalid states unrepresentable |
| JSON | `JSON` columns only for genuinely open-shaped data (rule config, score breakdown, diffs) | Never for anything that needs to be filtered or joined |

---

## 2. Entity relationship overview

```
shops ─┬─< sessions
       ├─< bundles ─┬─< bundle_items
       │            ├─< bundle_price_tiers
       │            ├─< bundle_rules
       │            ├─< bundle_scores        (append-only history)
       │            ├─< bundle_orders
       │            └─< alerts
       ├─< variant_metrics_daily             (velocity source)
       ├─< inventory_snapshots               (runway source)
       ├─< activity_log
       ├─< webhook_events
       └─< jobs

bundles.current_score_id ──► bundle_scores.id   (denormalised pointer, see §4.7)
```

Nine core tables plus five operational ones. The task asks for "multiple related tables"; the
relationships here are load-bearing, not decorative — the score cannot be computed without
joining across five of them.

---

## 3. Tables

### 3.1 `shops` — tenant root

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | |
| `shop_domain` | VARCHAR(255) **UNIQUE** | `ember-and-ash.myshopify.com` |
| `shopify_shop_gid` | VARCHAR(255) | |
| `access_token_ciphertext` | VARBINARY(512) | AES-256-GCM |
| `access_token_iv` | VARBINARY(12) | |
| `access_token_tag` | VARBINARY(16) | |
| `key_version` | SMALLINT UNSIGNED, default 1 | supports key rotation |
| `scopes` | VARCHAR(512) | detects a scope change needing re-consent |
| `currency` | CHAR(3) | |
| `iana_timezone` | VARCHAR(64) | nightly sweep runs at 03:00 *shop-local* |
| `margin_floor_bps` | SMALLINT UNSIGNED, default 3000 | merchant-tunable scoring input |
| `margin_target_bps` | SMALLINT UNSIGNED, default 5500 | |
| `installed_at`, `uninstalled_at` | DATETIME(3), nullable | |

*Token columns are `VARBINARY`, not `VARCHAR`* — ciphertext is bytes, and a collation applied to
bytes is a corruption waiting to happen.

### 3.2 `sessions`

`id`, `shop_id` FK, `session_id` VARCHAR(255) UNIQUE, `is_online` BOOL, `staff_user_id`,
`staff_email_hash` VARBINARY(32), `expires_at`, timestamps.
Index: `(shop_id, expires_at)` for the expiry sweep.

Online tokens are per-staff and short-lived; storing the *hash* of the staff email is enough to
attribute an activity-log entry without holding staff PII.

### 3.3 `bundles` — the central entity

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT UNSIGNED PK | |
| `public_id` | CHAR(26) | ULID, used in URLs |
| `shop_id` | BIGINT UNSIGNED FK → shops | ON DELETE CASCADE |
| `handle` | VARCHAR(120) | **UNIQUE (shop_id, handle)** |
| `title`, `subtitle` | VARCHAR(160) / VARCHAR(255) | |
| `status` | ENUM('draft','publishing','active','paused','archived') | `publishing` is the in-flight state protecting the external side effect (ARCHITECTURE §6.1) |
| `min_items`, `max_items` | TINYINT UNSIGNED | flight sizes, e.g. 3 and 6 |
| `pricing_mode` | ENUM('tiered_percent','fixed_price','per_item_percent') | |
| `fixed_price_cents` | INT UNSIGNED, nullable | only for `fixed_price` |
| `storefront_collection_gid` | VARCHAR(255), nullable | discount scope |
| `discount_gid` | VARCHAR(255), nullable | the automatic discount this bundle owns |
| `current_score_id` | BIGINT UNSIGNED, nullable FK → bundle_scores | see §4.7 |
| `starts_at`, `ends_at` | DATETIME(3), nullable | scheduled campaigns |
| `created_at`, `updated_at`, `deleted_at` | DATETIME(3) | |

Indexes: `UNIQUE(shop_id, handle)` · `(shop_id, status, deleted_at)` · `(shop_id, ends_at)`

CHECK constraints (MySQL 8 enforces these): `min_items >= 1`,
`max_items >= min_items`, `fixed_price_cents IS NOT NULL OR pricing_mode <> 'fixed_price'`.
Invariants belong in the database, not only in the service layer.

### 3.4 `bundle_items` — components

`id`, `bundle_id` FK, `product_gid`, `variant_gid`, `inventory_item_gid`, `sku`,
`product_title_cache`, `variant_title_cache`, `image_url_cache`,
`unit_price_cents`, `unit_cost_cents`, `position` TINYINT,
`is_required` BOOL, `heat_level` TINYINT (0–5), `flavor_profile` ENUM('smoky','fruity','citrus','umami','herbal','sweet-heat'),
timestamps.

Indexes: `UNIQUE(bundle_id, variant_gid)` · `(variant_gid)` — the second one exists because
`inventory_levels/update` arrives keyed by variant and must fan out to *every* affected bundle.

**On the `_cache` columns:** these are a deliberate denormalisation. The dashboard renders 30
bundles with ~6 components each; without caching titles and prices that is 180 Admin API lookups
per page load, which the rate limiter would reject. They are refreshed by `products/update`
webhooks and by the nightly sweep, and the bundle editor always reads live data from Shopify
before saving. Stale display data is acceptable; stale *pricing* data is not, which is why
`unit_price_cents` is re-read at publish and at every score recompute.

`unit_cost_cents` comes from `InventoryItem.unitCost` — needed for margin, and frequently null
on real stores, which the margin component handles explicitly (§4.3).

### 3.5 `bundle_price_tiers`

`id`, `bundle_id` FK, `min_quantity` TINYINT, `discount_bps` SMALLINT, timestamps.
`UNIQUE(bundle_id, min_quantity)`.

Example for a flight: `(3 → 1000)`, `(4 → 1500)`, `(6 → 2200)`. Resolution is "highest
`min_quantity` ≤ selected count".

### 3.6 `bundle_rules`

`id`, `bundle_id` FK, `rule_type` ENUM(`max_per_heat_tier`, `min_distinct_flavors`,
`require_heat_range`, `exclude_together`, `require_one_of`), `config` JSON, `is_blocking` BOOL,
timestamps.

`is_blocking` separates the two feedback classes the Flight Builder needs: a blocking rule stops
add-to-cart ("a 6-flight needs at least 3 distinct flavours"); a non-blocking one is advice
("this flight is heavy on smoky — swap slot 2?"). Coaching the customer and refusing the customer
are different products, and the schema distinguishes them.

Example config: `{"tier": 5, "max": 2}` · `{"min": 3}` · `{"variant_gids": [...]}`

### 3.7 `variant_metrics_daily` — the velocity rollup

`id`, `shop_id`, `variant_gid`, `day` DATE, `units_sold` INT, `orders` INT,
`gross_cents` BIGINT, `refunded_units` INT, timestamps.
`UNIQUE(shop_id, variant_gid, day)` · index `(shop_id, day)`.

Rolled up from order webhooks and reconciled nightly. **This table is the reason scoring is
fast.** The alternative — computing 7-day velocity from raw orders at read time — turns a 40 ms
dashboard into a multi-second one. A daily grain is the right resolution for a runway estimate;
hourly would be noise.

### 3.8 `inventory_snapshots`

`id`, `shop_id`, `variant_gid`, `inventory_item_gid`, `location_gid`, `available` INT,
`captured_at` DATETIME(3).
Indexes: `(shop_id, variant_gid, captured_at DESC)` · `(captured_at)` for pruning.

Append-only, 90-day retention. Kept as history rather than a single mutable "current" column so
the app can show *"you had 12 days of cover on Tuesday, you have 6 today"* — a trend, which is
what actually makes a merchant act.

### 3.9 `bundle_orders` — attribution

`id`, `shop_id`, `bundle_id` FK, `order_gid`, `order_number`, `flight_token` CHAR(26),
`item_count` TINYINT, `subtotal_cents`, `discount_cents`, `currency`,
`customer_hash` VARBINARY(32) nullable, `placed_at`, `cancelled_at` nullable.
`UNIQUE(shop_id, order_gid, bundle_id)` · index `(shop_id, bundle_id, placed_at)`.

Attribution reads the `_flight_id` line-item property from the order payload. When absent
(customer added the same products by hand), the order is not attributed — attach rate measures
the *builder*, and inflating it with coincidental baskets would make the metric lie.

`customer_hash` is HMAC-SHA256(customer_id, per-shop salt). It supports "how many repeat flight
buyers" without the app ever holding a customer identifier.

### 3.10 `bundle_scores` — append-only score history

| Column | Type |
|---|---|
| `id` | BIGINT UNSIGNED PK |
| `shop_id`, `bundle_id` | FK |
| `score` | DECIMAL(5,2) |
| `band` | ENUM('healthy','watch','at_risk') |
| `inventory_score`, `margin_score`, `traction_score`, `balance_score` | DECIMAL(5,2) |
| `min_days_cover` | DECIMAL(6,2) |
| `limiting_variant_gid` | VARCHAR(255) — *which component is the weakest link* |
| `effective_margin_bps` | SMALLINT |
| `attach_rate_bps` | SMALLINT |
| `primary_reason` | VARCHAR(255) — human sentence, generated at compute time |
| `recommended_action` | JSON |
| `breakdown` | JSON — every input, for full auditability |
| `computed_at` | DATETIME(3) |

Index: `(bundle_id, computed_at DESC)`.

Never updated, only inserted. Two payoffs: a trend sparkline for free, and — more importantly —
when a merchant asks *"why was this flagged last Thursday?"* the exact inputs are still there.
A scoring system you cannot audit is a scoring system nobody trusts.

### 3.11 `activity_log` — the audit trail

`id`, `shop_id`, `actor_type` ENUM('staff','system','webhook'), `actor_id`, `actor_label`,
`entity_type` ENUM('bundle','bundle_item','alert','shop'), `entity_id`,
`action` VARCHAR(64) (`bundle.created`, `bundle.published`, `item.removed`, `score.band_changed`,
`alert.raised`, `alert.acknowledged`), `before` JSON, `after` JSON, `metadata` JSON,
`request_id` CHAR(26), `created_at`.

Indexes: `(shop_id, created_at DESC)` · `(entity_type, entity_id, created_at DESC)`.

Written in the **same transaction** as the change it describes. A log written after commit is a
log that loses entries exactly when you need them. `before`/`after` store only the changed keys,
not whole rows — full-row snapshots make a diff view unreadable and the table enormous.

`request_id` ties a log entry back to the server log line that produced it.

### 3.12 `alerts`

`id`, `shop_id`, `bundle_id` nullable FK, `alert_type` ENUM('stockout_risk','margin_breach',
'component_deleted','traction_drop','bundle_expiring'), `severity` ENUM('info','warning','critical'),
`title`, `body`, `recommended_action` JSON, `status` ENUM('open','acknowledged','resolved'),
`dedupe_key` VARCHAR(255), `created_at`, `acknowledged_at`, `resolved_at`.

`dedupe_key` = `{type}:{bundle_id}:{limiting_variant}`, made unique **only while the alert is
open**, using the same generated-column technique as `jobs` (§3.14) — one open alert per
condition, while the resolved history of that condition accumulates freely:

```sql
open_key VARCHAR(320)
  GENERATED ALWAYS AS (IF(status = 'open', CONCAT(shop_id, ':', dedupe_key), NULL)) STORED,
UNIQUE KEY uq_alerts_open (open_key)
```

Without this the merchant gets the same stock-out warning every time an inventory webhook fires.
**Alert fatigue is a product bug**, and it is fixed here in the schema.

Alerts auto-resolve: when a recompute finds the condition cleared, the open alert moves to
`resolved` and an activity entry records it.

### 3.13 `webhook_events` — idempotency ledger

`id`, `shop_id` nullable, `webhook_id` VARCHAR(64) **UNIQUE**, `topic`, `api_version`,
`payload_hash` VARBINARY(32), `status` ENUM('received','processed','failed'), `attempts`,
`last_error` TEXT, `received_at`, `processed_at`.

The unique index on `webhook_id` **is** the idempotency mechanism: insert first, and let a
duplicate-key error tell you it is a replay. 30-day retention.

### 3.14 `jobs`

`id`, `shop_id`, `type` VARCHAR(64), `payload` JSON, `dedupe_key` VARCHAR(255) nullable,
`status` ENUM('pending','running','done','failed','dead'), `attempts`, `max_attempts`,
`run_at`, `locked_at`, `locked_by` VARCHAR(64), `last_error` TEXT, timestamps.

Indexes: `(status, run_at)` — the claim query's covering index.

**Debounce, implemented within MySQL's constraints.** MySQL has no partial/filtered indexes, so a
naive `UNIQUE(shop_id, type, dedupe_key)` would block a bundle from ever being re-queued after its
first job completed. Instead there is a generated column that is non-null *only while the job is
pending*, and a unique index over it — MySQL's unique indexes ignore NULLs, so completed jobs drop
out of the constraint automatically:

```sql
pending_key VARCHAR(320)
  GENERATED ALWAYS AS (
    IF(status = 'pending', CONCAT(shop_id, ':', type, ':', IFNULL(dedupe_key, '')), NULL)
  ) STORED,
UNIQUE KEY uq_jobs_pending (pending_key)
```

An enqueue is then `INSERT … ON DUPLICATE KEY UPDATE run_at = LEAST(run_at, VALUES(run_at))`, so
a burst of forty inventory webhooks collapses into one pending recompute per bundle.

---

## 4. The logic feature: Bundle Health Score

A composite 0–100 score, recomputed on event and nightly, that answers one question:
**is this bundle going to keep working, and if not, what do I do about it?**

Every sub-score is normalised to 0–100 and clamped, so no single dimension can dominate through
an outlier.

### 4.1 Weights

```
score = 0.40 × inventory
      + 0.25 × margin
      + 0.20 × traction
      + 0.15 × balance
```

**The weighting is a product argument, and it should be defended as one.** Inventory dominates
because a stock-out is the only failure that is *unrecoverable* — the order is already placed and
the customer is already disappointed. A thin margin is a bad quarter; a broken bundle is a bad
review. Traction is weighted below margin because a young bundle has no traction yet and should
not be punished for it. Balance is smallest because it is a quality signal, not a risk signal.

Weights live in one config object, not scattered through the code, so they are tunable — and in a
later version, per-merchant.

### 4.2 Inventory runway — 40%

```ts
velocity(variant)   = Σ units_sold over trailing 7 days / 7        // from variant_metrics_daily
daysOfCover(v)      = onHand(v) / max(velocity(v), 0.1)            // floor avoids ÷0 → Infinity
minDaysCover        = min(daysOfCover(v) for v in required items)  // weakest link
inventoryScore      = clamp01((minDaysCover - 3) / (21 - 3)) × 100
```

- **Minimum, not average.** A bundle is only as available as its scarcest component. Averaging
  here would be the single biggest modelling error available, and it is worth saying out loud in
  the presentation.
- 3 days → 0, 21 days → 100, linear between. Below 3 days the bundle is effectively already
  broken; beyond 21 days more stock adds no confidence.
- Optional components (`is_required = false`) are excluded — they can be swapped without
  breaking the flight.
- `limiting_variant_gid` is persisted so the UI can name the culprit instead of showing a number.

### 4.3 Margin integrity — 25%

```ts
grossRevenue   = Σ unit_price_cents
discount       = resolveTier(itemCount).discount_bps
netRevenue     = grossRevenue × (10000 - discount) / 10000
cogs           = Σ unit_cost_cents
effMarginBps   = ((netRevenue - cogs) / netRevenue) × 10000
marginScore    = clamp01((effMarginBps - floor_bps) / (target_bps - floor_bps)) × 100
```

Defaults: floor 3000 bps (30%), target 5500 bps (55%), both per-shop columns.

**When cost data is missing** (`unit_cost_cents IS NULL` on any component — common on real
stores) the margin component is *excluded and the remaining weights renormalise*, and the score
is flagged `partial: true` with the reason "cost price not set on 2 components". It does not
quietly score 0 and it does not quietly score 100. Substituting a fabricated number for missing
data is how analytics features lose merchant trust permanently.

### 4.4 Demand traction — 20%

Raw attach rate is `bundleOrders / totalOrders` over 30 days. Used directly, a brand-new bundle
with 1 order out of 2 scores a perfect 100. So it is shrunk toward the shop's prior:

```ts
priorRate    = shop-wide bundle attach rate (30d)
k            = 20                                   // pseudo-count strength
shrunk       = (bundleOrders + k × priorRate) / (totalOrders30d + k)   // Bayesian shrinkage
benchmark    = max(shrunk rate across this shop's active bundles)
tractionScore= clamp01(shrunk / max(benchmark, 0.01)) × 100
```

Two decisions worth stating:

- **Shrinkage** means a bundle needs real volume before it can claim a high score. This is the
  difference between a metric and a random number generator.
- **The benchmark is the merchant's own best bundle**, not an industry constant. A store doing 4
  orders a day and a store doing 400 have nothing in common, and any hardcoded threshold is
  wrong for at least one of them.

New bundles (< 14 days live) return `traction: null` and the weight renormalises — same rule as
missing cost data. A bundle is not "unhealthy" for being new.

### 4.5 Composition balance — 15%

```ts
heatSpread   = (max(heat) - min(heat)) / 5                    // 0..1
flavorDiv    = distinctFlavors / min(itemCount, 4)            // 0..1, saturates at 4
duplication  = 1 - (maxOverlapWithOtherActiveBundle / itemCount)
balanceScore = (0.4 × heatSpread + 0.4 × flavorDiv + 0.2 × duplication) × 100
```

This is the component that ties the app back to the storefront: a flight that scores well on
balance is exactly the flight the Flight Builder's "your flight is unbalanced" coach is trying to
steer a customer toward. The same domain function, `computeBalance()`, is called by the scoring
job **and** by the `/proxy/validate` endpoint. One definition of "balanced", two surfaces.

The duplication term penalises a merchant for publishing four near-identical flights — a real
merchandising failure that no analytics tool reports.

### 4.6 Bands, reasons, and actions

| Band | Range | UI |
|---|---|---|
| `healthy` | 75–100 | green |
| `watch` | 50–74 | amber |
| `at_risk` | 0–49 | red + alert raised |

The score always ships with a sentence and an action, generated from the lowest-scoring
component:

> **41 · At risk** — *Charred Pineapple has 6 days of cover at current velocity.*
> **Suggested:** swap in *Smoked Habanero* (34 days cover, same heat tier, keeps flavour spread at 4).

The swap suggestion is a real query, not a placeholder: find variants in the same heat tier with
`daysOfCover > 21`, rank by resulting `balanceScore`, return the top one. This is the moment in
the demo where the app stops looking like a dashboard and starts looking like a product.

### 4.7 Recomputation and the `current_score_id` denormalisation

**Triggers:** `orders/create`, `orders/cancelled`, `inventory_levels/update`, `products/update`,
any bundle edit, publish/pause, and the 03:00 nightly sweep.

Bursts are debounced by the jobs table's `dedupe_key` (60-second coalescing window), so a restock
touching 40 variants produces one recompute per affected bundle, not forty.

`bundles.current_score_id` points at the latest row in the append-only `bundle_scores`. Without
it, the bundle list page needs a correlated "latest score per bundle" subquery — the classic
greatest-n-per-group problem, and a table scan as history grows. With it, the list is a single
join on a primary key.

*The tradeoff, stated:* the pointer can drift from the true latest row if a write fails
mid-transaction. It is set inside the same transaction as the score insert, and the nightly
sweep reconciles any drift. That is a conscious trade of a small consistency risk for an
order-of-magnitude read improvement on the most-visited page in the app.

---

## 5. Drizzle implementation

### 5.1 Schema organisation

```
app/db/src/schema/
  shops.ts      sessions.ts   bundles.ts   metrics.ts
  scoring.ts    activity.ts   ops.ts       index.ts   // barrel
```

```ts
// bundles.ts (abridged)
export const bundleStatus = ['draft','publishing','active','paused','archived'] as const;

export const bundles = mysqlTable('bundles', {
  id:        bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  publicId:  char('public_id', { length: 26 }).notNull(),
  shopId:    bigint('shop_id', { mode: 'number', unsigned: true })
               .notNull().references(() => shops.id, { onDelete: 'cascade' }),
  handle:    varchar('handle', { length: 120 }).notNull(),
  title:     varchar('title', { length: 160 }).notNull(),
  status:    mysqlEnum('status', bundleStatus).notNull().default('draft'),
  minItems:  tinyint('min_items', { unsigned: true }).notNull().default(3),
  maxItems:  tinyint('max_items', { unsigned: true }).notNull().default(6),
  discountGid: varchar('discount_gid', { length: 255 }),
  currentScoreId: bigint('current_score_id', { mode: 'number', unsigned: true }),
  createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime('updated_at', { fsp: 3 }).notNull()
               .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
  deletedAt: datetime('deleted_at', { fsp: 3 }),
}, (t) => ({
  shopHandle: uniqueIndex('uq_bundles_shop_handle').on(t.shopId, t.handle),
  shopStatus: index('ix_bundles_shop_status').on(t.shopId, t.status, t.deletedAt),
}));

export const bundlesRelations = relations(bundles, ({ one, many }) => ({
  shop:  one(shops, { fields: [bundles.shopId], references: [shops.id] }),
  items: many(bundleItems),
  tiers: many(bundlePriceTiers),
  rules: many(bundleRules),
  currentScore: one(bundleScores, {
    fields: [bundles.currentScoreId], references: [bundleScores.id],
  }),
}));
```

`relations()` is what makes the read path clean — the bundle editor loads a bundle with its
items, tiers, rules and current score in one `db.query.bundles.findFirst({ with: {...} })`
instead of five hand-written joins.

### 5.2 Migrations

```bash
npx drizzle-kit generate   # schema diff → app/db/migrations/0001_*.sql, committed to git
npx drizzle-kit migrate    # apply, tracked in __drizzle_migrations
```

- **Generated SQL is committed and reviewed.** `drizzle-kit push` is used only against a
  throwaway local database; it is never run against anything that holds data, because it will
  cheerfully drop a column.
- Migrations are applied by an **explicit startup gate** — the server checks it is at head and
  refuses to serve traffic if not. Never applied lazily from a request path.
- **Expand/contract for anything destructive:** add the new column → backfill → dual-write →
  switch reads → drop the old column in a *later* migration. A rename is never a rename.
- Every migration is written to be re-runnable and is tested against the seeded database in CI.

### 5.3 Repository pattern

```ts
// Every method takes shopId first. This is the multi-tenancy boundary.
class BundleRepository {
  async findById(shopId: number, publicId: string) {
    return this.db.query.bundles.findFirst({
      where: and(
        eq(bundles.shopId, shopId),            // ← never optional
        eq(bundles.publicId, publicId),
        isNull(bundles.deletedAt),
      ),
      with: { items: true, tiers: true, rules: true, currentScore: true },
    });
  }
}
```

Services never import `db` directly, so there is exactly one layer where a query can forget its
`shopId` — and an integration test asserts shop A cannot read shop B's bundle by ID.

### 5.4 Transactions

Publish, and any multi-table write, runs inside `db.transaction()`:

```ts
await db.transaction(async (tx) => {
  const [score] = await tx.insert(bundleScores).values(row).$returningId();
  await tx.update(bundles).set({ currentScoreId: score.id }).where(eq(bundles.id, bundleId));
  await tx.insert(activityLog).values(diffEntry);       // audit inside the same transaction
});
```

External API calls are **never** inside a transaction — a Shopify request holding an InnoDB row
lock for 800 ms is a lock-contention incident waiting to happen. That is what the `publishing`
status exists for.

---

## 6. Seed data

`npm run seed` builds a store that demonstrates the product on first open:

- 18 sauces across 6 heat levels and 6 flavour profiles, with cost prices set on 16 of 18 (so the
  "partial score — cost price missing" path is visible, not theoretical)
- 4 bundles: one `healthy`, one `watch`, one `at_risk`, one `draft`
- 90 days of synthetic orders with weekend seasonality and a realistic bundle attach rate
- **one component engineered to be ~6 days from stock-out**, so the at-risk alert, the limiting
  variant, and the swap suggestion all render immediately

A demo that requires the reviewer to imagine the interesting state is a demo that fails.

---

## 7. Performance notes

| Query | Approach | Target |
|---|---|---|
| Dashboard summary | pre-aggregated; `current_score_id` join, no subquery | < 50 ms |
| Bundle list (30 rows) | covering index `(shop_id, status, deleted_at)` | < 30 ms |
| Score recompute (1 bundle) | 3 indexed reads (metrics, inventory, items) + 1 insert | < 80 ms |
| Storefront `/proxy/bundles` | metafield snapshot first; proxy response `Cache-Control: public, max-age=60` | < 100 ms |
| Product search | Admin GraphQL, 60 s in-process LRU | < 300 ms |

Retention: `inventory_snapshots` 90 days, `webhook_events` 30 days, `jobs` (done) 7 days,
`bundle_scores` and `activity_log` kept indefinitely — they are the audit record. A nightly
prune job enforces this; unbounded operational tables are a slow-motion outage.
