import { AppError, toAppError } from '../errors/app-error.ts';
import { createLogger, createRequestId, type Logger } from '../logging/logger.ts';

/**
 * HTTP plumbing shared by every Edge Function.
 *
 * Entrypoints stay thin: parse, authenticate, validate, call a controller, map
 * the result. This module owns the parts that must not vary between functions —
 * CORS exposure, the error envelope, request correlation and the guarantee that
 * an internal exception never reaches the browser verbatim.
 */

/**
 * CORS is granted per function, never globally.
 *
 * Only functions the browser calls get browser-compatible CORS. The webhook and
 * the scheduled sync are server-to-server and deliberately get none — opening
 * them would let any page on the internet invoke them.
 */
export const BROWSER_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-application-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export type HandlerOptions = {
  functionName: string;
  /** Whether the browser may call this function. */
  browserAccessible: boolean;
  /** Methods other than OPTIONS that this function accepts. */
  allowedMethods?: string[];
};

export type HandlerContext = {
  request: Request;
  requestId: string;
  logger: Logger;
};

/**
 * Wraps a function body with CORS, method checking, error mapping and timing.
 *
 * The handler returns a JSON-serialisable value; this maps it to a 200. Any
 * throw is converted to the standard error envelope.
 */
export function createHandler(
  options: HandlerOptions,
  handle: (context: HandlerContext) => Promise<unknown>,
): (request: Request) => Promise<Response> {
  const allowedMethods = options.allowedMethods ?? ['POST'];

  return async (request: Request): Promise<Response> => {
    const requestId = createRequestId();
    const logger = createLogger(options.functionName, requestId);
    const startedAt = Date.now();

    if (request.method === 'OPTIONS') {
      return options.browserAccessible
        ? new Response(null, { status: 204, headers: BROWSER_CORS_HEADERS })
        : new Response(null, { status: 405 });
    }

    try {
      if (!allowedMethods.includes(request.method)) {
        throw new AppError(
          'METHOD_NOT_ALLOWED',
          `This endpoint accepts ${allowedMethods.join(', ')}.`,
        );
      }

      const result = await handle({ request, requestId, logger });

      logger.info('Request completed', {
        durationMs: Date.now() - startedAt,
        status: 200,
      });

      return jsonResponse(result ?? { ok: true }, 200, options.browserAccessible);
    } catch (error) {
      const appError = toAppError(error);

      // The full detail goes to the log; only the safe message goes back.
      logger.error('Request failed', {
        code: appError.code,
        status: appError.status,
        durationMs: Date.now() - startedAt,
        detail: appError.internalDetail ?? appError.message,
      });

      return jsonResponse(
        {
          error: {
            code: appError.code,
            message: appError.message,
            requestId,
          },
        },
        appError.status,
        options.browserAccessible,
      );
    }
  };
}

export function jsonResponse(body: unknown, status: number, withCors: boolean): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(withCors ? BROWSER_CORS_HEADERS : {}),
    },
  });
}

/** Parses a JSON body, rejecting anything malformed with a safe message. */
export async function parseJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw AppError.invalidRequest('The request body must be valid JSON.');
  }
}

/**
 * Runs a promise with a timeout.
 *
 * Edge Functions have a hard wall-clock limit; a hung upstream call should fail
 * with a clear timeout rather than being killed mid-write, which would leave a
 * sync run marked RUNNING forever.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AppError('TIMEOUT', `${label} took too long. Please try again.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
