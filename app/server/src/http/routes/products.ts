import { LRUCache } from 'lru-cache';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { createAdminClient } from '../../shopify/admin-client.js';
import { PRODUCT_SEARCH_QUERY, type ProductSearchResult } from '../../shopify/queries.js';
import { requireShopContext } from '../plugins/auth.js';

export interface ProductRoutesOptions {
  apiVersion: string;
}

// Proxied Admin GraphQL product search, 60s cached. See
// ARCHITECTURE.md §6.1.
export async function productRoutes(
  app: FastifyInstance,
  opts: ProductRoutesOptions,
): Promise<void> {
  const cache = new LRUCache<string, ProductSearchResult>({ max: 200, ttl: 60_000 });
  const querySchema = z.object({ q: z.string().min(1).max(200) });

  app.get('/products/search', async (request) => {
    const shop = requireShopContext(request);
    const { q } = querySchema.parse(request.query);

    const cacheKey = `${shop.shopId}:${q}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const adminClient = createAdminClient({
      shopDomain: shop.shopDomain,
      accessToken: shop.accessToken,
      apiVersion: opts.apiVersion,
    });
    const result = await adminClient.request<ProductSearchResult>(PRODUCT_SEARCH_QUERY, {
      query: q,
    });
    cache.set(cacheKey, result);
    return result;
  });
}
