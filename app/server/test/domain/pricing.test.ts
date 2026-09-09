import { describe, expect, it } from 'vitest';
import {
  bpsToPercentage,
  computeFlightPrice,
  computeNextTierNudge,
  lowestTier,
  resolveTierForQuantity,
} from '../../src/domain/pricing.js';

const tiers = [
  { minQuantity: 3, discountBps: 1000 },
  { minQuantity: 4, discountBps: 1500 },
  { minQuantity: 6, discountBps: 2200 },
];

describe('resolveTierForQuantity', () => {
  it('resolves the highest tier at or below the quantity', () => {
    expect(resolveTierForQuantity(tiers, 6)?.discountBps).toBe(2200);
    expect(resolveTierForQuantity(tiers, 5)?.discountBps).toBe(1500);
    expect(resolveTierForQuantity(tiers, 4)?.discountBps).toBe(1500);
    expect(resolveTierForQuantity(tiers, 3)?.discountBps).toBe(1000);
  });

  it('returns undefined below every tier threshold', () => {
    expect(resolveTierForQuantity(tiers, 2)).toBeUndefined();
  });

  it('returns undefined for an empty tier list', () => {
    expect(resolveTierForQuantity([], 5)).toBeUndefined();
  });
});

describe('lowestTier', () => {
  it('returns the tier with the smallest min_quantity regardless of input order', () => {
    expect(lowestTier([tiers[2]!, tiers[0]!, tiers[1]!])?.minQuantity).toBe(3);
  });

  it('returns undefined for an empty list', () => {
    expect(lowestTier([])).toBeUndefined();
  });
});

describe('bpsToPercentage', () => {
  it('converts basis points to a fraction (Shopify GraphQL percentage format)', () => {
    expect(bpsToPercentage(1000)).toBe(0.1);
    expect(bpsToPercentage(2200)).toBeCloseTo(0.22);
  });
});

describe('computeFlightPrice', () => {
  it('applies the resolved tier discount to the subtotal in tiered_percent mode', () => {
    const result = computeFlightPrice({
      itemPricesCents: [1000, 1000, 1000, 1000],
      pricingMode: 'tiered_percent',
      fixedPriceCents: null,
      tiers,
    });
    expect(result.subtotalCents).toBe(4000);
    expect(result.discountBps).toBe(1500);
    expect(result.discountCents).toBe(600);
    expect(result.totalCents).toBe(3400);
    expect(result.savingsCents).toBe(600);
    expect(result.savingsPercent).toBeCloseTo(0.15);
  });

  it('applies zero discount below the lowest tier threshold', () => {
    const result = computeFlightPrice({
      itemPricesCents: [1000, 1000],
      pricingMode: 'tiered_percent',
      fixedPriceCents: null,
      tiers,
    });
    expect(result.discountBps).toBe(0);
    expect(result.totalCents).toBe(2000);
  });

  it('ignores tiers and charges the fixed price in fixed_price mode', () => {
    const result = computeFlightPrice({
      itemPricesCents: [1500, 2000, 999],
      pricingMode: 'fixed_price',
      fixedPriceCents: 4000,
      tiers,
    });
    expect(result.subtotalCents).toBe(4499);
    expect(result.totalCents).toBe(4000);
    expect(result.savingsCents).toBe(499);
    expect(result.discountBps).toBe(0);
  });

  it('never reports negative savings when the fixed price exceeds the subtotal', () => {
    const result = computeFlightPrice({
      itemPricesCents: [500],
      pricingMode: 'fixed_price',
      fixedPriceCents: 4000,
      tiers,
    });
    expect(result.totalCents).toBe(4000);
    expect(result.savingsCents).toBe(0);
  });

  it('rounds per line item in per_item_percent mode, which can differ from subtotal-level rounding', () => {
    // Three 1-cent items at 50% off: each item's discount rounds up to a
    // full cent (3 total), but the combined subtotal's discount rounds to
    // 2 - the exact compounding-rounding scenario per_item_percent exists
    // to model.
    const itemPricesCents = [1, 1, 1];
    const oddTiers = [{ minQuantity: 3, discountBps: 5000 }];

    const perItem = computeFlightPrice({
      itemPricesCents,
      pricingMode: 'per_item_percent',
      fixedPriceCents: null,
      tiers: oddTiers,
    });
    const perSubtotal = computeFlightPrice({
      itemPricesCents,
      pricingMode: 'tiered_percent',
      fixedPriceCents: null,
      tiers: oddTiers,
    });

    expect(perItem.discountCents).not.toBe(perSubtotal.discountCents);
  });

  it('returns zero savings percent for an empty selection', () => {
    const result = computeFlightPrice({
      itemPricesCents: [],
      pricingMode: 'tiered_percent',
      fixedPriceCents: null,
      tiers,
    });
    expect(result.subtotalCents).toBe(0);
    expect(result.savingsPercent).toBe(0);
  });
});

describe('computeNextTierNudge', () => {
  it('finds the next reachable tier and how many more items it needs', () => {
    const nudge = computeNextTierNudge(tiers, 3, 6);
    expect(nudge).toEqual({ itemsNeeded: 1, nextDiscountBps: 1500 });
  });

  it('returns null when already at the best tier', () => {
    expect(computeNextTierNudge(tiers, 6, 6)).toBeNull();
  });

  it('does not suggest a tier the bundle maxItems cannot reach', () => {
    expect(computeNextTierNudge(tiers, 4, 5)).toBeNull();
  });
});
