// A single error handler maps this hierarchy to a status code, so no
// route hand-rolls one and no stack trace ever reaches a client.
// See ARCHITECTURE.md §11.
export class AppError extends Error {
  readonly statusCode: number = 500;
  readonly code: string = 'internal_error';

  constructor(message: string, opts?: { code?: string; statusCode?: number }) {
    super(message);
    if (opts?.code) this.code = opts.code;
    if (opts?.statusCode) this.statusCode = opts.statusCode;
  }
}

export class ValidationError extends AppError {
  override readonly statusCode = 400;
  override readonly code = 'validation_error';
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class AuthError extends AppError {
  override readonly statusCode = 401;
  override readonly code = 'unauthorized';
}

export class NotFoundError extends AppError {
  override readonly statusCode = 404;
  override readonly code = 'not_found';
}

export class ShopifyApiError extends AppError {
  override readonly statusCode = 502;
  override readonly code = 'shopify_api_error';
  constructor(
    message: string,
    public readonly graphqlErrors?: unknown,
  ) {
    super(message);
  }
}
