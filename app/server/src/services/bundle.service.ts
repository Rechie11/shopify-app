import type { DbOrTx } from '@ember-and-ash/db/client';
import { NotFoundError, ValidationError } from '../errors.js';
import { ShopifyApiError } from '../shopify/admin-client.js';
import type { createAdminClient } from '../shopify/admin-client.js';
import {
  DISCOUNT_AUTOMATIC_BASIC_CREATE_MUTATION,
  DISCOUNT_AUTOMATIC_DEACTIVATE_MUTATION,
  type DiscountAutomaticBasicCreateResult,
  type DiscountAutomaticDeactivateResult,
} from '../shopify/queries.js';
import { bpsToPercentage, lowestTier } from '../domain/pricing.js';
import {
  type Bundle,
  type BundleItem,
  type BundleItemInput,
  type CreateBundleInput,
  type PriceTierInput,
  createBundle,
  findBundleByPublicId,
  replaceBundleItems,
  replacePriceTiers,
  setBundleStatus,
  softDeleteBundle,
} from '../repositories/bundle.repository.js';
import { enqueue, enqueueScoreRecomputeNow } from '../jobs/queue.js';
import { writeActivity } from './activity.service.js';

type AdminClient = ReturnType<typeof createAdminClient>;

export async function createDraftBundle(
  db: DbOrTx,
  shopId: number,
  input: CreateBundleInput,
): Promise<Bundle> {
  if (input.minItems < 1) {
    throw new ValidationError('minItems must be at least 1');
  }
  if (input.maxItems < input.minItems) {
    throw new ValidationError('maxItems must be greater than or equal to minItems');
  }
  if (input.pricingMode === 'fixed_price' && input.fixedPriceCents == null) {
    throw new ValidationError('fixedPriceCents is required when pricingMode is fixed_price');
  }

  const bundle = await createBundle(db, shopId, input);
  await writeActivity(db, {
    shopId,
    actorType: 'staff',
    actorLabel: 'Admin',
    entityType: 'bundle',
    entityId: bundle.id,
    action: 'bundle.created',
    after: { handle: bundle.handle, title: bundle.title, status: bundle.status },
  });
  return bundle;
}

export interface SaveBundleCompositionInput {
  items: BundleItemInput[];
  tiers: PriceTierInput[];
}

// The editor always saves the complete composition, not a diff - replace,
// not merge.
export async function saveBundleComposition(
  db: DbOrTx,
  shopId: number,
  publicId: string,
  input: SaveBundleCompositionInput,
): Promise<void> {
  const bundle = await findBundleByPublicId(db, shopId, publicId);
  if (!bundle) {
    throw new NotFoundError('Bundle not found');
  }

  await replaceBundleItems(db, bundle.id, input.items);
  await replacePriceTiers(db, bundle.id, input.tiers);

  await writeActivity(db, {
    shopId,
    actorType: 'staff',
    actorLabel: 'Admin',
    entityType: 'bundle',
    entityId: bundle.id,
    action: 'bundle.composition_updated',
    before: { itemCount: bundle.items.length, tierCount: bundle.tiers.length },
    after: { itemCount: input.items.length, tierCount: input.tiers.length },
  });

  if (bundle.status === 'active') {
    // "Any bundle edit" is a recompute trigger (SCHEMA.md §4.7) - an
    // active bundle's score should reflect its current composition
    // immediately, not wait for the next webhook or the nightly sweep.
    await enqueueScoreRecomputeNow(db, shopId, bundle.id);
  }
}

function buildDiscountVariables(
  bundle: Bundle,
  items: BundleItem[],
  tier: { minQuantity: number; discountBps: number },
) {
  const productGids = [...new Set(items.map((item) => item.productGid))];
  return {
    automaticBasicDiscount: {
      title: bundle.title,
      startsAt: new Date().toISOString(),
      // DiscountMinimumQuantityInput has no product-scoping field of its
      // own - the threshold is cart-wide quantity; customerGets.items
      // below is what actually scopes the discount to the bundle's
      // products.
      minimumRequirement: {
        quantity: { greaterThanOrEqualToQuantity: String(tier.minQuantity) },
      },
      customerGets: {
        value: { percentage: bpsToPercentage(tier.discountBps) },
        items: { products: { productsToAdd: productGids } },
      },
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
    },
  };
}

// The actual Shopify call. Callable both from the publish route and from
// the discount.reconcile job, so a failed first attempt and a retried one
// go through identical logic. Simplification accepted for now: scopes the
// discount directly to the bundle's product ids rather than a managed
// Shopify Collection (bundles.storefront_collection_gid stays unused until
// that's worth building) - matches the "Cart Transform is the real answer,
// this is a six-day stand-in" tradeoff in APP_DECISIONS.md.
export async function attemptPublish(
  adminClient: AdminClient,
  db: DbOrTx,
  shopId: number,
  publicId: string,
): Promise<void> {
  const bundle = await findBundleByPublicId(db, shopId, publicId);
  if (!bundle) {
    throw new NotFoundError('Bundle not found');
  }
  if (bundle.status === 'active' && bundle.discountGid) {
    // Already published by a prior attempt (e.g. a manual retry beat a
    // stale discount.reconcile job to it). Without this, the reconcile
    // job would create a second, duplicate discount.
    return;
  }
  if (bundle.items.length < bundle.minItems) {
    throw new ValidationError(
      `Bundle needs at least ${bundle.minItems} items to publish (has ${bundle.items.length})`,
    );
  }
  const tier = lowestTier(bundle.tiers);
  if (!tier) {
    throw new ValidationError('Bundle needs at least one price tier to publish');
  }

  const variables = buildDiscountVariables(bundle, bundle.items, tier);
  const result = await adminClient.request<DiscountAutomaticBasicCreateResult>(
    DISCOUNT_AUTOMATIC_BASIC_CREATE_MUTATION,
    variables,
  );

  const userErrors = result.discountAutomaticBasicCreate.userErrors;
  if (userErrors.length > 0) {
    throw new ShopifyApiError(userErrors.map((e) => e.message).join('; '), userErrors);
  }
  const discountGid = result.discountAutomaticBasicCreate.automaticDiscountNode?.id;
  if (!discountGid) {
    throw new ShopifyApiError('Discount creation returned no id');
  }

  await db.transaction(async (tx) => {
    await setBundleStatus(tx, shopId, publicId, 'active', { discountGid });
    await writeActivity(tx, {
      shopId,
      actorType: 'staff',
      actorLabel: 'Admin',
      entityType: 'bundle',
      entityId: bundle.id,
      action: 'bundle.published',
      before: { status: bundle.status },
      after: { status: 'active', discountGid },
    });
  });

  await enqueueScoreRecomputeNow(db, shopId, bundle.id);
}

// Publish is a transaction with an external side effect, ordered
// defensively: persist status=publishing -> call Shopify -> persist
// discount_gid + status=active. If the Shopify call fails, the bundle
// stays in publishing and a retry job reconciles it - never an active
// bundle with no discount, or a discount with no bundle.
// See ARCHITECTURE.md §6.1.
export async function publishBundle(
  adminClient: AdminClient,
  db: DbOrTx,
  shopId: number,
  publicId: string,
): Promise<void> {
  const bundle = await findBundleByPublicId(db, shopId, publicId);
  if (!bundle) {
    throw new NotFoundError('Bundle not found');
  }

  await setBundleStatus(db, shopId, publicId, 'publishing');

  try {
    await attemptPublish(adminClient, db, shopId, publicId);
  } catch (err) {
    await enqueue(db, {
      shopId,
      type: 'discount.reconcile',
      payload: { bundlePublicId: publicId },
      dedupeKey: publicId,
    });
    throw err;
  }
}

export async function pauseBundle(
  adminClient: AdminClient,
  db: DbOrTx,
  shopId: number,
  publicId: string,
): Promise<void> {
  const bundle = await findBundleByPublicId(db, shopId, publicId);
  if (!bundle) {
    throw new NotFoundError('Bundle not found');
  }

  if (bundle.discountGid) {
    const result = await adminClient.request<DiscountAutomaticDeactivateResult>(
      DISCOUNT_AUTOMATIC_DEACTIVATE_MUTATION,
      { id: bundle.discountGid },
    );
    const userErrors = result.discountAutomaticDeactivate.userErrors;
    if (userErrors.length > 0) {
      throw new ShopifyApiError(userErrors.map((e) => e.message).join('; '), userErrors);
    }
  }

  await db.transaction(async (tx) => {
    await setBundleStatus(tx, shopId, publicId, 'paused');
    await writeActivity(tx, {
      shopId,
      actorType: 'staff',
      actorLabel: 'Admin',
      entityType: 'bundle',
      entityId: bundle.id,
      action: 'bundle.paused',
      before: { status: bundle.status },
      after: { status: 'paused' },
    });
  });
}

export async function deleteBundle(db: DbOrTx, shopId: number, publicId: string): Promise<void> {
  const bundle = await findBundleByPublicId(db, shopId, publicId);
  if (!bundle) {
    throw new NotFoundError('Bundle not found');
  }
  await db.transaction(async (tx) => {
    await softDeleteBundle(tx, shopId, publicId);
    await writeActivity(tx, {
      shopId,
      actorType: 'staff',
      actorLabel: 'Admin',
      entityType: 'bundle',
      entityId: bundle.id,
      action: 'bundle.deleted',
      before: { status: bundle.status },
      after: { status: 'archived' },
    });
  });
}
