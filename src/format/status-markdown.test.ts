import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { formatStatusMarkdown } from "./status-markdown.js";
import { StateManager } from "../state/state-manager.js";
import { DEFAULT_CONFIG } from "../types.js";

describe("formatStatusMarkdown", () => {
  let tmpDir: string;
  let manager: StateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "status-md-test-"));
    manager = new StateManager(path.join(tmpDir, "openfeelz.json"), DEFAULT_CONFIG);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("produces markdown with status header and dimension table", async () => {
    const state = await manager.getState();
    const md = formatStatusMarkdown(state);
    expect(md).toContain("# OpenFeelz Status");
    expect(md).toContain("## Dimensions");
    expect(md).toContain("| Dimension | Value | Baseline | Deviation |");
    expect(md).toContain("pleasure");
    expect(md).toContain("arousal");
  });

  it("includes OCEAN personality table", async () => {
    const state = await manager.getState();
    const md = formatStatusMarkdown(state);
    expect(md).toContain("## Personality (OCEAN)");
    expect(md).toContain("openness");
    expect(md).toContain("neuroticism");
  });

  it("includes basic emotions when present", async () => {
    let state = await manager.getState();
    state = manager.applyStimulus(state, "happy", 0.7, "test");
    const md = formatStatusMarkdown(state);
    expect(md).toContain("## Basic Emotions");
    expect(md).toContain("happiness");
  });

  it("includes decay rates table", async () => {
    const state = await manager.getState();
    const md = formatStatusMarkdown(state);
    expect(md).toContain("## Decay Rates");
    expect(md).toContain("Rate/hr");
  });

  it("includes recent stimuli when present", async () => {
    let state = await manager.getState();
    state = manager.applyStimulus(state, "curious", 0.5, "reading docs");
    const md = formatStatusMarkdown(state);
    expect(md).toContain("## Recent Stimuli");
    expect(md).toContain("reading docs");
  });

  it("shows primary emotion and intensity", async () => {
    let state = await manager.getState();
    state = manager.applyStimulus(state, "angry", 0.9, "traffic");
    const md = formatStatusMarkdown(state);
    expect(md).toContain("**Primary Emotion:**");
    expect(md).toContain("anger");
  });
});
