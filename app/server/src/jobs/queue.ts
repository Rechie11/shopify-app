import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@ember-and-ash/db/client';
import { jobs } from '@ember-and-ash/db';

export interface EnqueueOptions {
  shopId: number;
  type: string;
  payload: unknown;
  // Omit to coalesce on (shopId, type) alone - the right default for a
  // job where only the latest matters (e.g. shop.uninstalled). Pass a
  // unique value (e.g. the webhook delivery id) when each occurrence must
  // be processed independently. See SCHEMA.md §3.14.
  dedupeKey?: string | undefined;
  runAt?: Date;
  maxAttempts?: number;
}

// A burst of events for the same (shopId, type, dedupeKey) collapses into
// one pending job via the generated pending_key column - the ON DUPLICATE
// KEY UPDATE just pulls run_at earlier if a sooner occurrence arrives.
export async function enqueue(db: DbOrTx, opts: EnqueueOptions): Promise<void> {
  const runAt = opts.runAt ?? new Date();
  await db
    .insert(jobs)
    .values({
      shopId: opts.shopId,
      type: opts.type,
      payload: opts.payload,
      dedupeKey: opts.dedupeKey,
      runAt,
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .onDuplicateKeyUpdate({
      set: { runAt: sql`LEAST(\`run_at\`, VALUES(\`run_at\`))` },
    });
}

const RECOMPUTE_DEBOUNCE_MS = 60_000;

// A burst of forty inventory webhooks collapses into one recompute per
// bundle, firing 60s after the first event in the burst (LEAST keeps the
// earliest run_at, so the delay is bounded even under sustained updates).
// See ARCHITECTURE.md §7, SCHEMA.md §4.7.
export async function enqueueScoreRecompute(
  db: DbOrTx,
  shopId: number,
  bundleId: number,
): Promise<void> {
  await enqueue(db, {
    shopId,
    type: 'score.recompute',
    payload: { bundleId },
    dedupeKey: String(bundleId),
    runAt: new Date(Date.now() + RECOMPUTE_DEBOUNCE_MS),
  });
}

// Immediate (no debounce) variant for explicit user actions - publish,
// pause, and composition edits - where the merchant expects the score to
// reflect their action right away, not up to a minute later.
export async function enqueueScoreRecomputeNow(
  db: DbOrTx,
  shopId: number,
  bundleId: number,
): Promise<void> {
  await enqueue(db, {
    shopId,
    type: 'score.recompute',
    payload: { bundleId },
    dedupeKey: String(bundleId),
  });
}
