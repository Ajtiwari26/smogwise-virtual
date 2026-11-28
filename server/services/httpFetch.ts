/**
 * Bounded HTTP JSON fetch helper with timeout AbortController, Content-Type validation,
 * classified failures, redacted logging, and streamed byte-limit protection.
 */

import { logServerEvent } from '../config/logger.js';

const DEFAULT_MAX_JSON_BYTES = 256 * 1024;

/** Classified failure categories returned by fetchBoundedJsonDetailed. */
export type FetchFailureReason =
  | 'timeout'
  | 'aborted'
  | 'http_status'
  | 'content_type'
  | 'oversized'
  | 'invalid_json'
  | 'network';

/** Outcome union distinguishing valid JSON payloads from classified transport/parse failures. */
export type FetchJsonResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly reason: FetchFailureReason; readonly status?: number };

function isJsonContentType(response: Response): boolean {
  const rawType = response.headers.get('content-type');
  if (rawType === null || rawType.trim().length === 0) {
    return true;
  }
  const mime = rawType.split(';')[0]?.trim().toLowerCase();
  return mime === 'application/json' || /^application\/[\w.+-]+\+json$/.test(mime ?? '');
}

function exceedsContentLength(response: Response, maxBytes: number): boolean {
  const rawLen = response.headers.get('content-length');
  if (rawLen === null) {
    return false;
  }
  const parsed = Number.parseInt(rawLen, 10);
  return Number.isFinite(parsed) && parsed > maxBytes;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  if (response.body === null) {
    const text = await response.text();
    return Buffer.byteLength(text, 'utf8') <= maxBytes ? text : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function safeHostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch (err: unknown) {
    void err;
    return 'invalid-url';
  }
}

function classifyCatchReason(err: unknown, timedOut: boolean): FetchFailureReason {
  if (timedOut) {
    return 'timeout';
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return 'aborted';
  }
  return 'network';
}

function failFetch(
  host: string,
  reason: FetchFailureReason,
  status?: number,
): FetchJsonResult {
  logServerEvent('warn', 'upstream_fetch_failed', {
    host,
    reason,
    ...(status !== undefined ? { status } : {}),
  });
  return status !== undefined ? { ok: false, reason, status } : { ok: false, reason };
}

async function parseResponsePayload(
  response: Response,
  maxBytes: number,
  host: string,
): Promise<FetchJsonResult> {
  if (!response.ok) {
    await response.body?.cancel();
    return failFetch(host, 'http_status', response.status);
  }
  if (!isJsonContentType(response)) {
    await response.body?.cancel();
    return failFetch(host, 'content_type');
  }
  if (exceedsContentLength(response, maxBytes)) {
    await response.body?.cancel();
    return failFetch(host, 'oversized');
  }
  const text = await readBoundedText(response, maxBytes);
  if (text === null) {
    return failFetch(host, 'oversized');
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return { ok: true, data: parsed };
  } catch (err: unknown) {
    void err;
    return failFetch(host, 'invalid_json');
  }
}

/** Fetches bounded JSON with a shared deadline and optional caller cancellation. */
export async function fetchBoundedJsonDetailed(
  url: string,
  timeoutMs: number,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
  callerSignal?: AbortSignal,
): Promise<FetchJsonResult> {
  const host = safeHostFromUrl(url);
  const controller = new AbortController();
  const signal = callerSignal === undefined
    ? controller.signal : AbortSignal.any([callerSignal, controller.signal]);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchWithRetry(url, { signal, maxBytes, host });
  } catch (err: unknown) {
    const reason = classifyCatchReason(err, controller.signal.aborted);
    return failFetch(host, reason);
  } finally {
    clearTimeout(timer);
  }
}

interface FetchContext {
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly host: string;
}

async function fetchWithRetry(url: string, context: FetchContext): Promise<FetchJsonResult> {
  const { host, signal, maxBytes } = context;
  const request = () => fetch(url, {
    method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal,
  });
  const response = await request();
  if ([502, 503, 504].includes(response.status)) {
    await response.body?.cancel();
    return parseResponsePayload(await request(), maxBytes, host);
  }
  return parseResponsePayload(response, maxBytes, host);
}

/**
 * Fetches a JSON endpoint with timeout cancellation, JSON Content-Type guard,
 * and a 256 KB default body size limit. Returns null on any failure or bound violation.
 */
export async function fetchBoundedJson(
  url: string,
  timeoutMs: number,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<unknown | null> {
  const outcome = await fetchBoundedJsonDetailed(url, timeoutMs, maxBytes);
  return outcome.ok ? outcome.data : null;
}
