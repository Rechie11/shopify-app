export interface OrderLineItem {
  variantGid: string | null;
  quantity: number;
  priceCents: number;
  totalDiscountCents: number;
  flightId: string | null;
  flightName: string | null;
}

export interface AttributedFlight {
  flightToken: string;
  flightName: string;
  lineItems: OrderLineItem[];
  itemCount: number;
  subtotalCents: number;
  discountCents: number;
}

// Attribution reads the _flight_id line-item property set by the cart
// (ARCHITECTURE.md §9's cart mechanics). When absent, the customer added
// the same products by hand - not attributed, because inflating attach
// rate with coincidental baskets would make the metric lie.
// See SCHEMA.md §3.9.
export function groupLineItemsByFlight(lineItems: OrderLineItem[]): AttributedFlight[] {
  const groups = new Map<string, OrderLineItem[]>();
  for (const item of lineItems) {
    if (!item.flightId) {
      continue;
    }
    const existing = groups.get(item.flightId) ?? [];
    existing.push(item);
    groups.set(item.flightId, existing);
  }

  return [...groups.entries()].map(([flightToken, items]) => ({
    flightToken,
    flightName: items[0]?.flightName ?? '',
    lineItems: items,
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    subtotalCents: items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0),
    discountCents: items.reduce((sum, i) => sum + i.totalDiscountCents, 0),
  }));
}
