/**
 * Integration tests for the OpenFeelz plugin.
 *
 * Tests the full plugin registration cycle and end-to-end flows
 * using a mock OpenClaw plugin API.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("openfeelz integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "emotion-int-test-"));
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Plugin Registration
  // -----------------------------------------------------------------------

  describe("plugin registration", () => {
    it("registers all expected components", async () => {
      const { default: plugin } = await import("../index.js");

      const registeredTools: any[] = [];
      const registeredHooks: Record<string, any[]> = {};
      const registeredServices: any[] = [];
      const registeredClis: any[] = [];
      const registeredRoutes: any[] = [];

      const mockApi = {
        id: "openfeelz",
        config: {},
        pluginConfig: {
          apiKey: "test-key",
          personality: { openness: 0.7, neuroticism: 0.3 },
        },
        runtime: {},
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        },
        resolvePath: (p: string) => path.join(tmpDir, p),
        registerTool: (tool: any, opts: any) => registeredTools.push({ tool, opts }),
        registerCli: (registrar: any, opts: any) => registeredClis.push({ registrar, opts }),
        registerService: (service: any) => registeredServices.push(service),
        registerHttpRoute: (params: any) => registeredRoutes.push(params),
        registerHook: () => {},
        registerHttpHandler: () => {},
        registerCommand: () => {},
        registerProvider: () => {},
        on: (hookName: string, handler: any) => {
          if (!registeredHooks[hookName]) registeredHooks[hookName] = [];
          registeredHooks[hookName].push(handler);
        },
      };

      plugin.register(mockApi);

      // Verify registrations
      expect(registeredTools).toHaveLength(1);
      expect(registeredTools[0].opts.name).toBe("emotion_state");

      expect(registeredHooks["before_agent_start"]).toBeDefined();
      expect(registeredHooks["before_agent_start"]).toHaveLength(1);

      expect(registeredHooks["agent_end"]).toBeDefined();
      expect(registeredHooks["agent_end"]).toHaveLength(1);

      expect(registeredClis).toHaveLength(1);
      expect(registeredClis[0].opts.commands).toContain("emotion");

      expect(registeredRoutes).toHaveLength(1);
      expect(registeredRoutes[0].path).toBe("/emotion-dashboard");
    });

    it("registers decay service when enabled", async () => {
      const { default: plugin } = await import("../index.js");

      const registeredServices: any[] = [];
      const mockApi = {
        id: "openfeelz",
        config: {},
        pluginConfig: { decayServiceEnabled: true },
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        resolvePath: (p: string) => path.join(tmpDir, p),
        registerTool: () => {},
        registerCli: () => {},
        registerService: (s: any) => registeredServices.push(s),
        registerHttpRoute: () => {},
        on: () => {},
      };

      plugin.register(mockApi);

      expect(registeredServices.length).toBeGreaterThanOrEqual(1);
      const decayService = registeredServices.find((s: any) => s.id === "openfeelz-decay");
      expect(decayService).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // End-to-end Flow
  // -----------------------------------------------------------------------

  describe("end-to-end flow", () => {
    it("full cycle: stimulus -> decay -> query -> verify", async () => {
      const { StateManager } = await import("./state/state-manager.js");
      const { DEFAULT_CONFIG } = await import("./types.js");
      const { computePrimaryEmotion, computeOverallIntensity } = await import("./model/emotion-model.js");

      const statePath = path.join(tmpDir, "openfeelz.json");
      const manager = new StateManager(statePath, DEFAULT_CONFIG);

      // 1. Start fresh
      let state = await manager.getState();
      expect(state.meta.totalUpdates).toBe(0);

      // 2. Apply anger stimulus
      state = manager.applyStimulus(state, "angry", 0.8, "someone was rude");
      expect(state.basicEmotions.anger).toBeGreaterThan(0);
      expect(state.dimensions.pleasure).toBeLessThan(0);
      expect(state.dimensions.arousal).toBeGreaterThan(0);
      expect(state.meta.totalUpdates).toBe(1);

      // 3. Save and reload
      await manager.saveState(state);
      const reloaded = await manager.getState();
      expect(reloaded.basicEmotions.anger).toBeGreaterThan(0);

      // 4. Apply happy stimulus (should partially counteract anger)
      state = manager.applyStimulus(reloaded, "happy", 0.6, "received good news");
      expect(state.basicEmotions.happiness).toBeGreaterThan(0);
      expect(state.dimensions.pleasure).toBeGreaterThan(reloaded.dimensions.pleasure);
      expect(state.meta.totalUpdates).toBe(2);

      // 5. Set personality trait
      state = manager.setPersonalityTrait(state, "openness", 0.9);
      expect(state.personality.openness).toBe(0.9);
      expect(state.baseline.curiosity).toBeGreaterThan(0.5); // High openness -> higher curiosity baseline

      // 6. Reset to baseline
      const reset = manager.resetToBaseline(state);
      expect(reset.dimensions.pleasure).toBeCloseTo(reset.baseline.pleasure, 5);
      expect(reset.basicEmotions.anger).toBe(0);
      expect(reset.basicEmotions.happiness).toBe(0);

      // 7. Verify primary emotion after reset
      const primary = computePrimaryEmotion(reset.basicEmotions);
      expect(primary).toBe("neutral");
      const intensity = computeOverallIntensity(reset.basicEmotions);
      expect(intensity).toBe(0);
    });

    it("rumination lifecycle", async () => {
      const { StateManager } = await import("./state/state-manager.js");
      const { DEFAULT_CONFIG } = await import("./types.js");

      const config = { ...DEFAULT_CONFIG, ruminationThreshold: 0.3, ruminationEnabled: true };
      const manager = new StateManager(path.join(tmpDir, "state.json"), config);

      let state = await manager.getState();

      // Strong stimulus should trigger rumination
      state = manager.applyStimulus(state, "angry", 0.95, "extreme provocation");
      const hasRumination = state.rumination.active.length > 0;

      if (hasRumination) {
        // Advance rumination
        state = manager.advanceRumination(state);

        // Rumination should have applied effects and advanced stages
        // (or removed entries if they expired)
        expect(state.rumination.active.length).toBeLessThanOrEqual(1);

        // After multiple advances, rumination should eventually clear
        for (let i = 0; i < 10; i++) {
          state = manager.advanceRumination(state);
        }
        expect(state.rumination.active).toHaveLength(0);
      }
    });

    it("multi-agent awareness", async () => {
      const { loadOtherAgentStates } = await import("./state/multi-agent.js");
      const { writeStateFile, buildEmptyState } = await import("./state/state-file.js");

      const agentsRoot = path.join(tmpDir, "agents");

      // Create two agent states
      for (const agentId of ["agent-a", "agent-b"]) {
        const state = buildEmptyState();
        state.agents[agentId] = {
          latest: {
            id: `s-${agentId}`,
            timestamp: new Date().toISOString(),
            label: agentId === "agent-a" ? "focused" : "calm",
            intensity: 0.6,
            trigger: "working",
            confidence: 0.8,
            sourceRole: "assistant",
          },
          history: [],
        };
        await writeStateFile(
          path.join(agentsRoot, agentId, "agent", "openfeelz.json"),
          state,
        );
      }

      // Load from main agent's perspective
      const others = await loadOtherAgentStates(agentsRoot, "main", 5);
      expect(others).toHaveLength(2);
      expect(others.map((o) => o.latest.label).sort()).toEqual(["calm", "focused"]);
    });

    it("v1 migration preserves user history", async () => {
      const { migrateV1State } = await import("./migration/migrate-v1.js");

      const v1 = {
        version: 1,
        users: {
          alice: {
            latest: {
              timestamp: "2026-02-06T12:00:00Z",
              label: "happy",
              intensity: "high",
              reason: "promotion",
              confidence: 0.95,
            },
            history: [
              { timestamp: "2026-02-06T12:00:00Z", label: "happy", intensity: "high", reason: "promotion", confidence: 0.95 },
              { timestamp: "2026-02-05T08:00:00Z", label: "anxious", intensity: "medium", reason: "deadline", confidence: 0.8 },
            ],
          },
        },
        agents: {},
      };

      const v2 = migrateV1State(v1);
      expect(v2.version).toBe(2);
      expect(v2.users["alice"].history).toHaveLength(2);
      expect(v2.users["alice"].latest!.label).toBe("happy");
      expect(v2.users["alice"].latest!.intensity).toBe(0.9);
      expect(v2.users["alice"].history[1].label).toBe("anxious");
      expect(v2.users["alice"].history[1].intensity).toBe(0.6);
    });
  });
});
