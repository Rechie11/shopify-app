import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authenticatedFetch } from '../lib/authenticated-fetch.js';

// Day 1 proved the auth pipeline end to end. The real dashboard (KPI
// tiles, score distribution, alerts, activity feed) lands Day 3 once the
// Bundle Health Score exists to summarize.
export function Dashboard() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [shopDomain, setShopDomain] = useState<string | null>(null);

  useEffect(() => {
    authenticatedFetch('/api/ping')
      .then(async (res) => {
        if (!res.ok) throw new Error(`ping failed with ${res.status}`);
        const body = (await res.json()) as { shop?: string };
        setShopDomain(body.shop ?? null);
        setStatus('ok');
      })
      .catch(() => setStatus('error'));
  }, []);

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Dashboard</h1>
      </div>
      <div className="card">
        {status === 'loading' && <p className="muted">Checking session...</p>}
        {status === 'error' && <p className="muted">Could not authenticate with the server.</p>}
        {status === 'ok' && (
          <>
            <p>
              Authenticated as <strong>{shopDomain}</strong>.
            </p>
            <p className="muted">
              Score distribution, alerts, and the activity feed land here on Day 3.
            </p>
            <Link className="button button--primary" to="/bundles">
              Go to Bundles
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
