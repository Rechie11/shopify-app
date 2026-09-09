import { and, count, eq, gte, isNull } from 'drizzle-orm';
import type { DbOrTx } from '@ember-and-ash/db/client';
import { bundleOrders } from '@ember-and-ash/db';
import { isMysqlErrorCode } from '../db/errors.js';

export interface RecordBundleOrderInput {
  shopId: number;
  bundleId: number;
  orderGid: string;
  orderNumber: string | undefined;
  flightToken: string;
  itemCount: number;
  subtotalCents: number;
  discountCents: number;
  currency: string;
  customerHash: string | undefined;
  placedAt: Date;
}

// Attribution reads the _flight_id line-item property from the order
// payload. Idempotent on (shop, order, bundle): a webhook replay must not
// double-count attach rate. See SCHEMA.md §3.9.
export async function recordBundleOrder(
  db: DbOrTx,
  input: RecordBundleOrderInput,
): Promise<boolean> {
  try {
    await db.insert(bundleOrders).values(input);
    return true;
  } catch (err) {
    if (isMysqlErrorCode(err, 'ER_DUP_ENTRY')) {
      return false;
    }
    throw err;
  }
}

export async function cancelBundleOrder(
  db: DbOrTx,
  shopId: number,
  orderGid: string,
  cancelledAt: Date,
): Promise<void> {
  await db
    .update(bundleOrders)
    .set({ cancelledAt })
    .where(and(eq(bundleOrders.shopId, shopId), eq(bundleOrders.orderGid, orderGid)));
}

// The numerator for the shop-wide bundle attach rate (SCHEMA.md §4.4's
// priorRate): total orders that included ANY bundle, across every
// bundle at this shop. Distinct from the shop-wide total order count
// (shop_order_counts_daily), which is the rate's denominator.
export async function countAllBundleOrdersForShop(
  db: DbOrTx,
  shopId: number,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(bundleOrders)
    .where(
      and(
        eq(bundleOrders.shopId, shopId),
        gte(bundleOrders.placedAt, since),
        isNull(bundleOrders.cancelledAt),
      ),
    );
  return row?.total ?? 0;
}

export async function countBundleOrders(
  db: DbOrTx,
  shopId: number,
  bundleId: number,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(bundleOrders)
    .where(
      and(
        eq(bundleOrders.shopId, shopId),
        eq(bundleOrders.bundleId, bundleId),
        gte(bundleOrders.placedAt, since),
        isNull(bundleOrders.cancelledAt),
      ),
    );
  return row?.total ?? 0;
}
