import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerEmotionCli } from "./cli.js";
import { StateManager } from "../state/state-manager.js";
import { DEFAULT_CONFIG } from "../types.js";

// Commander is a peer dependency; install it for testing
// The actual OpenClaw installation provides it.

describe("cli", () => {
  let tmpDir: string;
  let statePath: string;
  let manager: StateManager;
  let program: Command;
  let output: string[];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "emotion-cli-test-"));
    statePath = path.join(tmpDir, "openfeelz.json");
    manager = new StateManager(statePath, DEFAULT_CONFIG);
    program = new Command();
    program.exitOverride(); // Don't call process.exit
    output = [];
    // Capture console.log output
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function run(...args: string[]) {
    return program.parseAsync(["node", "test", ...args]);
  }

  const getManager = (_id: string) => manager;

  it("registers the emotion command", () => {
    registerEmotionCli({ program, getManager });
    const cmd = program.commands.find((c) => c.name() === "emotion");
    expect(cmd).toBeDefined();
  });

  it("registers emotion wizard subcommand", () => {
    registerEmotionCli({ program, getManager });
    const emotionCmd = program.commands.find((c) => c.name() === "emotion");
    expect(emotionCmd).toBeDefined();
    const wizardCmd = emotionCmd!.commands.find((c) => c.name() === "wizard");
    expect(wizardCmd).toBeDefined();
  });

  describe("status", () => {
    it("prints formatted state", async () => {
      registerEmotionCli({ program, getManager });
      await run("emotion", "status");
      const text = output.join("\n");
      expect(text).toContain("pleasure");
      expect(text).toContain("arousal");
    });

    it("prints JSON with --json flag", async () => {
      registerEmotionCli({ program, getManager });
      await run("emotion", "status", "--json");
      const text = output.join("\n");
      const data = JSON.parse(text);
      expect(data.dimensions).toBeDefined();
    });
  });

  describe("personality", () => {
    it("shows current personality", async () => {
      registerEmotionCli({ program, getManager });
      await run("emotion", "personality");
      const text = output.join("\n");
      expect(text).toContain("openness");
    });

    it("sets a trait with set subcommand", async () => {
      registerEmotionCli({ program, getManager });
      await run("emotion", "personality", "set", "--trait", "openness", "--value", "0.8");
      const state = await manager.getState();
      expect(state.personality.openness).toBe(0.8);
    });
  });

  describe("reset", () => {
    it("resets to baseline", async () => {
      registerEmotionCli({ program, getManager });
      // First apply a stimulus
      let state = await manager.getState();
      state = manager.applyStimulus(state, "angry", 0.9, "test");
      await manager.saveState(state);

      await run("emotion", "reset");
      const text = output.join("\n");
      expect(text.toLowerCase()).toContain("reset");
    });
  });

  describe("history", () => {
    it("shows recent stimuli", async () => {
      registerEmotionCli({ program, getManager });
      let state = await manager.getState();
      state = manager.applyStimulus(state, "happy", 0.7, "good news");
      await manager.saveState(state);

      await run("emotion", "history");
      const text = output.join("\n");
      expect(text).toContain("happy");
    });
  });

  describe("modify", () => {
    it("applies stimulus and updates state", async () => {
      registerEmotionCli({ program, getManager });
      await run("emotion", "modify", "--emotion", "angry", "--intensity", "0.8", "--trigger", "test");
      const state = await manager.getState();
      expect(state.basicEmotions.anger).toBeGreaterThan(0.1);
      expect(output.join("\n")).toContain("Applied stimulus");
    });
  });

  describe("context", () => {
    it("outputs personality block when state is neutral (always at least OCEAN)", async () => {
      registerEmotionCli({ program, getManager });
      await run("emotion", "context");
      const text = output.join("\n");
      expect(text).toContain("<emotion_state>");
      expect(text).toContain("<personality>");
      expect(text).toContain("openness:");
    });

    it("outputs emotion block after stimulus", async () => {
      registerEmotionCli({ program, getManager });
      // Use strong anger to produce dimension deviations above threshold (0.15)
      await run("emotion", "modify", "--emotion", "angry", "--intensity", "0.9", "--trigger", "test");
      output = [];
      await run("emotion", "context");
      const text = output.join("\n");
      expect(text).toContain("<emotion_state>");
      expect(text).toContain("dimensions");
    });
  });
});
