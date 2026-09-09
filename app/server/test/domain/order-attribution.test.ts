import { describe, expect, it } from 'vitest';
import { groupLineItemsByFlight } from '../../src/domain/order-attribution.js';

describe('groupLineItemsByFlight', () => {
  it('groups line items sharing the same _flight_id into one attributed flight', () => {
    const result = groupLineItemsByFlight([
      {
        variantGid: 'v1',
        quantity: 1,
        priceCents: 1200,
        totalDiscountCents: 100,
        flightId: 'flight-a',
        flightName: 'Tasting Flight',
      },
      {
        variantGid: 'v2',
        quantity: 1,
        priceCents: 1200,
        totalDiscountCents: 100,
        flightId: 'flight-a',
        flightName: 'Tasting Flight',
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.itemCount).toBe(2);
    expect(result[0]!.subtotalCents).toBe(2400);
    expect(result[0]!.discountCents).toBe(200);
  });

  it('does not attribute line items with no _flight_id (coincidental basket)', () => {
    const result = groupLineItemsByFlight([
      {
        variantGid: 'v1',
        quantity: 1,
        priceCents: 1200,
        totalDiscountCents: 0,
        flightId: null,
        flightName: null,
      },
    ]);
    expect(result).toHaveLength(0);
  });

  it('separates two distinct flights purchased in the same order', () => {
    const result = groupLineItemsByFlight([
      {
        variantGid: 'v1',
        quantity: 1,
        priceCents: 1000,
        totalDiscountCents: 0,
        flightId: 'flight-a',
        flightName: 'Flight A',
      },
      {
        variantGid: 'v2',
        quantity: 1,
        priceCents: 1000,
        totalDiscountCents: 0,
        flightId: 'flight-b',
        flightName: 'Flight B',
      },
    ]);
    expect(result).toHaveLength(2);
  });

  it('ignores hand-picked items mixed in with an attributed flight', () => {
    const result = groupLineItemsByFlight([
      {
        variantGid: 'v1',
        quantity: 1,
        priceCents: 1000,
        totalDiscountCents: 0,
        flightId: 'flight-a',
        flightName: 'Flight A',
      },
      {
        variantGid: 'v2',
        quantity: 1,
        priceCents: 500,
        totalDiscountCents: 0,
        flightId: null,
        flightName: null,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.itemCount).toBe(1);
  });
});
