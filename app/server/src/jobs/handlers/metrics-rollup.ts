import { groupLineItemsByFlight, type OrderLineItem } from '../../domain/order-attribution.js';
import { findBundleByHandle } from '../../repositories/bundle.repository.js';
import {
  recordBundleOrder,
  cancelBundleOrder,
} from '../../repositories/bundle-order.repository.js';
import {
  addRefundedUnits,
  addToVariantMetricsDaily,
  incrementShopOrderCount,
} from '../../repositories/metrics.repository.js';
import { enqueueScoreRecompute } from '../queue.js';
import type { JobHandler } from '../worker.js';

interface OrderLineItemPayload {
  variant_id: number | null;
  quantity: number;
  price: string;
  total_discount: string;
  properties?: Array<{ name: string; value: string }>;
}

interface OrderWebhookPayload {
  admin_graphql_api_id: string;
  order_number: number;
  currency: string;
  line_items: OrderLineItemPayload[];
  created_at: string;
  cancelled_at: string | null;
}

function extractProperty(
  properties: OrderLineItemPayload['properties'],
  name: string,
): string | null {
  return properties?.find((p) => p.name === name)?.value ?? null;
}

function toOrderLineItem(li: OrderLineItemPayload): OrderLineItem {
  return {
    variantGid: li.variant_id ? `gid://shopify/ProductVariant/${li.variant_id}` : null,
    quantity: li.quantity,
    priceCents: Math.round(parseFloat(li.price) * 100),
    totalDiscountCents: Math.round(parseFloat(li.total_discount || '0') * 100),
    flightId: extractProperty(li.properties, '_flight_id'),
    // A deliberate refinement over the illustrative code in
    // ARCHITECTURE.md §9: the storefront (Day 4) sets _flight_name to the
    // bundle's *handle*, not its display title, since only the handle is
    // guaranteed unique per shop - title-matching would misattribute the
    // moment two bundles share a name.
    flightName: extractProperty(li.properties, '_flight_name'),
  };
}

// orders/create -> metrics rollup + bundle attribution from _flight_id;
// orders/cancelled -> reverse it. customer_hash (SCHEMA.md §3.9) is
// deferred - it needs a per-shop salt column that doesn't exist yet, and
// it only supports a "repeat flight buyers" stat no UI currently surfaces.
// See ARCHITECTURE.md §6.3.
export const handleMetricsRollup: JobHandler = async (db, job) => {
  const { topic, body } = job.payload as { topic: string; body: OrderWebhookPayload };
  const shopId = job.shopId;
  const day = new Date(body.created_at);

  if (topic === 'orders/cancelled') {
    await cancelBundleOrder(
      db,
      shopId,
      body.admin_graphql_api_id,
      new Date(body.cancelled_at ?? body.created_at),
    );
    for (const li of body.line_items) {
      if (!li.variant_id) continue;
      await addRefundedUnits(
        db,
        shopId,
        `gid://shopify/ProductVariant/${li.variant_id}`,
        day,
        li.quantity,
      );
    }
    return;
  }

  const lineItems = body.line_items.map(toOrderLineItem);

  for (const item of lineItems) {
    if (!item.variantGid) continue;
    await addToVariantMetricsDaily(db, {
      shopId,
      variantGid: item.variantGid,
      day,
      unitsSold: item.quantity,
      orders: 1,
      grossCents: item.priceCents * item.quantity,
    });
  }
  await incrementShopOrderCount(db, shopId, day);

  const flights = groupLineItemsByFlight(lineItems);
  for (const flight of flights) {
    const bundle = await findBundleByHandle(db, shopId, flight.flightName);
    if (!bundle) {
      // The bundle was renamed or deleted since this flight was built -
      // the sale still happened, but it can no longer be attributed.
      continue;
    }

    const recorded = await recordBundleOrder(db, {
      shopId,
      bundleId: bundle.id,
      orderGid: body.admin_graphql_api_id,
      orderNumber: String(body.order_number),
      flightToken: flight.flightToken,
      itemCount: flight.itemCount,
      subtotalCents: flight.subtotalCents,
      discountCents: flight.discountCents,
      currency: body.currency,
      customerHash: undefined,
      placedAt: day,
    });

    if (recorded) {
      await enqueueScoreRecompute(db, shopId, bundle.id);
    }
  }
};
