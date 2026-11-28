/** Bounded Gemini Interactions transport with stateless continuation and model fallback. */

import { GoogleGenAI, type AutomaticContinuationOption, type GoogleGenAIInteraction }
  from '@google/genai';
import type { Interactions } from '@google/genai';
import { isPlainRecord } from '../../src/domain/domainUtils.js';
import { logServerEvent } from '../config/logger.js';
import { extractFunctionCalls, type ExecutedToolResult } from './genaiTools.js';
import type { GroundedClaims } from './genaiVerifier.js';

const PRIMARY_MODEL = 'gemini-3.5-flash-lite';
const FALLBACK_MODEL = 'gemini-4-hydrogen';
const PRIMARY_TIMEOUT_MS = 4500;
const FOLLOWUP_TIMEOUT_MS = 1800;
const TOTAL_LLM_BUDGET_MS = 5500;
const MIN_CALL_MS = 800;
const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 4;

let cachedClient: { readonly apiKey: string; readonly client: GoogleGenAI } | undefined;

function getGenAiClient(apiKey: string): GoogleGenAI {
  if (cachedClient?.apiKey === apiKey) return cachedClient.client;
  const client = new GoogleGenAI({ apiKey });
  cachedClient = { apiKey, client };
  return client;
}

/** Structured JSON response format accepted by Interactions. */
export interface InteractionResponseFormat {
  readonly type: 'text';
  readonly mime_type: 'application/json';
  readonly schema: Record<string, unknown>;
}

/** Result metadata for a validated Gemini interaction. */
export interface GeminiInteractionResult {
  readonly text: string;
  readonly modelUsed?: string;
  readonly toolClaims: GroundedClaims;
}

/** Options for structured output, validation and local tool calls. */
export interface GeminiQueryOptions {
  readonly responseFormat?: InteractionResponseFormat;
  readonly tools?: Interactions.Tool[];
  readonly validateResponse?: (rawText: string, toolClaims: GroundedClaims) => boolean;
  readonly executeTools?: (
    calls: ReturnType<typeof extractFunctionCalls>,
  ) => readonly ExecutedToolResult[];
}

type InteractionRequest = Interactions.CreateModelInteractionParamsNonStreaming
  & AutomaticContinuationOption;

type Attempt =
  | { readonly kind: 'response'; readonly response: GoogleGenAIInteraction }
  | { readonly kind: 'retryable' | 'terminal' };

function sdkFailure(err: unknown, model: string): Attempt {
  const rawStatus = isPlainRecord(err) ? err['status'] : undefined;
  const status = typeof rawStatus === 'number' ? rawStatus : undefined;
  const terminal = typeof status === 'number' && [400, 401, 403, 405, 422].includes(status);
  logServerEvent('warn', 'genai_interaction_error', { model, status, terminal });
  return { kind: terminal ? 'terminal' : 'retryable' };
}

function invokeRawInteraction(
  client: GoogleGenAI,
  request: InteractionRequest,
  timeoutMs: number,
): Promise<Attempt> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Attempt>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: 'retryable' });
      controller.abort();
      logServerEvent('warn', 'genai_interaction_timeout', { model: request.model });
    }, timeoutMs);
  });
  const run = async (): Promise<Attempt> => {
    try {
      const response = await client.interactions.create(request, {
        timeout_ms: timeoutMs, signal: controller.signal, retries: { strategy: 'none' },
      });
      return response && 'status' in response ? { kind: 'response', response } : { kind: 'retryable' };
    } catch (err: unknown) {
      return sdkFailure(err, request.model);
    }
  };
  return Promise.race([timeout, run()]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Reads only completed, fault-free Interactions output, using SDK text or model output steps. */
export function extractCompletedInteractionText(response: GoogleGenAIInteraction): string | null {
  if (response.status !== 'completed' || hasInteractionFault(response)) return null;
  const text = response.output_text?.trim();
  if (text) return text;
  const output = response.steps?.filter((step) => step.type === 'model_output').at(-1);
  const joined = output?.content?.flatMap((part) => part.type === 'text' ? [part.text] : [])
    .join('').trim();
  return joined || null;
}

function hasInteractionFault(response: GoogleGenAIInteraction): boolean {
  return (response.errors?.length ?? 0) > 0 ||
    (response.steps ?? []).some((step) => step.type === 'model_output' && step.error !== undefined);
}

interface ModelRun {
  readonly model: string;
  readonly systemInstruction: string;
  readonly prompt: string;
  readonly deadline: number;
  readonly firstTimeout: number;
  readonly budget: { remainingToolCalls: number };
}

interface ToolState {
  input: string | Interactions.Step[];
  readonly executed: Set<string>;
  readonly claims: Map<string, string>;
}

function appendToolResults(
  state: ToolState,
  response: GoogleGenAIInteraction,
  execute: NonNullable<GeminiQueryOptions['executeTools']>,
  budget: ModelRun['budget'],
): boolean {
  const calls = extractFunctionCalls(response.steps ?? []);
  const pending = calls.filter((call) => !state.executed.has(call.id));
  if (pending.length === 0 || pending.length > budget.remainingToolCalls) return false;
  if (new Set(pending.map((call) => call.id)).size !== pending.length) return false;
  const initial: Interactions.Step[] = typeof state.input === 'string'
    ? [{ type: 'user_input', content: [{ type: 'text', text: state.input }] }]
    : state.input;
  budget.remainingToolCalls -= pending.length;
  const results = execute(pending);
  const steps: Interactions.Step[] = results.map((result) => {
    const claimId = `TOOL_${state.executed.size + 1}`;
    state.executed.add(result.callId);
    if (result.claim) state.claims.set(claimId, result.claim);
    const resultText = JSON.stringify({
      claimId: result.claim ? claimId : null, data: result.data,
    });
    return {
      type: 'function_result', call_id: result.callId, name: result.name,
      result: [{ type: 'text', text: resultText }],
      is_error: result.claim === undefined,
    };
  });
  state.input = [...initial, ...(response.steps ?? []), ...steps];
  return true;
}

function interactionRequest(
  run: ModelRun,
  input: ToolState['input'],
  options: GeminiQueryOptions,
): InteractionRequest {
  return {
    model: run.model, system_instruction: run.systemInstruction, input, store: false,
    automatic_continuation: false,
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
  };
}

function completedResult(
  response: GoogleGenAIInteraction,
  claims: GroundedClaims,
  options: GeminiQueryOptions,
): GeminiInteractionResult | null {
  const text = extractCompletedInteractionText(response);
  if (text === null) return null;
  if (options.validateResponse?.(text, claims) === false) {
    logServerEvent('warn', 'genai_output_rejected', { model: response.model });
    return null;
  }
  return { text, toolClaims: claims, ...(response.model ? { modelUsed: response.model } : {}) };
}

function isUsableResponse(response: GoogleGenAIInteraction, model: string): boolean {
  if (response == null) return false;
  const { status } = response;
  const usable = (status === 'requires_action' || status === 'completed')
    && !hasInteractionFault(response);
  if (!usable) logServerEvent('warn', 'genai_interaction_unusable', { model, status });
  return usable;
}

function hasPendingTools(response: GoogleGenAIInteraction, state: ToolState): boolean {
  return (response.steps ?? []).some((step) =>
    step.type === 'function_call' && !state.executed.has(step.id),
  );
}

async function runModel(
  client: GoogleGenAI,
  run: ModelRun,
  options: GeminiQueryOptions,
): Promise<GeminiInteractionResult | 'terminal' | null> {
  const state: ToolState = { input: run.prompt, executed: new Set(), claims: new Map() };
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const remaining = run.deadline - Date.now();
    if (remaining < MIN_CALL_MS) return null;
    const timeout = Math.min(remaining, round === 0 ? run.firstTimeout : FOLLOWUP_TIMEOUT_MS);
    const request = interactionRequest(run, state.input, options);
    const attempt = await invokeRawInteraction(client, request, timeout);
    if (attempt.kind !== 'response') return attempt.kind === 'terminal' ? 'terminal' : null;
    const { response } = attempt;
    if (!isUsableResponse(response, run.model)) return null;
    if (!hasPendingTools(response, state)) return completedResult(response, state.claims, options);
    if (!continueTools(round, state, response, options, run.budget)) return null;
  }
  return null;
}

function continueTools(
  round: number,
  state: ToolState,
  response: GoogleGenAIInteraction,
  options: GeminiQueryOptions,
  budget: ModelRun['budget'],
): boolean {
  return round < MAX_TOOL_ROUNDS && options.executeTools !== undefined &&
    appendToolResults(state, response, options.executeTools, budget);
}

/** Queries Gemini within one deadline, skipping secondary calls after configuration failures. */
export async function queryGeminiWithFallback(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  options: GeminiQueryOptions = {},
): Promise<GeminiInteractionResult | null> {
  const client = getGenAiClient(apiKey);
  const common = {
    systemInstruction, prompt, deadline: Date.now() + TOTAL_LLM_BUDGET_MS,
    budget: { remainingToolCalls: MAX_TOOL_CALLS },
  };
  const primary = await runModel(client, {
    ...common, model: PRIMARY_MODEL, firstTimeout: PRIMARY_TIMEOUT_MS,
  }, options);
  if (primary !== null) return primary === 'terminal' ? null : primary;
  const fallback = await runModel(client, {
    ...common, model: FALLBACK_MODEL, firstTimeout: FOLLOWUP_TIMEOUT_MS,
  }, options);
  return fallback === 'terminal' ? null : fallback;
}

/** Accepts plain JSON or a single Markdown JSON fence enclosing the entire response. */
export function extractJsonPayloadText(raw: string): string {
  const trimmed = raw.trim();
  return /^\x60\x60\x60(?:json)?\s*\n([\s\S]*?)\n\x60\x60\x60$/i.exec(trimmed)?.[1] ?? trimmed;
}
