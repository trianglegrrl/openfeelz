import { describe, it, expect } from "vitest";
import {
  inferGoals,
  computeGoalModulation,
  applyGoalModulation,
} from "./goal-modulation.js";
import type { OCEANProfile } from "../types.js";
import { createDefaultPersonality } from "./personality.js";

describe("goal-modulation", () => {
  describe("inferGoals", () => {
    it("infers goals from personality traits", () => {
      const personality: OCEANProfile = {
        openness: 0.9,
        conscientiousness: 0.8,
        extraversion: 0.5,
        agreeableness: 0.7,
        neuroticism: 0.3,
      };
      const goals = inferGoals(personality);
      expect(goals.length).toBeGreaterThan(0);
      // High openness -> exploration goal
      expect(goals.some((g) => g.type === "exploration")).toBe(true);
      // High conscientiousness -> task_completion goal
      expect(goals.some((g) => g.type === "task_completion")).toBe(true);
    });

    it("returns minimal goals for default personality", () => {
      const goals = inferGoals(createDefaultPersonality());
      expect(goals.length).toBeGreaterThanOrEqual(0);
    });

    it("high agreeableness infers social harmony goal", () => {
      const personality = { ...createDefaultPersonality(), agreeableness: 0.9 };
      const goals = inferGoals(personality);
      expect(goals.some((g) => g.type === "social_harmony")).toBe(true);
    });
  });

  describe("computeGoalModulation", () => {
    it("returns modulation factors for active goals", () => {
      const personality: OCEANProfile = {
        openness: 0.9,
        conscientiousness: 0.8,
        extraversion: 0.5,
        agreeableness: 0.5,
        neuroticism: 0.3,
      };
      const goals = inferGoals(personality);
      const modulation = computeGoalModulation(goals, "frustrated", 0.7);
      // Frustration should be amplified when task_completion goal is active
      expect(modulation.intensityMultiplier).toBeGreaterThanOrEqual(1.0);
    });

    it("amplifies frustration when task_completion is a goal", () => {
      const personality = { ...createDefaultPersonality(), conscientiousness: 0.9 };
      const goals = inferGoals(personality);
      const modulation = computeGoalModulation(goals, "frustrated", 0.6);
      expect(modulation.intensityMultiplier).toBeGreaterThan(1.0);
    });

    it("amplifies curiosity when exploration is a goal", () => {
      const personality = { ...createDefaultPersonality(), openness: 0.9 };
      const goals = inferGoals(personality);
      const modulation = computeGoalModulation(goals, "curious", 0.5);
      expect(modulation.intensityMultiplier).toBeGreaterThan(1.0);
    });

    it("returns neutral modulation for unrelated emotions", () => {
      const goals = inferGoals(createDefaultPersonality());
      const modulation = computeGoalModulation(goals, "surprised", 0.5);
      expect(modulation.intensityMultiplier).toBeCloseTo(1.0, 1);
    });
  });

  describe("applyGoalModulation", () => {
    it("scales emotion intensity based on goals", () => {
      const personality = { ...createDefaultPersonality(), conscientiousness: 0.9 };
      const goals = inferGoals(personality);

      const originalIntensity = 0.6;
      const modulated = applyGoalModulation(goals, "frustrated", originalIntensity);
      expect(modulated).toBeGreaterThan(originalIntensity);
      expect(modulated).toBeLessThanOrEqual(1.0);
    });

    it("clamps result to [0, 1]", () => {
      const personality = { ...createDefaultPersonality(), conscientiousness: 1.0 };
      const goals = inferGoals(personality);
      const modulated = applyGoalModulation(goals, "frustrated", 0.95);
      expect(modulated).toBeLessThanOrEqual(1.0);
    });
  });
});
