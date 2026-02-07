import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createBootstrapHook, createAgentEndHook } from "./hooks.js";
import { StateManager } from "../state/state-manager.js";
import { DEFAULT_CONFIG } from "../types.js";

describe("hooks", () => {
  let tmpDir: string;
  let statePath: string;
  let manager: StateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "emotion-hooks-test-"));
    statePath = path.join(tmpDir, "emotion-engine.json");
    manager = new StateManager(statePath, DEFAULT_CONFIG);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Bootstrap Hook (before_agent_start)
  // -----------------------------------------------------------------------

  describe("createBootstrapHook", () => {
    it("returns a handler function", () => {
      const handler = createBootstrapHook(manager, DEFAULT_CONFIG);
      expect(typeof handler).toBe("function");
    });

    it("returns prependContext when state has user data", async () => {
      // Set up some user emotion data
      let state = await manager.getState();
      state = manager.updateUserEmotion(state, "user1", {
        label: "happy",
        intensity: 0.7,
        reason: "good mood",
        confidence: 0.9,
      });
      state.dimensions.pleasure = 0.6;
      await manager.saveState(state);

      const handler = createBootstrapHook(manager, DEFAULT_CONFIG);
      const event = { prompt: "Hello", userKey: "user1", agentId: "main" };
      const result = await handler(event);

      expect(result).toBeDefined();
      expect(result?.prependContext).toBeDefined();
      expect(result!.prependContext).toContain("<emotion_state>");
      expect(result!.prependContext).toContain("happy");
    });

    it("returns undefined when no emotion data exists", async () => {
      const handler = createBootstrapHook(manager, DEFAULT_CONFIG);
      const event = { prompt: "Hello", userKey: "user1", agentId: "main" };
      const result = await handler(event);

      // Empty state, no entries, no dimension deviations
      expect(result).toBeUndefined();
    });

    it("applies decay before formatting", async () => {
      let state = await manager.getState();
      state.dimensions.pleasure = 0.9;
      // Set lastUpdated to 24 hours ago so decay is significant
      const pastDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      state.lastUpdated = pastDate;
      state = manager.updateUserEmotion(state, "user1", {
        label: "happy",
        intensity: 0.7,
        reason: "test",
        confidence: 0.9,
      });
      // Write directly to bypass saveState's lastUpdated override
      const { writeStateFile } = await import("../state/state-file.js");
      await writeStateFile(path.join(tmpDir, "emotion-engine.json"), { ...state, lastUpdated: pastDate });

      const handler = createBootstrapHook(manager, DEFAULT_CONFIG);
      await handler({ prompt: "Hello", userKey: "user1", agentId: "main" });

      // Verify decay was applied (pleasure should have decayed from 0.9)
      const updatedState = await manager.getState();
      expect(updatedState.dimensions.pleasure).toBeLessThan(0.85);
    });

    it("respects contextEnabled=false", async () => {
      const config = { ...DEFAULT_CONFIG, contextEnabled: false };
      let state = await manager.getState();
      state = manager.updateUserEmotion(state, "user1", {
        label: "happy",
        intensity: 0.7,
        reason: "test",
        confidence: 0.9,
      });
      await manager.saveState(state);

      const handler = createBootstrapHook(manager, config);
      const result = await handler({ prompt: "Hello", userKey: "user1", agentId: "main" });
      expect(result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Agent End Hook
  // -----------------------------------------------------------------------

  describe("createAgentEndHook", () => {
    it("returns a handler function", () => {
      const handler = createAgentEndHook(manager, DEFAULT_CONFIG);
      expect(typeof handler).toBe("function");
    });

    it("does nothing when no messages are provided", async () => {
      const handler = createAgentEndHook(manager, DEFAULT_CONFIG);
      await handler({ success: true, messages: [], userKey: "user1", agentId: "main" });
      const state = await manager.getState();
      expect(Object.keys(state.users)).toHaveLength(0);
    });

    it("classifies and records user message emotions (with mock classifier)", async () => {
      const mockFetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    label: "frustrated",
                    intensity: 0.6,
                    reason: "debugging issues",
                    confidence: 0.85,
                  }),
                },
              },
            ],
          }),
      });

      const config = { ...DEFAULT_CONFIG, apiKey: "test-key" };
      const mgr = new StateManager(statePath, config);
      const handler = createAgentEndHook(mgr, config, mockFetchFn);

      await handler({
        success: true,
        messages: [
          { role: "user", content: "This bug is driving me crazy" },
        ],
        userKey: "user1",
        agentId: "main",
      });

      const state = await mgr.getState();
      expect(state.users["user1"]).toBeDefined();
      expect(state.users["user1"].latest!.label).toBe("frustrated");
    });
  });
});
