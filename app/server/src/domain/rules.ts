import { z } from 'zod';
import type { bundleRuleType } from '@ember-and-ash/db';

// bundle_rules.config is merchant-authored JSON with no admin editor yet
// (out of scope for six days - see BUILD_PLAN.md Day 5). Each rule type's
// shape is validated defensively here: a malformed row is skipped rather
// than crashing storefront validation. See SCHEMA.md §3.6.

export type RuleType = (typeof bundleRuleType)[number];

export interface RuleSelectionItem {
  heatLevel: number | null;
  flavorProfile: string | null;
}

export interface RuleInput {
  ruleType: RuleType;
  config: unknown;
  isBlocking: boolean;
}

export interface RuleViolation {
  ruleType: RuleType;
  isBlocking: boolean;
  message: string;
}

const maxPerHeatTierConfig = z.object({ tier: z.number().int(), max: z.number().int().min(0) });
const minDistinctFlavorsConfig = z.object({ min: z.number().int().min(0) });
const requireHeatRangeConfig = z.object({ min: z.number().int(), max: z.number().int() });
const excludeTogetherConfig = z.object({ flavors: z.tuple([z.string(), z.string()]) });
const requireOneOfConfig = z.object({ flavors: z.array(z.string()).min(1) });

function evaluateOne(rule: RuleInput, selection: RuleSelectionItem[]): RuleViolation | null {
  switch (rule.ruleType) {
    case 'max_per_heat_tier': {
      const parsed = maxPerHeatTierConfig.safeParse(rule.config);
      if (!parsed.success) return null;
      const count = selection.filter((i) => i.heatLevel === parsed.data.tier).length;
      if (count > parsed.data.max) {
        return {
          ruleType: rule.ruleType,
          isBlocking: rule.isBlocking,
          message: `No more than ${parsed.data.max} bottle${parsed.data.max === 1 ? '' : 's'} at heat ${parsed.data.tier}.`,
        };
      }
      return null;
    }
    case 'min_distinct_flavors': {
      const parsed = minDistinctFlavorsConfig.safeParse(rule.config);
      if (!parsed.success) return null;
      const distinct = new Set(
        selection.map((i) => i.flavorProfile).filter((f): f is string => f !== null),
      ).size;
      if (distinct < parsed.data.min) {
        return {
          ruleType: rule.ruleType,
          isBlocking: rule.isBlocking,
          message: `Include at least ${parsed.data.min} different flavour profiles.`,
        };
      }
      return null;
    }
    case 'require_heat_range': {
      const parsed = requireHeatRangeConfig.safeParse(rule.config);
      if (!parsed.success) return null;
      const outOfRange = selection.some(
        (i) => i.heatLevel !== null && (i.heatLevel < parsed.data.min || i.heatLevel > parsed.data.max),
      );
      if (outOfRange) {
        return {
          ruleType: rule.ruleType,
          isBlocking: rule.isBlocking,
          message: `Every bottle must be between heat ${parsed.data.min} and ${parsed.data.max}.`,
        };
      }
      return null;
    }
    case 'exclude_together': {
      const parsed = excludeTogetherConfig.safeParse(rule.config);
      if (!parsed.success) return null;
      const [a, b] = parsed.data.flavors;
      const flavors = new Set(selection.map((i) => i.flavorProfile));
      if (flavors.has(a) && flavors.has(b)) {
        return {
          ruleType: rule.ruleType,
          isBlocking: rule.isBlocking,
          message: `${a} and ${b} can't be in the same flight.`,
        };
      }
      return null;
    }
    case 'require_one_of': {
      const parsed = requireOneOfConfig.safeParse(rule.config);
      if (!parsed.success) return null;
      const flavors = new Set(selection.map((i) => i.flavorProfile));
      const hasOne = parsed.data.flavors.some((f) => flavors.has(f));
      if (!hasOne) {
        return {
          ruleType: rule.ruleType,
          isBlocking: rule.isBlocking,
          message: `Include at least one of: ${parsed.data.flavors.join(', ')}.`,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

export function evaluateBundleRules(
  rules: RuleInput[],
  selection: RuleSelectionItem[],
): RuleViolation[] {
  return rules
    .map((rule) => evaluateOne(rule, selection))
    .filter((v): v is RuleViolation => v !== null);
}
