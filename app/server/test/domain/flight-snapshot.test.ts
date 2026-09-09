import { describe, expect, it } from 'vitest';
import { buildFlightSnapshotPayload, type SnapshotSourceBundle } from '../../src/domain/flight-snapshot.js';

const bundle: SnapshotSourceBundle = {
  publicId: '01ABC',
  handle: 'demo-flight',
  title: 'Demo Flight',
  subtitle: null,
  minItems: 3,
  maxItems: 6,
  pricingMode: 'tiered_percent',
  fixedPriceCents: null,
  tiers: [
    { minQuantity: 4, discountBps: 1500 },
    { minQuantity: 3, discountBps: 1000 },
  ],
  items: [
    {
      variantGid: 'gid://shopify/ProductVariant/1',
      productGid: 'gid://shopify/Product/1',
      productTitleCache: 'Charred Pineapple',
      variantTitleCache: 'Default Title',
      imageUrlCache: 'https://cdn.example/1.jpg',
      unitPriceCents: 1000,
      isRequired: true,
      heatLevel: 3,
      flavorProfile: 'fruity',
    },
  ],
};

describe('buildFlightSnapshotPayload', () => {
  it('maps bundle fields to the snapshot shape', () => {
    const payload = buildFlightSnapshotPayload([bundle], new Date('2026-01-01T00:00:00.000Z'));
    expect(payload.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(payload.bundles).toHaveLength(1);
    expect(payload.bundles[0]).toMatchObject({
      publicId: '01ABC',
      handle: 'demo-flight',
      title: 'Demo Flight',
    });
  });

  it('sorts tiers by minQuantity ascending regardless of input order', () => {
    const payload = buildFlightSnapshotPayload([bundle]);
    expect(payload.bundles[0]?.tiers.map((t) => t.minQuantity)).toEqual([3, 4]);
  });

  it('maps cached item fields to the public snapshot names', () => {
    const payload = buildFlightSnapshotPayload([bundle]);
    const item = payload.bundles[0]?.items[0];
    expect(item).toMatchObject({
      variantGid: 'gid://shopify/ProductVariant/1',
      productTitle: 'Charred Pineapple',
      variantTitle: 'Default Title',
      imageUrl: 'https://cdn.example/1.jpg',
      unitPriceCents: 1000,
      heatLevel: 3,
      flavorProfile: 'fruity',
    });
  });

  it('produces an empty bundles array for no active bundles', () => {
    expect(buildFlightSnapshotPayload([]).bundles).toEqual([]);
  });
});
