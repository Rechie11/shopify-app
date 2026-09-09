import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, type Db } from '@ember-and-ash/db/client';
import { shops } from '@ember-and-ash/db';
import {
  createBundle,
  findBundleByPublicId,
  listBundles,
} from '../../src/repositories/bundle.repository.js';
import { ValidationError } from '../../src/errors.js';

// Real MySQL, not mocked - this is the one test in the suite that asserts
// the actual multi-tenancy boundary holds. Requires `docker compose up -d`
// (see README.md). See ARCHITECTURE.md §10 and SCHEMA.md §5.3.
const databaseUrl = process.env.DATABASE_URL ?? 'mysql://ember:ember@localhost:3306/ember_ash';

describe('bundle repository: cross-tenant isolation', () => {
  let db: Db;
  let shopAId: number;
  let shopBId: number;

  beforeAll(async () => {
    db = createDbClient(databaseUrl);

    const [shopA] = await db
      .insert(shops)
      .values({ shopDomain: `tenant-a-${Date.now()}.myshopify.com` })
      .$returningId();
    const [shopB] = await db
      .insert(shops)
      .values({ shopDomain: `tenant-b-${Date.now()}.myshopify.com` })
      .$returningId();
    shopAId = shopA!.id;
    shopBId = shopB!.id;
  });

  afterAll(async () => {
    // ON DELETE CASCADE cleans up any bundles created under these shops.
    await db.delete(shops).where(eq(shops.id, shopAId));
    await db.delete(shops).where(eq(shops.id, shopBId));
  });

  it('does not let shop B read shop A bundle by public id', async () => {
    const bundle = await createBundle(db, shopAId, {
      handle: 'tasting-flight',
      title: "Shop A's Flight",
      minItems: 3,
      maxItems: 6,
      pricingMode: 'tiered_percent',
    });

    const asOwner = await findBundleByPublicId(db, shopAId, bundle.publicId);
    expect(asOwner?.id).toBe(bundle.id);

    const asOtherTenant = await findBundleByPublicId(db, shopBId, bundle.publicId);
    expect(asOtherTenant).toBeUndefined();
  });

  it('raises a clear ValidationError on a duplicate handle within the same shop, not a raw DB error', async () => {
    await createBundle(db, shopAId, {
      handle: 'duplicate-handle-test',
      title: 'First',
      minItems: 3,
      maxItems: 6,
      pricingMode: 'tiered_percent',
    });

    await expect(
      createBundle(db, shopAId, {
        handle: 'duplicate-handle-test',
        title: 'Second',
        minItems: 3,
        maxItems: 6,
        pricingMode: 'tiered_percent',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows the same handle to be reused across different shops', async () => {
    await createBundle(db, shopAId, {
      handle: 'shared-handle',
      title: "Shop A's",
      minItems: 3,
      maxItems: 6,
      pricingMode: 'tiered_percent',
    });

    await expect(
      createBundle(db, shopBId, {
        handle: 'shared-handle',
        title: "Shop B's",
        minItems: 3,
        maxItems: 6,
        pricingMode: 'tiered_percent',
      }),
    ).resolves.toMatchObject({ handle: 'shared-handle' });
  });

  it('scopes the bundle list to the calling shop only', async () => {
    await createBundle(db, shopAId, {
      handle: 'shop-a-only',
      title: 'Shop A Only',
      minItems: 3,
      maxItems: 6,
      pricingMode: 'tiered_percent',
    });

    const shopBBundles = await listBundles(db, shopBId);
    expect(shopBBundles.some((b) => b.handle === 'shop-a-only')).toBe(false);
  });
});
