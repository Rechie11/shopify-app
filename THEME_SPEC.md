# Ember & Ash — Theme Specification

**Part 1 deliverable.** Shopify Liquid + CSS + minimal JavaScript. No Bootstrap, no Tailwind,
no framework on the storefront.

---

## 1. Brand

**Ember & Ash** — small-batch hot sauce, fire-roasted peppers, numbered batches, made in small
runs and sold until they run out. The scarcity is real, and the whole storefront leans on it.

**Voice:** confident, dry, a little bit dangerous. Never "spice lovers rejoice!" — more
"Batch 014. 340 bottles. Charred pineapple, scotch bonnet, and a bad decision."

**Positioning:** the opposite of a supermarket hot sauce wall. Every bottle has provenance —
a batch number, a pepper origin, a harvest month, and a note from the maker.

### 1.1 Design tokens

Declared once in `snippets/css-variables.liquid`, driven by `settings_schema.json`, so a merchant
can rebrand in the theme editor without touching CSS.

```css
:root {
  /* Surface */
  --c-ash: #ede7de; /* page ground — warm paper, not white */
  --c-ash-deep: #ddd4c7; /* raised cards */
  --c-char: #17130f; /* near-black, brown-biased */
  --c-smoke: #6b6259; /* secondary text */

  /* Heat scale — also the heat-index UI, 0 through 5 */
  --c-heat-0: #c8cba6;
  --c-heat-1: #e8c547;
  --c-heat-2: #e2903b;
  --c-heat-3: #e2542c;
  --c-heat-4: #c22e22;
  --c-heat-5: #7a1410;

  --c-ember: #e2542c; /* primary action */
  --c-lime: #b9d24a; /* accent, freshness counterpoint */

  /* Type */
  --f-display: 'Fraunces', ui-serif, Georgia, serif; /* Shopify font_picker */
  --f-body: 'Inter', ui-sans-serif, system-ui, sans-serif;

  --step--1: clamp(0.83rem, 0.8rem + 0.15vw, 0.92rem);
  --step-0: clamp(1rem, 0.96rem + 0.2vw, 1.13rem);
  --step-1: clamp(1.33rem, 1.2rem + 0.6vw, 1.75rem);
  --step-2: clamp(1.78rem, 1.5rem + 1.4vw, 2.9rem);
  --step-3: clamp(2.37rem, 1.8rem + 2.8vw, 4.8rem);

  /* Space — 4px base, one scale, used everywhere */
  --s-1: 0.25rem;
  --s-2: 0.5rem;
  --s-3: 0.75rem;
  --s-4: 1rem;
  --s-6: 1.5rem;
  --s-8: 2rem;
  --s-12: 3rem;
  --s-16: 4rem;
  --s-24: 6rem;

  --radius: 2px; /* nearly square — this brand is not soft */
  --ease: cubic-bezier(0.2, 0.7, 0.3, 1);

  /* Depth — added in the Day 6 visual audit (§11). Warm-toned, not cold
     gray, so raised surfaces read as part of this palette, not a
     generic-admin shadow pasted on top of it. */
  --shadow-soft: 0 1px 2px rgb(23 19 15 / 0.04), 0 4px 16px rgb(23 19 15 / 0.06);
  --shadow-soft-hover: 0 2px 4px rgb(23 19 15 / 0.06), 0 8px 24px rgb(23 19 15 / 0.09);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**The heat scale is the design system.** The same six colours appear on product badges, the
collection filter rail, the product page dial, and the Flight Builder's heat curve. One visual
language carried across every template is what separates a designed theme from a styled one.

---

## 2. Template structure

| Template                                                                             | Sections                                                                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `index.json`                                                                         | `ember-hero` · `heat-index-rail` · `flight-builder` · `batch-story` · `flavor-matrix` · `featured-collection` |
| `collection.json`                                                                    | `collection-banner` · `heat-index-rail` (filter mode) · `main-collection`                                     |
| `product.json`                                                                       | `main-product` · `batch-story` · `flavor-matrix` (comparison mode) · `related-products`                       |
| `cart.json`                                                                          | `main-cart` (flight-aware grouping)                                                                           |
| `page.contact.json`, `page.json`, `list-collections.json`, `404.json`, `search.json` | supporting                                                                                                    |

`layout/theme.liquid` holds the meta/OG tags, the critical inline CSS, `{{ content_for_header }}`,
and a single deferred entry module. `layout/password.liquid` is styled too — a dev store is
password-protected, so for anyone reviewing the submission it is literally the first page they
see.

---

## 3. Custom sections

The task requires **at least 3**. There are **five**, and each earns its place.

### 3.1 `ember-hero` — the entry

Full-bleed image or looping muted video, a display headline at `--step-3`, batch ticker
("Batch 014 · 340 bottles · 61 left"), dual CTA (_Shop the shelf_ / _Build a flight_).

Schema settings: media picker, video URL, heading, subheading, two CTA label+link pairs, overlay
opacity, text alignment, height preset (`s`/`m`/`l`/`full`).

Implementation notes: `loading="eager"` + `fetchpriority="high"` on the hero image only, explicit
`width`/`height` to reserve space (CLS is won or lost here), `srcset` from
`image_url: width: 600|900|1400|2000`.

### 3.2 `heat-index-rail` — the signature filter

A horizontal Scoville scale, 0 → 5, rendered as six flame segments in the heat palette. On the
homepage it filters a product grid live; on a collection page it drives Shopify's native
`filter.p.m.custom.heat_level` faceting so the filter state is URL-addressable and
back-button-correct.

- Client-side filtering uses `[hidden]` toggling on already-rendered cards — no refetch, no
  layout thrash
- Selected state pushed to `history.replaceState` so a filtered view is shareable
- Blocks: one per heat tier, with an editable label ("Mild", "Warm", "Hot", "Serious", "Reckless",
  "Ash")

**Why it's good:** heat level is the single attribute a hot-sauce buyer actually shops on.
Building the primary navigation around the primary purchase decision is product thinking
expressed as UI.

### 3.3 `batch-story` — provenance

Editorial two-column block: batch number, harvest month, pepper origin with a small map dot,
bottle count, and a short maker's note. Block-based so a merchant can add a batch per product.

Reads from product metafields (`custom.batch_number`, `custom.pepper_origin`,
`custom.harvest_month`, `custom.bottle_count`) with sensible fallbacks when a metafield is empty —
a section that renders an empty grey box when unconfigured is a section that will embarrass you
in a demo.

### 3.4 `flavor-matrix` — comparison

A grid plotting sauces on heat (x) against flavour profile (y). On the homepage it is a browse
tool; on a product page it renders in comparison mode with the current product highlighted and
its two nearest neighbours called out ("if you like this, and want it hotter…").

Pure CSS Grid, no charting library. Cells are anchors. Reduces to a horizontally scrollable
table below 640 px with `scroll-snap-type: x mandatory`.

### 3.5 `flight-builder` — **the standout interactive feature**

Specified in full in §4.

---

## 4. The Flight Builder

### 4.1 What it is

A guided flow to assemble a 3, 4, or 6-bottle tasting flight, which — unlike every "build a
bundle" widget — **has an opinion about whether your flight is any good**.

It reads its configuration from Bundle Studio (the admin app): the available flights, their
price tiers, their composition rules, and each sauce's heat level and flavour profile. Server-side
validation happens against the same `computeBalance()` function that powers the app's Bundle
Health Score. The storefront and the admin agree on what "balanced" means because it is one
function.

### 4.2 Flow

```
  ① SIZE                ② SELECT                        ③ REVIEW
  ┌───────────┐   ┌──────────────────────────┐   ┌────────────────────┐
  │  3  4  6  │ → │  slot 1  slot 2  slot 3  │ → │  Heat curve  ▁▃▅▇  │
  │  bottles  │   │   [+]     [+]     [+]    │   │  Balance ●●●○      │
  └───────────┘   │  ── sauce rail ────────  │   │  ₱1,240 · save ₱138│
                  │  [🌶][🌶][🌶][🌶][🌶]►   │   │  [ Add flight ]    │
                  └──────────────────────────┘   └────────────────────┘
                         live coaching ↑
```

Steps 2 and 3 are one screen on desktop (rail left, review panel sticky right) and stacked with a
sticky bottom summary bar on mobile. The three-step framing is conceptual, not three page loads.

### 4.3 The coaching layer — what makes it not a bundle picker

As slots fill, a live panel updates:

- **Heat curve** — an inline SVG polyline across the selected slots. A good flight ramps; a flat
  line at tier 5 gets _"this is five kinds of very hot — consider opening with something milder."_
- **Balance meter** — four dots: heat spread, flavour variety, duplication, completeness
- **One suggestion at a time.** Never a list of complaints. _"Heavy on smoky. Swap slot 2 for
  Charred Pineapple?"_ with a one-tap **Swap** button that does it.
- **Blocking vs advisory** is honoured from `bundle_rules.is_blocking`: advisory issues are amber
  and never prevent checkout; blocking issues disable the CTA and say exactly what is missing.

Copy is written to coach, not to scold. The customer is buying hot sauce, not passing an exam.

### 4.4 Pricing

- Displayed price comes from `POST /apps/flights/validate` — the server is authoritative
- The client computes an optimistic price for instant feedback, then reconciles; if they differ,
  the server wins silently
- Savings shown as both an amount and a percentage against the à-la-carte total
- Labelled **"Flight discount applied at checkout"** — honest, because the discount is a Shopify
  automatic discount and materialises in the cart (see ARCHITECTURE §9)
- Tier proximity nudge: _"Add one more — a 4-bottle flight saves 15% instead of 10%."_ This is
  the highest-AOV line of copy in the whole theme

### 4.5 Add to cart

```js
const res = await fetch(`${Shopify.routes.root}cart/add.js`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    items: slots.map((s, i) => ({
      id: s.variantId,
      quantity: 1,
      properties: {
        _flight_id: flightToken, // ULID, ties the lines together
        _flight_name: bundle.title,
        _flight_slot: String(i + 1),
      },
    })),
  }),
});
```

Underscore-prefixed properties are hidden from the customer in cart and checkout. The cart
template groups lines sharing a `_flight_id` into one card — a single image cluster, one title,
one price, one **Remove flight** action that removes all lines together. A customer who has to
delete six lines individually to remove one flight will assume the site is broken.

### 4.6 State persistence

Flight state is serialised into the URL hash (`#flight=3:v1,v7,v12`) and mirrored to
`sessionStorage`. Consequences: refresh-safe, back-button-safe, and a customer can send a friend
a link to the exact flight they built. Roughly fifteen lines of code for a genuinely shareable
artefact.

### 4.7 Failure behaviour

| Failure                    | Behaviour                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Proxy unreachable          | Falls back to the metafield snapshot; banner: _"Live pricing unavailable — totals confirm at checkout"_; builder remains fully usable |
| Variant sold out mid-build | Slot marked, alternative offered inline, CTA blocked until resolved                                                                   |
| `cart/add.js` fails        | Inline error with a retry, selection preserved; never a silent no-op                                                                  |
| JavaScript disabled        | `<noscript>` renders the flight collection as a plain, purchasable product grid                                                       |

Every one of these is demoable. Deliberately breaking the proxy during the presentation and
showing the theme carry on is worth more than any amount of describing resilience.

### 4.8 Implementation

Vanilla ES module, custom element, no dependencies:

```js
class FlightBuilder extends HTMLElement {
  /* ~250 lines */
}
customElements.define('flight-builder', FlightBuilder);
```

Budget: **≤ 10 KB gzipped**, loaded `type="module" defer`, initialised on first interaction or
`IntersectionObserver` entry — not on page load. The section renders its skeleton in Liquid and
is fully readable before any JavaScript executes.

---

## 5. Product page

- Gallery with thumbnails, `<dialog>` lightbox, keyboard-navigable, no carousel library
- **Heat dial** — a radial gauge in the heat palette showing the Scoville tier, with a plain-language
  comparator ("about 4× a jalapeño") because Scoville units mean nothing to most buyers
- Flavour profile chips linking into the flavour matrix
- Batch panel: number, bottles made, bottles left (from `variant.inventory_quantity` when
  `inventory_policy` allows), harvest month
- Pairing suggestions from a `custom.pairs_with` metafield
- Variant selection via native `<select>` / radio inputs updating `?variant=` — no JS-only variant
  picker, so the page works before hydration
- Sticky add-to-cart bar on mobile below the fold
- **"Add to a flight"** secondary CTA that opens the builder pre-seeded with this sauce in slot 1
- JSON-LD `Product` schema with price, availability, and aggregate rating

---

## 6. Cart

- Flight lines grouped into one card (§4.5); loose lines render normally
- Quantity updates via `/cart/change.js`, optimistic UI, `aria-live` announcement of the new total
- Free-shipping progress bar driven by `cart.total_price` against a theme setting
- Empty state that sells: _"Nothing on the shelf yet"_ + three entry points (bestsellers, build a
  flight, the mild end of the range) — an empty cart is a merchandising slot, not a dead end
- Order note, and a "gift — hide prices" checkbox writing a cart attribute

---

## 7. Performance budget

| Metric                          | Target          | Approach                                                                                 |
| ------------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| Lighthouse Performance (mobile) | ≥ 90            | measured on the dev store before submission                                              |
| LCP                             | < 2.0 s         | hero image `fetchpriority=high`, `preconnect` to `cdn.shopify.com`, critical CSS inlined |
| CLS                             | < 0.05          | every image has explicit dimensions; no injected banners; fonts with `size-adjust`       |
| INP                             | < 200 ms        | no long tasks; builder work is O(items) over ≤ 18 items                                  |
| Total JS (home)                 | < 25 KB gzipped | builder ~10 KB, rail ~3 KB, cart ~4 KB. Zero dependencies                                |
| Total CSS                       | < 30 KB gzipped | one stylesheet, custom properties, no utility framework                                  |

Rules that make the budget hold: no jQuery, no Bootstrap, no carousel library; images through
Shopify's CDN with `srcset` + `sizes`; below-fold sections lazy-initialised; `font-display: swap`
with a metric-matched fallback stack.

---

## 8. Accessibility — WCAG 2.1 AA

- **Contrast:** every token pair verified ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries. `--c-heat-1`
  (#E8C547) fails on `--c-ash`, so it is used as a fill with `--c-char` text on top, never as text
  on the page ground. Colour never carries meaning alone — heat tiers always pair a colour with a
  numeral and a label. `.scheme-ember` (Day 6 audit) was found pairing `--c-ash` text on `--c-ember`
  at 3.09:1 — an unused utility class, fixed to `--c-char` text (4.87:1) before it could be picked
  up by a future section.
- **Keyboard:** the Flight Builder is fully operable without a mouse. Arrow keys move along the
  sauce rail, Enter/Space adds to the next open slot, Delete clears a slot, Escape exits the rail.
  A visible `:focus-visible` ring in `--c-ember` on every interactive element.
- **Screen readers:** slot changes and balance feedback announced through a single `aria-live="polite"`
  region (one region, debounced 300 ms — three competing live regions is worse than none). The
  rail is a `role="listbox"` with `aria-selected` slots. `<dialog>` handles focus trapping natively.
- **Structure:** one `<h1>` per page, no skipped heading levels, landmarks on every region, a skip
  link as the first focusable element.
- **Motion:** `prefers-reduced-motion` respected globally; the heat-curve animation degrades to an
  instant state change.
- **Targets:** minimum 44 × 44 px on all controls.

Verified with axe DevTools, VoiceOver, and a full keyboard-only pass before submission.

---

## 9. Theme editor experience

Every section is fully configurable — a theme a merchant cannot edit is a mockup.

- All copy, imagery, and CTAs exposed as settings; nothing important hardcoded
- Block-based sections (`batch-story`, `heat-index-rail`, `flavor-matrix`) support add/remove/reorder
- `presets` on every section so it appears in the "Add section" picker with a sensible default
- `settings_schema.json` exposes the brand tokens: colours, both fonts, corner radius, container width
- Section-level colour scheme selector (`ash` / `char` / `ember`) using Shopify's colour scheme
  settings, so any section can invert
- `default` values everywhere, so a freshly added section renders complete content immediately

---

## 10. File inventory

```
theme/
├─ layout/           theme.liquid · password.liquid
├─ templates/        index.json · collection.json · product.json · cart.json
│                    page.json · page.contact.json · list-collections.json
│                    search.json · 404.json
├─ sections/         ember-hero.liquid · heat-index-rail.liquid · batch-story.liquid
│                    flavor-matrix.liquid · flight-builder.liquid
│                    header.liquid · footer.liquid · main-product.liquid
│                    main-collection.liquid · main-cart.liquid
├─ snippets/         css-variables.liquid · sauce-card.liquid · heat-dial.liquid
│                    price.liquid · responsive-image.liquid · icon.liquid
│                    cart-flight-group.liquid · meta-tags.liquid
├─ assets/           base.css · flight-builder.js · heat-rail.js · cart.js · global.js
├─ config/           settings_schema.json · settings_data.json
└─ locales/          en.default.json
```

All customer-facing strings go through `locales/en.default.json` and `{{ 'key' | t }}`. Hardcoded
English in Liquid is the most common avoidable mark-down on a Shopify theme review, and it costs
nothing to do correctly from the first section.

---

## 11. Day 6 visual audit — what changed

A screenshot review of the storefront as configured (no merchant hero image uploaded yet, three
mismatched seed-data product photos) turned up real defects, not just taste calls. Fixed in
`base.css` and `css-variables.liquid` only — no Liquid template structure, no JS behaviour, no
schema changed.

- **Hero rendered as a bare gray-to-black gradient with nothing behind it.** No hero image is
  configured in the demo `settings_data.json`, so `.ember-hero__media` had no photo and nothing
  else — just the fixed readability scrim sitting on an empty div.
  First fix attempt was a soft radial ember-to-char gradient — wrong call, caught on review: it's
  the only blurred colour-blob decoration anywhere in the theme, and this brand's tokens are
  explicit about not being soft (`--radius: 2px`, §1.1). Replaced with what the rest of the theme
  actually does — flat `--c-char` — plus a 5px hard-edged spine of the six heat-scale colours down
  the left edge, the one motif this theme repeats everywhere (badges, filter rail, product dial,
  Flight Builder curve). The spine is a permanent signature on every hero, photo or none, not just
  an empty-state patch. A real merchant photo still fully covers the flat fallback via
  `object-fit: cover`.
- **The Flight Builder's balance-meter dots were invisible at rest.** `--fill: 0` resolved the
  conic-gradient to 100% `--c-ash`, which is the same colour as the panel it sits on — four dots
  that exist but cannot be seen until a bottle is picked. Added a permanent `--c-smoke` ring so the
  meter reads as "four things to fill," not empty space.
- **Filled slots and pale heat swatches had no edge definition.** `--c-heat-0`/`--c-heat-1` are
  close in value to `--c-ash-deep`, the slot chip's own background, so a picked Mild or Warm bottle
  nearly vanished into its own chip. Added a 1px inset ring on `.heat-rail__flame` inside filled
  slots, plus a hover border-color shift and the new `--shadow-soft` for a visibly "raised" chip.
- **Flat card boundaries throughout.** `.card`, `.sauce-card__media`, and
  `.flight-builder__review` all sit at `--c-ash-deep` against a `--c-ash` page ground — a ~2%
  lightness difference, too close to read as a distinct surface without a shadow doing the work.
  Added `--shadow-soft` / `--shadow-soft-hover` (new tokens, §1.1) to all three.
- **Mismatched seed-data product photography.** The three demo products currently mix a line-art
  illustration, an unrelated food photo, and a stock pepper image on three different baked-in
  backgrounds — a CSS filter cannot fix that; it needs consistent product photography, named here
  rather than silently left. What CSS *can* do: added a shared inset vignette to
  `.sauce-card__media` (`::after`, a bottom-edge shadow) so every card gets the same frame
  treatment regardless of what's inside it — real mitigation, not a full fix. **Before demo day:**
  replace the seed images with either consistent product photography or a single illustration
  style across all SKUs.

- **The flight price showed `$$0.00` on first paint.** Two independent sources each added a
  currency symbol: `.flight-builder__price-total::before` in CSS prepends `$` (JS's `formatMoney()`
  deliberately returns a plain, currency-agnostic decimal so it doesn't guess at the shop's money
  format), but the initial Liquid value used `{{ 0 | money }}`, which already includes the symbol.
  Before the custom element's first price computation replaces it, both fire at once. Changed the
  initial value to `{{ 0 | money_without_currency }}` so it matches the plain-decimal contract the
  CSS `$` prefix and `formatMoney()` already agreed on.
- **"Build a flight," the hero's secondary CTA, was invisible.** `.button` hardcodes
  `color: var(--c-char)` (near-black) regardless of context. `.button--ghost` overrode the border
  to `currentColor` but never touched `color`, so it stayed near-black text on a near-black border
  — invisible against the hero's dark scrim, though fine against the cream page everywhere else
  it's used (cart, product page, featured collection). Added `color: inherit` to `.button--ghost`,
  so it now takes its color from whatever surface it's on: `--c-char` from `body` everywhere it
  already worked, `--c-ash` inside `.ember-hero`, which sets its own light text color for exactly
  this reason.
- **Primary buttons went near-invisible on hover.** `.button--primary` sets `color: var(--c-char)`
  for its normal ember-background state. `.button--primary:hover` swaps the background to
  `--c-char` but never reset the text color, so hovering "Shop the shelf" produced near-black text
  on a near-black background — the exact inverse of the ghost-button bug above. Added
  `color: var(--c-ash)` to `.button--primary:hover`.
- **Batch Story's image could take over the whole page.** `responsive-image.liquid` renders the
  source image at its own native width/height with no cropping unless the caller passes a `class`
  that constrains it — `sauce-card` does this (`aspect-ratio: 4/5`, `object-fit: cover`);
  `batch-story.liquid` never did. A tall/narrow source illustration (or any oddly-proportioned
  image a merchant uploads) rendered at its own extreme intrinsic aspect ratio, stretching the
  whole section's height to match. Added a `batch-story__media` class with the same
  `aspect-ratio: 4/5` / `object-fit: cover` treatment already proven on product cards.

Verified with `shopify theme check` (41 files, 0 offenses) after each change.
