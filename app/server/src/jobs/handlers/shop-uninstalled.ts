import { eq } from 'drizzle-orm';
import type { Db } from '@ember-and-ash/db/client';
import { shops } from '@ember-and-ash/db';
import { writeActivity } from '../../services/activity.service.js';
import type { JobHandler } from '../worker.js';

// app/uninstalled: purge tokens, soft-delete the shop. A shop row is
// soft-deleted (uninstalled_at) rather than hard-deleted so activity
// history survives a reinstall. See ARCHITECTURE.md §5.3.
export const handleShopUninstalled: JobHandler = async (db: Db, job) => {
  const { shopId } = job;

  await db.transaction(async (tx) => {
    await tx
      .update(shops)
      .set({
        accessTokenCiphertext: null,
        accessTokenIv: null,
        accessTokenTag: null,
        uninstalledAt: new Date(),
      })
      .where(eq(shops.id, shopId));

    await writeActivity(tx as unknown as Db, {
      shopId,
      actorType: 'webhook',
      actorLabel: 'app/uninstalled',
      entityType: 'shop',
      entityId: shopId,
      action: 'shop.uninstalled',
      after: { uninstalledAt: new Date().toISOString() },
    });
  });
};
