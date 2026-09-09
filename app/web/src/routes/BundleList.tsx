import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Bundle, listBundles } from '../lib/api.js';

function money(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export function BundleList() {
  const navigate = useNavigate();
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBundles()
      .then((res) => setBundles(res.bundles))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load bundles'),
      );
  }, []);

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Bundles</h1>
        <button className="button button--primary" onClick={() => navigate('/bundles/new')}>
          New bundle
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card" style={{ padding: bundles?.length ? 0 : undefined }}>
        {bundles === null && !error && <p className="muted">Loading...</p>}

        {bundles?.length === 0 && (
          <div className="empty-state">
            <h3>No bundles yet</h3>
            <p>Create your first tasting flight to start tracking its health.</p>
            <button className="button button--primary" onClick={() => navigate('/bundles/new')}>
              New bundle
            </button>
          </div>
        )}

        {bundles && bundles.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Size</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {bundles.map((bundle) => (
                <tr
                  key={bundle.publicId}
                  className="clickable"
                  onClick={() => navigate(`/bundles/${bundle.publicId}`)}
                >
                  <td>{bundle.title}</td>
                  <td>
                    <span className={`badge badge--${bundle.status}`}>{bundle.status}</span>
                  </td>
                  <td>
                    {bundle.minItems}–{bundle.maxItems} bottles
                  </td>
                  <td>
                    {bundle.pricingMode === 'fixed_price'
                      ? money(bundle.fixedPriceCents)
                      : 'Tiered'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
