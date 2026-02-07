/**
 * State Manager: the central orchestrator for OpenFeelz.
 *
 * Coordinates:
 *  - State persistence (read/write via state-file)
 *  - Decay application (time-based)
 *  - Stimulus processing (classify + map + update)
 *  - Rumination lifecycle
 *  - Personality updates (with baseline/rate recalculation)
 *  - User/agent emotion tracking
 */

import crypto from "node:crypto";
import type {
  ClassificationResult,
  DimensionName,
  EmotionEngineConfig,
  EmotionEngineState,
  EmotionStimulus,
} from "../types.js";
import { DIMENSION_NAMES } from "../types.js";
import { clampDimension, createDefaultBasicEmotions } from "../model/emotion-model.js";
import {
  computeBaseline,
  computeDimensionDecayRates,
  computeEmotionDecayRates,
  computeResponseIntensityMultiplier,
  computeRuminationProbability,
} from "../model/personality.js";
import { decayDimensions, decayBasicEmotions } from "../model/decay.js";
import { applyEmotionMapping } from "../model/mapping.js";
import {
  advanceRumination,
  applyRuminationEffects,
  shouldStartRumination,
  startRumination,
} from "../model/rumination.js";
import {
  readStateFile,
  writeStateFile,
  acquireLock,
  releaseLock,
} from "./state-file.js";

/** Scale factor for rumination decay per stage. */
const RUMINATION_DECAY_FACTOR = 0.8;

export class StateManager {
  private readonly statePath: string;
  private readonly config: EmotionEngineConfig;

  constructor(statePath: string, config: EmotionEngineConfig) {
    this.statePath = statePath;
    this.config = config;
  }

  // -----------------------------------------------------------------------
  // State I/O
  // -----------------------------------------------------------------------

  /** Load state from disk (returns empty state if missing/corrupt). */
  async getState(): Promise<EmotionEngineState> {
    return readStateFile(this.statePath);
  }

  /** Save state to disk atomically with file locking. */
  async saveState(state: EmotionEngineState): Promise<void> {
    const lockPath = `${this.statePath}.lock`;
    const locked = await acquireLock(lockPath);
    try {
      state.lastUpdated = new Date().toISOString();
      await writeStateFile(this.statePath, state);
    } finally {
      if (locked) await releaseLock(lockPath);
    }
  }

  // -----------------------------------------------------------------------
  // Decay
  // -----------------------------------------------------------------------

  /**
   * Apply time-based decay to all dimensions and basic emotions.
   * Computes elapsed time since lastUpdated.
   * Returns a new state; does not mutate input.
   */
  applyDecay(state: EmotionEngineState): EmotionEngineState {
    const now = Date.now();
    const lastUpdated = new Date(state.lastUpdated).getTime();
    const elapsedHours = Math.max(0, (now - lastUpdated) / 3_600_000);

    if (elapsedHours <= 0) return { ...state };

    const dimensions = decayDimensions(
      state.dimensions,
      state.baseline,
      state.decayRates,
      elapsedHours,
    );
    const basicEmotions = decayBasicEmotions(
      state.basicEmotions,
      state.emotionDecayRates,
      elapsedHours,
    );

    return {
      ...state,
      dimensions,
      basicEmotions,
      lastUpdated: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Stimulus Processing
  // -----------------------------------------------------------------------

  /**
   * Apply an emotional stimulus: map label to dimension/emotion deltas,
   * record it in history, and optionally trigger rumination.
   * Returns a new state; does not mutate input.
   */
  applyStimulus(
    state: EmotionEngineState,
    label: string,
    intensity: number,
    trigger: string,
  ): EmotionEngineState {
    const multiplier = computeResponseIntensityMultiplier(state.personality);
    const scaledIntensity = Math.min(1, intensity * multiplier);

    // Apply emotion mapping
    const { dimensions, emotions } = applyEmotionMapping(
      state.dimensions,
      state.basicEmotions,
      label,
      scaledIntensity,
    );

    // Create stimulus record
    const stimulus: EmotionStimulus = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      label,
      intensity: scaledIntensity,
      trigger,
      confidence: 1, // direct application, full confidence
      sourceRole: "system",
    };

    // Add to history (cap at maxHistory)
    const recentStimuli = [stimulus, ...state.recentStimuli].slice(
      0,
      this.config.maxHistory,
    );

    // Check rumination
    let rumination = state.rumination;
    if (this.config.ruminationEnabled) {
      const prob = computeRuminationProbability(state.personality);
      if (shouldStartRumination(scaledIntensity, this.config.ruminationThreshold, prob)) {
        rumination = startRumination(rumination, stimulus);
      }
    }

    return {
      ...state,
      dimensions,
      basicEmotions: emotions,
      recentStimuli,
      rumination,
      meta: {
        ...state.meta,
        totalUpdates: state.meta.totalUpdates + 1,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Rumination
  // -----------------------------------------------------------------------

  /**
   * Advance all active ruminations by one stage and apply their effects.
   * Returns a new state; does not mutate input.
   */
  advanceRumination(state: EmotionEngineState): EmotionEngineState {
    if (!this.config.ruminationEnabled || state.rumination.active.length === 0) {
      return state;
    }

    // Apply current rumination effects
    const { dimensions, emotions } = applyRuminationEffects(
      state.rumination,
      state.dimensions,
      state.basicEmotions,
    );

    // Advance stages
    const rumination = advanceRumination(
      state.rumination,
      this.config.ruminationMaxStages,
      RUMINATION_DECAY_FACTOR,
    );

    return {
      ...state,
      dimensions,
      basicEmotions: emotions,
      rumination,
    };
  }

  // -----------------------------------------------------------------------
  // Direct Manipulation
  // -----------------------------------------------------------------------

  /** Set a dimension to an absolute value. */
  setDimension(state: EmotionEngineState, dimension: DimensionName, value: number): EmotionEngineState {
    const dimensions = { ...state.dimensions };
    dimensions[dimension] = clampDimension(dimension, value);
    return { ...state, dimensions, meta: { ...state.meta, totalUpdates: state.meta.totalUpdates + 1 } };
  }

  /** Apply a delta to a dimension. */
  applyDimensionDeltaMethod(state: EmotionEngineState, dimension: DimensionName, delta: number): EmotionEngineState {
    const dimensions = { ...state.dimensions };
    dimensions[dimension] = clampDimension(dimension, dimensions[dimension] + delta);
    return { ...state, dimensions, meta: { ...state.meta, totalUpdates: state.meta.totalUpdates + 1 } };
  }

  /** Set a personality trait and recalculate baseline + decay rates. */
  setPersonalityTrait(
    state: EmotionEngineState,
    trait: keyof typeof state.personality,
    value: number,
  ): EmotionEngineState {
    const personality = { ...state.personality };
    personality[trait] = Math.max(0, Math.min(1, value));

    const baseline = computeBaseline(personality);
    const decayRates = computeDimensionDecayRates(personality);
    const emotionDecayRates = computeEmotionDecayRates(personality);

    return {
      ...state,
      personality,
      baseline,
      decayRates,
      emotionDecayRates,
      meta: { ...state.meta, totalUpdates: state.meta.totalUpdates + 1 },
    };
  }

  /** Reset dimensions to baseline and clear basic emotions. */
  resetToBaseline(
    state: EmotionEngineState,
    dimensions?: DimensionName[],
  ): EmotionEngineState {
    const isFullReset = !dimensions || dimensions.length === 0;
    const newDims = { ...state.dimensions };

    const dimsToReset = isFullReset ? DIMENSION_NAMES : dimensions;
    for (const dim of dimsToReset) {
      newDims[dim] = state.baseline[dim];
    }

    let basicEmotions = state.basicEmotions;
    let rumination = state.rumination;

    if (isFullReset) {
      basicEmotions = createDefaultBasicEmotions();
      rumination = { active: [] };
    }

    return {
      ...state,
      dimensions: newDims,
      basicEmotions,
      rumination,
      meta: { ...state.meta, totalUpdates: state.meta.totalUpdates + 1 },
    };
  }

  // -----------------------------------------------------------------------
  // User / Agent Emotion Tracking
  // -----------------------------------------------------------------------

  /** Record a classified emotion for a user. */
  updateUserEmotion(
    state: EmotionEngineState,
    userKey: string,
    result: ClassificationResult,
  ): EmotionEngineState {
    const users = { ...state.users };
    const bucket = users[userKey] ? { ...users[userKey] } : { history: [] };

    const stimulus: EmotionStimulus = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      label: result.label,
      intensity: result.intensity,
      trigger: result.reason,
      confidence: result.confidence,
      sourceRole: "user",
    };

    bucket.latest = stimulus;
    bucket.history = [stimulus, ...bucket.history].slice(0, this.config.maxHistory);
    users[userKey] = bucket;

    return { ...state, users };
  }

  /** Record a classified emotion for an agent. */
  updateAgentEmotion(
    state: EmotionEngineState,
    agentId: string,
    result: ClassificationResult,
  ): EmotionEngineState {
    const agents = { ...state.agents };
    const bucket = agents[agentId] ? { ...agents[agentId] } : { history: [] };

    const stimulus: EmotionStimulus = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      label: result.label,
      intensity: result.intensity,
      trigger: result.reason,
      confidence: result.confidence,
      sourceRole: "assistant",
    };

    bucket.latest = stimulus;
    bucket.history = [stimulus, ...bucket.history].slice(0, this.config.maxHistory);
    agents[agentId] = bucket;

    return { ...state, agents };
  }
}
