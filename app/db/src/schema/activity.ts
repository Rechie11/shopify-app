import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  datetime,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core';
import { shops } from './shops.js';

export const activityActorType = ['staff', 'system', 'webhook'] as const;
export const activityEntityType = ['bundle', 'bundle_item', 'alert', 'shop'] as const;

// Written in the same transaction as the change it describes - a log
// written after commit is a log that loses entries exactly when you need
// them. before/after store only the changed keys, not whole rows.
// See SCHEMA.md §3.11.
export const activityLog = mysqlTable(
  'activity_log',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    actorType: mysqlEnum('actor_type', activityActorType).notNull(),
    // Null for system/webhook actors, which have no staff row.
    actorId: bigint('actor_id', { mode: 'number', unsigned: true }),
    actorLabel: varchar('actor_label', { length: 255 }).notNull(),

    entityType: mysqlEnum('entity_type', activityEntityType).notNull(),
    entityId: bigint('entity_id', { mode: 'number', unsigned: true }).notNull(),

    action: varchar('action', { length: 64 }).notNull(),
    before: json('before'),
    after: json('after'),
    metadata: json('metadata'),

    requestId: char('request_id', { length: 26 }),

    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index('ix_activity_shop_created').on(t.shopId, t.createdAt),
    index('ix_activity_entity').on(t.entityType, t.entityId, t.createdAt),
  ],
);
