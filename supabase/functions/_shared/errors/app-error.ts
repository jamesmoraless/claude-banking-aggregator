/**
 * Structured errors.
 *
 * Every failure that reaches the browser does so as an AppError with a stable
 * code and a message written for a person. Raw exceptions never cross the
 * boundary: they can carry query fragments, internal identifiers and — in the
 * case of Plaid client errors — occasionally request context we do not want
 * echoed back.
 */

export type ErrorCode =
  // Request / auth
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_REQUEST'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  // Configuration
  | 'CONFIGURATION_ERROR'
  // Plaid
  | 'PLAID_ERROR'
  | 'PLAID_ITEM_LOGIN_REQUIRED'
  | 'PLAID_RATE_LIMIT'
  | 'PLAID_UNAVAILABLE'
  | 'PLAID_ITEM_ALREADY_LINKED'
  // Anthropic
  | 'ANTHROPIC_ERROR'
  | 'ANTHROPIC_RATE_LIMIT'
  | 'CHAT_UNAVAILABLE'
  // Internal
  | 'DATABASE_ERROR'
  | 'INTERNAL_ERROR'
  | 'TIMEOUT';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_REQUEST: 400,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
  CONFIGURATION_ERROR: 503,
  PLAID_ERROR: 502,
  PLAID_ITEM_LOGIN_REQUIRED: 409,
  PLAID_RATE_LIMIT: 429,
  PLAID_UNAVAILABLE: 503,
  PLAID_ITEM_ALREADY_LINKED: 409,
  ANTHROPIC_ERROR: 502,
  ANTHROPIC_RATE_LIMIT: 429,
  CHAT_UNAVAILABLE: 503,
  DATABASE_ERROR: 500,
  INTERNAL_ERROR: 500,
  TIMEOUT: 504,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Detail for logs only. Never serialised into a response. */
  readonly internalDetail: string | undefined;

  constructor(code: ErrorCode, message: string, internalDetail?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.internalDetail = internalDetail;
  }

  static unauthorized(message = 'You must be signed in to do that.'): AppError {
    return new AppError('UNAUTHORIZED', message);
  }

  static invalidRequest(message: string, internalDetail?: string): AppError {
    return new AppError('INVALID_REQUEST', message, internalDetail);
  }

  static notFound(message = 'That resource could not be found.'): AppError {
    return new AppError('NOT_FOUND', message);
  }

  static database(operation: string, detail?: string): AppError {
    return new AppError(
      'DATABASE_ERROR',
      'We could not reach the database. Please try again.',
      `${operation}: ${detail ?? 'unknown'}`,
    );
  }

  static internal(detail?: string): AppError {
    return new AppError('INTERNAL_ERROR', 'Something went wrong on our side.', detail);
  }
}

/**
 * Normalises any thrown value into an AppError.
 *
 * Unrecognised throwables become a generic INTERNAL_ERROR with the original
 * message preserved for logging only — that is the boundary at which internal
 * text stops travelling outward.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof Error) {
    if (error.name === 'ConfigurationError') {
      return new AppError('CONFIGURATION_ERROR', error.message);
    }
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return new AppError('TIMEOUT', 'The request took too long. Please try again.', error.message);
    }
    return AppError.internal(error.message);
  }

  return AppError.internal(String(error));
}
