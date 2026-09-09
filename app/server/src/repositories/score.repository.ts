import { desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@ember-and-ash/db/client';
import { bundleScores, bundles } from '@ember-and-ash/db';

export type BundleScore = typeof bundleScores.$inferSelect;

export interface InsertBundleScoreInput {
  shopId: number;
  bundleId: number;
  score: number;
  band: (typeof bundleScores.$inferInsert)['band'];
  inventoryScore: number | null;
  marginScore: number | null;
  tractionScore: number | null;
  balanceScore: number;
  minDaysCover: number | null;
  limitingVariantGid: string | null;
  effectiveMarginBps: number | null;
  attachRateBps: number | null;
  primaryReason: string;
  recommendedAction: unknown;
  breakdown: unknown;
}

// current_score_id is written inside the same transaction as the score
// insert - the denormalised pointer and the row it points to must never
// disagree. See SCHEMA.md §4.7.
export async function insertBundleScore(
  db: DbOrTx,
  input: InsertBundleScoreInput,
): Promise<BundleScore> {
  return db.transaction(async (tx) => {
    const [result] = await tx
      .insert(bundleScores)
      .values({
        shopId: input.shopId,
        bundleId: input.bundleId,
        score: input.score.toFixed(2),
        band: input.band,
        inventoryScore: input.inventoryScore?.toFixed(2),
        marginScore: input.marginScore?.toFixed(2),
        tractionScore: input.tractionScore?.toFixed(2),
        balanceScore: input.balanceScore.toFixed(2),
        minDaysCover: input.minDaysCover?.toFixed(2),
        limitingVariantGid: input.limitingVariantGid,
        effectiveMarginBps: input.effectiveMarginBps,
        attachRateBps: input.attachRateBps,
        primaryReason: input.primaryReason,
        recommendedAction: input.recommendedAction,
        breakdown: input.breakdown,
      })
      .$returningId();

    await tx
      .update(bundles)
      .set({ currentScoreId: result!.id })
      .where(eq(bundles.id, input.bundleId));

    const created = await tx.query.bundleScores.findFirst({
      where: eq(bundleScores.id, result!.id),
    });
    if (!created) {
      throw new Error(
        `Failed to read back newly inserted bundle score for bundle ${input.bundleId}`,
      );
    }
    return created;
  });
}

export async function getScoreHistory(
  db: DbOrTx,
  bundleId: number,
  limit = 30,
): Promise<BundleScore[]> {
  return db
    .select()
    .from(bundleScores)
    .where(eq(bundleScores.bundleId, bundleId))
    .orderBy(desc(bundleScores.computedAt))
    .limit(limit);
}
