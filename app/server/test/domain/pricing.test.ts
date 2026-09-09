import { describe, expect, it } from 'vitest';
import { bpsToPercentage, lowestTier, resolveTierForQuantity } from '../../src/domain/pricing.js';

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
