/**
 * LLM-backed personality and emotional state analysis.
 *
 * Uses direct HTTP calls with config.apiKey (same pattern as classifier).
 * Supports Anthropic and OpenAI. Injectable fetchFn for testing.
 */

import type { EmotionEngineState } from "../types.js";
import { DIMENSION_NAMES, BASIC_EMOTION_NAMES, OCEAN_TRAITS } from "../types.js";
import { computePrimaryEmotion, computeOverallIntensity } from "../model/emotion-model.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface PersonalityAnalysisResult {
  summary: string;
  pad: { pleasure: number; arousal: number; dominance: number };
  extensions: { connection: number; curiosity: number; energy: number; trust: number };
  ocean: { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number };
}

export interface EmotionalStateResult {
  summary: string;
  primary: string;
  intensity: number;
  notes: string[];
}

/** Options for the analyzer functions. */
export interface AnalyzerOptions {
  /** API key (Anthropic or OpenAI, depending on model). */
  apiKey?: string;
  /** Base URL override (for OpenAI-compatible endpoints). */
  baseUrl?: string;
  /** Model name for LLM analysis. */
  model?: string;
  /** Force a specific provider: "anthropic" | "openai". Auto-detected from model if omitted. */
  provider?: "anthropic" | "openai";
  /** Timeout in ms. */
  timeoutMs?: number;
  /** Injectable fetch function (for testing). */
  fetchFn?: typeof fetch;
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";

// ---------------------------------------------------------------------------
// Provider Detection
// ---------------------------------------------------------------------------

function detectProvider(model: string): "anthropic" | "openai" {
  const lower = model.toLowerCase();
  if (lower.startsWith("claude") || lower.includes("claude")) {
    return "anthropic";
  }
  return "openai";
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildPersonalityPrompt(state: EmotionEngineState): string {
  const dims = DIMENSION_NAMES.map((n) => `  ${n}: ${state.dimensions[n].toFixed(3)}`).join("\n");
  const baseline = DIMENSION_NAMES.map((n) => `  ${n}: ${state.baseline[n].toFixed(3)}`).join("\n");
  const ocean = OCEAN_TRAITS.map((t) => `  ${t}: ${state.personality[t].toFixed(3)}`).join("\n");

  return `You are an expert psychometrician and psychiatrist with an exhaustive understanding of emotion and personality models (PAD, OCEAN/Big Five, Ekman).

Analyze the following personality and dimensional state profile. Provide a concise expert summary (2-4 sentences) addressed to the reader in second person: "Your personality profile indicates..." Describe what this profile reveals about their personality, emotional tendencies, and behavioral patterns.

Current Dimensions (PAD + Extensions):
${dims}

Personality Baseline:
${baseline}

OCEAN Personality Profile:
${ocean}

Respond with ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "summary": "<your expert analysis paragraph>",
  "pad": { "pleasure": <number>, "arousal": <number>, "dominance": <number> },
  "extensions": { "connection": <number>, "curiosity": <number>, "energy": <number>, "trust": <number> },
  "ocean": { "openness": <number>, "conscientiousness": <number>, "extraversion": <number>, "agreeableness": <number>, "neuroticism": <number> }
}

The numeric values should echo back the current state values.`;
}

function buildEmotionalStatePrompt(state: EmotionEngineState): string {
  const dims = DIMENSION_NAMES.map((n) => `  ${n}: ${state.dimensions[n].toFixed(3)}`).join("\n");
  const emos = BASIC_EMOTION_NAMES.map((n) => `  ${n}: ${state.basicEmotions[n].toFixed(3)}`).join("\n");
  const primary = computePrimaryEmotion(state.basicEmotions);
  const intensity = computeOverallIntensity(state.basicEmotions);
  const recentStimuli = state.recentStimuli.slice(0, 5).map(
    (s) => `  - ${s.label} (intensity ${s.intensity.toFixed(2)}) triggered by: ${s.trigger}`,
  ).join("\n") || "  (none)";

  return `You are an expert psychometrician and psychiatrist with an exhaustive understanding of emotion and personality models (PAD, OCEAN/Big Five, Ekman).

Describe the current emotional state addressed to the reader in second person: "You are in an [xyz] emotional state..." Provide a concise expert summary (2-4 sentences) that a human can read to understand how they are feeling right now and why.

Current Dimensions (PAD + Extensions):
${dims}

Basic Emotions (Ekman):
${emos}

Primary Emotion: ${primary} (overall intensity: ${intensity.toFixed(3)})

Recent Stimuli:
${recentStimuli}

Active Rumination: ${state.rumination.active.length} item(s)

Respond with ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "summary": "<your expert description paragraph>",
  "primary": "${primary}",
  "intensity": ${intensity.toFixed(3)},
  "notes": ["<observation 1>", "<observation 2>", ...]
}`;
}

function buildSystemInstruction(): string {
  return (
    "You are a JSON-only function. Return ONLY valid JSON. " +
    "Do not wrap in markdown fences. Do not include commentary. Do not call tools."
  );
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? (m[1] ?? "").trim() : trimmed;
}

function parseJSON<T>(raw: string): T {
  const cleaned = stripCodeFences(raw);
  return JSON.parse(cleaned) as T;
}

// ---------------------------------------------------------------------------
// Backend: Anthropic Messages API
// ---------------------------------------------------------------------------

async function callLLMViaAnthropic(
  prompt: string,
  apiKey: string,
  model: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<string> {
  const response = await fetchFn(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: buildSystemInstruction(),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic returned ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Empty Anthropic response");
  }

  return textBlock.text;
}

// ---------------------------------------------------------------------------
// Backend: OpenAI Chat Completions API
// ---------------------------------------------------------------------------

function openAISupportsCustomTemperature(model: string): boolean {
  const lower = model.toLowerCase();
  return !lower.includes("gpt-5-mini");
}

async function callLLMViaOpenAI(
  prompt: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: buildSystemInstruction() },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  };
  if (openAISupportsCustomTemperature(model)) {
    body.temperature = 0.2;
  }

  const response = await fetchFn(
    `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI returned ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty OpenAI response");
  }

  return content;
}

// ---------------------------------------------------------------------------
// Main LLM call routing
// ---------------------------------------------------------------------------

async function callLLM(prompt: string, opts: AnalyzerOptions): Promise<string> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  if (!opts.apiKey) {
    throw new Error(
      "LLM analysis requires apiKey. " +
      "Configure apiKey or set ANTHROPIC_API_KEY / OPENAI_API_KEY in the openfeelz plugin config.",
    );
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const provider = opts.provider ?? detectProvider(model);

  if (provider === "anthropic") {
    return callLLMViaAnthropic(
      prompt,
      opts.apiKey,
      model,
      fetchFn,
      timeoutMs,
    );
  }

  return callLLMViaOpenAI(
    prompt,
    opts.apiKey,
    opts.baseUrl ?? "https://api.openai.com/v1",
    model,
    fetchFn,
    timeoutMs,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function analyzePersonalityViaLLM(
  state: EmotionEngineState,
  opts: AnalyzerOptions,
): Promise<PersonalityAnalysisResult> {
  const prompt = buildPersonalityPrompt(state);
  const raw = await callLLM(prompt, opts);
  const result = parseJSON<PersonalityAnalysisResult>(raw);

  if (!result.summary || typeof result.summary !== "string") {
    throw new Error("LLM response missing summary field");
  }

  return result;
}

export async function describeEmotionalStateViaLLM(
  state: EmotionEngineState,
  opts: AnalyzerOptions,
): Promise<EmotionalStateResult> {
  const prompt = buildEmotionalStatePrompt(state);
  const raw = await callLLM(prompt, opts);
  const result = parseJSON<EmotionalStateResult>(raw);

  if (!result.summary || typeof result.summary !== "string") {
    throw new Error("LLM response missing summary field");
  }

  return result;
}
