import { useState } from 'react';
import { type ProductSearchNode, type ProductSearchVariant, searchProducts } from '../lib/api.js';

export interface PickedVariant {
  productGid: string;
  variantGid: string;
  inventoryItemGid: string;
  productTitleCache: string;
  variantTitleCache: string;
  unitPriceCents: number;
}

export function ProductPicker({ onPick }: { onPick: (variant: PickedVariant) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductSearchNode[]>([]);
  const [loading, setLoading] = useState(false);

  async function runSearch(q: string) {
    setQuery(q);
    if (q.trim().length === 0) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await searchProducts(q);
      setResults(res.products.nodes);
    } finally {
      setLoading(false);
    }
  }

  function pick(product: ProductSearchNode, variant: ProductSearchVariant) {
    onPick({
      productGid: product.id,
      variantGid: variant.id,
      inventoryItemGid: variant.inventoryItem.id,
      productTitleCache: product.title,
      variantTitleCache: variant.title,
      unitPriceCents: Math.round(parseFloat(variant.price) * 100),
    });
    setQuery('');
    setResults([]);
  }

  return (
    <div className="field">
      <label htmlFor="product-search">Add a product</label>
      <input
        id="product-search"
        type="text"
        placeholder="Search products..."
        value={query}
        onChange={(e) => void runSearch(e.target.value)}
      />
      {loading && <p className="muted">Searching...</p>}
      {results.length > 0 && (
        <div className="search-results">
          {results.map((product) =>
            product.variants.nodes.map((variant) => (
              <div className="search-result-row" key={variant.id}>
                <span>
                  {product.title}
                  {variant.title !== 'Default Title' ? ` — ${variant.title}` : ''}
                </span>
                <button className="button" onClick={() => pick(product, variant)}>
                  Add
                </button>
              </div>
            )),
          )}
        </div>
      )}
    </div>
  );
}
