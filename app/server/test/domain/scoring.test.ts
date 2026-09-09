import { describe, expect, it } from 'vitest';
import {
  buildPrimaryReason,
  computeBalanceScore,
  computeCompositeScore,
  computeInventoryScore,
  computeMarginScore,
  computeTractionScore,
  suggestSwap,
} from '../../src/domain/scoring.js';

describe('computeInventoryScore', () => {
  it('scores 0 at exactly 3 days of cover and 100 at exactly 21 days', () => {
    expect(
      computeInventoryScore([{ variantGid: 'v1', isRequired: true, velocityPerDay: 1, onHand: 3 }])
        .score,
    ).toBe(0);
    expect(
      computeInventoryScore([{ variantGid: 'v1', isRequired: true, velocityPerDay: 1, onHand: 21 }])
        .score,
    ).toBe(100);
  });

  it('handles zero velocity via the 0.1 floor rather than dividing by zero', () => {
    const result = computeInventoryScore([
      { variantGid: 'v1', isRequired: true, velocityPerDay: 0, onHand: 10 },
    ]);
    expect(result.minDaysCover).toBe(100); // 10 / 0.1
    expect(result.score).toBe(100);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('handles zero on-hand as zero days of cover', () => {
    const result = computeInventoryScore([
      { variantGid: 'v1', isRequired: true, velocityPerDay: 2, onHand: 0 },
    ]);
    expect(result.minDaysCover).toBe(0);
    expect(result.score).toBe(0);
  });

  it('uses the minimum across required items, not the average - the scarcest component decides', () => {
    const result = computeInventoryScore([
      { variantGid: 'plentiful', isRequired: true, velocityPerDay: 1, onHand: 100 },
      { variantGid: 'scarce', isRequired: true, velocityPerDay: 1, onHand: 5 },
    ]);
    expect(result.minDaysCover).toBe(5);
    expect(result.limitingVariantGid).toBe('scarce');
  });

  it('excludes optional (non-required) components entirely', () => {
    const result = computeInventoryScore([
      { variantGid: 'required', isRequired: true, velocityPerDay: 1, onHand: 100 },
      { variantGid: 'optional-and-scarce', isRequired: false, velocityPerDay: 1, onHand: 0 },
    ]);
    expect(result.limitingVariantGid).toBe('required');
  });

  it('returns null (excluded from composite) for a single-item bundle with no required items', () => {
    const result = computeInventoryScore([
      { variantGid: 'v1', isRequired: false, velocityPerDay: 1, onHand: 10 },
    ]);
    expect(result.score).toBeNull();
    expect(result.limitingVariantGid).toBeNull();
  });

  it('scores a single required item using that item alone', () => {
    const result = computeInventoryScore([
      { variantGid: 'only', isRequired: true, velocityPerDay: 1, onHand: 12 },
    ]);
    expect(result.minDaysCover).toBe(12);
    expect(result.limitingVariantGid).toBe('only');
  });
});

describe('computeMarginScore', () => {
  const tiers = [{ minQuantity: 3, discountBps: 1000 }];

  it('excludes the component when cost data is missing on any item, rather than scoring 0 or 100', () => {
    const result = computeMarginScore(
      [
        { unitPriceCents: 1000, unitCostCents: 400 },
        { unitPriceCents: 1000, unitCostCents: null },
      ],
      3,
      tiers,
      3000,
      5500,
    );
    expect(result.score).toBeNull();
    expect(result.effectiveMarginBps).toBeNull();
    expect(result.missingCostCount).toBe(1);
  });

  it('computes effective margin net of the resolved tier discount', () => {
    const result = computeMarginScore(
      [
        { unitPriceCents: 1000, unitCostCents: 400 },
        { unitPriceCents: 1000, unitCostCents: 400 },
        { unitPriceCents: 1000, unitCostCents: 400 },
      ],
      3,
      tiers,
      3000,
      5500,
    );
    // gross 3000, 10% off -> net 2700, cogs 1200 -> margin (2700-1200)/2700 = 55.56%
    expect(result.effectiveMarginBps).toBe(5556);
    expect(result.score).toBeGreaterThan(99);
  });

  it('applies no discount when item count resolves no tier', () => {
    const result = computeMarginScore(
      [{ unitPriceCents: 1000, unitCostCents: 400 }],
      1,
      tiers,
      3000,
      5500,
    );
    expect(result.effectiveMarginBps).toBe(6000); // (1000-400)/1000, no discount applied
  });
});

describe('computeTractionScore', () => {
  it('returns null for a brand-new bundle (< 14 days live)', () => {
    const result = computeTractionScore({
      bundleOrders30d: 5,
      totalOrders30d: 10,
      shopPriorRate: 0.2,
      benchmarkShrunkRate: 0.3,
      bundleAgeDays: 5,
    });
    expect(result.score).toBeNull();
  });

  it('shrinks a brand-new bundle with a lucky small sample toward the shop prior, not a perfect 100', () => {
    // 1 order out of 2 total orders would be a raw 50% attach rate, but
    // with k=20 pseudo-count shrinkage it should land close to the prior.
    const result = computeTractionScore({
      bundleOrders30d: 1,
      totalOrders30d: 2,
      shopPriorRate: 0.1,
      benchmarkShrunkRate: 0.15,
      bundleAgeDays: 20,
    });
    // shrunk = (1 + 20*0.1) / (2 + 20) = 3/22 ≈ 0.136, far below a naive 50%
    expect(result.shrunkRate).toBeLessThan(0.2);
  });

  it('benchmarks against the shop own best bundle, not a fixed constant', () => {
    const lowBenchmarkShop = computeTractionScore({
      bundleOrders30d: 10,
      totalOrders30d: 40,
      shopPriorRate: 0.2,
      benchmarkShrunkRate: 0.05,
      bundleAgeDays: 30,
    });
    const highBenchmarkShop = computeTractionScore({
      bundleOrders30d: 10,
      totalOrders30d: 40,
      shopPriorRate: 0.2,
      benchmarkShrunkRate: 0.9,
      bundleAgeDays: 30,
    });
    expect(lowBenchmarkShop.score).toBeGreaterThan(highBenchmarkShop.score!);
  });
});

describe('computeBalanceScore', () => {
  it('scores 0 heat spread when every item has an identical heat level', () => {
    const score = computeBalanceScore({
      items: [
        { heatLevel: 3, flavorProfile: 'smoky' },
        { heatLevel: 3, flavorProfile: 'fruity' },
        { heatLevel: 3, flavorProfile: 'citrus' },
      ],
      maxOverlapWithOtherActiveBundle: 0,
    });
    // heatSpread=0, flavorDiv=3/3=1, duplication=1 -> 0.4*0+0.4*1+0.2*1 = 0.6 -> 60
    expect(score).toBe(60);
  });

  it('caps flavour diversity at 4 distinct flavours regardless of larger item counts', () => {
    const score = computeBalanceScore({
      items: [
        { heatLevel: 1, flavorProfile: 'smoky' },
        { heatLevel: 2, flavorProfile: 'fruity' },
        { heatLevel: 3, flavorProfile: 'citrus' },
        { heatLevel: 4, flavorProfile: 'umami' },
        { heatLevel: 5, flavorProfile: 'herbal' },
      ],
      maxOverlapWithOtherActiveBundle: 0,
    });
    // 5 distinct flavours, min(5,4)=4 -> flavorDiv capped at 1, not 1.25
    expect(score).toBeLessThanOrEqual(100);
  });

  it('returns 0 for an empty item list rather than dividing by zero', () => {
    expect(computeBalanceScore({ items: [], maxOverlapWithOtherActiveBundle: 0 })).toBe(0);
  });

  it('penalises full overlap with another active bundle to zero duplication credit', () => {
    const score = computeBalanceScore({
      items: [
        { heatLevel: 1, flavorProfile: 'smoky' },
        { heatLevel: 5, flavorProfile: 'citrus' },
      ],
      maxOverlapWithOtherActiveBundle: 2,
    });
    // duplication term = 0 when overlap == itemCount
    const noOverlap = computeBalanceScore({
      items: [
        { heatLevel: 1, flavorProfile: 'smoky' },
        { heatLevel: 5, flavorProfile: 'citrus' },
      ],
      maxOverlapWithOtherActiveBundle: 0,
    });
    expect(score).toBeLessThan(noOverlap);
  });
});

describe('computeCompositeScore', () => {
  it('weights all four components when every one is available', () => {
    const result = computeCompositeScore({
      inventory: 100,
      margin: 100,
      traction: 100,
      balance: 100,
    });
    expect(result.score).toBe(100);
    expect(result.partial).toBe(false);
    expect(result.band).toBe('healthy');
  });

  it('renormalises weights when margin is excluded (missing cost data) rather than scoring it as 0', () => {
    const withMargin = computeCompositeScore({
      inventory: 80,
      margin: 0,
      traction: 80,
      balance: 80,
    });
    const withoutMargin = computeCompositeScore({
      inventory: 80,
      margin: null,
      traction: 80,
      balance: 80,
    });
    expect(withoutMargin.score).toBeGreaterThan(withMargin.score);
    expect(withoutMargin.partial).toBe(true);
    expect(withoutMargin.excludedComponents).toEqual(['margin']);
    // With inventory/traction/balance all at 80 and margin excluded, the
    // renormalised score should just be 80.
    expect(withoutMargin.score).toBe(80);
  });

  it('renormalises for a brand-new bundle missing only traction', () => {
    const result = computeCompositeScore({
      inventory: 90,
      margin: 90,
      traction: null,
      balance: 90,
    });
    expect(result.score).toBe(90);
    expect(result.partial).toBe(true);
  });

  it('assigns bands at the documented thresholds', () => {
    expect(
      computeCompositeScore({ inventory: 75, margin: 75, traction: 75, balance: 75 }).band,
    ).toBe('healthy');
    expect(
      computeCompositeScore({ inventory: 74, margin: 74, traction: 74, balance: 74 }).band,
    ).toBe('watch');
    expect(
      computeCompositeScore({ inventory: 50, margin: 50, traction: 50, balance: 50 }).band,
    ).toBe('watch');
    expect(
      computeCompositeScore({ inventory: 49, margin: 49, traction: 49, balance: 49 }).band,
    ).toBe('at_risk');
  });
});

describe('buildPrimaryReason', () => {
  it('names the limiting variant when inventory is the lowest-scoring component', () => {
    const reason = buildPrimaryReason({
      inventory: { score: 10, limitingVariantTitle: 'Charred Pineapple', minDaysCover: 6 },
      margin: { score: 80, effectiveMarginBps: 5000, floorBps: 3000 },
      traction: { score: 90 },
      balance: { score: 95 },
    });
    expect(reason).toContain('Charred Pineapple');
    expect(reason).toContain('6 days');
  });

  it('explains margin when it is the lowest-scoring available component', () => {
    const reason = buildPrimaryReason({
      inventory: { score: 90, limitingVariantTitle: null, minDaysCover: 20 },
      margin: { score: 5, effectiveMarginBps: 2000, floorBps: 3000 },
      traction: { score: 90 },
      balance: { score: 95 },
    });
    expect(reason).toContain('margin');
  });

  it('falls back to balance when it is the only component available (e.g. missing cost + brand new)', () => {
    const reason = buildPrimaryReason({
      inventory: { score: null, limitingVariantTitle: null, minDaysCover: null },
      margin: { score: null, effectiveMarginBps: null, floorBps: 3000 },
      traction: { score: null },
      balance: { score: 40 },
    });
    expect(reason.length).toBeGreaterThan(0);
  });
});

describe('suggestSwap', () => {
  const currentItems = [
    { variantGid: 'limiting', heatLevel: 3, flavorProfile: 'smoky' },
    { variantGid: 'other', heatLevel: 1, flavorProfile: 'fruity' },
  ];

  it('returns null when no candidate shares the limiting heat tier', () => {
    const result = suggestSwap(
      currentItems,
      'limiting',
      [
        {
          variantGid: 'wrong-heat',
          productTitle: 'Mild Sauce',
          daysOfCover: 40,
          heatLevel: 1,
          flavorProfile: 'citrus',
        },
      ],
      0,
    );
    expect(result).toBeNull();
  });

  it('returns null when the only same-heat candidate does not clear the 21-day threshold', () => {
    const result = suggestSwap(
      currentItems,
      'limiting',
      [
        {
          variantGid: 'low-stock',
          productTitle: 'Ghost Pepper',
          daysOfCover: 10,
          heatLevel: 3,
          flavorProfile: 'umami',
        },
      ],
      0,
    );
    expect(result).toBeNull();
  });

  it('picks the candidate that yields the best resulting balance score', () => {
    // The other item is also "smoky", so a same-flavour swap leaves the
    // bundle with only 1 distinct flavour, while the new-flavour swap
    // gives it 2 - the two candidates are only distinguishable via that
    // diversity effect on the resulting balance score.
    const monoFlavorItems = [
      { variantGid: 'limiting', heatLevel: 3, flavorProfile: 'smoky' },
      { variantGid: 'other', heatLevel: 1, flavorProfile: 'smoky' },
    ];
    const result = suggestSwap(
      monoFlavorItems,
      'limiting',
      [
        {
          variantGid: 'same-flavor',
          productTitle: 'Smoky Redux',
          daysOfCover: 30,
          heatLevel: 3,
          flavorProfile: 'smoky',
        },
        {
          variantGid: 'new-flavor',
          productTitle: 'Umami Bomb',
          daysOfCover: 25,
          heatLevel: 3,
          flavorProfile: 'umami',
        },
      ],
      0,
    );
    // Swapping in a new flavour improves flavour diversity over repeating "smoky".
    expect(result?.swapInVariantGid).toBe('new-flavor');
  });
});
