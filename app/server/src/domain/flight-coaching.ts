import { computeBalanceComponents, computeBalanceScore } from './scoring.js';

// The Flight Builder's live coaching layer. Reads the same balance
// components the Bundle Health Score is built from (computeBalanceScore),
// then turns them into at most one piece of advice - never a list of
// complaints. See THEME_SPEC.md §4.3.

export interface FlightSlotItem {
  variantGid: string;
  productTitle: string;
  heatLevel: number | null;
  flavorProfile: string | null;
}

export interface FlightCoachingBalance {
  score: number;
  heatSpread: number;
  flavorDiversity: number;
  duplication: number;
}

export interface FlightCoachingSuggestion {
  message: string;
  swapOutVariantGid: string | null;
  swapInVariantGid: string | null;
  swapInProductTitle: string | null;
}

export interface FlightCoachingResult {
  balance: FlightCoachingBalance;
  suggestion: FlightCoachingSuggestion | null;
}

const FLAT_HOT_HEAT_FLOOR = 4;

function mode<T>(values: T[]): { value: T; count: number } | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

// Tries swapping each selected slot for each candidate, keeps whichever
// single swap yields the best resulting balance score. Same
// hypothetical-score-and-rank technique as domain/scoring.ts#suggestSwap,
// generalised to any slot rather than only the inventory-limiting one.
function bestSwapForBalance(
  selection: FlightSlotItem[],
  candidates: FlightSlotItem[],
  maxOverlapWithOtherActiveBundle: number,
  onlySwapOut?: (item: FlightSlotItem) => boolean,
): { swapOutIndex: number; candidate: FlightSlotItem; score: number } | null {
  let best: { swapOutIndex: number; candidate: FlightSlotItem; score: number } | null = null;

  selection.forEach((slot, index) => {
    if (onlySwapOut && !onlySwapOut(slot)) return;
    for (const candidate of candidates) {
      if (candidate.variantGid === slot.variantGid) continue;
      const hypothetical = selection.map((s, i) => (i === index ? candidate : s));
      const score = computeBalanceScore({
        items: hypothetical,
        maxOverlapWithOtherActiveBundle,
      });
      if (!best || score > best.score) {
        best = { swapOutIndex: index, candidate, score };
      }
    }
  });

  return best;
}

export function computeFlightCoaching(
  selection: FlightSlotItem[],
  candidates: FlightSlotItem[],
  maxOverlapWithOtherActiveBundle: number,
): FlightCoachingResult {
  if (selection.length === 0) {
    return {
      balance: { score: 0, heatSpread: 0, flavorDiversity: 0, duplication: 0 },
      suggestion: null,
    };
  }

  const components = computeBalanceComponents({
    items: selection,
    maxOverlapWithOtherActiveBundle,
  });
  const score = computeBalanceScore({ items: selection, maxOverlapWithOtherActiveBundle });
  const balance: FlightCoachingBalance = { score, ...components };

  const heats = selection
    .map((s) => s.heatLevel)
    .filter((h): h is number => h !== null && h !== undefined);
  const avgHeat = heats.length > 0 ? heats.reduce((a, b) => a + b, 0) / heats.length : 0;

  // Priority 1: a flat, uniformly hot line - the "this is five kinds of
  // very hot" case.
  if (selection.length > 1 && components.heatSpread === 0 && avgHeat >= FLAT_HOT_HEAT_FLOOR) {
    const milder = candidates
      .filter((c) => c.heatLevel !== null && c.heatLevel < avgHeat)
      .sort((a, b) => (a.heatLevel ?? 0) - (b.heatLevel ?? 0))[0];
    return {
      balance,
      suggestion: {
        message: `This is ${selection.length} kinds of very hot — consider opening with something milder.`,
        swapOutVariantGid: milder ? selection[0]!.variantGid : null,
        swapInVariantGid: milder?.variantGid ?? null,
        swapInProductTitle: milder?.productTitle ?? null,
      },
    };
  }

  // Priority 2: one flavour dominates the flight.
  if (selection.length >= 3 && components.flavorDiversity < 1) {
    const flavors = selection.map((s) => s.flavorProfile).filter((f): f is string => f !== null);
    const dominant = mode(flavors);
    if (dominant && dominant.count > selection.length / 2) {
      const swap = bestSwapForBalance(
        selection,
        candidates,
        maxOverlapWithOtherActiveBundle,
        (item) => item.flavorProfile === dominant.value,
      );
      if (swap && swap.score > score) {
        return {
          balance,
          suggestion: {
            message: `Heavy on ${dominant.value}. Swap slot ${swap.swapOutIndex + 1} for ${swap.candidate.productTitle}?`,
            swapOutVariantGid: selection[swap.swapOutIndex]!.variantGid,
            swapInVariantGid: swap.candidate.variantGid,
            swapInProductTitle: swap.candidate.productTitle,
          },
        };
      }
    }
  }

  return { balance, suggestion: null };
}
