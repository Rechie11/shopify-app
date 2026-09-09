export interface PriceTier {
  minQuantity: number;
  discountBps: number;
}

// Resolution is "highest min_quantity <= selected count". See SCHEMA.md §3.5.
export function resolveTierForQuantity(
  tiers: PriceTier[],
  quantity: number,
): PriceTier | undefined {
  return tiers
    .filter((t) => t.minQuantity <= quantity)
    .sort((a, b) => b.minQuantity - a.minQuantity)[0];
}

export function lowestTier(tiers: PriceTier[]): PriceTier | undefined {
  return [...tiers].sort((a, b) => a.minQuantity - b.minQuantity)[0];
}

export function bpsToPercentage(bps: number): number {
  return bps / 10000;
}

export type PricingMode = 'tiered_percent' | 'fixed_price' | 'per_item_percent';

export interface FlightPriceInput {
  itemPricesCents: number[];
  pricingMode: PricingMode;
  fixedPriceCents: number | null;
  tiers: PriceTier[];
}

export interface FlightPriceResult {
  quantity: number;
  subtotalCents: number;
  discountBps: number;
  discountCents: number;
  totalCents: number;
  savingsCents: number;
  savingsPercent: number;
}

// The single function both the Flight Builder's optimistic client-side
// estimate and the server's /apps/flights/validate response are built
// from - independently reimplemented on the client (see
// assets/flight-pricing.js) and asserted to agree across 200 random
// selections, not shared by import, because the point is verifying two
// implementations converge, not merely reusing one. See
// ARCHITECTURE.md §6.2 and THEME_SPEC.md §4.4.
export function computeFlightPrice(input: FlightPriceInput): FlightPriceResult {
  const quantity = input.itemPricesCents.length;
  const subtotalCents = input.itemPricesCents.reduce((sum, p) => sum + p, 0);

  if (input.pricingMode === 'fixed_price') {
    const totalCents = input.fixedPriceCents ?? subtotalCents;
    const savingsCents = Math.max(0, subtotalCents - totalCents);
    return {
      quantity,
      subtotalCents,
      discountBps: 0,
      discountCents: subtotalCents - totalCents,
      totalCents,
      savingsCents,
      savingsPercent: subtotalCents > 0 ? savingsCents / subtotalCents : 0,
    };
  }

  const tier = resolveTierForQuantity(input.tiers, quantity);
  const discountBps = tier?.discountBps ?? 0;

  let discountCents: number;
  if (input.pricingMode === 'per_item_percent') {
    // Rounded per line item, then summed - can differ from a single
    // subtotal-level rounding by a cent or two. That divergence is the
    // reason this is a distinct pricing mode, not cosmetic.
    discountCents = input.itemPricesCents.reduce(
      (sum, price) => sum + Math.round((price * discountBps) / 10000),
      0,
    );
  } else {
    discountCents = Math.round((subtotalCents * discountBps) / 10000);
  }

  const totalCents = subtotalCents - discountCents;
  return {
    quantity,
    subtotalCents,
    discountBps,
    discountCents,
    totalCents,
    savingsCents: discountCents,
    savingsPercent: subtotalCents > 0 ? discountCents / subtotalCents : 0,
  };
}

export interface NextTierNudge {
  itemsNeeded: number;
  nextDiscountBps: number;
}

// "Add one more - a 4-bottle flight saves 15% instead of 10%." The
// highest-AOV line of copy in the theme, per THEME_SPEC.md §4.4.
export function computeNextTierNudge(
  tiers: PriceTier[],
  quantity: number,
  maxItems: number,
): NextTierNudge | null {
  const better = tiers
    .filter((t) => t.minQuantity > quantity && t.minQuantity <= maxItems)
    .sort((a, b) => a.minQuantity - b.minQuantity)[0];
  if (!better) return null;
  return { itemsNeeded: better.minQuantity - quantity, nextDiscountBps: better.discountBps };
}
