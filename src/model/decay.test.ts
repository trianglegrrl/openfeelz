import { describe, it, expect } from "vitest";
import {
  decayDimensions,
  decayBasicEmotions,
  decayTowardBaseline,
} from "./decay.js";
import { createDefaultDimensionalState, createDefaultBasicEmotions } from "./emotion-model.js";
import { createDefaultPersonality, computeBaseline, computeDimensionDecayRates, computeEmotionDecayRates } from "./personality.js";
import type { DimensionalState, BasicEmotions } from "../types.js";

describe("decay", () => {
  const personality = createDefaultPersonality();
  const baseline = computeBaseline(personality);
  const dimRates = computeDimensionDecayRates(personality);
  const emoRates = computeEmotionDecayRates(personality);

  // -----------------------------------------------------------------------
  // decayTowardBaseline (single value)
  // -----------------------------------------------------------------------

  describe("decayTowardBaseline", () => {
    it("returns baseline when elapsed time is very large", () => {
      const result = decayTowardBaseline(0.9, 0.0, 0.058, 10_000);
      expect(result).toBeCloseTo(0.0, 3);
    });

    it("returns current value when elapsed time is zero", () => {
      const result = decayTowardBaseline(0.9, 0.0, 0.058, 0);
      expect(result).toBe(0.9);
    });

    it("decays positive value toward positive baseline", () => {
      // Value above baseline decays down
      const result = decayTowardBaseline(0.8, 0.2, 0.058, 12);
      expect(result).toBeLessThan(0.8);
      expect(result).toBeGreaterThan(0.2);
    });

    it("decays negative value toward zero baseline", () => {
      const result = decayTowardBaseline(-0.5, 0.0, 0.058, 12);
      expect(result).toBeGreaterThan(-0.5);
      expect(result).toBeLessThan(0);
    });

    it("value at baseline stays at baseline", () => {
      const result = decayTowardBaseline(0.3, 0.3, 0.058, 100);
      expect(result).toBeCloseTo(0.3, 10);
    });

    it("respects half-life: value should be ~halfway after one half-life", () => {
      // rate = ln(2) / halfLife => halfLife = ln(2) / rate
      // For rate 0.058, halfLife ≈ 11.95 hours
      const rate = 0.058;
      const halfLife = Math.log(2) / rate;
      const result = decayTowardBaseline(1.0, 0.0, rate, halfLife);
      expect(result).toBeCloseTo(0.5, 1);
    });

    it("handles negative elapsed hours gracefully (no decay)", () => {
      const result = decayTowardBaseline(0.8, 0.0, 0.058, -5);
      expect(result).toBe(0.8);
    });
  });

  // -----------------------------------------------------------------------
  // decayDimensions
  // -----------------------------------------------------------------------

  describe("decayDimensions", () => {
    it("returns baseline when elapsed time is very large", () => {
      const elevated: DimensionalState = {
        pleasure: 0.9,
        arousal: 0.8,
        dominance: 0.7,
        connection: 0.9,
        curiosity: 0.9,
        energy: 0.9,
        trust: 0.9,
      };
      const result = decayDimensions(elevated, baseline, dimRates, 100_000);
      expect(result.pleasure).toBeCloseTo(baseline.pleasure, 2);
      expect(result.arousal).toBeCloseTo(baseline.arousal, 2);
      expect(result.connection).toBeCloseTo(baseline.connection, 2);
    });

    it("does not mutate original state", () => {
      const state = { ...createDefaultDimensionalState(), pleasure: 0.8 };
      decayDimensions(state, baseline, dimRates, 12);
      expect(state.pleasure).toBe(0.8);
    });

    it("returns same state when elapsed is zero", () => {
      const state = { ...createDefaultDimensionalState(), pleasure: 0.8 };
      const result = decayDimensions(state, baseline, dimRates, 0);
      expect(result.pleasure).toBe(0.8);
    });

    it("partially decays dimensions toward baseline", () => {
      const state: DimensionalState = {
        pleasure: 0.8,
        arousal: -0.5,
        dominance: 0.3,
        connection: 0.9,
        curiosity: 0.2,
        energy: 0.8,
        trust: 0.3,
      };
      const result = decayDimensions(state, baseline, dimRates, 6);
      // Each dimension should be closer to baseline than it started
      expect(Math.abs(result.pleasure - baseline.pleasure)).toBeLessThan(
        Math.abs(state.pleasure - baseline.pleasure),
      );
      expect(Math.abs(result.arousal - baseline.arousal)).toBeLessThan(
        Math.abs(state.arousal - baseline.arousal),
      );
    });
  });

  // -----------------------------------------------------------------------
  // decayBasicEmotions
  // -----------------------------------------------------------------------

  describe("decayBasicEmotions", () => {
    it("returns all zeros when elapsed time is very large", () => {
      const emotions: BasicEmotions = {
        happiness: 0.9,
        sadness: 0.7,
        anger: 0.8,
        fear: 0.6,
        disgust: 0.5,
        surprise: 0.9,
      };
      const result = decayBasicEmotions(emotions, emoRates, 100_000);
      expect(result.happiness).toBeCloseTo(0, 2);
      expect(result.sadness).toBeCloseTo(0, 2);
      expect(result.surprise).toBeCloseTo(0, 2);
    });

    it("surprise decays faster than sadness", () => {
      const emotions: BasicEmotions = {
        happiness: 0,
        sadness: 0.8,
        anger: 0,
        fear: 0,
        disgust: 0,
        surprise: 0.8,
      };
      const result = decayBasicEmotions(emotions, emoRates, 6);
      // Surprise should have decayed more (higher base rate)
      expect(result.surprise).toBeLessThan(result.sadness);
    });

    it("does not mutate original", () => {
      const emotions = { ...createDefaultBasicEmotions(), happiness: 0.8 };
      decayBasicEmotions(emotions, emoRates, 12);
      expect(emotions.happiness).toBe(0.8);
    });

    it("returns same values when elapsed is zero", () => {
      const emotions = { ...createDefaultBasicEmotions(), anger: 0.6 };
      const result = decayBasicEmotions(emotions, emoRates, 0);
      expect(result.anger).toBe(0.6);
    });

    it("emotions never go below zero", () => {
      const emotions: BasicEmotions = {
        happiness: 0.01,
        sadness: 0.01,
        anger: 0.01,
        fear: 0.01,
        disgust: 0.01,
        surprise: 0.01,
      };
      const result = decayBasicEmotions(emotions, emoRates, 1000);
      expect(result.happiness).toBeGreaterThanOrEqual(0);
      expect(result.sadness).toBeGreaterThanOrEqual(0);
    });
  });
});
