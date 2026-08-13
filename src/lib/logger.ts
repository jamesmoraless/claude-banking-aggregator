/**
 * Structured browser logging.
 *
 * Deliberately small. Its real job is to be the ONE place log output is
 * produced, so that redaction is enforceable: anything resembling a token,
 * key or authorization header is stripped before it reaches the console.
 *
 * Financial values are not logged either. A console entry is not a safe place
 * for someone's balances.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

const REDACTED = '[redacted]';

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|key|authorization|cookie|credential|access_token|public_token)/i;

/** Recursively removes anything that looks sensitive. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value == null) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redact(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(entry, depth + 1);
    }
    return output;
  }

  if (typeof value === 'string') {
    // Catch tokens that arrive as bare strings rather than under a telling key.
    if (/^(access|public|link)-(sandbox|development|production)-/.test(value)) return REDACTED;
    if (/^ey[A-Za-z0-9_-]{10,}\./.test(value)) return REDACTED; // JWT
    if (/^sb_(secret|publishable)_/.test(value)) return REDACTED;
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }

  return value;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context ? { context: redact(context) } : {}),
  };

  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else if (import.meta.env.DEV) {
    // Info and debug are noise in production and can reveal usage patterns.
    console.warn(JSON.stringify(entry));
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
};
