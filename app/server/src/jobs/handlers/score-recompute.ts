import { eq } from 'drizzle-orm';
import { shops } from '@ember-and-ash/db';
import { recomputeBundleScore } from '../../services/score.service.js';
import type { JobHandler } from '../worker.js';

// Debounced by the jobs table's dedupe_key (a burst of inventory webhooks
// touching one bundle collapses into one recompute). See SCHEMA.md §4.7.
export const handleScoreRecompute: JobHandler = async (db, job) => {
  const payload = job.payload as { bundleId: number };

  const shop = await db.query.shops.findFirst({ where: eq(shops.id, job.shopId) });
  if (!shop) {
    return;
  }

  await recomputeBundleScore(db, job.shopId, payload.bundleId, {
    marginFloorBps: shop.marginFloorBps,
    marginTargetBps: shop.marginTargetBps,
  });
};
