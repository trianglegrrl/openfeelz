import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEmotionTool } from "./emotion-tool.js";
import { DEFAULT_CONFIG } from "../types.js";
import { StateManager } from "../state/state-manager.js";

describe("emotion-tool", () => {
  let tmpDir: string;
  let manager: StateManager;
  let tool: ReturnType<typeof createEmotionTool>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "emotion-tool-test-"));
    const statePath = path.join(tmpDir, "openfeelz.json");
    manager = new StateManager(statePath, DEFAULT_CONFIG);
    tool = createEmotionTool(manager);
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("has correct metadata", () => {
    expect(tool.name).toBe("emotion_state");
    expect(tool.description).toBeDefined();
    expect(tool.parameters).toBeDefined();
  });

  describe("action: query", () => {
    it("returns full state", async () => {
      const result = await tool.execute("call-1", { action: "query" });
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe("text");
      const data = JSON.parse(result.content[0].text);
      expect(data.dimensions).toBeDefined();
      expect(data.basicEmotions).toBeDefined();
      expect(data.personality).toBeDefined();
    });

    it("returns summary format", async () => {
      const result = await tool.execute("call-1", { action: "query", format: "summary" });
      const data = JSON.parse(result.content[0].text);
      expect(data.primaryEmotion).toBeDefined();
      expect(data.overallIntensity).toBeDefined();
    });

    it("returns dimensions format", async () => {
      const result = await tool.execute("call-1", { action: "query", format: "dimensions" });
      const data = JSON.parse(result.content[0].text);
      expect(data.pleasure).toBeDefined();
      expect(data.arousal).toBeDefined();
    });

    it("returns emotions format", async () => {
      const result = await tool.execute("call-1", { action: "query", format: "emotions" });
      const data = JSON.parse(result.content[0].text);
      expect(data.happiness).toBeDefined();
      expect(data.anger).toBeDefined();
    });
  });

  describe("action: modify", () => {
    it("applies an emotional stimulus", async () => {
      const result = await tool.execute("call-1", {
        action: "modify",
        emotion: "angry",
        intensity: 0.8,
        trigger: "test trigger",
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.applied).toBe(true);
      expect(data.dimensions.pleasure).toBeLessThan(0);
      expect(data.dimensions.arousal).toBeGreaterThan(0);
    });

    it("defaults intensity to 0.5", async () => {
      const result = await tool.execute("call-1", {
        action: "modify",
        emotion: "happy",
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.applied).toBe(true);
    });
  });

  describe("action: set_dimension", () => {
    it("sets a dimension to absolute value", async () => {
      const result = await tool.execute("call-1", {
        action: "set_dimension",
        dimension: "pleasure",
        value: 0.7,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.dimensions.pleasure).toBe(0.7);
    });

    it("applies delta when delta is provided", async () => {
      const result = await tool.execute("call-1", {
        action: "set_dimension",
        dimension: "pleasure",
        delta: 0.3,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.dimensions.pleasure).toBe(0.3);
    });

    it("throws on unknown dimension", async () => {
      await expect(
        tool.execute("call-1", {
          action: "set_dimension",
          dimension: "nonexistent",
          value: 0.5,
        }),
      ).rejects.toThrow();
    });
  });

  describe("action: reset", () => {
    it("resets all dimensions to baseline", async () => {
      // First apply a stimulus
      await tool.execute("call-1", { action: "modify", emotion: "angry", intensity: 0.9 });
      // Then reset
      const result = await tool.execute("call-2", { action: "reset" });
      const data = JSON.parse(result.content[0].text);
      expect(data.reset).toBe(true);
    });

    it("resets only specified dimensions", async () => {
      await tool.execute("call-1", { action: "modify", emotion: "angry", intensity: 0.9 });
      const result = await tool.execute("call-2", {
        action: "reset",
        dimensions: ["pleasure"],
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.reset).toBe(true);
    });
  });

  describe("action: set_personality", () => {
    it("sets an OCEAN trait", async () => {
      const result = await tool.execute("call-1", {
        action: "set_personality",
        trait: "openness",
        value: 0.9,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.personality.openness).toBe(0.9);
    });

    it("throws on unknown trait", async () => {
      await expect(
        tool.execute("call-1", {
          action: "set_personality",
          trait: "nonexistent",
          value: 0.5,
        }),
      ).rejects.toThrow();
    });
  });

  describe("action: get_personality", () => {
    it("returns current personality profile", async () => {
      const result = await tool.execute("call-1", { action: "get_personality" });
      const data = JSON.parse(result.content[0].text);
      expect(data.openness).toBeDefined();
      expect(data.conscientiousness).toBeDefined();
      expect(data.extraversion).toBeDefined();
      expect(data.agreeableness).toBeDefined();
      expect(data.neuroticism).toBeDefined();
    });
  });
});
