import { resolveTierForQuantity, type PriceTier } from './pricing.js';

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// score = 0.40 x inventory + 0.25 x margin + 0.20 x traction + 0.15 x balance
// Inventory dominates because a stock-out is the only failure that is
// unrecoverable. See SCHEMA.md §4.1.
export const SCORE_WEIGHTS = {
  inventory: 0.4,
  margin: 0.25,
  traction: 0.2,
  balance: 0.15,
} as const;

// ---- 4.2 Inventory runway (40%) ----------------------------------------

export interface InventoryItemInput {
  variantGid: string;
  isRequired: boolean;
  velocityPerDay: number; // trailing 7-day average units sold/day
  onHand: number;
}

export interface InventoryResult {
  score: number | null;
  minDaysCover: number | null;
  limitingVariantGid: string | null;
}

// Minimum, not average - a bundle is only as available as its scarcest
// component. Optional components are excluded: they can be swapped
// without breaking the flight. 3 days -> 0, 21 days -> 100, linear
// between. See SCHEMA.md §4.2.
export function computeInventoryScore(items: InventoryItemInput[]): InventoryResult {
  const required = items.filter((i) => i.isRequired);
  if (required.length === 0) {
    return { score: null, minDaysCover: null, limitingVariantGid: null };
  }

  let minDaysCover = Infinity;
  let limitingVariantGid: string | null = null;
  for (const item of required) {
    const velocity = Math.max(item.velocityPerDay, 0.1); // floor avoids ÷0 -> Infinity
    const daysOfCover = item.onHand / velocity;
    if (daysOfCover < minDaysCover) {
      minDaysCover = daysOfCover;
      limitingVariantGid = item.variantGid;
    }
  }

  const score = clamp01((minDaysCover - 3) / (21 - 3)) * 100;
  return { score: round2(score), minDaysCover: round2(minDaysCover), limitingVariantGid };
}

// ---- 4.3 Margin integrity (25%) ----------------------------------------

export interface MarginItemInput {
  unitPriceCents: number;
  unitCostCents: number | null;
}

export interface MarginResult {
  score: number | null;
  effectiveMarginBps: number | null;
  missingCostCount: number;
}

// When cost data is missing on any component, the margin component is
// excluded (not scored 0, not scored 100) and the remaining weights
// renormalise. Substituting a fabricated number for missing data is how
// analytics features lose merchant trust permanently. See SCHEMA.md §4.3.
export function computeMarginScore(
  items: MarginItemInput[],
  itemCount: number,
  tiers: PriceTier[],
  floorBps: number,
  targetBps: number,
): MarginResult {
  const missingCostCount = items.filter((i) => i.unitCostCents == null).length;
  if (missingCostCount > 0) {
    return { score: null, effectiveMarginBps: null, missingCostCount };
  }

  const grossRevenue = items.reduce((sum, i) => sum + i.unitPriceCents, 0);
  const tier = resolveTierForQuantity(tiers, itemCount);
  const discountBps = tier?.discountBps ?? 0;
  const netRevenue = (grossRevenue * (10000 - discountBps)) / 10000;
  const cogs = items.reduce((sum, i) => sum + (i.unitCostCents ?? 0), 0);

  if (netRevenue <= 0) {
    return { score: 0, effectiveMarginBps: 0, missingCostCount: 0 };
  }

  const effectiveMarginBps = ((netRevenue - cogs) / netRevenue) * 10000;
  const score = clamp01((effectiveMarginBps - floorBps) / (targetBps - floorBps)) * 100;
  return {
    score: round2(score),
    effectiveMarginBps: Math.round(effectiveMarginBps),
    missingCostCount: 0,
  };
}

// ---- 4.4 Demand traction (20%) ------------------------------------------

const TRACTION_PSEUDO_COUNT = 20; // k

export interface TractionInput {
  bundleOrders30d: number;
  totalOrders30d: number;
  shopPriorRate: number; // shop-wide bundle attach rate, 0..1
  benchmarkShrunkRate: number; // max shrunk rate across this shop's active bundles, 0..1
  bundleAgeDays: number;
}

export interface TractionResult {
  score: number | null;
  shrunkRate: number | null;
}

// Raw attach rate lets a brand-new bundle with 1 order out of 2 score a
// perfect 100, so it is shrunk toward the shop's prior (Bayesian
// shrinkage) and benchmarked against the merchant's own best bundle, not
// an industry constant. New bundles (<14 days live) return traction: null
// - a bundle is not "unhealthy" for being new. See SCHEMA.md §4.4.
export function computeTractionScore(input: TractionInput): TractionResult {
  if (input.bundleAgeDays < 14) {
    return { score: null, shrunkRate: null };
  }

  const shrunkRate =
    (input.bundleOrders30d + TRACTION_PSEUDO_COUNT * input.shopPriorRate) /
    (input.totalOrders30d + TRACTION_PSEUDO_COUNT);
  const benchmark = Math.max(input.benchmarkShrunkRate, 0.01);
  const score = clamp01(shrunkRate / benchmark) * 100;
  return { score: round2(score), shrunkRate: round2(shrunkRate * 10000) / 10000 };
}

// ---- 4.5 Composition balance (15%) --------------------------------------

export interface BalanceItemInput {
  heatLevel: number | null;
  flavorProfile: string | null;
}

export interface BalanceInput {
  items: BalanceItemInput[];
  // Count of variants this bundle shares with the most-overlapping other
  // active bundle at this shop.
  maxOverlapWithOtherActiveBundle: number;
}

export interface BalanceComponents {
  heatSpread: number; // 0-1
  flavorDiversity: number; // 0-1
  duplication: number; // 0-1, 1 = no overlap with another active bundle
}

// The three sub-metrics behind the balance score, extracted so the Flight
// Builder's balance meter (four dots: heat spread, flavour variety,
// duplication, completeness) can render them individually instead of only
// the rolled-up number. See SCHEMA.md §4.5.
export function computeBalanceComponents(input: BalanceInput): BalanceComponents {
  const itemCount = input.items.length;
  if (itemCount === 0) {
    return { heatSpread: 0, flavorDiversity: 0, duplication: 0 };
  }

  const heats = input.items
    .map((i) => i.heatLevel)
    .filter((h): h is number => h !== null && h !== undefined);
  const heatSpread = heats.length > 0 ? (Math.max(...heats) - Math.min(...heats)) / 5 : 0;

  const distinctFlavors = new Set(
    input.items
      .map((i) => i.flavorProfile)
      .filter((f): f is string => f !== null && f !== undefined),
  ).size;
  // Saturates at 4: a flight of 6 with 5 distinct flavours is exactly as
  // diverse, for scoring purposes, as one of 4 with 4 distinct flavours.
  const flavorDiversity = Math.min(distinctFlavors / Math.min(itemCount, 4), 1);

  const duplication = clamp01(1 - input.maxOverlapWithOtherActiveBundle / itemCount);

  return { heatSpread, flavorDiversity, duplication };
}

// Ties the app back to the storefront: the same computeBalanceScore is
// called by the scoring job and by /proxy/validate. One definition of
// "balanced", two surfaces. Duplication penalises publishing several
// near-identical flights. See SCHEMA.md §4.5.
export function computeBalanceScore(input: BalanceInput): number {
  if (input.items.length === 0) {
    return 0;
  }
  const { heatSpread, flavorDiversity, duplication } = computeBalanceComponents(input);
  return round2(clamp01(0.4 * heatSpread + 0.4 * flavorDiversity + 0.2 * duplication) * 100);
}

// ---- 4.1 / 4.6 Composite, band -------------------------------------------

export type ScoreBand = 'healthy' | 'watch' | 'at_risk';

export interface CompositeInput {
  inventory: number | null;
  margin: number | null;
  traction: number | null;
  balance: number; // always computable
}

export interface CompositeResult {
  score: number;
  band: ScoreBand;
  partial: boolean;
  excludedComponents: Array<keyof typeof SCORE_WEIGHTS>;
}

// Every sub-score is normalised to 0-100 and clamped, so no single
// dimension can dominate through an outlier. When a component is
// excluded (missing cost data, a bundle too new for traction, no
// required items), the remaining weights renormalise rather than
// treating the missing component as 0. See SCHEMA.md §4.1, §4.6.
export function computeCompositeScore(input: CompositeInput): CompositeResult {
  const entries: Array<[keyof typeof SCORE_WEIGHTS, number | null]> = [
    ['inventory', input.inventory],
    ['margin', input.margin],
    ['traction', input.traction],
    ['balance', input.balance],
  ];

  const available = entries.filter((e): e is [keyof typeof SCORE_WEIGHTS, number] => e[1] !== null);
  const excludedComponents = entries.filter((e) => e[1] === null).map((e) => e[0]);
  const totalWeight = available.reduce((sum, [key]) => sum + SCORE_WEIGHTS[key], 0);

  if (totalWeight === 0) {
    return { score: 0, band: 'at_risk', partial: true, excludedComponents };
  }

  const weightedSum = available.reduce((sum, [key, value]) => sum + SCORE_WEIGHTS[key] * value, 0);
  const score = round2(weightedSum / totalWeight);

  const band: ScoreBand = score >= 75 ? 'healthy' : score >= 50 ? 'watch' : 'at_risk';
  return { score, band, partial: excludedComponents.length > 0, excludedComponents };
}

// ---- 4.6 Reason and swap recommendation ----------------------------------

export interface ReasonInput {
  inventory: {
    score: number | null;
    limitingVariantTitle: string | null;
    minDaysCover: number | null;
  };
  margin: { score: number | null; effectiveMarginBps: number | null; floorBps: number };
  traction: { score: number | null };
  balance: { score: number };
}

// The score always ships with a sentence generated from the lowest-scoring
// available component - the moment the app stops looking like a dashboard
// and starts looking like a product. See SCHEMA.md §4.6.
export function buildPrimaryReason(input: ReasonInput): string {
  const candidates: Array<{ key: string; score: number }> = [];
  if (input.inventory.score !== null)
    candidates.push({ key: 'inventory', score: input.inventory.score });
  if (input.margin.score !== null) candidates.push({ key: 'margin', score: input.margin.score });
  if (input.traction.score !== null)
    candidates.push({ key: 'traction', score: input.traction.score });
  candidates.push({ key: 'balance', score: input.balance.score });

  const lowest = candidates.reduce((min, c) => (c.score < min.score ? c : min));

  switch (lowest.key) {
    case 'inventory':
      return `${input.inventory.limitingVariantTitle ?? 'A component'} has ${Math.round(
        input.inventory.minDaysCover ?? 0,
      )} days of cover at current velocity.`;
    case 'margin':
      return `Effective margin is ${((input.margin.effectiveMarginBps ?? 0) / 100).toFixed(1)}%, below the ${(
        input.margin.floorBps / 100
      ).toFixed(0)}% floor.`;
    case 'traction':
      return 'This bundle is seeing low demand relative to your other active bundles.';
    default:
      return 'This bundle skews toward similar heat levels and flavours.';
  }
}

export interface SwapCandidate {
  variantGid: string;
  productTitle: string;
  daysOfCover: number;
  heatLevel: number | null;
  flavorProfile: string | null;
}

export interface SwapSuggestion {
  swapOutVariantGid: string;
  swapInVariantGid: string;
  swapInProductTitle: string;
  daysOfCover: number;
  resultingBalanceScore: number;
}

// Find variants in the same heat tier with daysOfCover > 21, rank by the
// resulting balanceScore if swapped in, return the top one. A real query,
// not a placeholder. See SCHEMA.md §4.6.
export function suggestSwap(
  currentItems: Array<BalanceItemInput & { variantGid: string }>,
  limitingVariantGid: string,
  candidates: SwapCandidate[],
  maxOverlapWithOtherActiveBundle: number,
): SwapSuggestion | null {
  const limitingItem = currentItems.find((i) => i.variantGid === limitingVariantGid);
  if (!limitingItem) {
    return null;
  }

  const eligible = candidates.filter(
    (c) =>
      c.heatLevel === limitingItem.heatLevel &&
      c.daysOfCover > 21 &&
      c.variantGid !== limitingVariantGid,
  );
  if (eligible.length === 0) {
    return null;
  }

  let best: { candidate: SwapCandidate; score: number } | null = null;
  for (const candidate of eligible) {
    const hypotheticalItems = currentItems.map((item) =>
      item.variantGid === limitingVariantGid
        ? { heatLevel: candidate.heatLevel, flavorProfile: candidate.flavorProfile }
        : item,
    );
    const score = computeBalanceScore({
      items: hypotheticalItems,
      maxOverlapWithOtherActiveBundle,
    });
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  if (!best) {
    return null;
  }
  return {
    swapOutVariantGid: limitingVariantGid,
    swapInVariantGid: best.candidate.variantGid,
    swapInProductTitle: best.candidate.productTitle,
    daysOfCover: best.candidate.daysOfCover,
    resultingBalanceScore: best.score,
  };
}
