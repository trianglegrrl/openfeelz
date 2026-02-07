/**
 * Emotion label to dimension/emotion delta mapping.
 *
 * Maps discrete emotion labels (from classification) to continuous
 * dimensional changes (PAD + extensions) and basic emotion changes.
 *
 * Merged from:
 *  - amygdala-memory update-state.sh emotion mappings
 *  - ros_emotion emotional_state_manager.py patterns
 */

import type {
  BasicEmotionName,
  BasicEmotions,
  DimensionName,
  DimensionalState,
  EmotionDimensionDelta,
} from "../types.js";
import { clampDimension, clampEmotion } from "./emotion-model.js";

// ---------------------------------------------------------------------------
// Mapping Table
// ---------------------------------------------------------------------------

/**
 * Master mapping table: canonical label -> dimension/emotion deltas.
 * All delta values assume intensity = 1.0; they are scaled by actual intensity.
 */
export const ALL_EMOTION_MAPPINGS: Record<string, EmotionDimensionDelta> = {
  // --- Positive emotions ---
  happy: {
    dimensions: { pleasure: 0.2, arousal: 0.1, energy: 0.05 },
    emotions: { happiness: 0.3 },
  },
  excited: {
    dimensions: { pleasure: 0.15, arousal: 0.25, energy: 0.1 },
    emotions: { happiness: 0.2, surprise: 0.1 },
  },
  calm: {
    dimensions: { pleasure: 0.1, arousal: -0.15, energy: 0.05 },
    emotions: { happiness: 0.05 },
  },
  relieved: {
    dimensions: { pleasure: 0.15, arousal: -0.1, energy: 0.05 },
    emotions: { happiness: 0.1 },
  },
  optimistic: {
    dimensions: { pleasure: 0.15, arousal: 0.05, energy: 0.1 },
    emotions: { happiness: 0.15 },
  },
  energized: {
    dimensions: { pleasure: 0.1, arousal: 0.15, energy: 0.25 },
    emotions: { happiness: 0.1 },
  },

  // --- Negative emotions ---
  sad: {
    dimensions: { pleasure: -0.2, arousal: -0.15, energy: -0.1 },
    emotions: { sadness: 0.3 },
  },
  angry: {
    dimensions: { pleasure: -0.15, arousal: 0.25, dominance: 0.1, trust: -0.05 },
    emotions: { anger: 0.3 },
  },
  frustrated: {
    dimensions: { pleasure: -0.1, arousal: 0.15, dominance: -0.05, energy: -0.05 },
    emotions: { anger: 0.2 },
  },
  fearful: {
    dimensions: { pleasure: -0.15, arousal: 0.2, dominance: -0.15 },
    emotions: { fear: 0.3 },
  },
  anxious: {
    dimensions: { pleasure: -0.1, arousal: 0.15, dominance: -0.1, energy: -0.05 },
    emotions: { fear: 0.2 },
  },
  disgusted: {
    dimensions: { pleasure: -0.2, arousal: 0.1 },
    emotions: { disgust: 0.3 },
  },

  // --- Cognitive emotions ---
  curious: {
    dimensions: { curiosity: 0.2, arousal: 0.1, pleasure: 0.05 },
    emotions: { surprise: 0.05 },
  },
  confused: {
    dimensions: { curiosity: 0.1, arousal: 0.1, dominance: -0.1 },
    emotions: { surprise: 0.1 },
  },
  focused: {
    dimensions: { curiosity: 0.1, arousal: 0.05, energy: 0.05, dominance: 0.05 },
    emotions: {},
  },
  surprised: {
    dimensions: { arousal: 0.2, curiosity: 0.1 },
    emotions: { surprise: 0.3 },
  },

  // --- Social emotions ---
  connected: {
    dimensions: { connection: 0.2, pleasure: 0.1, trust: 0.1 },
    emotions: { happiness: 0.1 },
  },
  trusting: {
    dimensions: { trust: 0.15, connection: 0.1, pleasure: 0.05 },
    emotions: { happiness: 0.05 },
  },
  lonely: {
    dimensions: { connection: -0.2, pleasure: -0.1 },
    emotions: { sadness: 0.15 },
  },

  // --- Resource emotions ---
  fatigued: {
    dimensions: { energy: -0.25, arousal: -0.1, pleasure: -0.05 },
    emotions: { sadness: 0.05 },
  },

  // --- Neutral ---
  neutral: {
    dimensions: {},
    emotions: {},
  },
};

/**
 * Aliases: common labels that map to a canonical entry.
 */
const LABEL_ALIASES: Record<string, string> = {
  joy: "happy",
  happiness: "happy",
  contentment: "calm",
  content: "calm",
  peaceful: "calm",
  peace: "calm",
  anger: "angry",
  rage: "angry",
  irritated: "frustrated",
  irritation: "frustrated",
  sadness: "sad",
  sorrow: "sad",
  disappointment: "sad",
  disappointed: "sad",
  fear: "fearful",
  scared: "fearful",
  terrified: "fearful",
  anxiety: "anxious",
  worried: "anxious",
  worry: "anxious",
  disgust: "disgusted",
  revulsion: "disgusted",
  surprise: "surprised",
  shocked: "surprised",
  astonished: "surprised",
  curiosity: "curious",
  interest: "curious",
  interested: "curious",
  fascinated: "curious",
  confusion: "confused",
  bewildered: "confused",
  connection: "connected",
  warmth: "connected",
  warm: "connected",
  bonded: "connected",
  trust: "trusting",
  loneliness: "lonely",
  isolated: "lonely",
  fatigue: "fatigued",
  tired: "fatigued",
  exhausted: "fatigued",
  depleted: "fatigued",
  excitement: "excited",
  thrilled: "excited",
  relief: "relieved",
  optimism: "optimistic",
  hopeful: "optimistic",
  hope: "optimistic",
  energy: "energized",
  energetic: "energized",
  vigorous: "energized",
  focus: "focused",
  concentrated: "focused",
  attentive: "focused",
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Get the dimension/emotion delta mapping for a given emotion label.
 * Handles aliases and is case-insensitive.
 * Returns undefined for unknown labels.
 */
export function getEmotionMapping(label: string): EmotionDimensionDelta | undefined {
  const normalized = label.trim().toLowerCase();
  const canonical = LABEL_ALIASES[normalized] ?? normalized;
  return ALL_EMOTION_MAPPINGS[canonical];
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/**
 * Apply an emotion mapping to current dimensions and basic emotions,
 * scaled by intensity.
 *
 * Returns new objects; does not mutate inputs.
 */
export function applyEmotionMapping(
  dimensions: DimensionalState,
  emotions: BasicEmotions,
  label: string,
  intensity: number,
): { dimensions: DimensionalState; emotions: BasicEmotions } {
  const mapping = getEmotionMapping(label);
  if (!mapping) {
    return { dimensions: { ...dimensions }, emotions: { ...emotions } };
  }

  const newDims = { ...dimensions };
  for (const [dim, delta] of Object.entries(mapping.dimensions)) {
    if (delta != null) {
      const name = dim as DimensionName;
      newDims[name] = clampDimension(name, newDims[name] + delta * intensity);
    }
  }

  const newEmos = { ...emotions };
  for (const [emo, delta] of Object.entries(mapping.emotions)) {
    if (delta != null) {
      const name = emo as BasicEmotionName;
      newEmos[name] = clampEmotion(newEmos[name] + delta * intensity);
    }
  }

  return { dimensions: newDims, emotions: newEmos };
}
