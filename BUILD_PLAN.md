# Build Plan — 8 to 14 September 2026

Six working days to a presentation on **Monday 14 September**.

The plan is sequenced by **risk, not by comfort**. Auth and webhooks are the two things that can
silently eat two days, so they go first, while there is still room to recover. The theme — the
part that is most fun and most visible — goes late, because it is the part I can reliably build
fast and can trim without breaking anything else.

**The rule for the whole week:** end every day with something that runs. Never go to sleep on a
broken build.

---

## Day 0 — Tuesday 8 Sept · Foundations

_Goal: `npm run dev` opens an embedded app inside a real dev store._

**Accounts and tooling**

- [ ] Shopify Partner account → create a development store
- [ ] Seed the store: 18 products across 6 heat levels and 6 flavour profiles, with variants,
      images, **cost per item set on 16 of 18**, and inventory tracking on
- [ ] Metafield definitions: `custom.heat_level`, `custom.flavor_profile`, `custom.batch_number`,
      `custom.pepper_origin`, `custom.harvest_month`, `custom.bottle_count`, `custom.pairs_with`
- [ ] `npm i -g @shopify/cli` · `shopify app init` · verify the tunnel resolves

**Repo**

- [ ] Monorepo with npm workspaces (`theme`, `app/server`, `app/web`, `app/db`)
- [ ] TypeScript strict, ESLint + Prettier, `.env.example`, zod-validated env at boot
- [ ] `docker-compose.yml` with MySQL 8
- [ ] `shopify.app.toml`: scopes, `embedded = true`, app proxy (`prefix=apps`, `subpath=flights`),
      `api_version = "2026-07"`
- [ ] Drizzle configured, first migration (`shops`, `sessions`), `drizzle-kit migrate` runs clean
- [ ] Fastify boots, `/healthz` and `/readyz` respond
- [ ] Vite dev server, `index.html` loading App Bridge + Polaris from the Shopify CDN
- [ ] App installs and renders "Bundle Studio" inside the admin iframe

**End-of-day check:** the app loads inside Shopify admin. Nothing else matters today.

---

## Day 1 — Wednesday 9 Sept · Auth, webhooks, audit

_Goal: the plumbing that everything else stands on is done and tested._

- [ ] Session token verification: signature, `exp`, `nbf`, `aud` == client id, `iss`/`dest` host match
- [ ] Token exchange for an offline token; AES-256-GCM encryption at rest
- [ ] **The 400 → 401 + `X-Shopify-Retry-Invalid-Session-Request: 1` path, with a test.** Skipping
      this costs a mysterious debugging session on Friday
- [ ] Fallback `/auth` authorization-code flow with `state` + `hmac`
- [ ] `authenticatedFetch` on the client: attaches `shopify.idToken()`, retries once on that 401
- [ ] Admin GraphQL client with cost-aware throttling (`extensions.cost.throttleStatus`)
- [ ] Webhook registration; raw-body HMAC verification; `webhook_events` idempotency table
- [ ] Jobs table + worker loop with `FOR UPDATE SKIP LOCKED`, backoff, dead-letter
- [ ] `activity_log` + the service that writes diffs inside the caller's transaction
- [ ] `app/uninstalled` handler: purge tokens, soft-delete shop

**End-of-day check:** place a test order in the dev store → a `webhook_events` row appears →
a job runs → an `activity_log` entry exists. Send the same webhook twice → still one row.

**This is the highest-risk day.** If it slips, cut the fallback `/auth` flow (it is not on the
demo path) before cutting anything else.

---

## Day 2 — Thursday 10 Sept · Bundle CRUD

_Goal: the full create → edit → publish loop works end to end._

- [ ] Migration 2: `bundles`, `bundle_items`, `bundle_price_tiers`, `bundle_rules`
- [ ] Repositories with `shopId` as the required first argument; cross-tenant isolation test
- [ ] `bundle.service`: create, update, validate, publish, pause, soft delete
- [ ] Publish transaction with the `publishing` intermediate state +
      `discountAutomaticBasicCreate`, and the reconcile job for a failed Shopify call
- [ ] `/api/products/search` proxying Admin GraphQL with a 60 s LRU cache
- [ ] App UI: layout, nav, bundle list, bundle editor (product picker, tiers, rules), empty states
- [ ] zod schemas on every route; the typed error hierarchy and single error handler

**End-of-day check:** create a bundle in the app, publish it, and see the automatic discount
appear in Shopify admin. Every change shows up in the activity log.

---

## Day 3 — Friday 11 Sept · The scoring engine

_Goal: the feature that makes this more than CRUD._

- [ ] Migration 3: `variant_metrics_daily`, `inventory_snapshots`, `bundle_orders`,
      `bundle_scores`, `alerts`
- [ ] `orders/create` and `orders/cancelled` → metrics rollup + bundle attribution from `_flight_id`
- [ ] `inventory_levels/update` → snapshot + fan-out to affected bundles
- [ ] `products/update` / `products/delete` → cache refresh, broken-component alert
- [ ] **`domain/scoring.ts` as pure functions** — inventory, margin, traction, balance, composite
- [ ] Unit tests first, on the boundaries: zero velocity, zero on-hand, single item, all-identical
      heat, missing cost data, brand-new bundle. **Write these before the UI** — this is the code
      that will be questioned in the presentation
- [ ] Weight renormalisation when a component is unavailable; `partial: true` flag
- [ ] `primary_reason` sentence + `recommended_action` swap query
- [ ] Debounced recompute jobs; nightly sweep; alerts with `dedupe_key` and auto-resolve
- [ ] `current_score_id` written inside the score-insert transaction
- [ ] Dashboard UI: KPI tiles, score distribution, alert list, activity feed
- [ ] Bundle detail: score gauge, four-component breakdown, trend sparkline, the recommendation

**End-of-day check:** drop inventory on one variant in the dev store → within a minute the bundle
drops to `at_risk`, names the limiting variant, and suggests a specific swap. **This exact
sequence is the centre of the demo — rehearse it today, not on Sunday.**

---

## Day 4 — Saturday 12 Sept · The theme

_Goal: a storefront that looks designed, not assembled._

- [ ] Theme scaffold; `settings_schema.json` with the brand tokens; `css-variables.liquid`
- [ ] `base.css`: type scale, spacing scale, the heat palette, focus styles, reduced-motion
- [ ] Header, footer, `sauce-card` snippet, `heat-dial` snippet, `responsive-image` snippet
- [ ] **Section 1** — `ember-hero` (media, batch ticker, dual CTA)
- [ ] **Section 2** — `heat-index-rail` (filter, URL state)
- [ ] **Section 3** — `batch-story` (metafield-driven, with fallbacks)
- [ ] **Section 4** — `flavor-matrix` (CSS grid, comparison mode)
- [ ] Templates: home, collection, product, cart
- [ ] Cart: flight grouping by `_flight_id`, free-shipping bar, a selling empty state
- [ ] Presets and defaults on every section; all copy through `locales/en.default.json`

**End-of-day check:** every page renders correctly at 375 px, 768 px, and 1440 px, and every
section can be added and configured from the theme editor without touching code.

---

## Day 5 — Sunday 13 Sept · Flight Builder + integration

_Goal: the two halves become one system._

- [ ] `/proxy/bundles` and `/proxy/validate` with signature verification + 60 s timestamp window
- [ ] Metafield snapshot written on publish (the fallback path)
- [ ] **Section 5** — `flight-builder`: size step, slot rail, heat curve SVG, balance meter
- [ ] Live coaching with **one** suggestion at a time and a working one-tap swap
- [ ] Server-authoritative pricing; tier-proximity nudge copy
- [ ] `cart/add.js` with `_flight_id` / `_flight_name` / `_flight_slot` properties
- [ ] URL-hash + `sessionStorage` state persistence
- [ ] All four failure paths (proxy down, sold out, add-to-cart fails, no JS)
- [ ] Full keyboard pass; `aria-live` region; axe clean; contrast verified
- [ ] Lighthouse mobile ≥ 90 on home and product
- [ ] Property test: storefront price == server price across 200 random selections

**End-of-day check:** build a flight on the storefront, add it, check out, and watch the order
webhook land, get attributed to the bundle, and move that bundle's score. **That single loop is
the whole submission** — if it runs, everything else is presentation.

---

## Day 6 — Monday 14 Sept (morning) · Ship and rehearse

_No new features. None._

- [ ] `npm run seed` produces the demo store state, including the SKU engineered to sit ~6 days
      from stock-out
- [ ] `README.md` verified by deleting `node_modules`, dropping the database, and following it
      literally
- [ ] Final read of `APP_DECISIONS.md`
- [ ] `.env` is gitignored; no secret anywhere in git history; `.env.example` complete
- [ ] Screenshots and a 2-minute screen recording as a backup for a network failure
- [ ] **Two full timed run-throughs of the demo**
- [ ] Push, verify a clean clone builds

---

## If you are behind

Cut in this order. Decide this now, not at 11pm on Sunday.

**Cut first (nobody will miss these):**

1. `flavor-matrix` section — you still have four custom sections, one more than required
2. Alert acknowledge/resolve UI — keep alert _generation_, drop the workflow
3. Score trend sparkline
4. Bundle scheduling (`starts_at` / `ends_at`)
5. Metafield fallback path — App Proxy alone is fine if the venue's network is fine
6. The fallback `/auth` authorization-code route

**Cut only under real pressure:** 7. `flavor-matrix` and `batch-story` both, leaving three custom sections exactly 8. Playwright tests — keep the vitest unit tests on scoring 9. Traction component of the score — ship with three components and renormalised weights, and
say so

**Never cut. This is the submission:**

- Token exchange auth working inside the admin iframe
- One complete bundle CRUD loop, publish included
- The Bundle Health Score with its explanation and recommendation
- The activity log
- The Flight Builder adding a correctly-propertied flight to the cart
- `APP_DECISIONS.md` and `README.md`

---

## Demo script — 10 minutes

Open on the storefront, not the code. Lead with the problem, not the stack.

| Time | Beat               | What you say and show                                                                                                                                                           |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | **The problem**    | "A small-batch producer's highest-AOV lever is bundles. Bundles are also the thing that silently breaks on them." One sentence, no slides                                       |
| 0:30 | **The store**      | Home, heat index rail, a product page. Point at the heat dial and the batch panel — every attribute here is real structured data, not decoration                                |
| 2:00 | **Flight Builder** | Build a flight deliberately badly — all smoky, all tier 5. Let it coach you. Take the swap. Watch the balance meter and the price move. Add to cart, show the grouped cart card |
| 4:00 | **The pivot**      | "That flight exists because a merchant published it. Here's where." Open the app in Shopify admin                                                                               |
| 4:30 | **Dashboard**      | Portfolio, score distribution, an open alert already waiting                                                                                                                    |
| 5:15 | **The score**      | Open the at-risk bundle. Read the reason out loud: _six days of cover on Charred Pineapple._ Then the recommendation. **This is the moment. Slow down here**                    |
| 6:30 | **Live**           | In another tab, drop that variant's inventory in Shopify admin. Come back, refresh — the score moved and the alert fired. Real webhooks, real recompute                         |
| 7:30 | **Activity log**   | "Who changed this and when." Show a before/after diff                                                                                                                           |
| 8:15 | **Architecture**   | One diagram. Token exchange, four trust boundaries, webhook → job → score. Thirty seconds, no more                                                                              |
| 9:00 | **Tradeoffs**      | Name three unprompted: MySQL queue over Redis, automatic discount over Cart Transform, cached titles over live lookups. Say what you'd do next                                  |
| 9:45 | **Close**          | "Two surfaces, one system: the storefront's definition of a balanced flight and the app's are the same function."                                                               |

**Rehearsal notes**

- The single most impressive twenty seconds is the live inventory drop moving the score. Practise
  it until it is automatic, and have the screen recording ready in case the tunnel dies.
- Have the scoring unit test file open in a second window. If anyone asks "how do you know the
  score is right", showing the boundary-case tests answers it better than any explanation.
- Deliberately break the proxy and show the builder carrying on, **if** you have time in hand.
  It is the strongest single signal of production thinking in the whole demo.
- When asked what you would change: lead with the Cart Transform Function. Knowing the limitation
  of your own compromise is what a senior answer sounds like.
- If something breaks live, say what you expected, what happened, and where you would look. That
  is a better interview answer than a demo that never breaks.
