/**
 * OCEAN (Big Five) personality model.
 *
 * Computes personality-influenced:
 *  - Dimension baselines (resting state)
 *  - Dimension decay rates
 *  - Basic emotion decay rates
 *  - Rumination probability
 *  - Response intensity multiplier
 *
 * Ported from ros_emotion/hybrid_personality_model.py.
 */

import type {
  BasicEmotionName,
  DecayRates,
  DimensionName,
  DimensionalState,
  EmotionDecayRates,
  OCEANProfile,
} from "../types.js";
import { DIMENSION_NAMES } from "../types.js";
import { clampDimension } from "./emotion-model.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a default (neutral) personality with all traits at 0.5. */
export function createDefaultPersonality(): OCEANProfile {
  return {
    openness: 0.5,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    neuroticism: 0.5,
  };
}

// ---------------------------------------------------------------------------
// Influence Matrices
//
// Each matrix maps trait deviations (trait - 0.5) to dimension/emotion effects.
// The magnitude of the effect is proportional to how far the trait deviates
// from the neutral midpoint (0.5).
// ---------------------------------------------------------------------------

/**
 * How each OCEAN trait influences dimension baselines.
 * Key: trait -> dimension -> influence weight.
 * Effect = weight * (traitValue - 0.5)
 */
const TRAIT_BASELINE_INFLUENCE: Record<string, Partial<Record<DimensionName, number>>> = {
  openness: { curiosity: 0.3, dominance: 0.1 },
  conscientiousness: { energy: 0.2, dominance: 0.15 },
  extraversion: { pleasure: 0.25, arousal: 0.2, connection: 0.15 },
  agreeableness: { connection: 0.25, trust: 0.2, pleasure: 0.1 },
  neuroticism: { pleasure: -0.25, arousal: 0.15, energy: -0.1 },
};

/**
 * How each OCEAN trait modulates dimension decay rates.
 * Values > 1 speed up decay; values < 1 slow it down.
 * The actual multiplier is: 1 + weight * (traitValue - 0.5)
 */
const TRAIT_DIMENSION_DECAY_INFLUENCE: Record<string, Partial<Record<DimensionName, number>>> = {
  openness: { curiosity: -0.3 }, // High openness -> slower curiosity decay
  conscientiousness: { energy: 0.2 }, // High conscientiousness -> faster energy recovery
  extraversion: { arousal: 0.3, pleasure: 0.2 }, // Extraverts recover faster
  agreeableness: { connection: -0.2 }, // Agreeable -> slower connection decay
  neuroticism: { pleasure: -0.4, arousal: -0.2 }, // Neurotic -> slower negative recovery
};

/**
 * How each OCEAN trait modulates basic emotion decay rates.
 * Same convention: multiplier = 1 + weight * (traitValue - 0.5)
 */
const TRAIT_EMOTION_DECAY_INFLUENCE: Record<string, Partial<Record<BasicEmotionName, number>>> = {
  extraversion: { sadness: 0.4, happiness: -0.2 }, // Extraverts: fast sadness decay, slow happiness decay
  neuroticism: { sadness: -0.4, anger: -0.3, fear: -0.3, disgust: -0.2 }, // Neurotic: negative emotions linger
  agreeableness: { anger: 0.3 }, // Agreeable: anger fades faster
  openness: { surprise: -0.3, happiness: -0.1 }, // Open: surprise/happiness linger
};

/** Base decay rates for dimensions (per hour). */
const BASE_DIMENSION_DECAY_RATES: Record<DimensionName, number> = {
  pleasure: 0.058, // ~12h half-life
  arousal: 0.087, // ~8h half-life
  dominance: 0.046, // ~15h half-life
  connection: 0.035, // ~20h half-life
  curiosity: 0.058, // ~12h half-life
  energy: 0.046, // ~15h half-life
  trust: 0.035, // ~20h half-life
};

/** Base decay rates for basic emotions (per hour). */
const BASE_EMOTION_DECAY_RATES: Record<BasicEmotionName, number> = {
  happiness: 0.058, // ~12h half-life
  sadness: 0.046, // ~15h half-life (lingers)
  anger: 0.058, // ~12h half-life
  fear: 0.058, // ~12h half-life
  disgust: 0.046, // ~15h half-life
  surprise: 0.139, // ~5h half-life (fades fast)
};

// ---------------------------------------------------------------------------
// Baseline Computation
// ---------------------------------------------------------------------------

/**
 * Compute personality-influenced dimension baselines.
 *
 * Starts from neutral (PAD=0, extensions=0.5) and applies trait influences.
 */
export function computeBaseline(personality: OCEANProfile): DimensionalState {
  const baseline: DimensionalState = {
    pleasure: 0,
    arousal: 0,
    dominance: 0,
    connection: 0.5,
    curiosity: 0.5,
    energy: 0.5,
    trust: 0.5,
  };

  for (const [trait, influences] of Object.entries(TRAIT_BASELINE_INFLUENCE)) {
    const deviation = (personality[trait as keyof OCEANProfile] ?? 0.5) - 0.5;
    for (const [dim, weight] of Object.entries(influences)) {
      baseline[dim as DimensionName] += weight! * deviation;
    }
  }

  // Clamp to valid ranges
  for (const name of DIMENSION_NAMES) {
    baseline[name] = clampDimension(name, baseline[name]);
  }

  return baseline;
}

// ---------------------------------------------------------------------------
// Decay Rate Computation
// ---------------------------------------------------------------------------

/**
 * Compute personality-influenced dimension decay rates.
 *
 * Applies trait modulation multipliers to base rates.
 */
export function computeDimensionDecayRates(personality: OCEANProfile): DecayRates {
  const rates = { ...BASE_DIMENSION_DECAY_RATES };

  for (const [trait, influences] of Object.entries(TRAIT_DIMENSION_DECAY_INFLUENCE)) {
    const deviation = (personality[trait as keyof OCEANProfile] ?? 0.5) - 0.5;
    for (const [dim, weight] of Object.entries(influences)) {
      const multiplier = 1 + weight! * deviation;
      rates[dim as DimensionName] *= Math.max(0.1, multiplier); // Floor at 10% of base rate
    }
  }

  return rates;
}

/**
 * Compute personality-influenced basic emotion decay rates.
 */
export function computeEmotionDecayRates(personality: OCEANProfile): EmotionDecayRates {
  const rates = { ...BASE_EMOTION_DECAY_RATES };

  for (const [trait, influences] of Object.entries(TRAIT_EMOTION_DECAY_INFLUENCE)) {
    const deviation = (personality[trait as keyof OCEANProfile] ?? 0.5) - 0.5;
    for (const [emotion, weight] of Object.entries(influences)) {
      const multiplier = 1 + weight! * deviation;
      rates[emotion as BasicEmotionName] *= Math.max(0.1, multiplier);
    }
  }

  return rates;
}

// ---------------------------------------------------------------------------
// Rumination Probability
// ---------------------------------------------------------------------------

/**
 * Compute the probability that an intense emotion triggers rumination.
 *
 * High neuroticism and high openness increase rumination likelihood.
 * High conscientiousness decreases it (better self-regulation).
 */
export function computeRuminationProbability(personality: OCEANProfile): number {
  const base = 0.5;
  const neuroticismEffect = (personality.neuroticism - 0.5) * 0.6;
  const opennessEffect = (personality.openness - 0.5) * 0.2;
  const conscientiousnessEffect = (personality.conscientiousness - 0.5) * -0.3;

  return Math.max(0, Math.min(1, base + neuroticismEffect + opennessEffect + conscientiousnessEffect));
}

// ---------------------------------------------------------------------------
// Response Intensity Multiplier
// ---------------------------------------------------------------------------

/**
 * Compute how personality scales the intensity of emotional responses.
 *
 * High neuroticism amplifies responses.
 * High agreeableness dampens them slightly (emotional regulation).
 */
export function computeResponseIntensityMultiplier(personality: OCEANProfile): number {
  const base = 1.0;
  const neuroticismEffect = (personality.neuroticism - 0.5) * 0.4;
  const agreeablenessEffect = (personality.agreeableness - 0.5) * -0.2;

  return Math.max(0.5, Math.min(2.0, base + neuroticismEffect + agreeablenessEffect));
}
