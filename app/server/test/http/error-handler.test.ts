import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import errorHandlerPlugin from '../../src/http/plugins/error-handler.js';
import { AuthError, NotFoundError, ShopifyApiError, ValidationError } from '../../src/errors.js';

function buildApp() {
  const app = Fastify();
  app.register(errorHandlerPlugin);
  app.get('/not-found', async () => {
    throw new NotFoundError('Bundle not found');
  });
  app.get('/auth-error', async () => {
    throw new AuthError('Missing session token');
  });
  app.get('/validation-error', async () => {
    throw new ValidationError('Bad input', [{ path: 'title', message: 'required' }]);
  });
  app.get('/shopify-error', async () => {
    throw new ShopifyApiError('Admin API failed');
  });
  app.get('/zod-error', async () => {
    z.object({ title: z.string() }).parse({});
  });
  app.get('/unexpected-error', async () => {
    throw new Error('something exploded with a secret stack trace');
  });
  app.post('/json-body', async () => ({ ok: true }));
  return app;
}

describe('error handler', () => {
  it('maps NotFoundError to 404', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/not-found' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('maps AuthError to 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/auth-error' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('maps ValidationError to 400 with details', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/validation-error' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toEqual([{ path: 'title', message: 'required' }]);
  });

  it('maps ShopifyApiError to 502', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/shopify-error' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('shopify_api_error');
  });

  it('maps a raw ZodError to 400', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/zod-error' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it("maps Fastify's own 4xx errors (e.g. empty JSON body) to their real status, not 500", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/json-body',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('FST_ERR_CTP_EMPTY_JSON_BODY');
  });

  it('maps an unexpected error to a generic 500 without leaking details', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/unexpected-error' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.message).toBe('Something went wrong');
    expect(JSON.stringify(body)).not.toContain('secret stack trace');
  });
});
