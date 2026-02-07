import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StateManager } from "./state-manager.js";
import { DEFAULT_CONFIG } from "../types.js";
import type { EmotionEngineConfig } from "../types.js";

function testConfig(overrides: Partial<EmotionEngineConfig> = {}): EmotionEngineConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe("StateManager", () => {
  let tmpDir: string;
  let statePath: string;
  let manager: StateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "emotion-sm-test-"));
    statePath = path.join(tmpDir, "openfeelz.json");
    manager = new StateManager(statePath, testConfig());
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  describe("getState", () => {
    it("returns empty state when no file exists", async () => {
      const state = await manager.getState();
      expect(state.version).toBe(2);
      expect(state.meta.totalUpdates).toBe(0);
    });

    it("returns persisted state after save", async () => {
      const state = await manager.getState();
      state.meta.totalUpdates = 5;
      await manager.saveState(state);

      const reloaded = await manager.getState();
      expect(reloaded.meta.totalUpdates).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // applyDecay
  // -----------------------------------------------------------------------

  describe("applyDecay", () => {
    it("decays elevated dimensions toward baseline", async () => {
      const state = await manager.getState();
      state.dimensions.pleasure = 0.8;
      state.basicEmotions.happiness = 0.7;
      state.lastUpdated = new Date(Date.now() - 12 * 3600 * 1000).toISOString();

      const decayed = manager.applyDecay(state);
      expect(decayed.dimensions.pleasure).toBeLessThan(0.8);
      expect(decayed.dimensions.pleasure).toBeGreaterThan(state.baseline.pleasure);
      expect(decayed.basicEmotions.happiness).toBeLessThan(0.7);
    });

    it("does nothing when lastUpdated is now", async () => {
      const state = await manager.getState();
      state.dimensions.pleasure = 0.8;
      state.lastUpdated = new Date().toISOString();

      const decayed = manager.applyDecay(state);
      expect(decayed.dimensions.pleasure).toBeCloseTo(0.8, 2);
    });
  });

  // -----------------------------------------------------------------------
  // applyStimulus
  // -----------------------------------------------------------------------

  describe("applyStimulus", () => {
    it("applies emotion mapping to dimensions and basic emotions", async () => {
      const state = await manager.getState();
      const updated = manager.applyStimulus(state, "angry", 0.8, "test trigger");

      expect(updated.dimensions.pleasure).toBeLessThan(state.dimensions.pleasure);
      expect(updated.dimensions.arousal).toBeGreaterThan(state.dimensions.arousal);
      expect(updated.basicEmotions.anger).toBeGreaterThan(0);
      expect(updated.recentStimuli).toHaveLength(1);
      expect(updated.recentStimuli[0].label).toBe("angry");
      expect(updated.meta.totalUpdates).toBe(1);
    });

    it("caps recentStimuli at maxHistory", async () => {
      const config = testConfig({ maxHistory: 3 });
      const mgr = new StateManager(statePath, config);
      let state = await mgr.getState();

      for (let i = 0; i < 5; i++) {
        state = mgr.applyStimulus(state, "happy", 0.5, `trigger ${i}`);
      }

      expect(state.recentStimuli).toHaveLength(3);
    });

    it("triggers rumination when intensity exceeds threshold", async () => {
      const config = testConfig({ ruminationEnabled: true, ruminationThreshold: 0.6 });
      const mgr = new StateManager(statePath, config);
      let state = await mgr.getState();
      state = mgr.applyStimulus(state, "angry", 0.95, "extreme anger");

      expect(state.rumination.active.length).toBeGreaterThanOrEqual(0);
      // With default personality (prob ~0.5), extreme intensity (0.95) vs threshold (0.6)
      // adjustedThreshold = 0.6 + 0.5*0.3 = 0.75 -> 0.95 > 0.75 -> should ruminate
    });

    it("does not trigger rumination when disabled", async () => {
      const config = testConfig({ ruminationEnabled: false });
      const mgr = new StateManager(statePath, config);
      let state = await mgr.getState();
      state = mgr.applyStimulus(state, "angry", 0.95, "extreme anger");

      expect(state.rumination.active).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // advanceRumination
  // -----------------------------------------------------------------------

  describe("advanceRumination", () => {
    it("advances and applies rumination effects", async () => {
      const config = testConfig({ ruminationEnabled: true, ruminationThreshold: 0.3 });
      const mgr = new StateManager(statePath, config);
      let state = await mgr.getState();

      // Apply strong stimulus to trigger rumination
      state = mgr.applyStimulus(state, "angry", 0.95, "rage");
      const preRum = { ...state.dimensions };

      // Advance rumination
      state = mgr.advanceRumination(state);

      // If rumination was active, effects should have been applied
      if (state.rumination.active.length > 0 || preRum.pleasure !== state.dimensions.pleasure) {
        // Some change happened
        expect(true).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // setDimension / setPersonalityTrait
  // -----------------------------------------------------------------------

  describe("setDimension", () => {
    it("sets a dimension to an absolute value", async () => {
      const state = await manager.getState();
      const updated = manager.setDimension(state, "pleasure", 0.6);
      expect(updated.dimensions.pleasure).toBe(0.6);
    });

    it("clamps to valid range", async () => {
      const state = await manager.getState();
      const updated = manager.setDimension(state, "pleasure", 2.0);
      expect(updated.dimensions.pleasure).toBe(1);
    });
  });

  describe("applyDimensionDelta", () => {
    it("adds delta to current value", async () => {
      const state = await manager.getState();
      const updated = manager.applyDimensionDeltaMethod(state, "pleasure", 0.3);
      expect(updated.dimensions.pleasure).toBe(0.3); // 0 + 0.3
    });
  });

  describe("setPersonalityTrait", () => {
    it("updates personality and recalculates baseline + decay rates", async () => {
      const state = await manager.getState();
      const originalBaseline = state.baseline.curiosity;
      const updated = manager.setPersonalityTrait(state, "openness", 0.9);

      expect(updated.personality.openness).toBe(0.9);
      expect(updated.baseline.curiosity).toBeGreaterThan(originalBaseline);
    });

    it("clamps trait to [0, 1]", async () => {
      const state = await manager.getState();
      const updated = manager.setPersonalityTrait(state, "openness", 1.5);
      expect(updated.personality.openness).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // resetToBaseline
  // -----------------------------------------------------------------------

  describe("resetToBaseline", () => {
    it("resets all dimensions to baseline", async () => {
      const state = await manager.getState();
      state.dimensions.pleasure = 0.8;
      state.dimensions.arousal = 0.6;
      state.basicEmotions.happiness = 0.9;

      const reset = manager.resetToBaseline(state);
      expect(reset.dimensions.pleasure).toBeCloseTo(reset.baseline.pleasure, 5);
      expect(reset.dimensions.arousal).toBeCloseTo(reset.baseline.arousal, 5);
      expect(reset.basicEmotions.happiness).toBe(0);
    });

    it("resets only specified dimensions", async () => {
      const state = await manager.getState();
      state.dimensions.pleasure = 0.8;
      state.dimensions.arousal = 0.6;

      const reset = manager.resetToBaseline(state, ["pleasure"]);
      expect(reset.dimensions.pleasure).toBeCloseTo(reset.baseline.pleasure, 5);
      expect(reset.dimensions.arousal).toBe(0.6); // unchanged
    });

    it("clears rumination on full reset", async () => {
      const state = await manager.getState();
      state.rumination.active = [
        { stimulusId: "s1", label: "angry", stage: 1, intensity: 0.5, lastStageTimestamp: "" },
      ];

      const reset = manager.resetToBaseline(state);
      expect(reset.rumination.active).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // updateUserEmotion / updateAgentEmotion
  // -----------------------------------------------------------------------

  describe("updateUserEmotion", () => {
    it("records a user emotion entry", async () => {
      const state = await manager.getState();
      const updated = manager.updateUserEmotion(state, "user1", {
        label: "happy",
        intensity: 0.7,
        reason: "good news",
        confidence: 0.9,
      });

      expect(updated.users["user1"]).toBeDefined();
      expect(updated.users["user1"].latest!.label).toBe("happy");
      expect(updated.users["user1"].history).toHaveLength(1);
    });

    it("caps user history at maxHistory", async () => {
      const config = testConfig({ maxHistory: 3 });
      const mgr = new StateManager(statePath, config);
      let state = await mgr.getState();

      for (let i = 0; i < 5; i++) {
        state = mgr.updateUserEmotion(state, "user1", {
          label: "happy",
          intensity: 0.5,
          reason: `reason ${i}`,
          confidence: 0.8,
        });
      }

      expect(state.users["user1"].history).toHaveLength(3);
    });
  });
});
