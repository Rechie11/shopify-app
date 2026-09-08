# Ember & Ash — System Architecture

**Project:** Custom Shopify theme + embedded Shopify admin app
**Stack:** Shopify Liquid · Vite · Node.js · Drizzle ORM · MySQL 8
**Author:** Cherry Anne Dagunan
**Presentation:** 14 September 2026

---

## 1. The system in one paragraph

**Ember & Ash** is a fictional small-batch hot sauce company. Its storefront's signature
experience is the **Flight Builder** — a guided flow where a customer assembles a 3, 4, or
6-bottle tasting flight and gets live feedback on whether the flight is _balanced_ across heat
and flavour. **Bundle Studio** is the embedded admin app that makes those flights exist: the
merchant composes bundles, prices them, and — the part that matters — sees a **Bundle Health
Score** that tells them which bundles are about to break and why.

The two halves are not two demos. The storefront's Flight Builder renders bundles that Bundle
Studio published, validated in real time against rules Bundle Studio owns. One system, two
surfaces.

---

## 2. Why this app exists (the merchant problem)

A small-batch producer running ~20 SKUs has three problems that bundles create and nothing
solves:

1. **Bundles silently break.** A merchant builds a 6-bottle flight, it starts selling, and one
   component — usually the most popular one — stocks out in nine days. Now every flight order
   is a refund, a substitution email, or an angry review. The merchant finds out from a
   customer, not from a system.
2. **Discounts eat margin invisibly.** A "20% off any 6" feels fine until the flight is loaded
   with the two lowest-margin SKUs. Nobody computes blended margin per bundle.
3. **Bundle performance is unknowable.** Shopify Analytics reports on products and orders, not
   on _bundles as a merchandising object_. The merchant can't tell whether the flight that took
   an afternoon to build is doing anything.

Bundle Studio treats a bundle as a first-class, monitored object with a health score, an audit
trail, and actionable alerts. That is the difference between this and a CRUD app that stores
groups of product IDs.

---

## 3. Repository layout

Single repo, npm workspaces. Two deployable artifacts (theme, app), one shared schema package.

```
ember-and-ash/
├─ shopify.app.toml                 # app config: scopes, app proxy, webhooks
├─ package.json                     # workspaces root
├─ README.md                        # setup instructions (submission deliverable)
├─ APP_DECISIONS.md                 # decisions + tradeoffs (submission deliverable)
│
├─ theme/                           # ── Part 1: Shopify theme ────────────────
│  ├─ layout/theme.liquid
│  ├─ templates/                    # index / collection / product / cart / page / 404
│  ├─ sections/                     # 5 custom sections (spec: THEME_SPEC.md)
│  ├─ snippets/
│  ├─ assets/                       # css + vanilla ES modules, no framework
│  ├─ config/settings_schema.json   # brand tokens exposed to the theme editor
│  └─ locales/en.default.json
│
└─ app/                             # ── Part 2: embedded admin app ───────────
   ├─ server/                       # Node.js 22 + Fastify (ESM, TypeScript)
   │  ├─ src/
   │  │  ├─ index.ts                # composition root
   │  │  ├─ config/env.ts           # zod-validated environment
   │  │  ├─ http/
   │  │  │  ├─ plugins/             # auth, error handler, request-id, cors, rate-limit
   │  │  │  └─ routes/
   │  │  │     ├─ admin/            # /api/*      session-token authed (the merchant UI)
   │  │  │     ├─ proxy/            # /proxy/*    app-proxy signed (the storefront)
   │  │  │     ├─ webhooks/         # /webhooks/* HMAC verified
   │  │  │     └─ health.ts         # /healthz /readyz
   │  │  ├─ services/               # business logic — the only layer with rules in it
   │  │  │  ├─ bundle.service.ts
   │  │  │  ├─ scoring.service.ts   # the logic feature
   │  │  │  ├─ alert.service.ts
   │  │  │  ├─ activity.service.ts
   │  │  │  └─ metrics.service.ts   # velocity + attach-rate rollups
   │  │  ├─ repositories/           # Drizzle queries only; every method takes shopId
   │  │  ├─ shopify/
   │  │  │  ├─ auth.ts              # token exchange + session token verification
   │  │  │  ├─ admin-client.ts      # GraphQL client w/ cost-aware throttling
   │  │  │  ├─ webhooks.ts          # registration + HMAC verify
   │  │  │  └─ crypto.ts            # AES-256-GCM token encryption
   │  │  ├─ jobs/                   # worker loop + handlers
   │  │  └─ domain/                 # pure functions: scoring math, pricing, rules
   │  └─ test/                      # vitest: unit (domain) + integration (routes)
   │
   ├─ web/                          # Vite 6 + React 19 + Polaris web components
   │  ├─ vite.config.ts
   │  ├─ index.html                 # loads App Bridge + Polaris from Shopify CDN
   │  └─ src/
   │     ├─ main.tsx
   │     ├─ lib/authenticated-fetch.ts   # attaches shopify.idToken(), retries on 401
   │     ├─ routes/                      # Dashboard, Bundles, BundleEditor, Activity, Alerts
   │     └─ components/
   │
   └─ db/                           # Drizzle package (shared types)
      ├─ drizzle.config.ts
      ├─ src/schema/*.ts            # one file per domain area
      └─ migrations/                # generated SQL, committed, never hand-edited
```

**Why a monorepo:** the storefront's Flight Builder and the app's validation endpoint must agree
on the pricing and rule model exactly. Sharing `app/db` types (and a small `domain/pricing.ts`)
between them removes the single most likely source of a demo-day bug — a price shown on the
storefront that the server disagrees with.

---

## 4. Runtime topology

```
                         ┌──────────────────────────────────────┐
                         │        Shopify Admin (iframe)        │
                         │  App Bridge · Polaris web components │
                         └───────────────┬──────────────────────┘
                     Authorization: Bearer <session id token>
                                         │
   Storefront (Liquid)                   │
   ┌─────────────────┐                   ▼
   │ Flight Builder  │        ┌────────────────────────┐        ┌──────────────────┐
   │  (vanilla JS)   │──────► │   Node.js / Fastify    │ ─────► │  Shopify Admin   │
   └─────────────────┘  app   │                        │ GraphQL│  GraphQL API     │
        /apps/flights  proxy  │  routes → services →   │ 2026-07│  (cost-throttled)│
        (HMAC signed)         │  repositories          │        └──────────────────┘
                              │                        │
   Shopify ──── webhooks ────►│  HMAC verify → enqueue │        ┌──────────────────┐
   (orders, inventory,        │                        │ ─────► │   MySQL 8        │
    products, uninstall)      │  in-process job worker │ Drizzle│   (InnoDB)       │
                              └────────────────────────┘        └──────────────────┘
```

One Node process serves four distinct trust boundaries. Each has its own authentication plugin
and its own route prefix; they never share middleware by accident.

| Surface        | Prefix                | Caller              | Auth mechanism                        |
| -------------- | --------------------- | ------------------- | ------------------------------------- |
| Admin API      | `/api/*`              | Embedded app UI     | Session token (JWT) → token exchange  |
| Storefront API | `/proxy/*`            | Theme via App Proxy | App proxy HMAC signature              |
| Webhooks       | `/webhooks/*`         | Shopify             | `X-Shopify-Hmac-Sha256` over raw body |
| Health         | `/healthz`, `/readyz` | Platform            | none (no data exposed)                |

---

## 5. Authentication and session management

### 5.1 Install: Shopify managed installation

Scopes are declared in `shopify.app.toml`. Shopify handles the install screen and grant; the app
does not implement an authorization-code redirect for the happy path.

```toml
# shopify.app.toml (excerpt)
client_id = "..."
name = "Bundle Studio"
application_url = "https://<tunnel>/"
embedded = true

[access_scopes]
scopes = "read_products,read_inventory,read_orders,write_discounts,write_products"

[auth]
redirect_urls = ["https://<tunnel>/auth/callback"]   # fallback flow only

[app_proxy]
url = "https://<tunnel>/proxy"
subpath = "flights"
prefix = "apps"

[webhooks]
api_version = "2026-07"
```

### 5.2 Request: session token → token exchange

This is the current OAuth flow for embedded apps and it is what the app implements.

```
Browser (embedded iframe)                Server                      Shopify
        │                                   │                            │
        │  shopify.idToken()                │                            │
        │──────────────────────────────────►│                            │
        │  GET /api/bundles                 │                            │
        │  Authorization: Bearer <idToken>  │                            │
        │                                   │ 1. verify JWT locally:     │
        │                                   │    exp>now, nbf<now,       │
        │                                   │    aud==client_id,         │
        │                                   │    host(iss)==host(dest)   │
        │                                   │                            │
        │                                   │ 2. cached offline token?   │
        │                                   │    ── yes ─► use it        │
        │                                   │    ── no  ─► exchange:     │
        │                                   │  POST /admin/oauth/access_token
        │                                   │  grant_type=urn:ietf:params:oauth:
        │                                   │             grant-type:token-exchange
        │                                   │  subject_token=<idToken>   │
        │                                   │  subject_token_type=...:id_token
        │                                   │  requested_token_type=...:offline-access-token
        │                                   │───────────────────────────►│
        │                                   │◄──────────── access_token ─│
        │                                   │ 3. encrypt + store, then   │
        │                                   │    X-Shopify-Access-Token  │
        │◄──────────── 200 JSON ────────────│                            │
```

**Failure path that matters:** when Shopify rejects the exchange with `400`, the server must
respond `401` with header `X-Shopify-Retry-Invalid-Session-Request: 1`. App Bridge sees that
header, fetches a fresh ID token, and replays the request. Without it the app appears to
randomly log the merchant out after 24 hours. This is implemented in one place —
`http/plugins/auth.ts` — and covered by an integration test.

### 5.3 Token storage

Offline access tokens are the app's most sensitive asset. They are encrypted at rest with
AES-256-GCM using a key from `APP_ENCRYPTION_KEY` (32 bytes, base64):

- `access_token_ciphertext`, `access_token_iv`, `access_token_tag` stored as separate columns
- key is never in the repo; `.env.example` documents it, `.env` is gitignored
- rotation path documented: `key_version` column allows re-encrypt-on-read

Tokens are wiped on `app/uninstalled`. A shop row is soft-deleted (`uninstalled_at`) rather
than hard-deleted so activity history survives a reinstall.

### 5.4 Fallback authorization-code flow

`/auth` and `/auth/callback` implement the classic redirect flow with `state` nonce +
`hmac` verification. It is unused in the embedded happy path but exists for two reasons: it
covers a non-embedded entry (someone hits the app URL directly with `?shop=`), and it means the
submission demonstrably contains a complete OAuth implementation, not only the exchange.

---

## 6. API contracts

All admin responses are `application/json`, envelope-free, with errors as
`{ error: { code, message, details? } }` and a `x-request-id` header on every response.

### 6.1 Admin API (`/api`, session-token authed)

| Method   | Path                             | Purpose                                                        |
| -------- | -------------------------------- | -------------------------------------------------------------- |
| `GET`    | `/api/dashboard/summary`         | KPI tiles, score distribution, open alerts, recent activity    |
| `GET`    | `/api/bundles`                   | List. Query: `status`, `band`, `q`, `cursor`, `limit`          |
| `POST`   | `/api/bundles`                   | Create (draft). Body validated by zod                          |
| `GET`    | `/api/bundles/:id`               | Bundle + items + tiers + rules + current score                 |
| `PATCH`  | `/api/bundles/:id`               | Partial update; writes an activity diff                        |
| `POST`   | `/api/bundles/:id/publish`       | Validate → create/update Shopify automatic discount → activate |
| `POST`   | `/api/bundles/:id/pause`         | Deactivate discount, keep the record                           |
| `DELETE` | `/api/bundles/:id`               | Soft delete (`deleted_at`)                                     |
| `GET`    | `/api/bundles/:id/score`         | Current score **plus its full breakdown and reason**           |
| `GET`    | `/api/bundles/:id/score/history` | Time series for the trend sparkline                            |
| `GET`    | `/api/bundles/:id/activity`      | Paginated audit trail for this bundle                          |
| `GET`    | `/api/activity`                  | Shop-wide activity feed                                        |
| `GET`    | `/api/alerts`                    | Open alerts, newest first                                      |
| `POST`   | `/api/alerts/:id/acknowledge`    | Ack, with optional note                                        |
| `GET`    | `/api/products/search?q=`        | Proxied Admin GraphQL product search, 60s cached               |

Pagination is cursor-based (opaque base64 of `{id, sortKey}`) everywhere. Offset pagination is
not used — it breaks under concurrent writes and it is the kind of detail an interviewer checks.

**Publish is a transaction with an external side effect**, so it is ordered defensively:
validate rules → persist `status=publishing` → call Shopify `discountAutomaticBasicCreate` →
persist `discount_gid` + `status=active`. If the Shopify call fails, the bundle stays in
`publishing` and a retry job reconciles it. The app never ends up with an active bundle and no
discount, or a discount with no bundle.

### 6.2 Storefront API (`/proxy`, app-proxy signed)

Reachable from the theme as `/apps/flights/*`. Every request carries `shop`, `path_prefix`,
`timestamp`, `logged_in_customer_id`, and `signature`.

| Method | Path                     | Purpose                                                                                           |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------- |
| `GET`  | `/apps/flights/bundles`  | Published bundles: items, tiers, rules, heat/flavour metadata                                     |
| `POST` | `/apps/flights/validate` | Given a selection, return price, savings, rule violations, balance feedback and a swap suggestion |

Signature verification (per Shopify's spec): take all query params except `signature`, join
multi-values with commas, sort keys alphabetically, concatenate `key=value` pairs **with no
separator**, HMAC-SHA256 with the app's client secret, hex-encode, and compare with
`crypto.timingSafeEqual`. Requests older than 60 seconds by `timestamp` are rejected — the
signature alone does not prevent replay.

**The validate endpoint is the trust boundary for money.** The browser computes a price for
display responsiveness; the server recomputes it and the server's number is the one that
governs. Never trust a client-side bundle price.

### 6.3 Webhooks (`/webhooks`)

| Topic                                                       | Consumed for                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `orders/create`                                             | attach rate, sales velocity rollup, bundle order attribution        |
| `orders/cancelled`                                          | reverse the above                                                   |
| `inventory_levels/update`                                   | inventory runway — the highest-signal input to the score            |
| `products/update`                                           | price/cost/title cache refresh; detect a component gone unavailable |
| `products/delete`                                           | mark bundle as broken, raise a critical alert                       |
| `app/uninstalled`                                           | purge tokens, soft-delete shop                                      |
| `customers/data_request`, `customers/redact`, `shop/redact` | GDPR compliance (mandatory)                                         |

Handler contract, identical for every topic:

1. Read the **raw body** (Fastify content-type parser configured to preserve it — computing
   HMAC over a re-serialized JSON body is the classic bug here).
2. `timingSafeEqual` the base64 `X-Shopify-Hmac-Sha256` against HMAC-SHA256(rawBody, secret).
   Mismatch → `401`, log, stop.
3. Insert into `webhook_events` keyed by the unique `X-Shopify-Webhook-Id`. Duplicate key →
   already processed → `200`, stop. **Webhook delivery is at-least-once; idempotency is not
   optional.**
4. Enqueue a job. Return `200` immediately.

Shopify's delivery timeout is short and it retries on non-2xx. Doing scoring work inline in a
webhook handler is how apps get their webhook subscriptions removed for repeated failures. The
handler's only job is verify → record → enqueue.

---

## 7. Background processing

**Decision: a MySQL-backed job queue, not Redis.**

```sql
SELECT * FROM jobs
 WHERE status='pending' AND run_at <= NOW(3)
 ORDER BY run_at
 LIMIT 10
 FOR UPDATE SKIP LOCKED;
```

`FOR UPDATE SKIP LOCKED` (MySQL 8) gives safe multi-worker claiming without a second piece of
infrastructure. For a store doing thousands of orders a day this is entirely adequate, and it
means the whole system is `node + mysql` — one `docker compose up` for a reviewer.

Jobs: `score.recompute`, `metrics.rollup`, `inventory.sync`, `discount.reconcile`,
`alerts.evaluate`, `webhook.process`.

- **Retry:** exponential backoff `2^attempts` minutes, `max_attempts = 5`, then `status=dead`
  with `last_error` retained. Dead jobs surface on an internal page — a silent dead-letter queue
  is the same as no queue.
- **Debounce:** score recomputes coalesce. A burst of `inventory_levels/update` events during a
  restock would otherwise trigger 50 recomputes of the same bundle; instead the job is upserted
  on `(shop_id, type, dedupe_key)` with `run_at = now + 60s`.
- **Nightly sweep:** 03:00 shop-local — full metric rollup and a recompute of every active
  bundle, so a missed webhook cannot leave a score permanently stale.

_Tradeoff, stated plainly:_ a table-based queue polls, so it burns a small amount of DB I/O when
idle and it will not scale to high throughput. At real scale this becomes BullMQ/Redis or SQS.
The interface (`enqueue(type, payload, opts)`) is deliberately narrow so that swap is a
one-file change.

---

## 8. Shopify Admin API client

- **Version pinned to `2026-07`** (the current stable release as of September 2026) in one
  constant. Never `unstable`, never unversioned — Shopify falls forward silently otherwise.
- **GraphQL only.** REST Admin is legacy for new apps.
- **Cost-aware throttling.** The Admin GraphQL API meters by a leaky bucket, and every response
  carries `extensions.cost.throttleStatus` (`currentlyAvailable`, `restoreRate`). The client
  reads it and, when available points drop below a floor, sleeps for the time needed to restore.
  On a `THROTTLED` error it backs off with jitter. Retrying blindly on 429 is how apps get
  themselves rate-limited harder.
- **Bulk operations** for the initial catalogue sync at install (a store with hundreds of
  variants should not be paginated one page at a time).
- **Typed documents:** queries live in `.graphql` files, types generated by
  `@shopify/api-codegen-preset`. No stringly-typed queries.

---

## 9. Theme ↔ app integration

Three options were considered:

| Option                    | Data freshness   | Storefront perf          | Complexity                                      | Verdict                  |
| ------------------------- | ---------------- | ------------------------ | ----------------------------------------------- | ------------------------ |
| **App Proxy** (chosen)    | live             | one fetch on interaction | low                                             | Primary                  |
| Metafields synced by app  | stale until sync | zero fetch, in Liquid    | write amplification, sync bugs                  | Fallback mirror          |
| Theme app extension block | live             | good                     | requires app install to render the theme at all | Rejected for a take-home |

**Chosen: App Proxy primary, metafield mirror as fallback.** On publish, the app also writes a
compact JSON snapshot of the bundle to a shop metafield. The theme renders from the metafield on
first paint (no network, no layout shift), then the Flight Builder calls the proxy for live
pricing and validation. If the proxy call fails, the builder still works from the snapshot and
shows an unobtrusive "prices confirmed at checkout" note.

That fallback exists for one specific reason: a live demo on someone else's network. A blueprint
that assumes the network works is not a production blueprint.

### Cart mechanics

A flight is added as **individual line items sharing line-item properties**:

```js
await fetch('/cart/add.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    items: selections.map((s, i) => ({
      id: s.variantId,
      quantity: 1,
      properties: {
        _flight_id: flightToken, // underscore = hidden from the customer
        _flight_name: bundle.title,
        _flight_slot: String(i + 1),
      },
    })),
  }),
});
```

The discount is a **Shopify automatic discount** created by the app at publish time
(`discountAutomaticBasicCreate`, scoped to the flight collection with a minimum-quantity rule),
so Shopify — not the app — is the source of truth for what the customer pays. The cart template
groups lines sharing a `_flight_id` into a single visual card with one "Remove flight" control.

_Tradeoff:_ the discount only becomes visible at cart/checkout, so the builder labels its number
"discount applied at checkout". The production-grade answer is a **Cart Transform Function**,
which collapses the lines into one true bundle line with a merchant-defined price. That is
Shopify Functions (Wasm) and is out of scope for six days — it is named explicitly in
`APP_DECISIONS.md` as the first thing I would build next.

---

## 10. Security

| Threat                     | Control                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forged admin requests      | Session-token JWT verified: signature, `exp`, `nbf`, `aud` == client id, `iss`/`dest` host match                                                                         |
| Forged webhooks            | HMAC-SHA256 over **raw** body, `timingSafeEqual`                                                                                                                         |
| Forged storefront requests | App proxy signature + 60s timestamp window                                                                                                                               |
| Cross-tenant data leak     | `shopId` is a required first argument on every repository method; a lint rule and a code-review checklist enforce it. Integration tests assert shop A cannot read shop B |
| Token theft at rest        | AES-256-GCM, key outside the repo, `key_version` for rotation                                                                                                            |
| Clickjacking / framing     | `Content-Security-Policy: frame-ancestors https://<shop> https://admin.shopify.com` set per-request from the validated `dest` claim                                      |
| Injection                  | Drizzle parameterised queries throughout; zero raw SQL string interpolation                                                                                              |
| Malformed input            | zod schema at every route boundary; unknown keys stripped                                                                                                                |
| Replayed webhooks          | unique index on `webhook_events.webhook_id`                                                                                                                              |
| Secret leakage in logs     | pino redaction list covers `authorization`, `x-shopify-access-token`, `client_secret`, `password`                                                                        |
| Abuse of proxy endpoints   | per-shop rate limit (`@fastify/rate-limit`, 120 req/min) on `/proxy/*`                                                                                                   |

**PII posture:** the app stores no customer names, emails, or addresses. Order webhooks are
reduced to aggregates before persistence; where a per-customer identifier is needed for repeat
analysis, it is stored as a salted SHA-256 hash. The three mandatory GDPR webhooks are
implemented and return correct responses — most take-home apps skip these, and Shopify requires
them for any public app.

---

## 11. Observability and operations

- **Structured logging** — pino JSON, every log line carries `request_id`, `shop_domain`, and
  `route`. A merchant support question becomes one `grep`.
- **Health endpoints** — `/healthz` (process alive) and `/readyz` (DB reachable + migrations at
  head). Distinct, because a load balancer needs the first and a deploy gate needs the second.
- **Metrics counters** — webhook received/verified/failed, jobs processed/dead, Admin API
  throttle events, score recomputes. Exposed on `/metrics` in Prometheus text format.
- **Error handling** — a single Fastify error handler maps a typed error hierarchy
  (`ValidationError` 400, `AuthError` 401, `NotFoundError` 404, `ShopifyApiError` 502,
  `AppError` 500) so no route hand-rolls a status code and no stack trace ever reaches a client.
- **Migrations run as a startup gate**, not automatically in application code paths: the process
  refuses to serve traffic if the DB is behind.

---

## 12. Testing strategy

| Layer         | Tool                          | What is actually tested                                                                                                               |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Domain (pure) | vitest                        | Scoring math against fixture tables, including boundaries: zero velocity, zero on-hand, single-item bundle, all-identical heat levels |
| Repository    | vitest + Testcontainers MySQL | Real SQL against a real MySQL, migrations applied — not a mock                                                                        |
| HTTP          | vitest + `fastify.inject()`   | Auth rejection paths, HMAC rejection, idempotent webhook replay, cross-shop isolation                                                 |
| Theme         | Playwright                    | Flight Builder: keyboard-only completion, add-to-cart payload shape, proxy-failure fallback                                           |
| Contract      | vitest                        | The storefront price and the server price agree for 200 randomised selections                                                         |

The last row is the one worth pointing at in the presentation: it is a property test that
guarantees the demo cannot show a price the backend disagrees with.

---

## 13. Environments and configuration

```bash
# .env.example — every value zod-validated at boot; the process refuses to start if any is missing
NODE_ENV=development
PORT=3000
DATABASE_URL=mysql://ember:ember@localhost:3306/ember_ash
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_SCOPES=read_products,read_inventory,read_orders,write_discounts,write_products
SHOPIFY_APP_URL=https://<tunnel>.trycloudflare.com
SHOPIFY_API_VERSION=2026-07
APP_ENCRYPTION_KEY=            # 32 random bytes, base64
LOG_LEVEL=info
SCORE_MARGIN_FLOOR_BPS=3000    # 30% — merchant-tunable in a later version
SCORE_MARGIN_TARGET_BPS=5500   # 55%
```

`docker-compose.yml` provides MySQL 8 so a reviewer needs only Node and Docker. `npm run setup`
runs migrations and seeds a realistic catalogue (18 sauces, 90 days of synthetic orders with a
deliberate weekend seasonality and one SKU engineered to be nine days from stock-out — so the
"at risk" state is visible the moment the app opens, without waiting for real data).

---

## 14. What this architecture deliberately does _not_ do

Naming these preempts the obvious interview questions and shows the omissions were choices:

- **No Redis / external queue.** MySQL `SKIP LOCKED` is sufficient at this scale and halves the
  setup burden for a reviewer. Interface is isolated for a swap.
- **No microservices.** One process, clear internal layering. Splitting a system with one team
  and one datastore into services buys nothing but latency.
- **No Shopify Functions.** Cart Transform is the correct long-term bundling primitive; it is
  Wasm, has its own toolchain, and does not fit six days.
- **No server-side rendering for the admin UI.** It is an authenticated single-tenant dashboard
  inside an iframe — SEO and first-paint arguments do not apply. Vite SPA is right.
- **No React on the storefront.** The Flight Builder is ~10 KB of vanilla ES modules. Shipping a
  framework to a hot sauce product page to render a picker would be an architectural mistake and
  a Lighthouse penalty.

---

## 15. Cross-references

- Data model, indexes, migrations, and the full scoring formulas → **`SCHEMA.md`**
- Theme structure, sections, brand system, Flight Builder UX and a11y → **`THEME_SPEC.md`**
- Concept, decision log, tradeoffs, roadmap → **`APP_DECISIONS.md`** _(submission deliverable)_
- Day-by-day plan through 14 Sept, cut-list, demo script → **`BUILD_PLAN.md`**
