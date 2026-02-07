import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEmotionMcpServer } from "./mcp-server.js";
import { StateManager } from "../state/state-manager.js";
import { DEFAULT_CONFIG } from "../types.js";

describe("mcp-server", () => {
  let tmpDir: string;
  let manager: StateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "emotion-mcp-test-"));
    manager = new StateManager(path.join(tmpDir, "openfeelz.json"), DEFAULT_CONFIG);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("createEmotionMcpServer", () => {
    it("returns server config with tools and resources", () => {
      const config = createEmotionMcpServer(manager);
      expect(config.name).toBe("openfeelz");
      expect(config.tools).toBeDefined();
      expect(config.tools.length).toBeGreaterThanOrEqual(3);
      expect(config.resources).toBeDefined();
      expect(config.resources.length).toBeGreaterThanOrEqual(2);
    });

    it("query_emotion tool returns current state", async () => {
      const config = createEmotionMcpServer(manager);
      const queryTool = config.tools.find((t) => t.name === "query_emotion");
      expect(queryTool).toBeDefined();

      const result = await queryTool!.handler({});
      expect(result).toBeDefined();
      const data = JSON.parse(result.content);
      expect(data.dimensions).toBeDefined();
      expect(data.basicEmotions).toBeDefined();
    });

    it("modify_emotion tool applies stimulus", async () => {
      const config = createEmotionMcpServer(manager);
      const modifyTool = config.tools.find((t) => t.name === "modify_emotion");
      expect(modifyTool).toBeDefined();

      const result = await modifyTool!.handler({
        emotion: "happy",
        intensity: 0.7,
        trigger: "test",
      });
      const data = JSON.parse(result.content);
      expect(data.applied).toBe(true);
    });

    it("set_personality tool updates traits", async () => {
      const config = createEmotionMcpServer(manager);
      const setTrait = config.tools.find((t) => t.name === "set_personality");
      expect(setTrait).toBeDefined();

      const result = await setTrait!.handler({ trait: "openness", value: 0.9 });
      const data = JSON.parse(result.content);
      expect(data.personality.openness).toBe(0.9);
    });

    it("emotion_state resource returns formatted state", async () => {
      const config = createEmotionMcpServer(manager);
      const stateResource = config.resources.find((r) => r.uri === "emotion://state");
      expect(stateResource).toBeDefined();

      const content = await stateResource!.read();
      const data = JSON.parse(content);
      expect(data.dimensions).toBeDefined();
    });

    it("emotion_personality resource returns profile", async () => {
      const config = createEmotionMcpServer(manager);
      const personalityResource = config.resources.find((r) => r.uri === "emotion://personality");
      expect(personalityResource).toBeDefined();

      const content = await personalityResource!.read();
      const data = JSON.parse(content);
      expect(data.openness).toBeDefined();
    });

    it("set_dimension tool sets a dimension to an absolute value", async () => {
      const config = createEmotionMcpServer(manager);
      const tool = config.tools.find((t) => t.name === "set_dimension");
      expect(tool).toBeDefined();

      const result = await tool!.handler({ dimension: "pleasure", value: 0.7 });
      const data = JSON.parse(result.content);
      expect(data.dimensions.pleasure).toBe(0.7);
    });

    it("set_dimension tool throws on unknown dimension", async () => {
      const config = createEmotionMcpServer(manager);
      const tool = config.tools.find((t) => t.name === "set_dimension")!;
      await expect(tool.handler({ dimension: "fake", value: 0.5 })).rejects.toThrow("Unknown dimension");
    });

    it("reset tool resets all dimensions to baseline", async () => {
      const config = createEmotionMcpServer(manager);
      const modifyTool = config.tools.find((t) => t.name === "modify_emotion")!;
      await modifyTool.handler({ emotion: "angry", intensity: 0.9 });

      const resetTool = config.tools.find((t) => t.name === "reset")!;
      const result = await resetTool.handler({});
      const data = JSON.parse(result.content);
      expect(data.reset).toBe(true);
      expect(data.basicEmotions.anger).toBe(0);
    });

    it("reset tool resets specific dimensions only", async () => {
      const config = createEmotionMcpServer(manager);
      const setDim = config.tools.find((t) => t.name === "set_dimension")!;
      await setDim.handler({ dimension: "pleasure", value: 0.8 });
      await setDim.handler({ dimension: "curiosity", value: 0.9 });

      const resetTool = config.tools.find((t) => t.name === "reset")!;
      const result = await resetTool.handler({ dimensions: ["pleasure"] });
      const data = JSON.parse(result.content);
      expect(data.dimensions.pleasure).toBe(0); // baseline
      expect(data.dimensions.curiosity).toBe(0.9); // unchanged
    });

    it("set_decay tool sets a decay rate", async () => {
      const config = createEmotionMcpServer(manager);
      const tool = config.tools.find((t) => t.name === "set_decay");
      expect(tool).toBeDefined();

      const result = await tool!.handler({ dimension: "arousal", rate: 0.15 });
      const data = JSON.parse(result.content);
      expect(data.decayRates.arousal).toBe(0.15);
    });

    it("set_decay tool throws on unknown dimension", async () => {
      const config = createEmotionMcpServer(manager);
      const tool = config.tools.find((t) => t.name === "set_decay")!;
      await expect(tool.handler({ dimension: "fake", rate: 0.1 })).rejects.toThrow("Unknown dimension");
    });
  });
});
