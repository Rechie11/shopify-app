# Ember & Ash — Shopify Theme + Bundle Studio

A custom Shopify theme for a fictional small-batch hot sauce company, and **Bundle Studio**, an
embedded Shopify admin app that scores bundle health and tells the merchant what to fix.

**Stack:** Shopify Liquid · Vite · Node.js 22 · Fastify · Drizzle ORM · MySQL 8
**Admin API version:** `2026-07`

---

## What's here

| Path | What it is |
|---|---|
| `theme/` | The Shopify theme — Liquid, CSS, vanilla ES modules. No framework |
| `app/server/` | Node.js + Fastify API: auth, webhooks, app proxy, scoring engine, job worker |
| `app/web/` | Vite + React admin UI using App Bridge and Polaris web components |
| `app/db/` | Drizzle schema and committed SQL migrations |
| `APP_DECISIONS.md` | Concept, decisions, tradeoffs, roadmap *(start here)* |
| `ARCHITECTURE.md` | Topology, auth flow, API contracts, webhooks, security, testing |
| `SCHEMA.md` | Data model, indexes, migrations, and the full scoring formulas |
| `THEME_SPEC.md` | Templates, sections, brand system, Flight Builder UX, performance, a11y |

---

## Prerequisites

- **Node.js** 22 LTS or newer
- **Docker** (for MySQL 8) — or a local MySQL 8 instance
- **Shopify CLI** — `npm install -g @shopify/cli`
- A **Shopify Partner account** and a **development store**

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url> ember-and-ash
cd ember-and-ash
npm install
```

### 2. Start MySQL

```bash
docker compose up -d
# MySQL 8 on localhost:3306, database `ember_ash`
```

### 3. Configure the environment

```bash
cp .env.example .env
```

Fill in `.env`:

```bash
DATABASE_URL=mysql://ember:ember@localhost:3306/ember_ash
SHOPIFY_API_KEY=            # from the Partner dashboard, after step 4
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=            # the CLI prints this tunnel URL when it starts
SHOPIFY_API_VERSION=2026-07
APP_ENCRYPTION_KEY=         # generate with the command below
```

Generate the encryption key (32 random bytes, base64):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Every variable is validated with zod at boot — the server refuses to start if one is missing or
malformed, rather than failing later with a confusing error.

### 4. Create the app in Shopify

```bash
npm run dev          # wraps `shopify app dev`
```

The CLI creates the app in your Partner account, starts a tunnel, and prints an install link.
Copy the client ID and secret it generates into `.env`, then restart.

`shopify.app.toml` already declares the scopes, the embedded flag, the app proxy
(`/apps/flights` → `/proxy`), and the webhook subscriptions — the CLI syncs them on `dev`.

### 5. Run migrations and seed

```bash
npm run db:migrate    # drizzle-kit migrate — applies committed SQL migrations
npm run seed          # demo data (see below)
```

### 6. Install the app

Open the install link the CLI printed, choose your development store, and approve. The app opens
embedded in Shopify admin.

### 7. Push the theme

```bash
cd theme
shopify theme dev --store your-store.myshopify.com     # live preview with hot reload
# or
shopify theme push --unpublished                       # upload as an unpublished theme
```

---

## Demo data

`npm run seed` creates a store state where the app is interesting on first open:

- **18 sauces** across 6 heat levels and 6 flavour profiles, cost prices on 16 of 18 (so the
  partial-score path is visible)
- **4 bundles**: one `healthy`, one `watch`, one `at_risk`, one `draft`
- **90 days of synthetic orders** with weekend seasonality and a realistic bundle attach rate
- **One component engineered to sit ~6 days from stock-out**, so the at-risk alert, the limiting
  variant, and the swap recommendation all render immediately

To reset:

```bash
npm run db:reset      # drop, migrate, seed
```

---

## Everyday commands

```bash
npm run dev           # Shopify CLI: tunnel + server + Vite, all watched
npm run dev:server    # API only
npm run dev:web       # admin UI only
npm run build         # build the admin UI and compile the server

npm run db:generate   # generate a migration from schema changes
npm run db:migrate    # apply migrations
npm run db:studio     # Drizzle Studio — browse the database
npm run db:reset      # drop + migrate + seed

npm test              # vitest: unit + integration
npm run test:e2e      # Playwright: theme flows
npm run lint          # eslint + prettier check
npm run typecheck     # tsc --noEmit across all workspaces
```

---

## Verifying it works

A five-minute check that exercises the whole system:

1. **App loads** — open Bundle Studio in Shopify admin. The dashboard shows four bundles and at
   least one open alert.
2. **CRUD** — create a bundle, add three products, set price tiers, publish. A matching automatic
   discount appears under **Discounts** in Shopify admin.
3. **Audit** — open the bundle's Activity tab. Every change is listed with a before/after diff.
4. **Storefront** — open the theme, build a flight, watch the balance coaching, take a suggested
   swap, add it to the cart. The cart shows one grouped flight card.
5. **The full loop** — complete a test checkout. Within a minute the order appears attributed to
   the bundle and the bundle's score moves.
6. **The logic feature** — in Shopify admin, drop the inventory of a component in an active
   bundle. Within a minute the bundle drops to **At risk**, names the limiting variant, and
   recommends a specific swap.

Step 6 is the one to watch. Everything else is infrastructure holding it up.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| App shows a blank iframe | `SHOPIFY_APP_URL` doesn't match the current tunnel. The CLI generates a new URL each run — update `.env` and restart |
| `401` loop in the admin UI | The session-token retry header is missing or malformed. See `ARCHITECTURE.md` §5.2 |
| Webhooks never arrive | The tunnel changed since registration. `npm run dev` re-registers; verify with `shopify app webhook trigger` |
| `Invalid signature` on `/proxy/*` | The signature is computed over params sorted alphabetically and joined with **no separator**, excluding `signature` itself. See `ARCHITECTURE.md` §6.2 |
| Scores stay stale | The job worker isn't running, or jobs are dead-lettered. Check `SELECT status, count(*) FROM jobs GROUP BY status` |
| `THROTTLED` from the Admin API | The client backs off automatically; if it persists, the seed script is likely running concurrently with a sync job |

---

## Testing

```bash
npm test
```

- **Unit** (`app/server/test/domain/`) — scoring math against fixture tables, including zero
  velocity, zero on-hand, single-item bundles, all-identical heat levels, and missing cost data
- **Integration** (`app/server/test/http/`) — real MySQL via Testcontainers: auth rejection paths,
  HMAC rejection, idempotent webhook replay, cross-shop isolation
- **Contract** — a property test asserting the storefront price and the server price agree across
  200 randomised selections
- **E2E** (`npm run test:e2e`) — Playwright: the Flight Builder completed keyboard-only, the
  add-to-cart payload shape, and the proxy-failure fallback

---

## Security notes

- Offline access tokens are encrypted at rest with AES-256-GCM; the key lives in
  `APP_ENCRYPTION_KEY` and never in the repository
- Every webhook is HMAC-verified over the raw request body with a timing-safe comparison
- Every app proxy request is signature-verified with a 60-second timestamp window
- Every repository method takes `shopId` as its first argument; an integration test asserts one
  shop cannot read another's data
- No customer PII is stored — order data is reduced to aggregates, and where a per-customer
  identifier is needed it is a salted hash
- The three mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
  are implemented
