import { authenticatedFetch } from './authenticated-fetch.js';

export interface Bundle {
  id: number;
  publicId: string;
  handle: string;
  title: string;
  subtitle: string | null;
  status: 'draft' | 'publishing' | 'active' | 'paused' | 'archived';
  minItems: number;
  maxItems: number;
  pricingMode: 'tiered_percent' | 'fixed_price' | 'per_item_percent';
  fixedPriceCents: number | null;
  discountGid: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BundleItem {
  id: number;
  productGid: string;
  variantGid: string;
  productTitleCache: string | null;
  variantTitleCache: string | null;
  unitPriceCents: number | null;
  position: number;
  isRequired: boolean;
  heatLevel: number | null;
  flavorProfile: string | null;
}

export interface BundlePriceTier {
  id: number;
  minQuantity: number;
  discountBps: number;
}

export interface BundleWithDetails extends Bundle {
  items: BundleItem[];
  tiers: BundlePriceTier[];
}

export interface ProductSearchVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  inventoryItem: { id: string };
}

export interface ProductSearchNode {
  id: string;
  title: string;
  featuredImage: { url: string } | null;
  variants: { nodes: ProductSearchVariant[] };
}

export interface ProductSearchResponse {
  products: { nodes: ProductSearchNode[] };
}

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await authenticatedFetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body?.error?.message ?? `Request failed with ${res.status}`, res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function listBundles(): Promise<{ bundles: Bundle[]; nextCursor: string | null }> {
  return request('/bundles');
}

export function getBundle(publicId: string): Promise<BundleWithDetails> {
  return request(`/bundles/${publicId}`);
}

export interface CreateBundleInput {
  handle: string;
  title: string;
  subtitle?: string;
  minItems: number;
  maxItems: number;
  pricingMode: Bundle['pricingMode'];
  fixedPriceCents?: number;
}

export function createBundle(input: CreateBundleInput): Promise<Bundle> {
  return request('/bundles', { method: 'POST', body: JSON.stringify(input) });
}

export function updateBundle(publicId: string, patch: Partial<CreateBundleInput>): Promise<void> {
  return request(`/bundles/${publicId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export interface SaveCompositionInput {
  items: Array<{
    productGid: string;
    variantGid: string;
    productTitleCache?: string;
    variantTitleCache?: string;
    unitPriceCents?: number;
    position: number;
    isRequired: boolean;
  }>;
  tiers: Array<{ minQuantity: number; discountBps: number }>;
}

export function saveComposition(publicId: string, input: SaveCompositionInput): Promise<void> {
  return request(`/bundles/${publicId}/composition`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function publishBundle(publicId: string): Promise<void> {
  return request(`/bundles/${publicId}/publish`, { method: 'POST' });
}

export function pauseBundle(publicId: string): Promise<void> {
  return request(`/bundles/${publicId}/pause`, { method: 'POST' });
}

export function deleteBundle(publicId: string): Promise<void> {
  return request(`/bundles/${publicId}`, { method: 'DELETE' });
}

export function searchProducts(query: string): Promise<ProductSearchResponse> {
  return request(`/products/search?q=${encodeURIComponent(query)}`);
}

export { ApiError };
