// Client-side flight pricing - the Flight Builder's optimistic estimate,
// shown instantly while /apps/flights/validate reconciles the
// authoritative number. Independently implements the same math as the
// server's domain/pricing.ts computeFlightPrice/computeNextTierNudge -
// verified to agree across 200 random selections by a property test
// (app/server/test/domain/flight-pricing-parity.test.ts), not shared by
// import, so the test proves two implementations converge rather than
// merely exercising one. See ARCHITECTURE.md §6.2 and THEME_SPEC.md §4.4.

/**
 * @param {number[]} tiers - not used directly; kept for symmetry with the
 *   server's PriceTier[] shape when called from tests.
 */
export function resolveTierForQuantity(tiers, quantity) {
  return tiers
    .filter((t) => t.minQuantity <= quantity)
    .sort((a, b) => b.minQuantity - a.minQuantity)[0];
}

export function computeFlightPrice(input) {
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
  const discountBps = tier ? tier.discountBps : 0;

  let discountCents;
  if (input.pricingMode === 'per_item_percent') {
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

export function computeNextTierNudge(tiers, quantity, maxItems) {
  const better = tiers
    .filter((t) => t.minQuantity > quantity && t.minQuantity <= maxItems)
    .sort((a, b) => a.minQuantity - b.minQuantity)[0];
  if (!better) return null;
  return { itemsNeeded: better.minQuantity - quantity, nextDiscountBps: better.discountBps };
}
