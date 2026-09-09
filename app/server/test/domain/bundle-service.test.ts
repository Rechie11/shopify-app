import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repositories/bundle.repository.js', () => ({
  findBundleByPublicId: vi.fn(),
  setBundleStatus: vi.fn(),
}));

const { findBundleByPublicId } = await import('../../src/repositories/bundle.repository.js');
const { attemptPublish } = await import('../../src/services/bundle.service.js');

function baseBundle(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: 'publishing',
    minItems: 3,
    discountGid: null,
    items: [],
    tiers: [],
    ...overrides,
  };
}

describe('attemptPublish', () => {
  it('is a no-op when the bundle is already active with a discount - guards against a stale discount.reconcile job creating a duplicate discount', async () => {
    vi.mocked(findBundleByPublicId).mockResolvedValue(
      baseBundle({
        status: 'active',
        discountGid: 'gid://shopify/DiscountAutomaticNode/1',
      }) as never,
    );
    const adminClient = { request: vi.fn() };

    await attemptPublish(adminClient as never, {} as never, 1, 'pub-id');

    expect(adminClient.request).not.toHaveBeenCalled();
  });
});
