import { findBundleItemsByInventoryItemGid } from '../../repositories/bundle.repository.js';
import { recordInventorySnapshot } from '../../repositories/metrics.repository.js';
import { enqueueScoreRecompute } from '../queue.js';
import type { JobHandler } from '../worker.js';

interface InventoryLevelsUpdatePayload {
  inventory_item_id: number;
  location_id: number;
  available: number;
}

// inventory_levels/update -> snapshot + fan-out to affected bundles. The
// highest-signal input to the score. See ARCHITECTURE.md §6.3, SCHEMA.md §4.7.
export const handleInventorySync: JobHandler = async (db, job) => {
  const { body } = job.payload as { topic: string; body: InventoryLevelsUpdatePayload };

  const inventoryItemGid = `gid://shopify/InventoryItem/${body.inventory_item_id}`;
  const locationGid = `gid://shopify/Location/${body.location_id}`;

  const affected = await findBundleItemsByInventoryItemGid(db, job.shopId, inventoryItemGid);
  if (affected.length === 0) {
    // Not a component of any active bundle - still worth a full history
    // for when it is added to one later, but nothing to recompute yet.
    return;
  }

  await recordInventorySnapshot(db, {
    shopId: job.shopId,
    variantGid: affected[0]!.variantGid,
    inventoryItemGid,
    locationGid,
    available: body.available,
  });

  const affectedBundleIds = new Set(affected.map((a) => a.bundleId));
  await Promise.all(
    [...affectedBundleIds].map((bundleId) => enqueueScoreRecompute(db, job.shopId, bundleId)),
  );
};
