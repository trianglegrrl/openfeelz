#!/usr/bin/env node
/**
 * Smoke test for the analyzer with OpenAI.
 * Run: OPENAI_API_KEY=sk-... node scripts/test-analyzer-openai.mjs
 * Or: source ~/.bashrc && node scripts/test-analyzer-openai.mjs
 */
import { StateManager } from "../dist/src/state/state-manager.js";
import { analyzePersonalityViaLLM, describeEmotionalStateViaLLM } from "../dist/src/analysis/analyzer.js";
import { DEFAULT_CONFIG } from "../dist/src/types.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Set OPENAI_API_KEY to run this test.");
  process.exit(1);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "emotion-analyzer-test-"));
const statePath = path.join(tmpDir, "emotion.json");
const config = {
  ...DEFAULT_CONFIG,
  apiKey,
  model: process.env.EMOTION_MODEL || "gpt-5-mini",
  baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
};
const manager = new StateManager(statePath, config);

try {
  let state = await manager.getState();
  state = manager.applyStimulus(state, "happy", 0.5, "test stimulus");

  console.log("Calling analyzePersonalityViaLLM...");
  const personality = await analyzePersonalityViaLLM(state, {
    apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
  });
  console.log("Personality summary:", personality.summary?.slice(0, 100) + "...");

  console.log("Calling describeEmotionalStateViaLLM...");
  const emotional = await describeEmotionalStateViaLLM(state, {
    apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
  });
  console.log("Emotional summary:", emotional.summary?.slice(0, 100) + "...");

  console.log("OK - analyzer works with OpenAI");
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}
