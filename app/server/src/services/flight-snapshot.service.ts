import type { DbOrTx } from '@ember-and-ash/db/client';
import { ShopifyApiError } from '../shopify/admin-client.js';
import type { createAdminClient } from '../shopify/admin-client.js';
import {
  METAFIELDS_SET_MUTATION,
  SHOP_ID_QUERY,
  type MetafieldsSetResult,
  type ShopIdResult,
} from '../shopify/queries.js';
import { listActiveBundlesWithDetails } from '../repositories/bundle.repository.js';
import { buildFlightSnapshotPayload } from '../domain/flight-snapshot.js';

type AdminClient = ReturnType<typeof createAdminClient>;

export const FLIGHT_SNAPSHOT_NAMESPACE = 'custom';
export const FLIGHT_SNAPSHOT_KEY = 'flight_snapshot';

// The metafield fallback path: rewritten with every currently-active
// bundle whenever one publishes, pauses, or has its composition edited
// while active. The theme reads this on first paint with zero network
// dependency, then the Flight Builder calls the proxy for live data. If
// this write fails, publish/pause still succeed - the fallback is a
// best-effort mirror, not the source of truth. See ARCHITECTURE.md §9.
export async function writeFlightSnapshot(
  adminClient: AdminClient,
  db: DbOrTx,
  shopId: number,
): Promise<void> {
  const activeBundles = await listActiveBundlesWithDetails(db, shopId);
  const payload = buildFlightSnapshotPayload(activeBundles);

  const shopIdResult = await adminClient.request<ShopIdResult>(SHOP_ID_QUERY);
  const shopGid = shopIdResult.shop.id;

  const result = await adminClient.request<MetafieldsSetResult>(METAFIELDS_SET_MUTATION, {
    metafields: [
      {
        ownerId: shopGid,
        namespace: FLIGHT_SNAPSHOT_NAMESPACE,
        key: FLIGHT_SNAPSHOT_KEY,
        type: 'json',
        value: JSON.stringify(payload),
      },
    ],
  });

  const userErrors = result.metafieldsSet.userErrors;
  if (userErrors.length > 0) {
    throw new ShopifyApiError(userErrors.map((e) => e.message).join('; '), userErrors);
  }
}
