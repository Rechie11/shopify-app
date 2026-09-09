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
