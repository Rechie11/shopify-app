import { describe, expect, it } from 'vitest';
import {
  computeFlightPrice as serverComputeFlightPrice,
  computeNextTierNudge as serverComputeNextTierNudge,
  type PricingMode,
} from '../../src/domain/pricing.js';
// The theme's independent client-side reimplementation - see its header
// comment for why this isn't shared by import. Runtime-only: not part of
// this package's tsconfig "include", so it isn't type-checked here, only
// executed by vitest.
// @ts-expect-error - plain JS module outside this package, no declaration file
import * as clientPricing from '../../../../theme/assets/flight-pricing.js';

// Deterministic PRNG (mulberry32) so a failing seed is reproducible from
// the printed iteration index alone, without needing a fuzzing library.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

const PRICING_MODES: PricingMode[] = ['tiered_percent', 'fixed_price', 'per_item_percent'];

interface RandomCase {
  itemPricesCents: number[];
  pricingMode: PricingMode;
  fixedPriceCents: number | null;
  tiers: Array<{ minQuantity: number; discountBps: number }>;
  maxItems: number;
}

function randomCase(rng: () => number): RandomCase {
  const pricingMode = PRICING_MODES[randomInt(rng, 0, PRICING_MODES.length - 1)]!;
  const itemCount = randomInt(rng, 0, 8);
  const itemPricesCents = Array.from({ length: itemCount }, () => randomInt(rng, 0, 5000));

  const tierCount = randomInt(rng, 0, 3);
  const seenQuantities = new Set<number>();
  const tiers: Array<{ minQuantity: number; discountBps: number }> = [];
  for (let i = 0; i < tierCount; i++) {
    const minQuantity = randomInt(rng, 1, 8);
    if (seenQuantities.has(minQuantity)) continue;
    seenQuantities.add(minQuantity);
    tiers.push({ minQuantity, discountBps: randomInt(rng, 0, 5000) });
  }

  return {
    itemPricesCents,
    pricingMode,
    fixedPriceCents: pricingMode === 'fixed_price' ? randomInt(rng, 0, 20000) : null,
    tiers,
    maxItems: randomInt(rng, itemCount, itemCount + 4),
  };
}

describe('flight pricing parity: server (TypeScript) vs theme (vanilla JS)', () => {
  it('agrees on computeFlightPrice across 200 random selections', () => {
    const rng = mulberry32(20260913);

    for (let i = 0; i < 200; i++) {
      const testCase = randomCase(rng);

      const serverResult = serverComputeFlightPrice(testCase);
      const clientResult = clientPricing.computeFlightPrice(testCase);

      expect(clientResult, `iteration ${i}: ${JSON.stringify(testCase)}`).toEqual(serverResult);
    }
  });

  it('agrees on computeNextTierNudge across 200 random selections', () => {
    const rng = mulberry32(20260914);

    for (let i = 0; i < 200; i++) {
      const testCase = randomCase(rng);
      const quantity = testCase.itemPricesCents.length;

      const serverResult = serverComputeNextTierNudge(testCase.tiers, quantity, testCase.maxItems);
      const clientResult = clientPricing.computeNextTierNudge(
        testCase.tiers,
        quantity,
        testCase.maxItems,
      );

      expect(clientResult, `iteration ${i}: ${JSON.stringify(testCase)}`).toEqual(serverResult);
    }
  });
});
