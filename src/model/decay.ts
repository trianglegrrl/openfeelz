/**
 * Time-based exponential decay engine.
 *
 * Each value decays toward a personality-influenced baseline at a
 * personality-influenced rate using the formula:
 *
 *   newValue = baseline + (currentValue - baseline) * exp(-rate * elapsedHours)
 *
 * This gives smooth exponential decay with configurable half-life.
 * Half-life = ln(2) / rate ≈ 0.693 / rate
 */

import type {
  BasicEmotions,
  DecayRates,
  DimensionalState,
  EmotionDecayRates,
} from "../types.js";
import { DIMENSION_NAMES, BASIC_EMOTION_NAMES } from "../types.js";
import { clampDimension, clampEmotion } from "./emotion-model.js";

// ---------------------------------------------------------------------------
// Single-value decay
// ---------------------------------------------------------------------------

/**
 * Decay a single value toward a baseline.
 *
 * @param current - Current value
 * @param baseline - Target resting value
 * @param rate - Decay rate (per hour)
 * @param elapsedHours - Time elapsed since last decay
 * @returns Decayed value
 */
export function decayTowardBaseline(
  current: number,
  baseline: number,
  rate: number,
  elapsedHours: number,
): number {
  if (elapsedHours <= 0) return current;
  return baseline + (current - baseline) * Math.exp(-rate * elapsedHours);
}

// ---------------------------------------------------------------------------
// Dimensional decay
// ---------------------------------------------------------------------------

/**
 * Decay all dimensions toward their baselines.
 * Returns a new object; does not mutate the input.
 */
export function decayDimensions(
  state: DimensionalState,
  baseline: DimensionalState,
  rates: DecayRates,
  elapsedHours: number,
): DimensionalState {
  const result = { ...state };
  for (const name of DIMENSION_NAMES) {
    result[name] = clampDimension(
      name,
      decayTowardBaseline(state[name], baseline[name], rates[name], elapsedHours),
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Basic emotion decay
// ---------------------------------------------------------------------------

/**
 * Decay all basic emotions toward zero (their natural resting state).
 * Returns a new object; does not mutate the input.
 */
export function decayBasicEmotions(
  emotions: BasicEmotions,
  rates: EmotionDecayRates,
  elapsedHours: number,
): BasicEmotions {
  const result = { ...emotions };
  for (const name of BASIC_EMOTION_NAMES) {
    result[name] = clampEmotion(
      decayTowardBaseline(emotions[name], 0, rates[name], elapsedHours),
    );
  }
  return result;
}
