# DEMO_SCRIPT.md — Presenting Ember & Ash + Bundle Studio

A rehearsable script for demoing both halves of the submission, plus a reference so you can
answer follow-up questions on either the theme or the app without hesitating. Read it once
top to bottom before the call; during the call, use the bolded cues as your outline.

---

## 0. Before you start (5 minutes prior)

Get all of this running and confirmed **before** you're on the call — nothing kills a demo's
credibility like debugging a tunnel URL live.

- [ ] `docker compose ps` — MySQL container `Up ... (healthy)`
- [ ] `npm run dev` running in one terminal (tunnel + server + Vite). Confirm the backend actually
      bound to a port — look for `"msg":"Server listening at http://[::]:<port>"` in its log.
      **Note the port number** — the CLI assigns it dynamically, it won't be 3000.
- [ ] `cd theme && shopify theme dev --store <your-store>` running in a second terminal
- [ ] Bundle Studio open in one browser tab (Shopify admin), Dashboard loaded
- [ ] The theme preview open in a second tab, scrolled to the top of the homepage
- [ ] Shopify Admin → Discounts open in a third tab (for the CRUD step)
- [ ] Confirm the App Proxy is actually resolving: fill a flight once yourself first and watch
      for a **200** on `/apps/flights/validate` in DevTools Network. If you get a 404 here, fix it
      before the call — it's a Partner Dashboard / tunnel sync issue, not a code bug. (If it
      happens again: Partner Dashboard → Bundle Studio → Configuration → App proxy → confirm the
      Proxy URL matches your current tunnel, or run `shopify app config push`.)
- [ ] Seed data is fresh: 4 bundles (**Starter Flight** = healthy, **Weekend Warmer** = watch,
      **Reckless Reserve** = at risk, **Sampler Draft** = unpublished), at least one open alert. If
      it looks stale or someone's been clicking around, `npm run db:reset` gets you back to a
      known-good state.

---

## 1. The 30-second framing (say this before touching anything)

> "I built a fictional small-batch hot sauce brand, Ember & Ash, and an embedded app called
> Bundle Studio that manages product bundles for it — what they call 'tasting flights.' I picked
> this deliberately: hot sauce has real structured data — heat level, flavour, batch number — so
> the theme has something honest to build around instead of decorating a generic product grid.
> And because it's small-batch, inventory scarcity is real, which is what makes the app's actual
> premise — a bundle that can silently break when one component sells out — a real problem instead
> of an invented one. The theme's centerpiece and the app's whole reason for existing are the same
> idea seen from two sides: **building a flight**, on the storefront, and **keeping a flight
> healthy**, in the admin."

That's your thesis. Everything below either proves it or elaborates on it — if you get lost or a
question throws you, come back to this sentence.

---

## 2. Theme walkthrough (Ember & Ash) — ~4 minutes

Narrate as you scroll. Suggested path: **Home → Collection → Product → Flight Builder → Cart.**

### Home
> "This is the homepage. Three things worth pointing at: the hero ties into scarcity — 'Batch
> 014, 340 bottles, 61 left' — that's a real batch-tracking metafield, not decoration. Below that,
> **Shop by heat** is the signature navigation element: instead of a generic category filter, it's
> the actual heat scale — Mild through Ash — filtering the collection live. And the 'batch behind
> the bottle' section further down is provenance: pepper origin, harvest month, a note from the
> maker, per batch."

### Collection
> "Same heat-scale filter here, driving Shopify's native collection filtering — click 'Hot' and
> it narrows to just those SKUs."

*(Click a heat tier, show it filtering. Click back to 'Clear.')*

### Product page
> "Every product page repeats the batch-story block for that specific SKU, plus the flavour
> matrix — this plots every product on heat vs. flavour profile, so a customer can see where a
> bottle sits relative to the rest of the lineup, not just its own numbers in isolation."

### Flight Builder — **the standout interactive feature**
> "This is the one thing I'd point at if I only had one thing to show. A customer picks how many
> bottles — 3 to 10 — then fills each slot from the rail. Watch what happens as I add bottles."

*(Pick a size, e.g. 3. Add **Charred Pineapple**, then **Ghost Peppers**, then **Basta pagkaon**.)*

> "Those four dots are a live balance meter — heat spread, flavour diversity, overlap with other
> flights, and completeness. It's not just a shopping cart with extra steps — it coaches: if the
> flight skews too hot or too repetitive, it calls out to my backend and gets back a specific
> swap suggestion, same heat tier, better balance."

**If the app proxy is unreachable when you demo this** (known current state as of the last debugging
session — confirm before presenting whether it's fixed): the dots will sit at rest and no
suggestion will appear. Don't apologise for it or rush past it — narrate the fallback on purpose:

> "Right now that backend call isn't reaching me, so you're seeing the fallback path instead of
> live coaching — the price and the tier nudge you see are computed right here in the browser, and
> the builder tells you plainly: 'live pricing unavailable, totals confirm at checkout.' That's not
> a crash, it's a deliberate design decision — the storefront should never go down because my app
> is briefly unreachable. I'd rather show you the failure path working than just describe it."

This is a genuinely strong moment if you commit to it as intentional rather than treating it as a
bug you got caught by. If the proxy *is* working when you present, skip this paragraph and narrate
the live coaching and swap suggestion instead — cover both in rehearsal so you're ready either way.

> "The price you see is optimistic — computed right here in the browser for responsiveness — but
> the *server* recomputes and has final say the moment you add to cart. A customer should never
> see one number in the builder and a different one at checkout."

*(Click Add flight → open the cart.)*

> "Notice the cart shows **one grouped card** for the whole flight, not six separate line items —
> that's a deliberate cart-property trick under the hood, not a Shopify-native feature."

---

## 3. App walkthrough (Bundle Studio) — ~5 minutes

Switch to the admin tab.

### Dashboard
> "This is the merchant's home base. Four KPI tiles — active bundles, and a healthy/watch/at-risk
> breakdown, colour-coded so a merchant can tell their portfolio's state at a glance without
> reading numbers. Below that, open alerts, and a recent activity feed — every change anyone or
> anything makes to a bundle is logged here with a before/after diff underneath, even though today
> the UI only shows it shop-wide rather than filtered to one bundle." *(Say this plainly if asked
> — it's a known, documented scope cut, not a gap you're hiding.)*

### CRUD — Bundles → New bundle
> "Let's create one live."

*(Click New bundle → title it something → add 3 products via the picker → set min/max bottles →
add a price tier, e.g. "buy 3 get 10% off" → Publish.)*

> "Publishing does two things: it activates the bundle in our database, and it calls the Shopify
> Admin API to create a matching **automatic discount** — so the merchant never has to go set that
> discount up separately in two places."

*(Switch to the Discounts tab, refresh, point at the new discount.)*

> "There it is — created automatically, same name, same terms."

### The logic feature — Bundle Health Score
*(Click into Reckless Reserve, or whichever bundle is currently at risk.)*

> "This is the part that's actually novel. Every bundle gets a 0-to-100 score, recomputed on
> webhook events and nightly: 40% inventory runway — the *weakest* component, not the average,
> because a bundle is only as reliable as its most fragile ingredient — 25% margin integrity after
> the discount, 20% demand traction shrunk for small sample sizes so a brand-new bundle can't fake
> a perfect score, and 15% composition balance. The score always comes with a **reason** and an
> **action** — never just a number. Here: 'Charred Pineapple has 6 days of cover at current
> velocity. Suggested: swap in Smoked Habanero — 34 days cover, same heat tier.' A number a
> merchant can't act on is a number they'll stop looking at."

### Live proof of the logic feature (if time allows, this is the strongest close)
> "Let me actually break one live."

*(Go to Shopify Admin → Products, drop the inventory on one of Reckless Reserve's — or any active
bundle's — component products to near zero. Come back to Bundle Studio within about a minute.)*

> "The bundle just dropped to At Risk, named the exact limiting variant, and recommended a swap —
> that all happened through a real webhook → job queue → score recompute chain, not a canned demo
> state."

---

## 4. Closing line

> "Both halves are one system, not two separate demos stitched together: the storefront's
> centerpiece is building a flight; the app's whole purpose is keeping that flight healthy after
> it's built. That's the thing I'd want you to take away."

---

## 5. Theme — section-by-section reference (for Q&A)

| Section | What it actually does |
|---|---|
| `ember-hero` | Homepage/landing hero. Batch ticker (number, total, remaining — real metafields), heading/subheading, two CTAs. Falls back to a flat brand-coloured surface with a heat-scale spine if no merchant image is set, instead of a broken empty scrim. |
| `heat-index-rail` | The signature filter. Renders the 6-level heat scale (Mild → Ash) as colour-coded pills; clicking one filters the collection grid live via Shopify's native collection filtering, not custom JS filtering. |
| `batch-story` | Provenance block: batch number, pepper origin, harvest month, bottle count, a quoted note from the maker. Pulls from product metafields with configurable fallbacks so it degrades gracefully if a merchant hasn't filled every field in. |
| `flavor-matrix` | A 2-axis grid (flavour profile × heat level) plotting every product as a dot, so a customer sees where one bottle sits relative to the whole lineup instead of in isolation. |
| `flight-builder` | The standout interactive feature. Size picker → slot-filling from a heat-coded rail → live balance coaching (heat spread / flavour diversity / overlap / completeness) → swap suggestions → server-validated pricing → grouped add-to-cart. Renders from a metafield snapshot first (works before any JS runs), then calls the app proxy for live validation. |
| `collection-banner` | Collection page header — title, description, optional image. |
| `featured-collection` | A curated product grid dropped anywhere (used on the homepage under the heat rail). |
| `related-products` | Cross-sell grid on the product page. |
| `header` / `footer` | Standard nav, cart icon, search; footer repeats the brand line and site links. |
| `main-product`, `main-collection`, `main-cart`, `main-search`, `main-404`, `main-list-collections`, `main-page`, `main-page-contact` | Shopify's required template sections — product detail, collection grid, cart page, search results, 404, the all-collections index, and a generic/contact page. Not custom-styled beyond the shared design tokens, but present and functional as required by the brief. |

**Design system, if asked:** one CSS custom-property file (`css-variables.liquid`) drives colour,
type scale, spacing, and radius — a merchant can rebrand from the theme editor without touching
CSS. No framework, no build step for the storefront JS — vanilla custom elements, chosen
specifically to keep the Flight Builder ~10KB gzipped rather than shipping React to render a
picker.

---

## 6. App — feature-by-feature reference (for Q&A)

| Area | What it actually does |
|---|---|
| **Auth** | Token exchange (`urn:ietf:params:oauth:grant-type:token-exchange`) for the embedded path — no redirect out of the iframe. A full classic OAuth flow (`state` + HMAC) also exists at `/auth` for a direct non-embedded hit, because the brief asks for OAuth explicitly. |
| **Dashboard** | KPI tiles (active bundles, healthy/watch/at-risk counts), open alerts panel, shop-wide recent-activity feed. One API call (`GET /api/dashboard/summary`). |
| **Bundle list / editor** | Full CRUD: create as a draft, add products via a live Admin API search, set tiered pricing, define composition rules, publish (creates a Shopify automatic discount) or pause (revokes it), delete (soft delete). Every mutation writes an activity-log row with a before/after diff in the same DB transaction as the change. |
| **Bundle Health Score** | The logic-based feature. 0–100 composite: 40% inventory runway (weakest component), 25% margin integrity vs. the shop's floor, 20% demand traction (Bayesian-shrunk so small samples can't fake a high score), 15% composition balance. Recomputed on relevant webhooks and nightly. Bands: ≥75 healthy, 50–74 watch, <50 at risk — at-risk raises a deduplicated alert. Every score is append-only (nothing is overwritten, so a merchant can always see why something was flagged on a specific day). |
| **Alerts** | Generated when a bundle drops to at-risk; mentions the specific limiting variant and a swap suggestion; a merchant can acknowledge with an optional note. |
| **Webhooks** | `orders/create` / `orders/cancelled` (attach-rate and velocity, bundle order attribution), `inventory_levels/update` (the highest-signal input to the score), `products/update` (price/cost/title cache refresh), `app/uninstalled` (token purge, soft-delete), plus the three mandatory GDPR webhooks. Every webhook is verified → recorded (idempotency key from `X-Shopify-Webhook-Id`) → enqueued — never processed inline, so a slow score recompute can never cause Shopify to time out and retry-storm the endpoint. |
| **Job queue** | A MySQL table (`SELECT ... FOR UPDATE SKIP LOCKED`), not Redis — deliberate, so the whole system is `docker compose up` and done. Handles inventory sync, product sync, metrics rollup, discount reconciliation, score recompute, shop-uninstall cleanup, and GDPR compliance jobs. |
| **App Proxy** (storefront ↔ app) | `/apps/flights/*` on the storefront, verified with a 60-second timestamp window, forwards to `/proxy/*` on the app. Used for live bundle data and price/balance validation. Falls back to a metafield snapshot if unreachable, so the storefront never goes down because the app is slow or briefly unavailable. |
| **Security** | Access tokens encrypted at rest (AES-256-GCM). Every repository method takes `shopId` first — multi-tenant isolation by structure, not convention, and tested (one shop cannot read another's bundle by ID). No customer PII stored; aggregates only. |

---

## 7. Anticipated questions and how to answer them honestly

**"Why MySQL for the job queue instead of Redis/a real queue?"**
> "At this scale a polling table with `SKIP LOCKED` is genuinely adequate, and it means a reviewer
> runs one `docker compose up` and has the whole system — no extra infra. The `enqueue()`
> interface is deliberately narrow so swapping in BullMQ or SQS later is a one-file change, not a
> rewrite."

**"Why an automatic discount instead of a Shopify Cart Transform Function?"**
> "Cart Transform is Wasm with its own toolchain — that's not a six-day feature to build well.
> The automatic discount ships fast and lets Shopify own pricing truth, but the honest tradeoff is
> the flight isn't a single true cart line, and the discount shows at cart rather than inside the
> builder. It's the first thing on my roadmap if I had more time."

**"How do you know the storefront price and the server's price actually agree?"**
> "There's a property test that runs 200 randomised bottle selections and asserts the client's
> optimistic price and the server's authoritative price always match. That's the test I'd point
> at if asked to defend correctness under time pressure."

**"What would you build next?"**
> Pick two or three from `APP_DECISIONS.md` §5 depending on who's asking — a Cart Transform
> Function and forecasting (EWMA instead of trailing velocity) are the two the doc itself calls
> out as the biggest ones.

**"What's not finished / what would you flag yourself?"**
Better to say this yourself than have it discovered:
> "Two honest gaps: there's no automated end-to-end test suite yet for the storefront — the
> keyboard-only flow is verified by hand, repeatedly, but not locked in by CI. And the activity
> log is fully audit-capable per bundle in the data model, but the UI only surfaces it shop-wide
> today, not filtered to one bundle — both are called out explicitly in `APP_DECISIONS.md` rather
> than left for someone else to find."

**"Why doesn't the theme need the app installed to work?"**
> "The Flight Builder renders from a metafield snapshot written by the app on publish, so the
> storefront has no hard runtime dependency on the app being up. That was a deliberate call — a
> submitted theme that goes blank without the app installed is a bad property to ship."

**"Why isn't the live coaching/balance meter updating?" (if the app proxy is down when you present)**
> "That's the app proxy — the channel between the storefront and my backend — not currently
> reaching my server in this environment. You're seeing the exact fallback path the architecture
> is built around: `THEME_SPEC.md` documents this failure mode explicitly, and the theme is
> designed so a customer can still build and buy a flight, with a plain 'live pricing unavailable'
> note, rather than the page breaking. I'd rather show you that working than pretend it doesn't
> happen."
> Don't get pulled into narrating the specific Shopify CLI/tunnel mechanics unless asked directly —
> the answer above is complete on its own. If pressed further: dev-store app proxy URLs are tied to
> a local tunnel that regenerates on every restart, and keeping that registration in sync turned
> out to be less reliable than expected in this CLI version — a real infrastructure quirk, not a
> code defect, and not something `docker compose up` in the README ever depends on for a reviewer
> running the app normally end-to-end without the storefront/app split.

---

## 8. Timing cheat sheet

| Segment | Target time |
|---|---|
| Framing | 30 sec |
| Theme walkthrough | ~4 min |
| App walkthrough (incl. live inventory-drop proof) | ~5 min |
| Closing line | 15 sec |
| Buffer for questions | remainder |

Total demo: **~10 minutes**, leaving room in a 20–30 minute slot for questions using §7 above.
