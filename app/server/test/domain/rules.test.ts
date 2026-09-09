import { describe, expect, it } from 'vitest';
import { evaluateBundleRules, type RuleInput, type RuleSelectionItem } from '../../src/domain/rules.js';

function item(heatLevel: number | null, flavorProfile: string | null): RuleSelectionItem {
  return { heatLevel, flavorProfile };
}

describe('evaluateBundleRules', () => {
  it('returns no violations when there are no rules', () => {
    expect(evaluateBundleRules([], [item(1, 'smoky')])).toEqual([]);
  });

  describe('max_per_heat_tier', () => {
    const rule: RuleInput = {
      ruleType: 'max_per_heat_tier',
      config: { tier: 5, max: 1 },
      isBlocking: true,
    };

    it('violates when more than max items are at the given tier', () => {
      const violations = evaluateBundleRules(
        [rule],
        [item(5, 'smoky'), item(5, 'fruity'), item(1, 'citrus')],
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.isBlocking).toBe(true);
      expect(violations[0]?.message).toContain('heat 5');
    });

    it('passes when at or below max', () => {
      expect(
        evaluateBundleRules([rule], [item(5, 'smoky'), item(1, 'citrus')]),
      ).toEqual([]);
    });
  });

  describe('min_distinct_flavors', () => {
    const rule: RuleInput = {
      ruleType: 'min_distinct_flavors',
      config: { min: 2 },
      isBlocking: false,
    };

    it('violates when fewer distinct flavours are present', () => {
      const violations = evaluateBundleRules([rule], [item(1, 'smoky'), item(2, 'smoky')]);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.isBlocking).toBe(false);
    });

    it('passes with enough distinct flavours', () => {
      expect(evaluateBundleRules([rule], [item(1, 'smoky'), item(2, 'fruity')])).toEqual([]);
    });
  });

  describe('require_heat_range', () => {
    const rule: RuleInput = {
      ruleType: 'require_heat_range',
      config: { min: 1, max: 4 },
      isBlocking: true,
    };

    it('violates when any item is outside the range', () => {
      const violations = evaluateBundleRules([rule], [item(5, 'smoky')]);
      expect(violations).toHaveLength(1);
    });

    it('ignores items with no heat level set', () => {
      expect(evaluateBundleRules([rule], [item(null, 'smoky')])).toEqual([]);
    });
  });

  describe('exclude_together', () => {
    const rule: RuleInput = {
      ruleType: 'exclude_together',
      config: { flavors: ['smoky', 'herbal'] },
      isBlocking: true,
    };

    it('violates when both excluded flavours are present', () => {
      const violations = evaluateBundleRules([rule], [item(1, 'smoky'), item(2, 'herbal')]);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain('smoky');
      expect(violations[0]?.message).toContain('herbal');
    });

    it('passes when only one is present', () => {
      expect(evaluateBundleRules([rule], [item(1, 'smoky'), item(2, 'fruity')])).toEqual([]);
    });
  });

  describe('require_one_of', () => {
    const rule: RuleInput = {
      ruleType: 'require_one_of',
      config: { flavors: ['citrus', 'fruity'] },
      isBlocking: false,
    };

    it('violates when none of the required flavours are present', () => {
      expect(evaluateBundleRules([rule], [item(1, 'smoky')])).toHaveLength(1);
    });

    it('passes when at least one is present', () => {
      expect(evaluateBundleRules([rule], [item(1, 'citrus')])).toEqual([]);
    });
  });

  it('skips a rule with malformed config instead of throwing', () => {
    const badRule: RuleInput = {
      ruleType: 'max_per_heat_tier',
      config: { tier: 'not-a-number' },
      isBlocking: true,
    };
    expect(() => evaluateBundleRules([badRule], [item(1, 'smoky')])).not.toThrow();
    expect(evaluateBundleRules([badRule], [item(1, 'smoky')])).toEqual([]);
  });

  it('evaluates every rule and returns all violations, not just the first', () => {
    const rules: RuleInput[] = [
      { ruleType: 'max_per_heat_tier', config: { tier: 5, max: 0 }, isBlocking: true },
      { ruleType: 'min_distinct_flavors', config: { min: 3 }, isBlocking: false },
    ];
    const violations = evaluateBundleRules(rules, [item(5, 'smoky')]);
    expect(violations).toHaveLength(2);
  });
});
