/**
 * Tests for decay presets (fast vs slow) and getEffectiveDecayRates.
 */

import { describe, it, expect } from "vitest";
import { buildEmptyState } from "../state/state-file.js";
import { DEFAULT_CONFIG } from "../types.js";
import {
  getEffectiveDecayRates,
  DECAY_PRESET_FAST_DIMENSIONS,
  DECAY_PRESET_FAST_EMOTIONS,
} from "./decay-presets.js";

describe("decay-presets", () => {
  const state = buildEmptyState();

  describe("DECAY_PRESET_FAST_*", () => {
    it("fast dimension rates are ~ln(2) for 1h half-life", () => {
      const expectedRate = Math.log(2);
      for (const [, rate] of Object.entries(DECAY_PRESET_FAST_DIMENSIONS)) {
        expect(rate).toBeCloseTo(expectedRate, 5);
      }
    });

    it("fast emotion rates are ~ln(2)", () => {
      const expectedRate = Math.log(2);
      for (const [, rate] of Object.entries(DECAY_PRESET_FAST_EMOTIONS)) {
        expect(rate).toBeCloseTo(expectedRate, 5);
      }
    });
  });

  describe("getEffectiveDecayRates", () => {
    it('returns fast rates when config.decayPreset is "fast"', () => {
      const config = { ...DEFAULT_CONFIG, decayPreset: "fast" as const };
      const { dimensionRates, emotionDecayRates } = getEffectiveDecayRates(
        state,
        config,
      );
      expect(dimensionRates).toEqual(DECAY_PRESET_FAST_DIMENSIONS);
      expect(emotionDecayRates).toEqual(DECAY_PRESET_FAST_EMOTIONS);
    });

    it('returns state rates (with overrides) when config.decayPreset is "slow"', () => {
      const config = { ...DEFAULT_CONFIG, decayPreset: "slow" as const };
      const { dimensionRates, emotionDecayRates } = getEffectiveDecayRates(
        state,
        config,
      );
      expect(dimensionRates).toEqual(state.decayRates);
      expect(emotionDecayRates).toEqual(state.emotionDecayRates);
    });

    it('applies decayRateOverrides when preset is "slow" or "custom"', () => {
      const config = {
        ...DEFAULT_CONFIG,
        decayPreset: "slow" as const,
        decayRateOverrides: { pleasure: 0.9 },
      };
      const { dimensionRates } = getEffectiveDecayRates(state, config);
      expect(dimensionRates.pleasure).toBe(0.9);
      expect(dimensionRates.arousal).toBe(state.decayRates.arousal);
    });

    it('treats "custom" like "slow" (state rates + overrides)', () => {
      const config = {
        ...DEFAULT_CONFIG,
        decayPreset: "custom" as const,
        decayRateOverrides: { curiosity: 0.5 },
      };
      const { dimensionRates } = getEffectiveDecayRates(state, config);
      expect(dimensionRates.curiosity).toBe(0.5);
      expect(dimensionRates.pleasure).toBe(state.decayRates.pleasure);
    });
  });
});
