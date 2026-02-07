/**
 * Migrate emotion-state-1 (v1) state files to OpenFeelz (v2) format.
 *
 * Converts:
 *  - Flat NL labels -> emotion stimuli
 *  - String intensities ("low"/"medium"/"high") -> numeric (0.3/0.6/0.9)
 *  - Adds default personality, dimensions, baseline, decay rates
 */

import type { EmotionBucket, EmotionEngineState, EmotionStimulus } from "../types.js";
import { buildEmptyState } from "../state/state-file.js";
import crypto from "node:crypto";

/** V1 entry shape from emotion-state-1. */
interface V1Entry {
  timestamp: string;
  label: string;
  intensity: string | number;
  reason: string;
  confidence: number;
  source_hash?: string;
  source_role?: string;
}

interface V1Bucket {
  latest?: V1Entry;
  history: V1Entry[];
}

interface V1State {
  version: number;
  users: Record<string, V1Bucket>;
  agents: Record<string, V1Bucket>;
}

const INTENSITY_MAP: Record<string, number> = {
  low: 0.3,
  medium: 0.6,
  high: 0.9,
};

function convertIntensity(intensity: string | number): number {
  if (typeof intensity === "number") return Math.max(0, Math.min(1, intensity));
  return INTENSITY_MAP[intensity.toLowerCase()] ?? 0.5;
}

function convertEntry(entry: V1Entry): EmotionStimulus {
  return {
    id: entry.source_hash ?? crypto.randomUUID(),
    timestamp: entry.timestamp || new Date().toISOString(),
    label: entry.label?.trim().toLowerCase() ?? "neutral",
    intensity: convertIntensity(entry.intensity),
    trigger: entry.reason ?? "migrated from v1",
    confidence: entry.confidence ?? 0.5,
    sourceRole: entry.source_role ?? "unknown",
    sourceHash: entry.source_hash,
  };
}

function convertBucket(v1Bucket: V1Bucket): EmotionBucket {
  const history = (v1Bucket.history ?? []).map(convertEntry);
  const latest = v1Bucket.latest ? convertEntry(v1Bucket.latest) : history[0];
  return { latest, history };
}

/**
 * Migrate a v1 emotion-state JSON to v2 EmotionEngineState.
 * Returns a fresh v2 state with user/agent history preserved.
 */
export function migrateV1State(v1: V1State | null | undefined): EmotionEngineState {
  const v2 = buildEmptyState();

  if (!v1 || typeof v1 !== "object") return v2;

  // Migrate users
  if (v1.users && typeof v1.users === "object") {
    for (const [key, bucket] of Object.entries(v1.users)) {
      if (bucket && typeof bucket === "object") {
        v2.users[key] = convertBucket(bucket);
      }
    }
  }

  // Migrate agents
  if (v1.agents && typeof v1.agents === "object") {
    for (const [key, bucket] of Object.entries(v1.agents)) {
      if (bucket && typeof bucket === "object") {
        v2.agents[key] = convertBucket(bucket);
      }
    }
  }

  return v2;
}
