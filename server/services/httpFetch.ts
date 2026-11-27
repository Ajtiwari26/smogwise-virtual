/**
 * Bounded HTTP JSON fetch helper with timeout AbortController, Content-Type validation,
 * and streamed byte-limit protection against oversized upstream responses.
 */

const DEFAULT_MAX_JSON_BYTES = 256 * 1024;

function isJsonContentType(response: Response): boolean {
  const rawType = response.headers.get('content-type');
  if (rawType === null || rawType.trim().length === 0) {
    return true;
  }
  const normalized = rawType.toLowerCase();
  return normalized.includes('application/json') || normalized.includes('+json');
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

/**
 * Fetches a JSON endpoint with timeout cancellation, JSON Content-Type guard,
 * and a 256 KB default body size limit. Returns null on any failure or bound violation.
 */
export async function fetchBoundedJson(
  url: string,
  timeoutMs: number,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || !isJsonContentType(response) || exceedsContentLength(response, maxBytes)) {
      await response.body?.cancel();
      return null;
    }
    const text = await readBoundedText(response, maxBytes);
    if (text === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (err: unknown) {
    void err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}
