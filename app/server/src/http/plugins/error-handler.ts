import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';

// A single error handler maps the typed error hierarchy to a status code,
// so no route hand-rolls one and no stack trace ever reaches a client.
// See ARCHITECTURE.md §11.
async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      const body: { error: { code: string; message: string; details?: unknown } } = {
        error: { code: err.code, message: err.message },
      };
      if ('details' in err && err.details !== undefined) {
        body.error.details = err.details;
      }
      return reply.code(err.statusCode).send(body);
    }

    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'validation_error',
          message: 'Request failed validation',
          details: err.issues,
        },
      });
    }

    // Fastify's own validation errors (schema-based route validation).
    if (err.validation) {
      return reply.code(400).send({
        error: { code: 'validation_error', message: err.message, details: err.validation },
      });
    }

    // Other built-in Fastify errors (malformed/empty JSON body, payload
    // too large, unsupported media type, ...) already carry a correct 4xx
    // statusCode - trust it rather than masking every one as a 500.
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code ?? 'bad_request', message: err.message } });
    }

    request.log.error({ err }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: { code: 'internal_error', message: 'Something went wrong' } });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler-plugin' });
