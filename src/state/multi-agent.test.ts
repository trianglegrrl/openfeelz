import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadOtherAgentStates } from "./multi-agent.js";
import { buildEmptyState } from "./state-file.js";
import { writeStateFile } from "./state-file.js";

describe("multi-agent", () => {
  let tmpDir: string;
  let agentsRoot: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "emotion-multi-test-"));
    agentsRoot = path.join(tmpDir, "agents");
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadOtherAgentStates", () => {
    it("returns empty array when no other agents exist", async () => {
      const result = await loadOtherAgentStates(agentsRoot, "main", 3);
      expect(result).toEqual([]);
    });

    it("loads emotion states from sibling agent directories", async () => {
      // Create agent1's state
      const agent1State = buildEmptyState();
      agent1State.agents["agent1"] = {
        latest: {
          id: "s1",
          timestamp: new Date().toISOString(),
          label: "focused",
          intensity: 0.6,
          trigger: "working on task",
          confidence: 0.8,
          sourceRole: "assistant",
        },
        history: [],
      };
      await writeStateFile(
        path.join(agentsRoot, "agent1", "agent", "openfeelz.json"),
        agent1State,
      );

      // Create agent2's state
      const agent2State = buildEmptyState();
      agent2State.agents["agent2"] = {
        latest: {
          id: "s2",
          timestamp: new Date().toISOString(),
          label: "calm",
          intensity: 0.4,
          trigger: "idle",
          confidence: 0.7,
          sourceRole: "assistant",
        },
        history: [],
      };
      await writeStateFile(
        path.join(agentsRoot, "agent2", "agent", "openfeelz.json"),
        agent2State,
      );

      const result = await loadOtherAgentStates(agentsRoot, "main", 5);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toContain("agent1");
      expect(result.map((r) => r.id)).toContain("agent2");
    });

    it("excludes the current agent", async () => {
      const mainState = buildEmptyState();
      mainState.agents["main"] = {
        latest: {
          id: "s0",
          timestamp: new Date().toISOString(),
          label: "happy",
          intensity: 0.5,
          trigger: "test",
          confidence: 0.9,
          sourceRole: "assistant",
        },
        history: [],
      };
      await writeStateFile(
        path.join(agentsRoot, "main", "agent", "openfeelz.json"),
        mainState,
      );

      const result = await loadOtherAgentStates(agentsRoot, "main", 5);
      expect(result.map((r) => r.id)).not.toContain("main");
    });

    it("respects maxAgents limit", async () => {
      for (let i = 0; i < 5; i++) {
        const state = buildEmptyState();
        state.agents[`agent${i}`] = {
          latest: {
            id: `s${i}`,
            timestamp: new Date().toISOString(),
            label: "calm",
            intensity: 0.3,
            trigger: "test",
            confidence: 0.8,
            sourceRole: "assistant",
          },
          history: [],
        };
        await writeStateFile(
          path.join(agentsRoot, `agent${i}`, "agent", "openfeelz.json"),
          state,
        );
      }

      const result = await loadOtherAgentStates(agentsRoot, "main", 2);
      expect(result).toHaveLength(2);
    });
  });
});
