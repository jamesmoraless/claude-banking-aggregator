/**
 * Structured server logging with mandatory redaction.
 *
 * Redaction happens here rather than at call sites, because a rule that
 * depends on every caller remembering it is not a rule. Anything whose key
 * looks sensitive, and any value shaped like a Plaid token, a JWT or a Supabase
 * key, is replaced before it can reach the log stream.
 *
 * Financial amounts are not logged either. A log line is not an appropriate
 * place for someone's balances.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

const REDACTED = '[redacted]';

const SENSITIVE_KEY = /(token|secret|password|key|authorization|cookie|credential|signature)/i;

const TOKEN_SHAPES: RegExp[] = [
  /^(access|public|link)-(sandbox|development|production)-[0-9a-f-]+$/i,
  /^ey[A-Za-z0-9_-]{10,}\./, // JWT
  /^sb_(secret|publishable)_/,
  /^sk-ant-/,
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (value == null) return value;

  if (Array.isArray(value)) return value.slice(0, 25).map((entry) => redact(entry, depth + 1));

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(entry, depth + 1);
    }
    return output;
  }

  if (typeof value === 'string') {
    if (TOKEN_SHAPES.some((shape) => shape.test(value))) return REDACTED;
    return value.length > 400 ? `${value.slice(0, 400)}…` : value;
  }

  return value;
}

export class Logger {
  private readonly base: LogContext;

  constructor(base: LogContext = {}) {
    this.base = base;
  }

  /** Derives a child logger carrying additional fixed fields. */
  child(context: LogContext): Logger {
    return new Logger({ ...this.base, ...context });
  }

  private emit(level: LogLevel, message: string, context?: LogContext): void {
    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(redact(this.base) as LogContext),
      ...(context ? (redact(context) as LogContext) : {}),
    };

    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  debug(message: string, context?: LogContext): void {
    this.emit('debug', message, context);
  }
  info(message: string, context?: LogContext): void {
    this.emit('info', message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.emit('warn', message, context);
  }
  error(message: string, context?: LogContext): void {
    this.emit('error', message, context);
  }
}

/** Correlates every log line and the error envelope for one request. */
export function createRequestId(): string {
  return crypto.randomUUID();
}

export function createLogger(functionName: string, requestId: string): Logger {
  return new Logger({ function: functionName, requestId });
}
