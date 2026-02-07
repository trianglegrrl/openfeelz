/**
 * Format emotional state for system prompt context injection.
 *
 * Produces an `<emotion_state>` XML block that gets prepended to the
 * agent's system prompt, giving it emotional context.
 *
 * Enhanced from emotion-state-1's buildEmotionBlock with dimensional context.
 */

import type {
  DimensionalState,
  EmotionEngineState,
  EmotionStimulus,
} from "../types.js";
import { DIMENSION_NAMES } from "../types.js";

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------

const INTENSITY_WORDS: Record<string, string> = {
  low: "mildly",
  medium: "moderately",
  high: "strongly",
};

function intensityWord(intensity: number): string {
  if (intensity < 0.33) return "mildly";
  if (intensity < 0.66) return "moderately";
  return "strongly";
}

/**
 * Format an ISO timestamp to a compact human-readable string.
 */
export function formatTimestamp(timestamp: string, timeZone?: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")} ${lookup("hour")}:${lookup("minute")}`;
}

function formatEntry(entry: EmotionStimulus, timeZone?: string): string {
  const ts = formatTimestamp(entry.timestamp, timeZone);
  const word = intensityWord(entry.intensity);
  const reason = entry.trigger.trim().endsWith(".")
    ? entry.trigger.trim()
    : `${entry.trigger.trim()}.`;
  return `${ts}: Felt ${word} ${entry.label} because ${reason}`;
}

// ---------------------------------------------------------------------------
// Dimension Summary
// ---------------------------------------------------------------------------

/**
 * Produce a compact summary of dimensions that deviate significantly
 * from their baseline.
 */
export function formatDimensionSummary(
  dimensions: DimensionalState,
  baseline: DimensionalState,
): string {
  const THRESHOLD = 0.15;
  const deviations: string[] = [];

  for (const name of DIMENSION_NAMES) {
    const delta = dimensions[name] - baseline[name];
    if (Math.abs(delta) >= THRESHOLD) {
      const direction = delta > 0 ? "elevated" : "lowered";
      deviations.push(`${name}: ${direction} (${dimensions[name].toFixed(2)})`);
    }
  }

  return deviations.join(", ");
}

// ---------------------------------------------------------------------------
// Trend Computation
// ---------------------------------------------------------------------------

function computeDominantLabel(
  entries: EmotionStimulus[],
  now: Date,
  halfLifeHours: number,
  windowHours: number,
): string {
  const weights: Record<string, number> = {};
  const nowMs = now.getTime();

  for (const entry of entries) {
    const ts = new Date(entry.timestamp).getTime();
    if (Number.isNaN(ts)) continue;
    const ageHours = (nowMs - ts) / 3_600_000;
    if (ageHours < 0 || ageHours > windowHours) continue;
    const weight = Math.pow(0.5, ageHours / halfLifeHours);
    weights[entry.label] = (weights[entry.label] || 0) + weight;
  }

  let topLabel = "neutral";
  let topWeight = 0;
  for (const [label, weight] of Object.entries(weights)) {
    if (weight > topWeight) {
      topWeight = weight;
      topLabel = label;
    }
  }

  return topWeight > 0 ? topLabel : "neutral";
}

// ---------------------------------------------------------------------------
// Main Block Builder
// ---------------------------------------------------------------------------

export interface FormatOptions {
  maxUserEntries: number;
  maxAgentEntries: number;
  halfLifeHours: number;
  trendWindowHours: number;
  timeZone?: string;
  otherAgents?: Array<{ id: string; latest: EmotionStimulus }>;
}

/**
 * Build the `<emotion_state>` block for system prompt context prepend.
 * Returns an empty string if there's nothing to inject.
 */
export function formatEmotionBlock(
  state: EmotionEngineState,
  userKey: string,
  agentId: string,
  options: FormatOptions,
): string {
  const now = new Date();
  const userBucket = state.users[userKey];
  const agentBucket = state.agents[agentId];
  const userEntries = userBucket?.history?.slice(0, options.maxUserEntries) ?? [];
  const agentEntries = agentBucket?.history?.slice(0, options.maxAgentEntries) ?? [];
  const otherAgents = options.otherAgents ?? [];

  // Check if there's anything to show
  const dimSummary = formatDimensionSummary(state.dimensions, state.baseline);
  if (
    userEntries.length === 0 &&
    agentEntries.length === 0 &&
    otherAgents.length === 0 &&
    !dimSummary
  ) {
    return "";
  }

  const lines: string[] = ["<emotion_state>"];

  // Dimensional context
  if (dimSummary) {
    lines.push("  <dimensions>");
    lines.push(`    ${dimSummary}`);
    lines.push("  </dimensions>");
  }

  // User emotions
  if (userEntries.length > 0) {
    lines.push("  <user>");
    for (const entry of userEntries) {
      lines.push(`    ${formatEntry(entry, options.timeZone)}`);
    }
    const userTrend = computeDominantLabel(
      userBucket?.history ?? [],
      now,
      options.halfLifeHours,
      options.trendWindowHours,
    );
    if (userTrend !== "neutral") {
      lines.push(
        `    Trend (last ${options.trendWindowHours}h): mostly ${userTrend}.`,
      );
    }
    lines.push("  </user>");
  }

  // Agent emotions
  if (agentEntries.length > 0) {
    lines.push("  <agent>");
    for (const entry of agentEntries) {
      lines.push(`    ${formatEntry(entry, options.timeZone)}`);
    }
    const agentTrend = computeDominantLabel(
      agentBucket?.history ?? [],
      now,
      options.halfLifeHours,
      options.trendWindowHours,
    );
    if (agentTrend !== "neutral") {
      lines.push(
        `    Trend (last ${options.trendWindowHours}h): mostly ${agentTrend}.`,
      );
    }
    lines.push("  </agent>");
  }

  // Other agents
  if (otherAgents.length > 0) {
    lines.push("  <others>");
    for (const other of otherAgents) {
      lines.push(
        `    ${other.id} — ${formatEntry(other.latest, options.timeZone)}`,
      );
    }
    lines.push("  </others>");
  }

  lines.push("</emotion_state>");
  return lines.join("\n");
}
