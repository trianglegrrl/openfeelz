import { describe, it, expect, vi } from "vitest";
import {
  classifyEmotion,
  buildClassifierPrompt,
  parseClassifierResponse,
  coerceClassificationResult,
} from "./classifier.js";
import { DEFAULT_CONFIG } from "../types.js";

describe("classifier", () => {
  // -----------------------------------------------------------------------
  // buildClassifierPrompt
  // -----------------------------------------------------------------------

  describe("buildClassifierPrompt", () => {
    it("includes the role in the prompt", () => {
      const prompt = buildClassifierPrompt("Hello world", "user", DEFAULT_CONFIG.emotionLabels);
      expect(prompt).toContain("user");
      expect(prompt).toContain("Hello world");
    });

    it("includes available emotion labels", () => {
      const labels = ["happy", "sad", "angry"];
      const prompt = buildClassifierPrompt("test", "assistant", labels);
      expect(prompt).toContain("happy");
      expect(prompt).toContain("sad");
      expect(prompt).toContain("angry");
    });

    it("asks for JSON output", () => {
      const prompt = buildClassifierPrompt("test", "user", DEFAULT_CONFIG.emotionLabels);
      expect(prompt.toLowerCase()).toContain("json");
    });
  });

  // -----------------------------------------------------------------------
  // parseClassifierResponse
  // -----------------------------------------------------------------------

  describe("parseClassifierResponse", () => {
    it("parses valid JSON response", () => {
      const raw = JSON.stringify({
        label: "happy",
        intensity: 0.7,
        reason: "user expressed delight",
        confidence: 0.85,
      });
      const result = parseClassifierResponse(raw);
      expect(result.label).toBe("happy");
      expect(result.intensity).toBe(0.7);
      expect(result.reason).toBe("user expressed delight");
      expect(result.confidence).toBe(0.85);
    });

    it("extracts JSON from markdown code block", () => {
      const raw = '```json\n{"label":"sad","intensity":0.5,"reason":"low mood","confidence":0.6}\n```';
      const result = parseClassifierResponse(raw);
      expect(result.label).toBe("sad");
    });

    it("throws on invalid JSON", () => {
      expect(() => parseClassifierResponse("not json")).toThrow();
    });

    it("throws on missing required fields", () => {
      const raw = JSON.stringify({ label: "happy" }); // missing intensity, reason, confidence
      expect(() => parseClassifierResponse(raw)).toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // coerceClassificationResult
  // -----------------------------------------------------------------------

  describe("coerceClassificationResult", () => {
    const labels = DEFAULT_CONFIG.emotionLabels;

    it("normalizes label to lowercase", () => {
      const result = coerceClassificationResult(
        { label: "HAPPY", intensity: 0.5, reason: "test", confidence: 0.8 },
        labels,
        0.35,
      );
      expect(result.label).toBe("happy");
    });

    it("falls back to neutral for unknown labels", () => {
      const result = coerceClassificationResult(
        { label: "zzz_unknown", intensity: 0.5, reason: "test", confidence: 0.8 },
        labels,
        0.35,
      );
      expect(result.label).toBe("neutral");
    });

    it("clamps intensity to [0, 1]", () => {
      const result = coerceClassificationResult(
        { label: "happy", intensity: 1.5, reason: "test", confidence: 0.8 },
        labels,
        0.35,
      );
      expect(result.intensity).toBe(1);
    });

    it("falls back to neutral when confidence is below minimum", () => {
      const result = coerceClassificationResult(
        { label: "angry", intensity: 0.8, reason: "test", confidence: 0.1 },
        labels,
        0.35,
      );
      expect(result.label).toBe("neutral");
      expect(result.intensity).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // classifyEmotion -- Anthropic backend (mock)
  // -----------------------------------------------------------------------

  describe("classifyEmotion (Anthropic)", () => {
    it("calls Anthropic Messages API for claude models", async () => {
      const mockResponse = {
        label: "happy",
        intensity: 0.7,
        reason: "positive greeting",
        confidence: 0.9,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [
              { type: "text", text: JSON.stringify(mockResponse) },
            ],
          }),
      });

      const result = await classifyEmotion(
        "Hello! Great to see you!",
        "user",
        {
          apiKey: "sk-ant-test",
          model: "claude-sonnet-4-5-20250514",
          emotionLabels: DEFAULT_CONFIG.emotionLabels,
          confidenceMin: 0.35,
          fetchFn: mockFetch,
        },
      );

      expect(result.label).toBe("happy");
      expect(result.intensity).toBe(0.7);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify it called the Anthropic endpoint
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe("https://api.anthropic.com/v1/messages");
      expect(callArgs[1].headers["x-api-key"]).toBe("sk-ant-test");
      expect(callArgs[1].headers["anthropic-version"]).toBe("2023-06-01");
    });

    it("auto-detects Anthropic from model name containing 'claude'", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [
              { type: "text", text: JSON.stringify({ label: "calm", intensity: 0.3, reason: "test", confidence: 0.8 }) },
            ],
          }),
      });

      await classifyEmotion("test", "user", {
        apiKey: "sk-ant-test",
        model: "claude-3-haiku-20240307",
        emotionLabels: DEFAULT_CONFIG.emotionLabels,
        confidenceMin: 0.35,
        fetchFn: mockFetch,
      });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe("https://api.anthropic.com/v1/messages");
    });

    it("returns neutral on Anthropic error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve("rate limited"),
      });

      const result = await classifyEmotion("test", "user", {
        apiKey: "sk-ant-test",
        model: "claude-sonnet-4-5-20250514",
        emotionLabels: DEFAULT_CONFIG.emotionLabels,
        confidenceMin: 0.35,
        fetchFn: mockFetch,
      });

      expect(result.label).toBe("neutral");
    });
  });

  // -----------------------------------------------------------------------
  // classifyEmotion -- OpenAI backend (mock)
  // -----------------------------------------------------------------------

  describe("classifyEmotion (OpenAI)", () => {
    it("calls OpenAI for gpt models", async () => {
      const mockResponse = {
        label: "happy",
        intensity: 0.7,
        reason: "positive greeting",
        confidence: 0.9,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              { message: { content: JSON.stringify(mockResponse) } },
            ],
          }),
      });

      const result = await classifyEmotion(
        "Hello! Great to see you!",
        "user",
        {
          apiKey: "sk-test",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          emotionLabels: DEFAULT_CONFIG.emotionLabels,
          confidenceMin: 0.35,
          fetchFn: mockFetch,
        },
      );

      expect(result.label).toBe("happy");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain("openai.com");
    });
  });

  // -----------------------------------------------------------------------
  // classifyEmotion -- External endpoint
  // -----------------------------------------------------------------------

  describe("classifyEmotion (endpoint)", () => {
    it("calls external endpoint when classifierUrl is set", async () => {
      const mockResponse = {
        label: "frustrated",
        intensity: 0.6,
        reason: "deployment issues",
        confidence: 0.8,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await classifyEmotion(
        "This deployment keeps failing",
        "user",
        {
          classifierUrl: "https://classifier.example.com/classify",
          emotionLabels: DEFAULT_CONFIG.emotionLabels,
          confidenceMin: 0.35,
          fetchFn: mockFetch,
        },
      );

      expect(result.label).toBe("frustrated");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://classifier.example.com/classify",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // classifyEmotion -- Error handling
  // -----------------------------------------------------------------------

  describe("classifyEmotion (errors)", () => {
    it("returns neutral on fetch failure", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));

      const result = await classifyEmotion(
        "test message",
        "user",
        {
          apiKey: "test-key",
          model: "gpt-4o-mini",
          emotionLabels: DEFAULT_CONFIG.emotionLabels,
          confidenceMin: 0.35,
          fetchFn: mockFetch,
        },
      );

      expect(result.label).toBe("neutral");
      expect(result.intensity).toBe(0);
      expect(result.confidence).toBe(0);
    });

    it("returns neutral on non-ok response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("error"),
      });

      const result = await classifyEmotion(
        "test",
        "user",
        {
          apiKey: "test-key",
          model: "claude-sonnet-4-5-20250514",
          emotionLabels: DEFAULT_CONFIG.emotionLabels,
          confidenceMin: 0.35,
          fetchFn: mockFetch,
        },
      );

      expect(result.label).toBe("neutral");
    });

    it("throws when no apiKey and no classifierUrl", async () => {
      await expect(
        classifyEmotion("test", "user", {
          emotionLabels: DEFAULT_CONFIG.emotionLabels,
          confidenceMin: 0.35,
        }),
      ).rejects.toThrow();
    });
  });
});
