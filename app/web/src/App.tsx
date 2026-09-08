import { useEffect, useState } from 'react';
import { authenticatedFetch } from './lib/authenticated-fetch.js';

// Day 1: proves the whole session-token -> token-exchange -> shop record
// pipeline works live, end to end, inside the real embedded iframe.
// Dashboard, Bundles, BundleEditor, Activity, and Alerts routes land Day 2+
// per BUILD_PLAN.md.
export function App() {
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
    <div style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
      <h1>Bundle Studio</h1>
      {status === 'loading' && <p>Checking session...</p>}
      {status === 'ok' && <p>Authenticated as {shopDomain}. Dashboard lands on Day 2.</p>}
      {status === 'error' && <p>Could not authenticate with the server.</p>}
    </div>
  );
}
