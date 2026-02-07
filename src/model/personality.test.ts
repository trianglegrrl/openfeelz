import { describe, it, expect } from "vitest";
import {
  createDefaultPersonality,
  computeBaseline,
  computeDimensionDecayRates,
  computeEmotionDecayRates,
  computeRuminationProbability,
  computeResponseIntensityMultiplier,
} from "./personality.js";
import type { OCEANProfile } from "../types.js";

describe("personality", () => {
  // -----------------------------------------------------------------------
  // Defaults
  // -----------------------------------------------------------------------

  describe("createDefaultPersonality", () => {
    it("returns all traits at 0.5", () => {
      const p = createDefaultPersonality();
      expect(p.openness).toBe(0.5);
      expect(p.conscientiousness).toBe(0.5);
      expect(p.extraversion).toBe(0.5);
      expect(p.agreeableness).toBe(0.5);
      expect(p.neuroticism).toBe(0.5);
    });
  });

  // -----------------------------------------------------------------------
  // Baseline Computation
  // -----------------------------------------------------------------------

  describe("computeBaseline", () => {
    it("returns neutral baselines for default personality", () => {
      const p = createDefaultPersonality();
      const baseline = computeBaseline(p);
      // Default personality should produce baseline close to default state
      expect(baseline.pleasure).toBeCloseTo(0, 1);
      expect(baseline.arousal).toBeCloseTo(0, 1);
      expect(baseline.dominance).toBeCloseTo(0, 1);
      expect(baseline.connection).toBeCloseTo(0.5, 1);
      expect(baseline.curiosity).toBeCloseTo(0.5, 1);
      expect(baseline.energy).toBeCloseTo(0.5, 1);
      expect(baseline.trust).toBeCloseTo(0.5, 1);
    });

    it("high extraversion raises pleasure and arousal baselines", () => {
      const p: OCEANProfile = {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.9,
        agreeableness: 0.5,
        neuroticism: 0.5,
      };
      const baseline = computeBaseline(p);
      const defaultBaseline = computeBaseline(createDefaultPersonality());
      expect(baseline.pleasure).toBeGreaterThan(defaultBaseline.pleasure);
      expect(baseline.arousal).toBeGreaterThan(defaultBaseline.arousal);
    });

    it("high agreeableness raises connection and trust baselines", () => {
      const p: OCEANProfile = {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.9,
        neuroticism: 0.5,
      };
      const baseline = computeBaseline(p);
      const defaultBaseline = computeBaseline(createDefaultPersonality());
      expect(baseline.connection).toBeGreaterThan(defaultBaseline.connection);
      expect(baseline.trust).toBeGreaterThan(defaultBaseline.trust);
    });

    it("high openness raises curiosity baseline", () => {
      const p: OCEANProfile = {
        openness: 0.9,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.5,
        neuroticism: 0.5,
      };
      const baseline = computeBaseline(p);
      const defaultBaseline = computeBaseline(createDefaultPersonality());
      expect(baseline.curiosity).toBeGreaterThan(defaultBaseline.curiosity);
    });

    it("high neuroticism lowers pleasure baseline", () => {
      const p: OCEANProfile = {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.5,
        neuroticism: 0.9,
      };
      const baseline = computeBaseline(p);
      const defaultBaseline = computeBaseline(createDefaultPersonality());
      expect(baseline.pleasure).toBeLessThan(defaultBaseline.pleasure);
    });

    it("baselines are clamped to valid ranges", () => {
      const extreme: OCEANProfile = {
        openness: 1,
        conscientiousness: 1,
        extraversion: 1,
        agreeableness: 1,
        neuroticism: 0,
      };
      const baseline = computeBaseline(extreme);
      expect(baseline.pleasure).toBeLessThanOrEqual(1);
      expect(baseline.pleasure).toBeGreaterThanOrEqual(-1);
      expect(baseline.connection).toBeLessThanOrEqual(1);
      expect(baseline.connection).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Decay Rate Computation
  // -----------------------------------------------------------------------

  describe("computeDimensionDecayRates", () => {
    it("returns positive rates for all dimensions", () => {
      const rates = computeDimensionDecayRates(createDefaultPersonality());
      expect(rates.pleasure).toBeGreaterThan(0);
      expect(rates.arousal).toBeGreaterThan(0);
      expect(rates.dominance).toBeGreaterThan(0);
      expect(rates.connection).toBeGreaterThan(0);
      expect(rates.curiosity).toBeGreaterThan(0);
      expect(rates.energy).toBeGreaterThan(0);
      expect(rates.trust).toBeGreaterThan(0);
    });

    it("high neuroticism slows pleasure decay rate", () => {
      const neurotic: OCEANProfile = { ...createDefaultPersonality(), neuroticism: 0.9 };
      const stable: OCEANProfile = { ...createDefaultPersonality(), neuroticism: 0.1 };
      const neuroticRates = computeDimensionDecayRates(neurotic);
      const stableRates = computeDimensionDecayRates(stable);
      // Neurotic: negative emotions linger -> slower pleasure decay
      expect(neuroticRates.pleasure).toBeLessThan(stableRates.pleasure);
    });

    it("high extraversion speeds sadness-related dimension decay", () => {
      const extraverted: OCEANProfile = { ...createDefaultPersonality(), extraversion: 0.9 };
      const introverted: OCEANProfile = { ...createDefaultPersonality(), extraversion: 0.1 };
      const extravertedRates = computeDimensionDecayRates(extraverted);
      const introvertedRates = computeDimensionDecayRates(introverted);
      // Extraverts bounce back faster from low arousal
      expect(extravertedRates.arousal).toBeGreaterThan(introvertedRates.arousal);
    });
  });

  describe("computeEmotionDecayRates", () => {
    it("returns positive rates for all emotions", () => {
      const rates = computeEmotionDecayRates(createDefaultPersonality());
      expect(rates.happiness).toBeGreaterThan(0);
      expect(rates.sadness).toBeGreaterThan(0);
      expect(rates.anger).toBeGreaterThan(0);
      expect(rates.fear).toBeGreaterThan(0);
      expect(rates.disgust).toBeGreaterThan(0);
      expect(rates.surprise).toBeGreaterThan(0);
    });

    it("surprise decays fastest by default", () => {
      const rates = computeEmotionDecayRates(createDefaultPersonality());
      expect(rates.surprise).toBeGreaterThan(rates.happiness);
      expect(rates.surprise).toBeGreaterThan(rates.sadness);
    });

    it("high neuroticism slows negative emotion decay", () => {
      const neurotic: OCEANProfile = { ...createDefaultPersonality(), neuroticism: 0.9 };
      const stable: OCEANProfile = { ...createDefaultPersonality(), neuroticism: 0.1 };
      const neuroticRates = computeEmotionDecayRates(neurotic);
      const stableRates = computeEmotionDecayRates(stable);
      expect(neuroticRates.sadness).toBeLessThan(stableRates.sadness);
      expect(neuroticRates.anger).toBeLessThan(stableRates.anger);
      expect(neuroticRates.fear).toBeLessThan(stableRates.fear);
    });
  });

  // -----------------------------------------------------------------------
  // Rumination Probability
  // -----------------------------------------------------------------------

  describe("computeRuminationProbability", () => {
    it("returns moderate probability for default personality", () => {
      const prob = computeRuminationProbability(createDefaultPersonality());
      expect(prob).toBeGreaterThan(0);
      expect(prob).toBeLessThan(1);
    });

    it("high neuroticism increases rumination probability", () => {
      const neurotic: OCEANProfile = { ...createDefaultPersonality(), neuroticism: 0.9 };
      const stable: OCEANProfile = { ...createDefaultPersonality(), neuroticism: 0.1 };
      expect(computeRuminationProbability(neurotic)).toBeGreaterThan(
        computeRuminationProbability(stable),
      );
    });

    it("is clamped to [0, 1]", () => {
      const extreme: OCEANProfile = {
        openness: 1,
        conscientiousness: 0,
        extraversion: 0,
        agreeableness: 0,
        neuroticism: 1,
      };
      const prob = computeRuminationProbability(extreme);
      expect(prob).toBeGreaterThanOrEqual(0);
      expect(prob).toBeLessThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Response Intensity Multiplier
  // -----------------------------------------------------------------------

  describe("computeResponseIntensityMultiplier", () => {
    it("returns 1.0 for default personality", () => {
      const mult = computeResponseIntensityMultiplier(createDefaultPersonality());
      expect(mult).toBeCloseTo(1.0, 1);
    });

    it("high neuroticism increases multiplier", () => {
      const neurotic: OCEANProfile = { ...createDefaultPersonality(), neuroticism: 0.9 };
      const mult = computeResponseIntensityMultiplier(neurotic);
      expect(mult).toBeGreaterThan(1.0);
    });

    it("high agreeableness decreases multiplier slightly", () => {
      const agreeable: OCEANProfile = { ...createDefaultPersonality(), agreeableness: 0.9 };
      const disagreeable: OCEANProfile = { ...createDefaultPersonality(), agreeableness: 0.1 };
      expect(computeResponseIntensityMultiplier(agreeable)).toBeLessThan(
        computeResponseIntensityMultiplier(disagreeable),
      );
    });
  });
});
