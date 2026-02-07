/**
 * Unified emotion classifier.
 *
 * Supports three backends:
 *  1. Anthropic Messages API (native) -- for claude-* models
 *  2. OpenAI Chat Completions API -- for gpt-* and other OpenAI-compatible models
 *  3. External HTTP endpoint -- POST with text + role
 *
 * Auto-detects provider from model name: models starting with "claude"
 * route to Anthropic, everything else routes to OpenAI format.
 *
 * Falls back to neutral on any failure (no hard crashes in classification).
 */

import type { ClassificationResult } from "../types.js";

/** Options for the classifyEmotion function. */
export interface ClassifyOptions {
  /** API key (Anthropic or OpenAI, depending on model). */
  apiKey?: string;
  /** Base URL override (for OpenAI-compatible endpoints). */
  baseUrl?: string;
  /** Model name for LLM classification. */
  model?: string;
  /** Force a specific provider: "anthropic" | "openai". Auto-detected from model if omitted. */
  provider?: "anthropic" | "openai";
  /** External classifier URL (if set, bypasses LLM entirely). */
  classifierUrl?: string;
  /** Available emotion labels. */
  emotionLabels: string[];
  /** Minimum confidence to accept a classification. */
  confidenceMin: number;
  /** Timeout in ms. */
  timeoutMs?: number;
  /** Injectable fetch function (for testing). */
  fetchFn?: typeof fetch;
}

const NEUTRAL_RESULT: ClassificationResult = {
  label: "neutral",
  intensity: 0,
  reason: "classification unavailable",
  confidence: 0,
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// ---------------------------------------------------------------------------
// Provider Detection
// ---------------------------------------------------------------------------

/** Determine provider from model name. */
function detectProvider(model: string): "anthropic" | "openai" {
  const lower = model.toLowerCase();
  if (lower.startsWith("claude") || lower.includes("claude")) {
    return "anthropic";
  }
  return "openai";
}

// ---------------------------------------------------------------------------
// Prompt Construction
// ---------------------------------------------------------------------------

/**
 * Build the classification prompt (shared across providers).
 */
export function buildClassifierPrompt(
  text: string,
  role: string,
  labels: string[],
): string {
  return (
    `You are an emotion classifier. Classify the emotion in this ${role} message.\n\n` +
    `Available labels: ${labels.join(", ")}\n\n` +
    `Return ONLY valid JSON with exactly these keys:\n` +
    `- label: one of the available labels\n` +
    `- intensity: number 0-1 (how strong the emotion is)\n` +
    `- reason: short phrase explaining what triggered the emotion\n` +
    `- confidence: number 0-1 (how confident you are in this classification)\n\n` +
    `Message:\n${text}`
  );
}

/**
 * Build the system instruction (used by both providers).
 */
function buildSystemInstruction(): string {
  return (
    "You are an emotion classifier. You return ONLY valid JSON. " +
    "No markdown, no explanation, just a single JSON object."
  );
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a raw LLM response string into a ClassificationResult.
 * Handles JSON wrapped in markdown code blocks.
 */
export function parseClassifierResponse(raw: string): ClassificationResult {
  // Strip markdown code block if present
  let cleaned = raw.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  const parsed = JSON.parse(cleaned);

  if (
    typeof parsed.label !== "string" ||
    typeof parsed.intensity !== "number" ||
    typeof parsed.reason !== "string" ||
    typeof parsed.confidence !== "number"
  ) {
    throw new Error(
      `Invalid classifier response: missing required fields. Got: ${JSON.stringify(parsed)}`,
    );
  }

  return {
    label: parsed.label,
    intensity: parsed.intensity,
    reason: parsed.reason,
    confidence: parsed.confidence,
  };
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/**
 * Normalize and validate a classification result.
 * Falls back to neutral if label is unknown or confidence is too low.
 */
export function coerceClassificationResult(
  result: ClassificationResult,
  labels: string[],
  confidenceMin: number,
): ClassificationResult {
  const normalizedLabel = result.label.trim().toLowerCase();
  const isKnown = labels.includes(normalizedLabel);

  if (!isKnown || result.confidence < confidenceMin) {
    return { ...NEUTRAL_RESULT };
  }

  return {
    label: normalizedLabel,
    intensity: Math.max(0, Math.min(1, result.intensity)),
    reason: result.reason.trim() || "unsure",
    confidence: Math.max(0, Math.min(1, result.confidence)),
  };
}

// ---------------------------------------------------------------------------
// Main Classification
// ---------------------------------------------------------------------------

/**
 * Classify the emotion in a text message.
 *
 * Routes to either an external HTTP endpoint, Anthropic, or OpenAI,
 * depending on config. Falls back to neutral on any failure.
 */
export async function classifyEmotion(
  text: string,
  role: string,
  options: ClassifyOptions,
): Promise<ClassificationResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10000;

  try {
    if (options.classifierUrl) {
      return await classifyViaEndpoint(text, role, options.classifierUrl, fetchFn, timeoutMs, options.emotionLabels, options.confidenceMin);
    }

    if (!options.apiKey) {
      throw new Error(
        "Emotion classifier requires either classifierUrl or apiKey. " +
        "Configure apiKey or set ANTHROPIC_API_KEY / OPENAI_API_KEY in the openfeelz plugin config.",
      );
    }

    const model = options.model ?? "claude-sonnet-4-5-20250514";
    const provider = options.provider ?? detectProvider(model);

    if (provider === "anthropic") {
      return await classifyViaAnthropic(
        text, role, options.apiKey, model, fetchFn, timeoutMs,
        options.emotionLabels, options.confidenceMin,
      );
    }

    return await classifyViaOpenAI(
      text, role, options.apiKey,
      options.baseUrl ?? "https://api.openai.com/v1",
      model, fetchFn, timeoutMs,
      options.emotionLabels, options.confidenceMin,
    );
  } catch (err) {
    // If it's a configuration error (no apiKey), rethrow
    if (err instanceof Error && err.message.includes("requires either")) {
      throw err;
    }
    console.error("[openfeelz] Classification failed:", err);
    return { ...NEUTRAL_RESULT };
  }
}

// ---------------------------------------------------------------------------
// Backend: External HTTP Endpoint
// ---------------------------------------------------------------------------

async function classifyViaEndpoint(
  text: string,
  role: string,
  url: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  labels: string[],
  confidenceMin: number,
): Promise<ClassificationResult> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, role }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Classifier endpoint returned ${response.status}`);
  }

  const raw = (await response.json()) as ClassificationResult;
  return coerceClassificationResult(raw, labels, confidenceMin);
}

// ---------------------------------------------------------------------------
// Backend: Anthropic Messages API (native)
// ---------------------------------------------------------------------------

async function classifyViaAnthropic(
  text: string,
  role: string,
  apiKey: string,
  model: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  labels: string[],
  confidenceMin: number,
): Promise<ClassificationResult> {
  const userPrompt = buildClassifierPrompt(text, role, labels);
  const systemInstruction = buildSystemInstruction();

  const response = await fetchFn(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      system: systemInstruction,
      messages: [
        { role: "user", content: userPrompt },
      ],
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

  const parsed = parseClassifierResponse(textBlock.text);
  return coerceClassificationResult(parsed, labels, confidenceMin);
}

// ---------------------------------------------------------------------------
// Backend: OpenAI Chat Completions API
// ---------------------------------------------------------------------------

async function classifyViaOpenAI(
  text: string,
  role: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  labels: string[],
  confidenceMin: number,
): Promise<ClassificationResult> {
  const prompt = buildClassifierPrompt(text, role, labels);

  const response = await fetchFn(
    `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: buildSystemInstruction() },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(`OpenAI returned ${response.status}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty OpenAI response");
  }

  const parsed = parseClassifierResponse(content);
  return coerceClassificationResult(parsed, labels, confidenceMin);
}
