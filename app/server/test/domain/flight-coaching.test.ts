import { describe, expect, it } from 'vitest';
import { computeFlightCoaching, type FlightSlotItem } from '../../src/domain/flight-coaching.js';

function item(
  variantGid: string,
  heatLevel: number | null,
  flavorProfile: string | null,
  productTitle = variantGid,
): FlightSlotItem {
  return { variantGid, productTitle, heatLevel, flavorProfile };
}

describe('computeFlightCoaching', () => {
  it('returns zeroed balance and no suggestion for an empty selection', () => {
    const result = computeFlightCoaching([], [], 0);
    expect(result.balance).toEqual({ score: 0, heatSpread: 0, flavorDiversity: 0, duplication: 0 });
    expect(result.suggestion).toBeNull();
  });

  it('suggests opening milder when every slot is flat and hot', () => {
    const selection = [
      item('v1', 5, 'smoky'),
      item('v2', 5, 'fruity'),
      item('v3', 5, 'citrus'),
    ];
    const candidates = [item('v4', 1, 'herbal', 'Mild One'), item('v5', 5, 'umami', 'Also Hot')];

    const result = computeFlightCoaching(selection, candidates, 0);

    expect(result.suggestion).not.toBeNull();
    expect(result.suggestion?.message).toContain('very hot');
    expect(result.suggestion?.swapInProductTitle).toBe('Mild One');
    expect(result.suggestion?.swapInVariantGid).toBe('v4');
  });

  it('does not suggest a milder swap when no milder candidate exists', () => {
    const selection = [item('v1', 5, 'smoky'), item('v2', 5, 'fruity')];
    const candidates = [item('v3', 5, 'citrus')];

    const result = computeFlightCoaching(selection, candidates, 0);

    expect(result.suggestion?.swapInVariantGid).toBeNull();
    expect(result.suggestion?.message).toContain('very hot');
  });

  it('suggests a swap when one flavor dominates the flight', () => {
    const selection = [
      item('v1', 1, 'smoky'),
      item('v2', 2, 'smoky'),
      item('v3', 3, 'smoky'),
      item('v4', 4, 'citrus'),
    ];
    const candidates = [item('v5', 2, 'fruity', 'Charred Pineapple')];

    const result = computeFlightCoaching(selection, candidates, 0);

    expect(result.suggestion).not.toBeNull();
    expect(result.suggestion?.message).toContain('Heavy on smoky');
    expect(result.suggestion?.swapInProductTitle).toBe('Charred Pineapple');
    expect(selection.map((s) => s.variantGid)).toContain(result.suggestion?.swapOutVariantGid);
  });

  it('returns no suggestion for an already well-balanced flight', () => {
    const selection = [
      item('v1', 0, 'smoky'),
      item('v2', 2, 'fruity'),
      item('v3', 5, 'citrus'),
      item('v4', 4, 'umami'),
    ];
    const candidates: FlightSlotItem[] = [];

    const result = computeFlightCoaching(selection, candidates, 0);

    expect(result.suggestion).toBeNull();
    expect(result.balance.score).toBeGreaterThan(0);
  });

  it('never proposes swapping a slot in for itself', () => {
    const selection = [item('v1', 5, 'smoky'), item('v2', 5, 'smoky'), item('v3', 5, 'smoky')];
    const candidates = [item('v1', 5, 'smoky')]; // same gid as an already-selected slot

    const result = computeFlightCoaching(selection, candidates, 0);

    if (result.suggestion?.swapInVariantGid) {
      expect(result.suggestion.swapInVariantGid).not.toBe(result.suggestion.swapOutVariantGid);
    }
  });

  it('reports duplication from maxOverlapWithOtherActiveBundle like the health score does', () => {
    const selection = [item('v1', 1, 'smoky'), item('v2', 2, 'fruity')];
    const result = computeFlightCoaching(selection, [], 2);
    expect(result.balance.duplication).toBe(0);
  });
});
