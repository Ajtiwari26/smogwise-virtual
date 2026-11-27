/**
 * @google/genai Interactions API transport wrapper with singleton client reuse,
 * active AbortController cancellation, retries disabled, and bounded model fallback.
 */

import { GoogleGenAI } from '@google/genai';
import { isPlainRecord } from '../../src/domain/domainUtils.js';

const PRIMARY_MODEL = 'gemini-3.5-flash-lite';
const FALLBACK_MODEL = 'gemini-4-hydrogen';
const PRIMARY_TIMEOUT_MS = 4500;
const FALLBACK_TIMEOUT_MS = 1800;
const TOTAL_LLM_BUDGET_MS = 5500;
const MIN_FALLBACK_BUDGET_MS = 800;

let cachedClient: { readonly apiKey: string; readonly client: GoogleGenAI } | null = null;

function getGenAiClient(apiKey: string): GoogleGenAI {
  if (cachedClient !== null && cachedClient.apiKey === apiKey) {
    return cachedClient.client;
  }
  const client = new GoogleGenAI({ apiKey });
  cachedClient = { apiKey, client };
  return client;
}

/** Optional structured JSON response format specification for Interactions API. */
export interface InteractionResponseFormat {
  readonly type: 'text';
  readonly mime_type: 'application/json';
  readonly schema: Record<string, unknown>;
}

function extractInteractionText(response: unknown): string | null {
  if (!isPlainRecord(response)) {
    return null;
  }
  const direct = response['output_text'];
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }
  const outputs = response['outputs'];
  if (!Array.isArray(outputs)) {
    return null;
  }
  const parts: string[] = [];
  for (const item of outputs) {
    if (isPlainRecord(item) && typeof item['text'] === 'string') {
      parts.push(item['text']);
    }
  }
  const joined = parts.join('\n').trim();
  return joined.length > 0 ? joined : null;
}

async function callInteractionModel(
  client: GoogleGenAI,
  model: string,
  systemInstruction: string,
  input: string,
  timeoutMs: number,
  responseFormat?: InteractionResponseFormat,
): Promise<string | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  let apiPromise: Promise<string | null>;
  try {
    const rawCall = client.interactions.create(
      {
        model,
        system_instruction: systemInstruction,
        input,
        store: false,
        ...(responseFormat !== undefined ? { response_format: responseFormat } : {}),
      },
      {
        timeout_ms: timeoutMs,
        signal: controller.signal,
        retries: { strategy: 'none' },
      },
    );
    apiPromise = Promise.resolve(rawCall)
      .then((res) => extractInteractionText(res))
      .catch((err: unknown) => {
        void err;
        return null;
      });
  } catch (err: unknown) {
    void err;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    return null;
  }

  try {
    return await Promise.race([apiPromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Queries primary Gemini model with bounded total budget fallback to secondary model.
 */
export async function queryGeminiWithFallback(
  apiKey: string,
  systemInstruction: string,
  input: string,
  responseFormat?: InteractionResponseFormat,
): Promise<string | null> {
  const client = getGenAiClient(apiKey);
  const deadline = Date.now() + TOTAL_LLM_BUDGET_MS;
  const primary = await callInteractionModel(
    client,
    PRIMARY_MODEL,
    systemInstruction,
    input,
    PRIMARY_TIMEOUT_MS,
    responseFormat,
  );
  if (primary !== null) {
    return primary;
  }
  const remaining = deadline - Date.now();
  if (remaining < MIN_FALLBACK_BUDGET_MS) {
    return null;
  }
  const fallbackTimeout = Math.min(FALLBACK_TIMEOUT_MS, remaining);
  return callInteractionModel(
    client,
    FALLBACK_MODEL,
    systemInstruction,
    input,
    fallbackTimeout,
    responseFormat,
  );
}

/** Strips optional Markdown code fences and extracts the outermost JSON object text. */
export function extractJsonPayloadText(raw: string): string {
  const trimmed = raw.trim();
  const fenceStart = trimmed.indexOf('```');
  if (fenceStart !== -1) {
    const firstNewline = trimmed.indexOf('\n', fenceStart);
    const lastFence = trimmed.lastIndexOf('```');
    if (firstNewline !== -1 && lastFence > firstNewline) {
      return trimmed.slice(firstNewline + 1, lastFence).trim();
    }
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }
  return trimmed;
}
