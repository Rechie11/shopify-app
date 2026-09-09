// Typed documents live here rather than inline in services - no
// stringly-typed queries scattered through the codebase. See
// ARCHITECTURE.md §8.

export const PRODUCT_SEARCH_QUERY = /* GraphQL */ `
  query ProductSearch($query: String!) {
    products(first: 20, query: $query) {
      nodes {
        id
        title
        featuredImage {
          url
        }
        variants(first: 10) {
          nodes {
            id
            title
            sku
            price
            inventoryItem {
              id
            }
          }
        }
      }
    }
  }
`;

export interface ProductSearchResult {
  products: {
    nodes: Array<{
      id: string;
      title: string;
      featuredImage: { url: string } | null;
      variants: {
        nodes: Array<{
          id: string;
          title: string;
          sku: string | null;
          price: string;
          inventoryItem: { id: string };
        }>;
      };
    }>;
  };
}

export const DISCOUNT_AUTOMATIC_BASIC_CREATE_MUTATION = /* GraphQL */ `
  mutation DiscountAutomaticBasicCreate($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface DiscountAutomaticBasicCreateResult {
  discountAutomaticBasicCreate: {
    automaticDiscountNode: { id: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

export const DISCOUNT_AUTOMATIC_DEACTIVATE_MUTATION = /* GraphQL */ `
  mutation DiscountAutomaticDeactivate($id: ID!) {
    discountAutomaticDeactivate(id: $id) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface DiscountAutomaticDeactivateResult {
  discountAutomaticDeactivate: {
    automaticDiscountNode: { id: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

export const SHOP_ID_QUERY = /* GraphQL */ `
  {
    shop {
      id
    }
  }
`;

export interface ShopIdResult {
  shop: { id: string };
}

// The flight-builder fallback path: a compact JSON snapshot of every
// active bundle, written to a shop metafield on publish so the theme can
// render from it on first paint with zero network dependency. See
// ARCHITECTURE.md §9 and THEME_SPEC.md §4.7.
export const METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface MetafieldsSetResult {
  metafieldsSet: {
    metafields: Array<{ id: string }>;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}
