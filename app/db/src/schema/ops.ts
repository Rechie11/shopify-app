import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  smallint,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { shops } from './shops.js';

export const webhookEventStatus = ['received', 'processed', 'failed'] as const;

// The unique index on webhook_id *is* the idempotency mechanism: insert
// first, and let a duplicate-key error tell you it is a replay. Webhook
// delivery is at-least-once - this is not optional. See SCHEMA.md §3.13.
export const webhookEvents = mysqlTable('webhook_events', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  shopId: bigint('shop_id', { mode: 'number', unsigned: true }).references(() => shops.id, {
    onDelete: 'cascade',
  }),

  webhookId: varchar('webhook_id', { length: 64 }).notNull().unique(),
  topic: varchar('topic', { length: 128 }).notNull(),
  apiVersion: varchar('api_version', { length: 16 }).notNull(),
  // Base64, not VARBINARY - see shops.ts for why.
  payloadHash: varchar('payload_hash', { length: 64 }),

  status: mysqlEnum('status', webhookEventStatus).notNull().default('received'),
  attempts: smallint('attempts', { unsigned: true }).notNull().default(0),
  lastError: text('last_error'),

  receivedAt: datetime('received_at', { fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  processedAt: datetime('processed_at', { fsp: 3 }),
});

export const jobStatus = ['pending', 'running', 'done', 'failed', 'dead'] as const;

// Debounce, implemented within MySQL's constraints: pending_key is
// non-null only while the job is pending, and MySQL's unique indexes
// ignore NULLs, so completed jobs drop out of the constraint
// automatically. An enqueue is INSERT ... ON DUPLICATE KEY UPDATE
// run_at = LEAST(run_at, VALUES(run_at)). See SCHEMA.md §3.14.
export const jobs = mysqlTable(
  'jobs',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // RESTRICT, not CASCADE: MySQL disallows a cascading action on a
    // column that a STORED generated column in the same table depends on
    // (pending_key below derives from shop_id). Shops are soft-deleted in
    // this design anyway, so a hard delete should fail loudly if jobs
    // still reference it, not silently cascade.
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),

    type: varchar('type', { length: 64 }).notNull(),
    payload: json('payload').notNull(),
    dedupeKey: varchar('dedupe_key', { length: 255 }),

    status: mysqlEnum('status', jobStatus).notNull().default('pending'),
    attempts: tinyint('attempts', { unsigned: true }).notNull().default(0),
    maxAttempts: tinyint('max_attempts', { unsigned: true }).notNull().default(5),

    runAt: datetime('run_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    lockedAt: datetime('locked_at', { fsp: 3 }),
    lockedBy: varchar('locked_by', { length: 64 }),
    lastError: text('last_error'),

    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),

    pendingKey: varchar('pending_key', { length: 320 }).generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`(if(\`status\` = 'pending', concat(\`shop_id\`, ':', \`type\`, ':', ifnull(\`dedupe_key\`, '')), NULL))`,
      { mode: 'stored' },
    ),
  },
  (t) => [
    uniqueIndex('uq_jobs_pending').on(t.pendingKey),
    // Covering index for the claim query: WHERE status='pending' AND
    // run_at <= NOW(3) ORDER BY run_at FOR UPDATE SKIP LOCKED.
    index('ix_jobs_status_run_at').on(t.status, t.runAt),
  ],
);
