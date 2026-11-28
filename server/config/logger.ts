/**
 * Minimal redacted structured JSON logger for server runtime diagnostics.
 * Avoids console.* lint violations while keeping production failures observable.
 */

const SENSITIVE_KEY_RE = /pass|secret|token|cookie|auth|key|lat|lon|coord|question|query/i;
const MAX_VALUE_LEN = 120;

type LogLevel = 'warn' | 'error';

/** Structured server diagnostic event emitted on external/unexpected failures. */
export interface DiagnosticEvent {
  readonly ts: string;
  readonly level: LogLevel;
  readonly event: string;
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
}

function sanitizeMeta(
  meta?: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number | boolean>> | undefined {
  if (meta === undefined) {
    return undefined;
  }
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      clean[k] = '[redacted]';
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      clean[k] = v;
    } else if (typeof v === 'string') {
      clean[k] = v.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_VALUE_LEN);
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/**
 * Emits a single-line redacted JSON event to stderr outside automated test runs.
 */
export function logServerEvent(
  level: LogLevel,
  event: string,
  meta?: Readonly<Record<string, unknown>>,
): DiagnosticEvent {
  const safeMeta = sanitizeMeta(meta);
  const record: DiagnosticEvent = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(safeMeta !== undefined ? { meta: safeMeta } : {}),
  };
  const isTestEnv = process.env['NODE_ENV'] === 'test' || process.env['VITEST'] !== undefined;
  if (!isTestEnv) {
    process.stderr.write(`${JSON.stringify(record)}\n`);
  }
  return record;
}
