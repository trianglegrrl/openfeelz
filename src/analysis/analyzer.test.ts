import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { analyzePersonalityViaLLM, describeEmotionalStateViaLLM } from "./analyzer.js";
import type { AnalyzerOptions } from "./analyzer.js";
import { StateManager } from "../state/state-manager.js";
import { DEFAULT_CONFIG } from "../types.js";

function mockOptsWithFetch(textResponse: string): AnalyzerOptions {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        content: [{ type: "text", text: textResponse }],
      }),
  });
  return {
    apiKey: "sk-ant-test",
    fetchFn: mockFetch,
  };
}

function mockOptsWithFetchCapture(capture: { prompt: string }, textResponse: string): AnalyzerOptions {
  const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = init?.body;
    if (typeof body === "string") {
      const parsed = JSON.parse(body) as { messages?: Array<{ role: string; content: string }> };
      const userMsg = parsed.messages?.find((m) => m.role === "user");
      if (userMsg?.content) capture.prompt = userMsg.content;
    }
    return {
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: textResponse }],
        }),
    };
  });
  return {
    apiKey: "sk-ant-test",
    fetchFn: mockFetch,
  };
}

describe("analyzer", () => {
  let tmpDir: string;
  let manager: StateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "analyzer-test-"));
    manager = new StateManager(path.join(tmpDir, "emotion.json"), DEFAULT_CONFIG);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("analyzePersonalityViaLLM", () => {
    it("calls the LLM and returns structured analysis with summary", async () => {
      const llmResponse = JSON.stringify({
        summary: "Your personality profile indicates a balanced profile with moderate traits across all OCEAN dimensions.",
        pad: { pleasure: 0, arousal: 0, dominance: 0 },
        extensions: { connection: 0.5, curiosity: 0.5, energy: 0.5, trust: 0.5 },
        ocean: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
      });
      const state = await manager.getState();

      const result = await analyzePersonalityViaLLM(state, mockOptsWithFetch(llmResponse));

      expect(result.summary).toContain("balanced profile");
      expect(result.pad).toBeDefined();
      expect(result.ocean).toBeDefined();
      expect(result.extensions).toBeDefined();
    });

    it("includes state values in the prompt sent to the LLM", async () => {
      const llmResponse = JSON.stringify({
        summary: "Test summary",
        pad: { pleasure: 0, arousal: 0, dominance: 0 },
        extensions: { connection: 0.5, curiosity: 0.5, energy: 0.5, trust: 0.5 },
        ocean: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
      });
      const captured = { prompt: "" };
      let state = await manager.getState();
      state = manager.setPersonalityTrait(state, "neuroticism", 0.9);

      await analyzePersonalityViaLLM(state, mockOptsWithFetchCapture(captured, llmResponse));

      expect(captured.prompt).toContain("neuroticism");
      expect(captured.prompt).toContain("0.9");
    });

    it("throws on invalid LLM response", async () => {
      const state = await manager.getState();

      await expect(analyzePersonalityViaLLM(state, mockOptsWithFetch("not json at all"))).rejects.toThrow();
    });

    it("throws when LLM returns JSON without summary", async () => {
      const state = await manager.getState();

      await expect(
        analyzePersonalityViaLLM(state, mockOptsWithFetch(JSON.stringify({ pad: {}, extensions: {}, ocean: {} }))),
      ).rejects.toThrow("summary");
    });

    it("throws when apiKey is missing", async () => {
      const state = await manager.getState();

      await expect(
        analyzePersonalityViaLLM(state, { fetchFn: vi.fn() }),
      ).rejects.toThrow("apiKey");
    });
  });

  describe("describeEmotionalStateViaLLM", () => {
    it("calls the LLM and returns structured description with summary", async () => {
      const llmResponse = JSON.stringify({
        summary: "You are in a mildly happy emotional state with a calm baseline.",
        primary: "happiness",
        intensity: 0.15,
        notes: ["Mild positive affect", "Low arousal"],
      });
      let state = await manager.getState();
      state = manager.applyStimulus(state, "happy", 0.5, "test");

      const result = await describeEmotionalStateViaLLM(state, mockOptsWithFetch(llmResponse));

      expect(result.summary).toContain("happy");
      expect(result.primary).toBe("happiness");
      expect(typeof result.intensity).toBe("number");
      expect(Array.isArray(result.notes)).toBe(true);
    });

    it("throws on invalid LLM response", async () => {
      const state = await manager.getState();

      await expect(describeEmotionalStateViaLLM(state, mockOptsWithFetch("broken"))).rejects.toThrow();
    });
  });
});
