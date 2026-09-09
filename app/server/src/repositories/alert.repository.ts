import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@ember-and-ash/db/client';
import { alerts } from '@ember-and-ash/db';

export type Alert = typeof alerts.$inferSelect;

export interface RaiseAlertInput {
  shopId: number;
  bundleId: number | null;
  alertType: (typeof alerts.$inferInsert)['alertType'];
  severity: (typeof alerts.$inferInsert)['severity'];
  title: string;
  body: string | undefined;
  recommendedAction: unknown;
  dedupeKey: string;
}

// The unique index on open_key (shop_id + dedupe_key, only while open) is
// the fatigue guard: raising the same condition twice is a silent no-op
// rather than a duplicate row. See SCHEMA.md §3.12.
export async function raiseAlert(db: DbOrTx, input: RaiseAlertInput): Promise<{ isNew: boolean }> {
  const existing = await db.query.alerts.findFirst({
    where: and(
      eq(alerts.shopId, input.shopId),
      eq(alerts.dedupeKey, input.dedupeKey),
      eq(alerts.status, 'open'),
    ),
  });
  if (existing) {
    return { isNew: false };
  }

  await db.insert(alerts).values({
    shopId: input.shopId,
    bundleId: input.bundleId,
    alertType: input.alertType,
    severity: input.severity,
    title: input.title,
    body: input.body,
    recommendedAction: input.recommendedAction,
    dedupeKey: input.dedupeKey,
  });
  return { isNew: true };
}

// Auto-resolve: when a recompute finds the condition cleared, the open
// alert moves to resolved. See SCHEMA.md §3.12.
export async function resolveAlertByDedupeKey(
  db: DbOrTx,
  shopId: number,
  dedupeKey: string,
): Promise<boolean> {
  const existing = await db.query.alerts.findFirst({
    where: and(
      eq(alerts.shopId, shopId),
      eq(alerts.dedupeKey, dedupeKey),
      eq(alerts.status, 'open'),
    ),
  });
  if (!existing) {
    return false;
  }
  await db
    .update(alerts)
    .set({ status: 'resolved', resolvedAt: new Date() })
    .where(eq(alerts.id, existing.id));
  return true;
}

export async function acknowledgeAlert(db: DbOrTx, shopId: number, alertId: number): Promise<void> {
  await db
    .update(alerts)
    .set({ status: 'acknowledged', acknowledgedAt: new Date() })
    .where(and(eq(alerts.id, alertId), eq(alerts.shopId, shopId)));
}

export async function listOpenAlerts(db: DbOrTx, shopId: number): Promise<Alert[]> {
  return db
    .select()
    .from(alerts)
    .where(and(eq(alerts.shopId, shopId), eq(alerts.status, 'open')))
    .orderBy(desc(alerts.createdAt));
}
