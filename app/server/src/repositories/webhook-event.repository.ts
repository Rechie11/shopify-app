import type { DbOrTx } from '@ember-and-ash/db/client';
import { webhookEvents } from '@ember-and-ash/db';
import { isMysqlErrorCode } from '../db/errors.js';

export interface RecordWebhookEventInput {
  shopId: number | undefined;
  webhookId: string;
  topic: string;
  apiVersion: string;
  payloadHash: string;
}

// The unique index on webhook_id *is* the idempotency mechanism: insert
// first, and let a duplicate-key error tell you it is a replay. Returns
// false (not an error) when the event was already recorded, so the caller
// can short-circuit without treating a replay as a failure.
// See ARCHITECTURE.md §6.3.
export async function recordWebhookEvent(
  db: DbOrTx,
  input: RecordWebhookEventInput,
): Promise<{ isNew: boolean }> {
  try {
    await db.insert(webhookEvents).values({
      shopId: input.shopId,
      webhookId: input.webhookId,
      topic: input.topic,
      apiVersion: input.apiVersion,
      payloadHash: input.payloadHash,
    });
    return { isNew: true };
  } catch (err) {
    if (isMysqlErrorCode(err, 'ER_DUP_ENTRY')) {
      return { isNew: false };
    }
    throw err;
  }
}
