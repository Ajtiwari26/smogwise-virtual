/**
 * AI Judge (37.50 pts) with live persona probes, cross-model grading,
 * active timeout cancellation, and deterministic offline_cold_rubric fallback.
 */

import { GoogleGenAI } from '@google/genai';
import { buildSnapshot, runPersonaProbes } from './judgeProbes.js';
import {
  averageScores,
  buildColdFallback,
  JUDGE_JSON_SCHEMA,
  mergeDeductions,
  type ParsedJudgePayload,
  parseJudgeJson,
  SYSTEM_RUBRIC,
} from './judgePrompts.js';
import type { AIJudgeResult, AnalyzerResult } from './types.js';
import { extractInteractionText, isPlainRecord } from './utils.js';

const GEMINI_PRIMARY = 'gemini-3.8-flash';
const GEMINI_FALLBACK = 'gemini-3.5-flash-lite';
const OPENAI_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 20_000;

interface JudgeModelOutput {
  readonly model: string;
  readonly data: ParsedJudgePayload;
}

async function callGeminiModel(
  client: GoogleGenAI,
  model: string,
  snapshot: string,
): Promise<ParsedJudgePayload | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const interaction = await client.interactions.create(
      {
        model,
        system_instruction: SYSTEM_RUBRIC,
        input: snapshot,
        store: false,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: JUDGE_JSON_SCHEMA,
        },
      },
      {
        timeout_ms: REQUEST_TIMEOUT_MS,
        signal: controller.signal,
        retries: { strategy: 'none' },
      },
    );
    return parseJudgeJson(extractInteractionText(interaction));
  } catch (err: unknown) {
    void err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runGeminiJudge(apiKey: string, snapshot: string): Promise<JudgeModelOutput | null> {
  const client = new GoogleGenAI({ apiKey });
  for (const model of [GEMINI_PRIMARY, GEMINI_FALLBACK]) {
    const data = await callGeminiModel(client, model, snapshot);
    if (data !== null) {
      return { model, data };
    }
  }
  return null;
}

function extractOpenAiContent(rawJson: unknown): string {
  if (!isPlainRecord(rawJson) || !Array.isArray(rawJson['choices'])) {
    return '';
  }
  const first = rawJson['choices'][0];
  const msg = isPlainRecord(first) ? first['message'] : undefined;
  return isPlainRecord(msg) && typeof msg['content'] === 'string' ? msg['content'] : '';
}

async function runOpenAiJudge(apiKey: string, snapshot: string): Promise<JudgeModelOutput | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_RUBRIC },
          { role: 'user', content: snapshot },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const rawJson: unknown = await res.json();
    const data = parseJudgeJson(extractOpenAiContent(rawJson));
    return data === null ? null : { model: OPENAI_MODEL, data };
  } catch (err: unknown) {
    void err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function collectJudgeOutputs(
  geminiKey: string,
  openAiKey: string,
  snapshot: string,
): Promise<readonly JudgeModelOutput[]> {
  const results: JudgeModelOutput[] = [];
  if (geminiKey.length > 0) {
    const gem = await runGeminiJudge(geminiKey, snapshot);
    if (gem !== null) results.push(gem);
  }
  if (openAiKey.length > 0) {
    const oai = await runOpenAiJudge(openAiKey, snapshot);
    if (oai !== null) results.push(oai);
  }
  return results;
}

/** Runs live cross-model AI evaluation or deterministic cold fallback when no API keys exist. */
export async function runAiJudge(
  rootDir: string,
  deterministicResults: readonly AnalyzerResult[],
): Promise<AIJudgeResult> {
  const transcripts = await runPersonaProbes(rootDir);
  const snapshot = buildSnapshot(rootDir, deterministicResults, transcripts);
  const geminiKey = process.env['GEMINI_API_KEY']?.trim() ?? '';
  const openAiKey = process.env['OPENAI_API_KEY']?.trim() ?? '';
  const results = await collectJudgeOutputs(geminiKey, openAiKey, snapshot);
  if (results.length === 0) {
    const okProbes = transcripts.filter((t) => t.status >= 200 && t.status < 500).length;
    return buildColdFallback(deterministicResults, okProbes);
  }
  const payloads = results.map((r) => r.data);
  return {
    mode: 'live_ai_judge',
    modelsUsed: results.map((r) => r.model),
    scores: averageScores(payloads),
    deductions: mergeDeductions(payloads),
    verdict: payloads.map((p) => p.verdict).join(' | '),
  };
}
