import { relations, sql } from 'drizzle-orm';
import { bigint, boolean, datetime, index, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { shops } from './shops.js';

// Online tokens are per-staff and short-lived. Storing the *hash* of the
// staff email is enough to attribute an activity-log entry without holding
// staff PII - see SCHEMA.md §3.2.
export const sessions = mysqlTable(
  'sessions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    sessionId: varchar('session_id', { length: 255 }).notNull().unique(),
    isOnline: boolean('is_online').notNull().default(false),
    staffUserId: bigint('staff_user_id', { mode: 'number', unsigned: true }),
    // Base64, not VARBINARY - see shops.ts for why.
    staffEmailHash: varchar('staff_email_hash', { length: 64 }),
    expiresAt: datetime('expires_at', { fsp: 3 }),

    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index('ix_sessions_shop_expires').on(t.shopId, t.expiresAt)],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  shop: one(shops, { fields: [sessions.shopId], references: [shops.id] }),
}));
