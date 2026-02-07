import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDashboardHandler, buildDashboardHtml } from "./dashboard.js";
import { StateManager } from "../state/state-manager.js";
import { DEFAULT_CONFIG } from "../types.js";
import type { EmotionEngineConfig } from "../types.js";
import { DIMENSION_NAMES } from "../types.js";

describe("dashboard", () => {
  let tmpDir: string;
  let manager: StateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "emotion-dash-test-"));
    manager = new StateManager(path.join(tmpDir, "openfeelz.json"), DEFAULT_CONFIG);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("buildDashboardHtml", () => {
    it("produces valid HTML with emotion data", async () => {
      let state = await manager.getState();
      state = manager.applyStimulus(state, "happy", 0.7, "test");
      const html = buildDashboardHtml(state);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("OpenFeelz");
      expect(html).toContain("pleasure");
      expect(html).toContain("arousal");
    });

    it("includes glassmorphism styles", async () => {
      const state = await manager.getState();
      const html = buildDashboardHtml(state);
      expect(html).toContain("backdrop-filter");
      expect(html).toContain("rgba");
    });

    it("includes personality section", async () => {
      const state = await manager.getState();
      const html = buildDashboardHtml(state);
      expect(html).toContain("openness");
      expect(html).toContain("neuroticism");
    });

    it("includes interactive controls: apply-emotion form, sliders, analysis display, reset", async () => {
      const state = await manager.getState();
      const html = buildDashboardHtml(state);
      expect(html).toContain('id="apply-emotion"');
      expect(html).toContain('data-section="dimensions"');
      expect(html).toContain('data-section="personality"');
      expect(html).toContain('type="range"');
      expect(html).toContain('id="personality-output"');
      expect(html).toContain('id="state-output"');
      expect(html).toContain('id="btn-reset"');
      expect(html).toContain("__EMOTION_STATE__");
    });

    it("includes edit-state UI: save/cancel buttons and edited class hooks", async () => {
      const state = await manager.getState();
      const html = buildDashboardHtml(state);
      expect(html).toContain("section-actions");
      expect(html).toContain("btn-save");
      expect(html).toContain("btn-cancel");
      expect(html).toContain("card-edited");
    });
  });

  const getManager = () => manager;

  describe("createDashboardHandler", () => {
    it("returns a handler function", () => {
      const handler = createDashboardHandler(getManager);
      expect(typeof handler).toBe("function");
    });

    it("responds with HTML content", async () => {
      const handler = createDashboardHandler(getManager);
      let statusCode = 0;
      let body = "";
      const headers: Record<string, string> = {};

      const mockRes = {
        writeHead(code: number, hdrs: Record<string, string>) {
          statusCode = code;
          Object.assign(headers, hdrs);
        },
        end(content: string) {
          body = content;
        },
      };

      const mockReq = { url: "/emotion-dashboard", headers: { host: "localhost" } };
      await handler(mockReq as any, mockRes as any);

      expect(statusCode).toBe(200);
      expect(headers["content-type"]).toContain("text/html");
      expect(body).toContain("<!DOCTYPE html>");
    });

    it("responds with JSON when ?format=json", async () => {
      const handler = createDashboardHandler(getManager);
      let statusCode = 0;
      let body = "";

      const mockReq = { url: "/emotion-dashboard?format=json", headers: { host: "localhost" } };
      const mockRes = {
        writeHead(code: number) { statusCode = code; },
        end(content: string) { body = content; },
      };

      await handler(mockReq as any, mockRes as any);

      expect(statusCode).toBe(200);
      const data = JSON.parse(body);
      expect(data.dimensions).toBeDefined();
    });

    it("JSON response includes structured personalityAnalysis, emotionalStateDescription, cachedAnalysis, and statusMarkdown", async () => {
      const handler = createDashboardHandler(getManager);
      let body = "";
      const mockReq = { url: "/emotion-dashboard?format=json", headers: { host: "localhost" } };
      const mockRes = { writeHead: () => {}, end: (c: string) => { body = c; } };
      await handler(mockReq as any, mockRes as any);
      const data = JSON.parse(body);
      expect(data.personalityAnalysis).toBeDefined();
      expect(data.personalityAnalysis.pad).toBeDefined();
      expect(typeof data.personalityAnalysis.pad.pleasure).toBe("number");
      expect(data.personalityAnalysis.extensions).toBeDefined();
      expect(data.personalityAnalysis.ocean).toBeDefined();
      expect(typeof data.personalityAnalysis.ocean.openness).toBe("number");
      expect(data.emotionalStateDescription).toBeDefined();
      expect(typeof data.emotionalStateDescription.primary).toBe("string");
      expect(typeof data.emotionalStateDescription.intensity).toBe("number");
      expect(Array.isArray(data.emotionalStateDescription.notes)).toBe(true);
      expect(typeof data.statusMarkdown).toBe("string");
      expect(data.statusMarkdown).toContain("OpenFeelz Status");
      expect(data.statusMarkdown).toContain("Dimensions");
      expect("cachedAnalysis" in data).toBe(true);
    });
  });

  describe("POST actions", () => {
    function createPostRequest(payload: object): IncomingMessageLike {
      const body = JSON.stringify(payload);
      const stream = new Readable({ read() { this.push(Buffer.from(body)); this.push(null); } });
      return Object.assign(stream, {
        method: "POST",
        url: "/emotion-dashboard",
        headers: { host: "localhost", "content-type": "application/json" },
      }) as IncomingMessageLike;
    }

    it("modify: applies stimulus and returns 200 with state", async () => {
      const handler = createDashboardHandler(() => manager);
      let statusCode = 0;
      let body = "";
      const mockRes = {
        writeHead: (c: number) => { statusCode = c; },
        end: (b: string) => { body = b; },
      };
      const mockReq = createPostRequest({
        action: "modify",
        emotion: "happy",
        intensity: 0.8,
        trigger: "dashboard test",
      });

      await handler(mockReq as any, mockRes as any);

      expect(statusCode).toBe(200);
      const data = JSON.parse(body);
      expect(data.ok).toBe(true);
      expect(data.state.basicEmotions.happiness).toBeGreaterThan(0);
      const saved = await manager.getState();
      expect(saved.basicEmotions.happiness).toBeGreaterThan(0);
    });

    it("reset: resets to baseline and returns 200", async () => {
      let state = await manager.getState();
      state = manager.applyStimulus(state, "sad", 0.7, "pre");
      await manager.saveState(state);

      const handler = createDashboardHandler(() => manager);
      let body = "";
      const mockRes = { writeHead: () => {}, end: (b: string) => { body = b; } };
      const mockReq = createPostRequest({ action: "reset" });

      await handler(mockReq as any, mockRes as any);

      const data = JSON.parse(body);
      expect(data.ok).toBe(true);
      const saved = await manager.getState();
      expect(saved.basicEmotions.sadness).toBe(0);
    });

    it("set_personality: sets trait and returns 200", async () => {
      const handler = createDashboardHandler(() => manager);
      let body = "";
      const mockRes = { writeHead: () => {}, end: (b: string) => { body = b; } };
      const mockReq = createPostRequest({
        action: "set_personality",
        trait: "neuroticism",
        value: 0.9,
      });

      await handler(mockReq as any, mockRes as any);

      const data = JSON.parse(body);
      expect(data.ok).toBe(true);
      expect(data.state.personality.neuroticism).toBe(0.9);
    });

    it("set_dimension: sets dimension and returns 200", async () => {
      const handler = createDashboardHandler(() => manager);
      let body = "";
      const mockRes = { writeHead: () => {}, end: (b: string) => { body = b; } };
      const mockReq = createPostRequest({
        action: "set_dimension",
        dimension: "pleasure",
        value: 0.5,
      });

      await handler(mockReq as any, mockRes as any);

      const data = JSON.parse(body);
      expect(data.ok).toBe(true);
      expect(data.state.dimensions.pleasure).toBe(0.5);
    });

    it("set_decay: sets decay rate and returns 200", async () => {
      const handler = createDashboardHandler(() => manager);
      let body = "";
      const mockRes = { writeHead: () => {}, end: (b: string) => { body = b; } };
      const mockReq = createPostRequest({
        action: "set_decay",
        dimension: "arousal",
        rate: 0.2,
      });

      await handler(mockReq as any, mockRes as any);

      const data = JSON.parse(body);
      expect(data.ok).toBe(true);
      expect(data.state.decayRates.arousal).toBe(0.2);
    });

    it("batch: applies multiple updates and returns 200", async () => {
      const handler = createDashboardHandler(() => manager);
      let body = "";
      const mockRes = { writeHead: () => {}, end: (b: string) => { body = b; } };
      const mockReq = createPostRequest({
        action: "batch",
        updates: {
          dimensions: { pleasure: 0.3 },
          personality: { neuroticism: 0.7 },
        },
      });

      await handler(mockReq as any, mockRes as any);

      const data = JSON.parse(body);
      expect(data.ok).toBe(true);
      expect(data.state.dimensions.pleasure).toBe(0.3);
      expect(data.state.personality.neuroticism).toBe(0.7);
    });

    it("analyze_personality: returns 400 Unknown action (removed - use cached analysis)", async () => {
      const handler = createDashboardHandler(() => manager);
      let statusCode = 0;
      let body = "";
      const mockRes = { writeHead: (c: number) => { statusCode = c; }, end: (b: string) => { body = b; } };
      const mockReq = createPostRequest({ action: "analyze_personality" });

      await handler(mockReq as any, mockRes as any);

      expect(statusCode).toBe(400);
      const data = JSON.parse(body);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Unknown action");
    });

    it("describe_state: returns 400 Unknown action (removed - use cached analysis)", async () => {
      const handler = createDashboardHandler(() => manager);
      let statusCode = 0;
      let body = "";
      const mockRes = { writeHead: (c: number) => { statusCode = c; }, end: (b: string) => { body = b; } };
      const mockReq = createPostRequest({ action: "describe_state" });

      await handler(mockReq as any, mockRes as any);

      expect(statusCode).toBe(400);
      const data = JSON.parse(body);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Unknown action");
    });
  });
});

type IncomingMessageLike = { method: string; url: string; headers: Record<string, string> };
