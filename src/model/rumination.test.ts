import { describe, it, expect } from "vitest";
import {
  createEmptyRuminationState,
  shouldStartRumination,
  startRumination,
  advanceRumination,
  applyRuminationEffects,
} from "./rumination.js";
import { createDefaultDimensionalState, createDefaultBasicEmotions } from "./emotion-model.js";
import type { EmotionStimulus } from "../types.js";

function makeStimulus(overrides: Partial<EmotionStimulus> = {}): EmotionStimulus {
  return {
    id: "test-1",
    timestamp: new Date().toISOString(),
    label: "angry",
    intensity: 0.8,
    trigger: "test trigger",
    confidence: 0.9,
    sourceRole: "user",
    ...overrides,
  };
}

describe("rumination", () => {
  // -----------------------------------------------------------------------
  // Factory
  // -----------------------------------------------------------------------

  describe("createEmptyRuminationState", () => {
    it("returns empty active list", () => {
      const state = createEmptyRuminationState();
      expect(state.active).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // shouldStartRumination
  // -----------------------------------------------------------------------

  describe("shouldStartRumination", () => {
    it("returns true when intensity exceeds adjusted threshold", () => {
      // probability 0.5 -> adjustedThreshold = 0.7 + 0.5*0.3 = 0.85
      // so intensity 0.9 should trigger, 0.8 should not
      expect(shouldStartRumination(0.9, 0.7, 0.5)).toBe(true);
      expect(shouldStartRumination(0.8, 0.7, 0.5)).toBe(false);
    });

    it("returns false when intensity is below threshold", () => {
      expect(shouldStartRumination(0.5, 0.7, 0.5)).toBe(false);
    });

    it("returns false when intensity equals threshold exactly", () => {
      expect(shouldStartRumination(0.7, 0.7, 0.5)).toBe(false);
    });

    it("probability of 0 always returns false", () => {
      expect(shouldStartRumination(0.9, 0.7, 0)).toBe(false);
    });

    it("probability of 1 always returns true when above threshold", () => {
      expect(shouldStartRumination(0.9, 0.7, 1.0)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // startRumination
  // -----------------------------------------------------------------------

  describe("startRumination", () => {
    it("adds a new entry to the active list", () => {
      const state = createEmptyRuminationState();
      const stimulus = makeStimulus({ intensity: 0.85 });
      const updated = startRumination(state, stimulus);
      expect(updated.active).toHaveLength(1);
      expect(updated.active[0].stimulusId).toBe("test-1");
      expect(updated.active[0].label).toBe("angry");
      expect(updated.active[0].stage).toBe(0);
      expect(updated.active[0].intensity).toBe(0.85);
    });

    it("does not mutate original state", () => {
      const state = createEmptyRuminationState();
      startRumination(state, makeStimulus());
      expect(state.active).toHaveLength(0);
    });

    it("does not add duplicate entries for same stimulus", () => {
      let state = createEmptyRuminationState();
      const stimulus = makeStimulus();
      state = startRumination(state, stimulus);
      state = startRumination(state, stimulus);
      expect(state.active).toHaveLength(1);
    });

    it("can track multiple different stimuli", () => {
      let state = createEmptyRuminationState();
      state = startRumination(state, makeStimulus({ id: "s1", label: "angry" }));
      state = startRumination(state, makeStimulus({ id: "s2", label: "sad" }));
      expect(state.active).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // advanceRumination
  // -----------------------------------------------------------------------

  describe("advanceRumination", () => {
    it("advances stage and reduces intensity", () => {
      let state = createEmptyRuminationState();
      state = startRumination(state, makeStimulus({ intensity: 0.8 }));
      const updated = advanceRumination(state, 4, 0.8);
      expect(updated.active[0].stage).toBe(1);
      expect(updated.active[0].intensity).toBeLessThan(0.8);
      expect(updated.active[0].intensity).toBeCloseTo(0.64, 2); // 0.8 * 0.8
    });

    it("removes entries that exceed max stages", () => {
      let state = createEmptyRuminationState();
      state = startRumination(state, makeStimulus({ intensity: 0.8 }));
      // Advance through all stages
      state = advanceRumination(state, 4, 0.8); // stage 1
      state = advanceRumination(state, 4, 0.8); // stage 2
      state = advanceRumination(state, 4, 0.8); // stage 3
      state = advanceRumination(state, 4, 0.8); // stage 4 -> removed
      expect(state.active).toHaveLength(0);
    });

    it("removes entries whose intensity drops below 0.05", () => {
      let state = createEmptyRuminationState();
      state = startRumination(state, makeStimulus({ intensity: 0.1 }));
      // 0.1 * 0.8 = 0.08 -> stage 1
      state = advanceRumination(state, 10, 0.8);
      // 0.08 * 0.8 = 0.064 -> stage 2
      state = advanceRumination(state, 10, 0.8);
      // 0.064 * 0.8 = 0.0512 -> stage 3
      state = advanceRumination(state, 10, 0.8);
      // 0.0512 * 0.8 = 0.041 -> below 0.05, removed
      state = advanceRumination(state, 10, 0.8);
      expect(state.active).toHaveLength(0);
    });

    it("handles empty state gracefully", () => {
      const state = createEmptyRuminationState();
      const updated = advanceRumination(state, 4, 0.8);
      expect(updated.active).toHaveLength(0);
    });

    it("does not mutate original", () => {
      let state = createEmptyRuminationState();
      state = startRumination(state, makeStimulus());
      const original = state.active[0].stage;
      advanceRumination(state, 4, 0.8);
      expect(state.active[0].stage).toBe(original);
    });
  });

  // -----------------------------------------------------------------------
  // applyRuminationEffects
  // -----------------------------------------------------------------------

  describe("applyRuminationEffects", () => {
    it("applies emotional effects from active ruminations", () => {
      let rumState = createEmptyRuminationState();
      rumState = startRumination(rumState, makeStimulus({ label: "angry", intensity: 0.8 }));

      const dims = createDefaultDimensionalState();
      const emos = createDefaultBasicEmotions();
      const { dimensions, emotions } = applyRuminationEffects(rumState, dims, emos);

      // Anger mapping should push pleasure negative, arousal positive
      expect(dimensions.pleasure).toBeLessThan(dims.pleasure);
      expect(dimensions.arousal).toBeGreaterThan(dims.arousal);
      expect(emotions.anger).toBeGreaterThan(emos.anger);
    });

    it("scales effects by rumination intensity", () => {
      let rumState1 = createEmptyRuminationState();
      rumState1 = startRumination(rumState1, makeStimulus({ label: "angry", intensity: 0.8 }));

      let rumState2 = createEmptyRuminationState();
      rumState2 = startRumination(rumState2, makeStimulus({ id: "s2", label: "angry", intensity: 0.3 }));

      const dims = createDefaultDimensionalState();
      const emos = createDefaultBasicEmotions();

      const r1 = applyRuminationEffects(rumState1, dims, emos);
      const r2 = applyRuminationEffects(rumState2, dims, emos);

      // Higher intensity should produce larger effects
      expect(Math.abs(r1.dimensions.pleasure - dims.pleasure)).toBeGreaterThan(
        Math.abs(r2.dimensions.pleasure - dims.pleasure),
      );
    });

    it("returns unchanged state when no active ruminations", () => {
      const rumState = createEmptyRuminationState();
      const dims = createDefaultDimensionalState();
      const emos = createDefaultBasicEmotions();
      const { dimensions, emotions } = applyRuminationEffects(rumState, dims, emos);
      expect(dimensions).toEqual(dims);
      expect(emotions).toEqual(emos);
    });

    it("does not mutate inputs", () => {
      let rumState = createEmptyRuminationState();
      rumState = startRumination(rumState, makeStimulus({ label: "sad", intensity: 0.9 }));
      const dims = createDefaultDimensionalState();
      const emos = createDefaultBasicEmotions();
      applyRuminationEffects(rumState, dims, emos);
      expect(dims.pleasure).toBe(0);
      expect(emos.sadness).toBe(0);
    });
  });
});
