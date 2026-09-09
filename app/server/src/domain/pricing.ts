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
