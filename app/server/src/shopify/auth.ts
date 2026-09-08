import jwt from 'jsonwebtoken';

export interface SessionTokenPayload {
  iss: string;
  dest: string;
  aud: string;
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sid: string;
}

export class SessionTokenError extends Error {}

// Verifies an App Bridge session token (id token) entirely locally: HS256
// signature, exp/nbf, aud == client id, and iss/dest host match. See
// ARCHITECTURE.md §5.2.
export function verifySessionToken(
  idToken: string,
  opts: { clientId: string; clientSecret: string },
): SessionTokenPayload {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(idToken, opts.clientSecret, {
      algorithms: ['HS256'],
      audience: opts.clientId,
      clockTolerance: 5,
    }) as jwt.JwtPayload;
  } catch (err) {
    throw new SessionTokenError(err instanceof Error ? err.message : 'invalid session token');
  }

  const { iss, dest, sub, jti, sid } = payload;
  if (typeof iss !== 'string' || typeof dest !== 'string') {
    throw new SessionTokenError('session token is missing iss/dest');
  }

  let issHost: string;
  let destHost: string;
  try {
    issHost = new URL(iss).host;
    destHost = new URL(dest).host;
  } catch {
    throw new SessionTokenError('session token iss/dest is not a valid URL');
  }
  if (issHost !== destHost) {
    throw new SessionTokenError('session token iss/dest host mismatch');
  }

  return {
    iss,
    dest,
    aud: String(payload.aud),
    sub: String(sub),
    exp: Number(payload.exp),
    nbf: Number(payload.nbf),
    iat: Number(payload.iat),
    jti: String(jti),
    sid: String(sid),
  };
}

export function shopDomainFromSessionToken(payload: SessionTokenPayload): string {
  return new URL(payload.dest).host;
}

export class TokenExchangeError extends Error {
  // true when Shopify rejected the exchange with a 400 - the caller must
  // answer 401 + X-Shopify-Retry-Invalid-Session-Request so App Bridge
  // fetches a fresh id token and replays the request. Skipping this makes
  // the app appear to log the merchant out at random after 24 hours.
  // See ARCHITECTURE.md §5.2.
  constructor(
    message: string,
    public readonly shouldRetryWithFreshToken: boolean,
  ) {
    super(message);
  }
}

export interface TokenExchangeResult {
  accessToken: string;
  scope: string;
}

export async function exchangeToken(
  shopDomain: string,
  idToken: string,
  opts: { clientId: string; clientSecret: string },
): Promise<TokenExchangeResult> {
  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: idToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new TokenExchangeError(
      `token exchange failed with ${response.status}: ${body}`,
      response.status === 400,
    );
  }

  const data = (await response.json()) as { access_token: string; scope: string };
  return { accessToken: data.access_token, scope: data.scope };
}
