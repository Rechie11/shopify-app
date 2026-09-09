// The payload shape shared by GET /apps/flights/bundles (live) and the
// shop metafield snapshot written on publish (fallback). One shape, two
// delivery paths - the theme's fallback renders identically to the live
// call. See ARCHITECTURE.md §9 and THEME_SPEC.md §4.7.

export interface FlightSnapshotItem {
  variantGid: string;
  productGid: string;
  productTitle: string | null;
  variantTitle: string | null;
  imageUrl: string | null;
  unitPriceCents: number | null;
  isRequired: boolean;
  heatLevel: number | null;
  flavorProfile: string | null;
}

export interface FlightSnapshotTier {
  minQuantity: number;
  discountBps: number;
}

export interface FlightSnapshotBundle {
  publicId: string;
  handle: string;
  title: string;
  subtitle: string | null;
  minItems: number;
  maxItems: number;
  pricingMode: 'tiered_percent' | 'fixed_price' | 'per_item_percent';
  fixedPriceCents: number | null;
  tiers: FlightSnapshotTier[];
  items: FlightSnapshotItem[];
}

export interface FlightSnapshotPayload {
  generatedAt: string;
  bundles: FlightSnapshotBundle[];
}

export interface SnapshotSourceBundle {
  publicId: string;
  handle: string;
  title: string;
  subtitle: string | null;
  minItems: number;
  maxItems: number;
  pricingMode: 'tiered_percent' | 'fixed_price' | 'per_item_percent';
  fixedPriceCents: number | null;
  tiers: FlightSnapshotTier[];
  items: Array<{
    variantGid: string;
    productGid: string;
    productTitleCache: string | null;
    variantTitleCache: string | null;
    imageUrlCache: string | null;
    unitPriceCents: number | null;
    isRequired: boolean;
    heatLevel: number | null;
    flavorProfile: string | null;
  }>;
}

export function buildFlightSnapshotPayload(
  bundles: SnapshotSourceBundle[],
  now: Date = new Date(),
): FlightSnapshotPayload {
  return {
    generatedAt: now.toISOString(),
    bundles: bundles.map((bundle) => ({
      publicId: bundle.publicId,
      handle: bundle.handle,
      title: bundle.title,
      subtitle: bundle.subtitle,
      minItems: bundle.minItems,
      maxItems: bundle.maxItems,
      pricingMode: bundle.pricingMode,
      fixedPriceCents: bundle.fixedPriceCents,
      tiers: [...bundle.tiers].sort((a, b) => a.minQuantity - b.minQuantity),
      items: bundle.items.map((item) => ({
        variantGid: item.variantGid,
        productGid: item.productGid,
        productTitle: item.productTitleCache,
        variantTitle: item.variantTitleCache,
        imageUrl: item.imageUrlCache,
        unitPriceCents: item.unitPriceCents,
        isRequired: item.isRequired,
        heatLevel: item.heatLevel,
        flavorProfile: item.flavorProfile,
      })),
    })),
  };
}
