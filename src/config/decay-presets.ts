/**
 * Decay presets: AI-fast (~1h half-life) vs human-like (personality-derived).
 * Used when config.decayPreset is "fast" or "slow"; "custom" uses state rates + overrides.
 */

import type {
  DecayRates,
  EmotionDecayRates,
  EmotionEngineConfig,
  EmotionEngineState,
} from "../types.js";
import { DIMENSION_NAMES, BASIC_EMOTION_NAMES } from "../types.js";

/** Half-life of 1 hour => rate = ln(2) ≈ 0.693 per hour. */
const ONE_HOUR_RATE = Math.log(2);

/** Preset identifier for decay speed. */
export type DecayPresetId = "fast" | "slow" | "custom";

/** Dimension decay rates for "fast" preset (~1h half-life for all dimensions). */
export const DECAY_PRESET_FAST_DIMENSIONS: DecayRates = Object.fromEntries(
  DIMENSION_NAMES.map((name) => [name, ONE_HOUR_RATE]),
) as DecayRates;

/** Basic emotion decay rates for "fast" preset (~1h half-life). */
export const DECAY_PRESET_FAST_EMOTIONS: EmotionDecayRates = Object.fromEntries(
  BASIC_EMOTION_NAMES.map((name) => [name, ONE_HOUR_RATE]),
) as EmotionDecayRates;

/**
 * Compute effective decay rates from state, config preset, and overrides.
 * - "fast": use fixed ~1h half-life rates.
 * - "slow" or "custom": use personality-derived rates from state, merged with config overrides.
 */
export function getEffectiveDecayRates(
  state: EmotionEngineState,
  config: EmotionEngineConfig,
): { dimensionRates: DecayRates; emotionDecayRates: EmotionDecayRates } {
  const preset = config.decayPreset ?? "slow";

  if (preset === "fast") {
    return {
      dimensionRates: { ...DECAY_PRESET_FAST_DIMENSIONS },
      emotionDecayRates: { ...DECAY_PRESET_FAST_EMOTIONS },
    };
  }

  // slow or custom: start from state (personality-derived), apply overrides
  const dimensionRates: DecayRates = { ...state.decayRates };
  const overrides = config.decayRateOverrides ?? {};
  for (const name of DIMENSION_NAMES) {
    if (overrides[name] != null) {
      dimensionRates[name] = overrides[name];
    }
  }

  return {
    dimensionRates,
    emotionDecayRates: { ...state.emotionDecayRates },
  };
}
