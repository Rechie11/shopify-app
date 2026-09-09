import { eq } from 'drizzle-orm';
import { shops } from '@ember-and-ash/db';
import { createAdminClient } from '../../shopify/admin-client.js';
import { decryptToken } from '../../shopify/crypto.js';
import { readShopAccessToken } from '../../repositories/shop.repository.js';
import { attemptPublish } from '../../services/bundle.service.js';
import type { JobHandler } from '../worker.js';

// Retries a bundle stuck in status=publishing after a failed Shopify call.
// Job handlers only receive (db, job), not the app's env, so the values
// this needs from outside are captured in a closure at registration time
// in index.ts. See ARCHITECTURE.md §6.1 and §7.
export function createDiscountReconcileHandler(
  encryptionKey: Buffer,
  apiVersion: string,
): JobHandler {
  return async (db, job) => {
    const payload = job.payload as { bundlePublicId: string };

    const shop = await db.query.shops.findFirst({ where: eq(shops.id, job.shopId) });
    if (!shop) {
      // Shop uninstalled since this was enqueued - nothing to reconcile.
      return;
    }

    const cached = readShopAccessToken(shop);
    if (!cached) {
      throw new Error(`No cached access token for shop ${shop.shopDomain}; cannot reconcile`);
    }

    const adminClient = createAdminClient({
      shopDomain: shop.shopDomain,
      accessToken: decryptToken(cached, encryptionKey),
      apiVersion,
    });

    await attemptPublish(adminClient, db, job.shopId, payload.bundlePublicId);
  };
}
