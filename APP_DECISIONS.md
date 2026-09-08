# APP_DECISIONS.md

**Ember & Ash** — custom Shopify theme + **Bundle Studio** — embedded Shopify admin app
Cherry Anne Dagunan · September 2026

> This is the required submission document. It covers the store concept, the app idea, the key
> architecture and schema decisions, the tradeoffs I accepted, and what I would build next.
> Deep detail lives in `ARCHITECTURE.md`, `SCHEMA.md`, and `THEME_SPEC.md`.

---

## 1. Store concept — Ember & Ash

A fictional small-batch hot sauce company. Fire-roasted peppers, numbered batches, sold until
they run out.

I picked this deliberately rather than reaching for the usual apparel or skincare store, for
three reasons:

1. **The product has real structured attributes.** Heat level, flavour profile, pepper origin,
   batch number. That gives the theme something honest to build navigation and filtering around —
   the heat index rail — instead of decorating a generic product grid.
2. **Small batch means scarcity is genuine.** Limited runs make inventory a first-class concern
   for the merchant, which is what makes the app's core idea real rather than invented.
3. **Tasting flights are a natural bundle.** Bundling is the obvious merchandising move for this
   category, so the theme's interactive feature and the app's purpose are the same idea seen from
   two sides. The two halves of the assessment become one system rather than two demos.

**Storefront centrepiece — the Flight Builder.** A customer assembles a 3, 4, or 6-bottle tasting
flight and gets live feedback on whether the flight is _balanced_ across heat and flavour, with a
one-tap swap when it isn't. It coaches rather than just collects.

---

## 2. App idea — Bundle Studio

### The merchant problem

A producer with ~20 SKUs has three problems that bundling creates and nothing solves:

- **Bundles break silently.** One component stocks out and every subsequent flight order becomes
  a refund or a substitution email. The merchant finds out from a customer.
- **Discounts eat margin invisibly.** "20% off any 6" is fine until the flight fills with the two
  lowest-margin SKUs. Nobody computes blended margin per bundle.
- **Bundle performance is unknowable.** Shopify Analytics reports on products and orders, not on
  a bundle as a merchandising object. The merchant cannot tell if the flight that took an
  afternoon to build is doing anything.

### What Bundle Studio does

It treats a bundle as a monitored object rather than a saved list of product IDs.

| Required                     | Implementation                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**                | Bundle portfolio, score distribution, revenue and AOV contribution, open alerts, recent activity                                                                        |
| **Create / update workflow** | Guided builder: product search against the Admin API, tiered pricing, composition rules, schedule, publish → creates the Shopify automatic discount, pause → revokes it |
| **History / activity log**   | Immutable audit trail — who changed what, before/after diffs, plus system and webhook events, written in the same transaction as the change                             |
| **Logic feature**            | **Bundle Health Score** — see below                                                                                                                                     |

### The logic feature — Bundle Health Score

A 0–100 composite recomputed on webhook events and nightly:

```
score = 0.40 × inventory runway     ← min days-of-cover across components (weakest link)
      + 0.25 × margin integrity     ← blended margin after discount vs the shop's floor
      + 0.20 × demand traction      ← attach rate, Bayesian-shrunk, benchmarked to the shop's best
      + 0.15 × composition balance  ← heat spread, flavour variety, overlap with other bundles
```

Bands: ≥ 75 healthy · 50–74 watch · < 50 at risk. At-risk raises a deduplicated alert.

**The part that matters is not the number.** Every score arrives with the reason and an action:

> **41 · At risk** — _Charred Pineapple has 6 days of cover at current velocity._
> **Suggested:** swap in _Smoked Habanero_ — 34 days cover, same heat tier, keeps flavour spread at 4.

The swap suggestion is a real query, not copy: same heat tier, days-of-cover above 21, ranked by
the resulting balance score. A number a merchant cannot act on is a number they will stop looking
at, which is why the recommendation is part of the feature rather than a follow-up.

Full formulas, weight rationale, and the missing-data handling are in `SCHEMA.md` §4.

---

## 3. Key decisions

### 3.1 Authentication — token exchange, with the classic flow retained

**Decision:** Shopify managed installation + session token → token exchange
(`urn:ietf:params:oauth:grant-type:token-exchange`) for the embedded path. A full authorization-code
flow with `state` nonce and `hmac` verification is also implemented at `/auth` for non-embedded
entry.

**Why:** token exchange is the current recommended flow for embedded apps and it removes the
redirect chain entirely — no bounce out of the iframe, no lost app state on install. The
authorization-code flow is retained because the brief asks for OAuth explicitly and because a
direct hit to the app URL with `?shop=` still has to work.

**The detail I would point at in review:** when Shopify rejects an exchange with `400`, the server
answers `401` with `X-Shopify-Retry-Invalid-Session-Request: 1` so App Bridge fetches a fresh ID
token and replays the request. Without that header the app appears to log the merchant out at
random after 24 hours. It is one line, in one place, and it is covered by a test.

### 3.2 Storefront ↔ app — App Proxy, with a metafield fallback

**Decision:** App Proxy at `/apps/flights/*` as the primary channel, with a metafield snapshot
written on publish as a fallback.

**Alternatives considered:** metafields only (fast, cacheable, but stale and write-amplifying); a
theme app extension block (live and idiomatic, but the theme then cannot render without the app
installed — a bad property for a submitted theme).

**Why the fallback exists:** the theme renders from the metafield snapshot on first paint, so
there is no network dependency before the customer interacts, then the builder calls the proxy for
live pricing and validation. If the proxy fails, the builder still works and says prices confirm
at checkout. This is a demo-day decision as much as an engineering one — I would rather show the
failure path working than describe it.

### 3.3 Price authority is the server

**Decision:** the browser computes an optimistic price for responsiveness; `POST /apps/flights/validate`
recomputes it server-side and the server's number governs. A property test asserts they agree
across 200 randomised selections.

**Why:** a client-computed bundle price is a client-editable bundle price. And the more mundane
version of the same risk is a demo where the storefront shows one number and the cart shows
another.

### 3.4 Job queue in MySQL, not Redis

**Decision:** a `jobs` table claimed with `SELECT … FOR UPDATE SKIP LOCKED`, exponential backoff,
a visible dead-letter state, and 60-second debouncing via a partial unique key.

**Why:** it keeps the entire system to `node + mysql`, so a reviewer runs `docker compose up` and
is done. At this scale a polling table is genuinely adequate.

**Tradeoff accepted:** it polls, so it costs a little idle DB I/O, and it will not scale to high
throughput. The `enqueue(type, payload, opts)` interface is deliberately narrow so replacing it
with BullMQ or SQS is a one-file change.

### 3.5 Webhooks: verify → record → enqueue, never process inline

**Decision:** HMAC over the **raw** body, insert into `webhook_events` keyed by the unique
`X-Shopify-Webhook-Id`, enqueue, return `200`.

**Why:** Shopify delivery is at-least-once with a short timeout and it retries on non-2xx. Doing
scoring work inline is how an app gets its subscriptions removed for repeated failures, and
without the idempotency key a retried `orders/create` double-counts every metric it touches. The
unique index _is_ the idempotency mechanism — insert first and let the duplicate-key error tell
you it is a replay.

### 3.6 Schema: integer money, GIDs, shop-scoped everything

- **Money as integer cents, discounts as basis points.** No floats anywhere near a price.
- **Full Shopify GIDs stored**, not bare numeric IDs — the API speaks GIDs and storing the numeric
  part means string surgery on every call.
- **`shop_id` on every tenant table, leading every composite index, and required as the first
  argument of every repository method.** Multi-tenant isolation enforced by structure rather than
  by remembering. An integration test asserts shop A cannot read shop B's bundle by ID.
- **`bundle_scores` is append-only.** When a merchant asks why something was flagged last
  Thursday, the exact inputs are still there. A scoring feature you cannot audit is one nobody
  trusts.

### 3.7 `bundles.current_score_id` — a deliberate denormalisation

**Decision:** a pointer from the bundle to its latest score row.

**Why:** without it the bundle list needs a correlated "latest score per bundle" subquery — the
greatest-n-per-group problem, and a scan that grows with history, on the most-visited page in the
app. With it, the list is a single join on a primary key.

**Tradeoff accepted:** the pointer can drift if a write fails mid-transaction. It is written
inside the same transaction as the score insert and the nightly sweep reconciles any drift. A
small consistency risk traded for an order-of-magnitude read improvement.

### 3.8 No framework on the storefront

**Decision:** the Flight Builder is a vanilla custom element, ~10 KB gzipped, zero dependencies.

**Why:** shipping React to a hot sauce product page to render a picker is an architectural
mistake and a Lighthouse penalty. The section renders its skeleton in Liquid and is readable
before any JavaScript runs.

### 3.9 Polaris web components in the admin

**Decision:** Vite + React for app state, Polaris **web components** loaded from Shopify's CDN
(`cdn.shopify.com/shopifycloud/polaris.js`) alongside App Bridge
(`cdn.shopify.com/shopifycloud/app-bridge.js`), rather than the Polaris React package.

**Why:** it is the current direction for embedded apps, it keeps the app visually native to the
admin (including future admin restyles) and it keeps the bundle small.

**Tradeoff accepted:** the web components are newer and less thoroughly documented than Polaris
React. The mitigation is that they are standard custom elements — if a component I need is
missing or misbehaving, dropping to plain HTML with Polaris design tokens for that one case costs
nothing and does not require a framework change.

---

## 4. Tradeoffs, stated plainly

| Decision                                                | Gained                                    | Given up                                                                    | Why it was right here                                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL job queue                                         | one-command setup, no extra infra         | horizontal scale, sub-second latency                                        | Correct at this scale; the swap is isolated behind one interface                                                                                                       |
| Automatic discount instead of a Cart Transform function | ships in days; Shopify owns pricing truth | flight isn't a single cart line; discount shows at cart, not in the builder | Cart Transform is Wasm with its own toolchain — not a six-day feature. Named as the first thing next                                                                   |
| Cached product titles/prices on `bundle_items`          | dashboard loads in one query              | display data can be briefly stale                                           | 180 Admin API lookups per page would be rate-limited. Prices are re-read at publish and at every score recompute — display staleness is fine, pricing staleness is not |
| Append-only score history                               | full auditability, trend charts free      | table grows; needs the `current_score_id` pointer                           | An unexplainable score is an ignored score                                                                                                                             |
| Fixed scoring weights                                   | ships now; defensible reasoning           | not tuned per merchant                                                      | Weights live in one config object; per-shop overrides are a column, not a rewrite                                                                                      |
| SPA admin, no SSR                                       | simpler, faster iteration                 | slower first paint                                                          | It is an authenticated single-tenant dashboard in an iframe. SEO and first-paint arguments don't apply                                                                 |
| Aggregates only, no customer PII                        | tiny compliance surface                   | no per-customer segmentation                                                | Storing PII I don't need would be a liability, not a feature                                                                                                           |
| Vanilla JS storefront                                   | 10 KB, Lighthouse ≥ 90                    | more manual DOM code                                                        | The right call for a public storefront every time                                                                                                                      |

---

## 5. What I would build next

**First, and by a distance:**

1. **Cart Transform Function.** Collapse a flight into a single true cart line with a
   merchant-defined price, so the discount is visible in the builder instead of at checkout. This
   is the one place where the current implementation is a compromise rather than a choice.
2. **Forecasting instead of trailing velocity.** Days-of-cover currently uses a flat 7-day
   trailing average. An EWMA with day-of-week seasonality and an inbound-purchase-order signal
   would move the inventory score from _reactive_ to _predictive_ — telling a merchant a bundle
   will break in twelve days is worth far more than telling them it broke.

**Then:**

3. **Per-merchant weight tuning**, with a preview of how a weight change reshuffles the current
   portfolio, so it is a considered adjustment and not a slider nobody understands.
4. **Bundle A/B testing** — two compositions or two price ladders behind one storefront slot,
   with a proper significance test rather than "whichever number is bigger".
5. **Redis/BullMQ**, scheduled reporting, and read replicas as write volume justifies them.
6. **Digest notifications** — an email or Slack message on band changes, batched daily. Alerts a
   merchant only sees when they open the app are half a feature.
7. **Theme app extension** so the Flight Builder can be dropped into any theme from the editor,
   rather than living in this one theme's section.
8. **OpenTelemetry tracing** across webhook → job → Admin API, plus alerting on dead-letter depth.
9. **Multi-currency and multi-location inventory.** Days-of-cover currently sums across locations;
   a merchant fulfilling from two warehouses needs it per-location.
10. **Full E2E suite in CI** against a seeded dev store, plus visual regression on the theme.

---

## 6. Honest limitations of this submission

Worth naming before anyone else does:

- **Cost prices are often unset on real stores.** When any component lacks a cost, the margin
  component is excluded and the remaining weights renormalise, and the score is flagged partial
  with the reason. It does not invent a number — but it also means the score is less informative
  on stores that never fill in cost data.
- **Attach rate needs volume.** Bayesian shrinkage stops a 1-of-2 bundle scoring 100, and bundles
  under 14 days old return `null` traction with the weight renormalised. A brand-new store will
  see mostly inventory and balance driving the score, which is the correct behaviour but is worth
  understanding.
- **The scoring weights are my judgement, not fitted to data.** I can defend the reasoning —
  inventory dominates because a stock-out is the only unrecoverable failure — but with real
  merchant data these should be validated and probably adjusted.
- **Single-region, single-process.** Fine for the scale this targets, and the boundaries are drawn
  so that scaling out does not require a rewrite.

---

## 7. Document map

| File               | Contents                                                                |
| ------------------ | ----------------------------------------------------------------------- |
| `README.md`        | Setup instructions — prerequisites, install, run, seed                  |
| `APP_DECISIONS.md` | This document                                                           |
| `ARCHITECTURE.md`  | Topology, auth flow, API contracts, webhooks, jobs, security, testing   |
| `SCHEMA.md`        | Full data model, indexes, constraints, migrations, scoring formulas     |
| `THEME_SPEC.md`    | Templates, sections, brand system, Flight Builder UX, performance, a11y |
| `BUILD_PLAN.md`    | Day-by-day plan, cut list, demo script                                  |
