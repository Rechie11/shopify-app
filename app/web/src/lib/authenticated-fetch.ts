declare global {
  interface Window {
    shopify: {
      idToken(): Promise<string>;
    };
  }
}

const RETRY_HEADER = 'x-shopify-retry-invalid-session-request';

// Attaches a fresh App Bridge session token to every request, and retries
// exactly once if the server asks for a fresh token via
// X-Shopify-Retry-Invalid-Session-Request. Without this retry, a stale
// cached id token makes the app appear to log the merchant out at random.
// See ARCHITECTURE.md §5.2.
export async function authenticatedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const attempt = async (): Promise<Response> => {
    const idToken = await window.shopify.idToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${idToken}`);
    return fetch(input, { ...init, headers });
  };

  const response = await attempt();
  if (response.status === 401 && response.headers.get(RETRY_HEADER) === '1') {
    return attempt();
  }
  return response;
}
