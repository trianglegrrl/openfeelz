/**
 * Tests that verify the exact format of the emotional context block
 * prepended to the agent's system prompt, and the end-to-end lifecycle
 * from stimulus through decay to context injection at bootstrap.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StateManager } from "../state/state-manager.js";
import { DEFAULT_CONFIG } from "../types.js";
import { createBootstrapHook } from "../hook/hooks.js";
import { formatEmotionBlock } from "./prompt-formatter.js";
import { buildEmptyState, writeStateFile } from "../state/state-file.js";
import { decayTowardBaseline } from "../model/decay.js";

describe("context injection lifecycle", () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "emotion-inject-test-"));
    statePath = path.join(tmpDir, "openfeelz.json");
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Exact block format
  // -----------------------------------------------------------------------

  describe("injected block structure", () => {
    it("produces the correct XML structure with dimensions, user, and agent sections", () => {
      const state = buildEmptyState();
      state.dimensions.pleasure = 0.6;
      state.dimensions.curiosity = 0.8;
      state.users["alice"] = {
        latest: {
          id: "s1",
          timestamp: "2026-02-06T15:30:00Z",
          label: "happy",
          intensity: 0.7,
          trigger: "project completed successfully",
          confidence: 0.9,
          sourceRole: "user",
        },
        history: [{
          id: "s1",
          timestamp: "2026-02-06T15:30:00Z",
          label: "happy",
          intensity: 0.7,
          trigger: "project completed successfully",
          confidence: 0.9,
          sourceRole: "user",
        }],
      };
      state.agents["main"] = {
        latest: {
          id: "s2",
          timestamp: "2026-02-06T15:30:00Z",
          label: "focused",
          intensity: 0.5,
          trigger: "helping with deployment",
          confidence: 0.85,
          sourceRole: "assistant",
        },
        history: [{
          id: "s2",
          timestamp: "2026-02-06T15:30:00Z",
          label: "focused",
          intensity: 0.5,
          trigger: "helping with deployment",
          confidence: 0.85,
          sourceRole: "assistant",
        }],
      };

      const block = formatEmotionBlock(state, "alice", "main", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });

      // Must start and end with the XML tags
      expect(block).toMatch(/^<emotion_state>/);
      expect(block).toMatch(/<\/emotion_state>$/);

      // Must contain dimension deviations
      expect(block).toContain("<dimensions>");
      expect(block).toContain("pleasure: elevated");
      expect(block).toContain("curiosity: elevated");
      expect(block).toContain("</dimensions>");

      // Must contain user section with natural-language entries
      expect(block).toContain("<user>");
      expect(block).toMatch(/Felt \w+ happy because/);
      expect(block).toContain("project completed successfully.");
      expect(block).toContain("</user>");

      // Must contain agent section
      expect(block).toContain("<agent>");
      expect(block).toMatch(/Felt \w+ focused because/);
      expect(block).toContain("</agent>");
    });

    it("includes trend line when history has entries in the window", () => {
      const state = buildEmptyState();
      const now = new Date();
      state.users["bob"] = {
        history: [
          {
            id: "s1", timestamp: now.toISOString(), label: "frustrated",
            intensity: 0.7, trigger: "bug", confidence: 0.9, sourceRole: "user",
          },
          {
            id: "s2", timestamp: new Date(now.getTime() - 3600000).toISOString(),
            label: "frustrated", intensity: 0.6, trigger: "another bug",
            confidence: 0.8, sourceRole: "user",
          },
          {
            id: "s3", timestamp: new Date(now.getTime() - 7200000).toISOString(),
            label: "happy", intensity: 0.4, trigger: "coffee",
            confidence: 0.7, sourceRole: "user",
          },
        ],
      };

      const block = formatEmotionBlock(state, "bob", "main", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });

      // Trend should reflect the dominant emotion (frustrated, since it's more recent and more intense)
      expect(block).toContain("Trend (last 24h): mostly frustrated.");
    });

    it("includes other agents section when provided", () => {
      const state = buildEmptyState();
      state.users["user1"] = {
        history: [{
          id: "s1", timestamp: new Date().toISOString(), label: "calm",
          intensity: 0.4, trigger: "relaxed", confidence: 0.8, sourceRole: "user",
        }],
      };

      const block = formatEmotionBlock(state, "user1", "main", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
        otherAgents: [
          {
            id: "research-agent",
            latest: {
              id: "os1", timestamp: new Date().toISOString(), label: "curious",
              intensity: 0.6, trigger: "investigating topic", confidence: 0.8,
              sourceRole: "assistant",
            },
          },
        ],
      });

      expect(block).toContain("<others>");
      expect(block).toContain("research-agent");
      expect(block).toContain("curious");
      expect(block).toContain("</others>");
    });

    it("returns empty string when there is nothing to inject", () => {
      const state = buildEmptyState();
      const block = formatEmotionBlock(state, "nobody", "main", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });
      expect(block).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // Decay timeline accuracy
  // -----------------------------------------------------------------------

  describe("decay timeline", () => {
    it("matches documented half-life: value is ~50% after one half-life", () => {
      // Default pleasure rate = 0.058/hr => half-life = ln(2)/0.058 ≈ 11.95h
      const rate = 0.058;
      const halfLife = Math.log(2) / rate;

      const result = decayTowardBaseline(1.0, 0.0, rate, halfLife);
      expect(result).toBeCloseTo(0.5, 2);
    });

    it("matches documented timeline: anger at 0.85 over 24 hours", () => {
      // Rate for anger (basic emotion) = 0.058/hr
      const rate = 0.058;

      const at0h = 0.85;
      const at2h = decayTowardBaseline(at0h, 0, rate, 2);
      const at6h = decayTowardBaseline(at0h, 0, rate, 6);
      const at12h = decayTowardBaseline(at0h, 0, rate, 12);
      const at24h = decayTowardBaseline(at0h, 0, rate, 24);

      // After 2 hours: should be noticeably lower but still high
      expect(at2h).toBeGreaterThan(0.7);
      expect(at2h).toBeLessThan(0.85);

      // After 6 hours: moderate decay
      expect(at6h).toBeGreaterThan(0.5);
      expect(at6h).toBeLessThan(0.7);

      // After 12 hours (~one half-life): roughly half
      expect(at12h).toBeCloseTo(0.425, 1); // 0.85 * 0.5

      // After 24 hours (~two half-lives): roughly a quarter
      expect(at24h).toBeCloseTo(0.212, 1); // 0.85 * 0.25
    });

    it("trust decays much slower than surprise", () => {
      // trust rate = 0.035, surprise rate = 0.139
      const trustAfter6h = decayTowardBaseline(0.8, 0, 0.035, 6);
      const surpriseAfter6h = decayTowardBaseline(0.8, 0, 0.139, 6);

      expect(trustAfter6h).toBeGreaterThan(0.6); // trust lingers
      expect(surpriseAfter6h).toBeLessThan(0.4); // surprise fades fast
    });

    it("decay toward non-zero baseline stabilizes at baseline", () => {
      // Extraverted personality has pleasure baseline ~0.1
      const baseline = 0.1;
      const rate = 0.058;

      const after12h = decayTowardBaseline(0.8, baseline, rate, 12);
      const after48h = decayTowardBaseline(0.8, baseline, rate, 48);
      const after168h = decayTowardBaseline(0.8, baseline, rate, 168); // 1 week

      // Should approach baseline, never go below it
      expect(after12h).toBeGreaterThan(baseline);
      expect(after48h).toBeCloseTo(baseline, 1);
      expect(after168h).toBeCloseTo(baseline, 3);
    });
  });

  // -----------------------------------------------------------------------
  // Full lifecycle: stimulus -> save -> time passes -> bootstrap -> verify
  // -----------------------------------------------------------------------

  describe("full injection lifecycle", () => {
    it("stimulus is captured, decays over time, and appears in bootstrap injection", async () => {
      const manager = new StateManager(statePath, DEFAULT_CONFIG);

      // 1. Apply a strong anger stimulus
      let state = await manager.getState();
      state = manager.applyStimulus(state, "angry", 0.85, "rude customer");
      state = manager.updateUserEmotion(state, "alice", {
        label: "angry",
        intensity: 0.85,
        reason: "rude customer",
        confidence: 0.9,
      });

      // 2. Save with timestamp 6 hours ago to simulate time passing
      const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      await writeStateFile(statePath, { ...state, lastUpdated: sixHoursAgo });

      // 3. Bootstrap hook runs (simulating the agent waking up)
      const hook = createBootstrapHook(() => manager, DEFAULT_CONFIG);
      const result = await hook({ prompt: "Hello", userKey: "alice", agentId: "main" });

      expect(result).toBeDefined();
      expect(result!.prependContext).toContain("<emotion_state>");

      // 4. The injected block should mention the user's anger
      expect(result!.prependContext).toContain("angry");
      expect(result!.prependContext).toContain("rude customer");

      // 5. Verify decay was applied to the persisted state
      const decayedState = await manager.getState();
      // Pleasure should have partially recovered toward baseline (was negative, now less negative)
      // Anger emotion should have partially decayed
      expect(decayedState.basicEmotions.anger).toBeLessThan(0.85 * 0.3); // mapped intensity * decay
      expect(decayedState.dimensions.arousal).toBeLessThan(state.dimensions.arousal);
    });

    it("multiple stimuli over time produce correct trend in injection", async () => {
      const manager = new StateManager(statePath, DEFAULT_CONFIG);

      let state = await manager.getState();

      // Simulate a history of emotions over a day
      const now = Date.now();
      const stimuli = [
        { label: "frustrated", intensity: 0.7, trigger: "deploy failed", hoursAgo: 8 },
        { label: "frustrated", intensity: 0.6, trigger: "another failure", hoursAgo: 6 },
        { label: "happy", intensity: 0.4, trigger: "got lunch", hoursAgo: 4 },
        { label: "frustrated", intensity: 0.8, trigger: "deploy failed again", hoursAgo: 1 },
      ];

      for (const s of stimuli) {
        state = manager.updateUserEmotion(state, "bob", {
          label: s.label,
          intensity: s.intensity,
          reason: s.trigger,
          confidence: 0.85,
        });
        // Backdate the timestamp
        const entry = state.users["bob"].history[0];
        entry.timestamp = new Date(now - s.hoursAgo * 3600 * 1000).toISOString();
      }

      await manager.saveState(state);

      // Bootstrap should show trend as "mostly frustrated"
      const hook = createBootstrapHook(() => manager, DEFAULT_CONFIG);
      const result = await hook({ prompt: "Hi", userKey: "bob", agentId: "main" });

      expect(result).toBeDefined();
      expect(result!.prependContext).toContain("frustrated");
      expect(result!.prependContext).toContain("Trend");
      expect(result!.prependContext).toContain("mostly frustrated");
    });
  });
});
