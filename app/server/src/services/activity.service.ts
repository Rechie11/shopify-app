import { desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@ember-and-ash/db/client';
import { activityLog } from '@ember-and-ash/db';

export type ActivityLogEntry = typeof activityLog.$inferSelect;

export interface WriteActivityInput {
  shopId: number;
  actorType: 'staff' | 'system' | 'webhook';
  actorId?: number;
  actorLabel: string;
  entityType: 'bundle' | 'bundle_item' | 'alert' | 'shop';
  entityId: number;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

// Written in the same transaction as the change it describes - a log
// written after commit is a log that loses entries exactly when you need
// them. Pass the transaction handle when the caller is already inside
// db.transaction(). See SCHEMA.md §3.11.
export async function writeActivity(db: DbOrTx, input: WriteActivityInput): Promise<void> {
  await db.insert(activityLog).values({
    shopId: input.shopId,
    actorType: input.actorType,
    actorId: input.actorId,
    actorLabel: input.actorLabel,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    before: input.before,
    after: input.after,
    metadata: input.metadata,
    requestId: input.requestId,
  });
}

export async function listRecentActivity(
  db: DbOrTx,
  shopId: number,
  limit = 20,
): Promise<ActivityLogEntry[]> {
  return db
    .select()
    .from(activityLog)
    .where(eq(activityLog.shopId, shopId))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}
