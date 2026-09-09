import {
  findBundleItemsByProductGid,
  findBundleItemsByVariantGid,
  refreshBundleItemCache,
} from '../../repositories/bundle.repository.js';
import { raiseAlert } from '../../repositories/alert.repository.js';
import { writeActivity } from '../../services/activity.service.js';
import { enqueueScoreRecompute } from '../queue.js';
import type { JobHandler } from '../worker.js';

interface ProductUpdatePayload {
  id: number;
  title: string;
  variants: Array<{ id: number; title: string; price: string }>;
}

interface ProductDeletePayload {
  id: number;
}

// products/update -> cache refresh; products/delete -> a critical alert
// naming the broken bundle, since no live bundle should silently sell a
// component that no longer exists. See ARCHITECTURE.md §6.3.
export const handleProductsSync: JobHandler = async (db, job) => {
  const { topic, body } = job.payload as {
    topic: string;
    body: ProductUpdatePayload | ProductDeletePayload;
  };

  if (topic === 'products/delete') {
    const productGid = `gid://shopify/Product/${body.id}`;
    const affected = await findBundleItemsByProductGid(db, job.shopId, productGid);
    for (const { bundleId, bundleTitle } of affected) {
      const dedupeKey = `component_deleted:${bundleId}:${productGid}`;
      const { isNew } = await raiseAlert(db, {
        shopId: job.shopId,
        bundleId,
        alertType: 'component_deleted',
        severity: 'critical',
        title: `${bundleTitle} has a deleted component`,
        body: 'A product in this bundle was deleted in Shopify. Replace it before the next order.',
        recommendedAction: null,
        dedupeKey,
      });
      if (isNew) {
        await writeActivity(db, {
          shopId: job.shopId,
          actorType: 'webhook',
          actorLabel: 'products/delete',
          entityType: 'alert',
          entityId: bundleId,
          action: 'alert.raised',
          after: { alertType: 'component_deleted', productGid },
        });
      }
    }
    return;
  }

  const update = body as ProductUpdatePayload;
  for (const variant of update.variants) {
    const variantGid = `gid://shopify/ProductVariant/${variant.id}`;
    const affected = await findBundleItemsByVariantGid(db, job.shopId, variantGid);
    const unitPriceCents = Math.round(parseFloat(variant.price) * 100);

    for (const { itemId, bundleId } of affected) {
      await refreshBundleItemCache(db, itemId, {
        productTitleCache: update.title,
        variantTitleCache: variant.title,
        unitPriceCents,
      });
      await enqueueScoreRecompute(db, job.shopId, bundleId);
    }
  }
};
