/**
 * CLI commands for the OpenFeelz plugin.
 *
 * Registered via api.registerCli() with Commander.js.
 *
 * Commands:
 *   openclaw emotion status [--json]
 *   openclaw emotion personality
 *   openclaw emotion personality set --trait <name> --value <n>
 *   openclaw emotion reset [--dimensions <names>]
 *   openclaw emotion history [--limit <n>]
 *   openclaw emotion decay --dimension <name> --rate <n>
 */

import type { Command } from "commander";
import type { OCEANTrait, DimensionName } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";
import { DIMENSION_NAMES, OCEAN_TRAITS } from "../types.js";
import {
  computePrimaryEmotion,
  computeOverallIntensity,
} from "../model/emotion-model.js";
import { formatEmotionBlock } from "../format/prompt-formatter.js";
import type { EmotionEngineConfig } from "../types.js";
import type { StateManager } from "../state/state-manager.js";

interface CliParams {
  program: Command;
  getManager: (agentId: string) => StateManager;
  config?: Partial<EmotionEngineConfig>;
}

export function registerEmotionCli({ program, getManager, config }: CliParams): void {
  const root = program
    .command("emotion")
    .description("OpenFeelz utilities")
    .option("--agent <id>", "Agent ID", "main");

  const agentOpts = () => (root.opts() as { agent?: string }).agent ?? "main";

  // -----------------------------------------------------------------------
  // status
  // -----------------------------------------------------------------------

  root
    .command("status")
    .description("Show current emotional state")
    .option("--agent <id>", "Agent ID", "main")
    .option("--json", "Output raw JSON")
    .action(async (opts: { json?: boolean; agent?: string }) => {
      const manager = getManager(opts.agent ?? agentOpts());
      let state = await manager.getState();
      state = manager.applyDecay(state);
      await manager.saveState(state);

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              dimensions: state.dimensions,
              basicEmotions: state.basicEmotions,
              personality: state.personality,
              primaryEmotion: computePrimaryEmotion(state.basicEmotions),
              overallIntensity: computeOverallIntensity(state.basicEmotions),
              ruminationActive: state.rumination.active.length,
              totalUpdates: state.meta.totalUpdates,
            },
            null,
            2,
          ),
        );
        return;
      }

      const primary = computePrimaryEmotion(state.basicEmotions);
      const intensity = computeOverallIntensity(state.basicEmotions);

      console.log(`Primary Emotion: ${primary} (intensity: ${intensity.toFixed(2)})`);
      console.log(`\nDimensions:`);
      for (const dim of DIMENSION_NAMES) {
        const val = state.dimensions[dim];
        const base = state.baseline[dim];
        const bar = renderBar(val, dim === "pleasure" || dim === "arousal" || dim === "dominance");
        console.log(`  ${dim.padEnd(12)} ${bar} ${val.toFixed(2)} (baseline: ${base.toFixed(2)})`);
      }

      console.log(`\nBasic Emotions:`);
      for (const emo of ["happiness", "sadness", "anger", "fear", "disgust", "surprise"] as const) {
        const val = state.basicEmotions[emo];
        if (val > 0.01) {
          console.log(`  ${emo.padEnd(12)} ${renderBar(val, false)} ${val.toFixed(2)}`);
        }
      }

      if (state.rumination.active.length > 0) {
        console.log(`\nRumination: ${state.rumination.active.length} active`);
        for (const entry of state.rumination.active) {
          console.log(`  ${entry.label} (stage ${entry.stage}, intensity ${entry.intensity.toFixed(2)})`);
        }
      }

      console.log(`\nTotal Updates: ${state.meta.totalUpdates}`);
    });

  // -----------------------------------------------------------------------
  // context
  // -----------------------------------------------------------------------

  root
    .command("context")
    .description("Output emotion state as XML block (as injected into system prompt)")
    .option("--agent <id>", "Agent ID", "main")
    .option("--user <key>", "User key for user emotion bucket", "default")
    .action(async (opts: { agent?: string; user?: string }) => {
      const manager = getManager(opts.agent ?? agentOpts());
      let state = await manager.getState();
      state = manager.applyDecay(state);
      state = manager.advanceRumination(state);
      await manager.saveState(state);

      const cfg = config ?? {};
      const block = formatEmotionBlock(state, opts.user ?? "default", opts.agent ?? agentOpts(), {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: cfg.halfLifeHours ?? DEFAULT_CONFIG.halfLifeHours,
        trendWindowHours: cfg.trendWindowHours ?? DEFAULT_CONFIG.trendWindowHours,
        timeZone: cfg.timezone,
        otherAgents: [],
      });

      if (!block) {
        console.log("(no emotion context to inject — state is neutral/empty)");
        return;
      }
      console.log(block);
    });

  // -----------------------------------------------------------------------
  // modify
  // -----------------------------------------------------------------------

  root
    .command("modify")
    .description("Apply an emotion stimulus (updates dimensional + basic emotion state)")
    .option("--agent <id>", "Agent ID", "main")
    .requiredOption("--emotion <label>", "Emotion label (e.g. angry, happy, calm)")
    .requiredOption("--intensity <0-1>", "Intensity 0-1", parseFloat)
    .option("--trigger <text>", "What triggered the emotion", "CLI")
    .action(async (opts: { agent?: string; emotion: string; intensity: number; trigger?: string }) => {
      const manager = getManager(opts.agent ?? agentOpts());
      let state = await manager.getState();
      state = manager.applyStimulus(state, opts.emotion, opts.intensity, opts.trigger ?? "CLI");
      await manager.saveState(state);
      console.log(`Applied stimulus: ${opts.emotion} (${opts.intensity}) — ${opts.trigger ?? "CLI"}`);
    });

  // -----------------------------------------------------------------------
  // personality
  // -----------------------------------------------------------------------

  const personalityCmd = root
    .command("personality")
    .description("Show or set OCEAN personality traits")
    .option("--agent <id>", "Agent ID", "main")
    .action(async (opts: { agent?: string }) => {
      const manager = getManager(opts.agent ?? agentOpts());
      const state = await manager.getState();
      console.log("OCEAN Personality Profile:");
      for (const trait of OCEAN_TRAITS) {
        const val = state.personality[trait];
        console.log(`  ${trait.padEnd(20)} ${renderBar(val, false)} ${val.toFixed(2)}`);
      }
    });

  personalityCmd
    .command("set")
    .description("Set a personality trait")
    .option("--agent <id>", "Agent ID", "main")
    .requiredOption("--trait <name>", "OCEAN trait name")
    .requiredOption("--value <number>", "Trait value (0-1)", parseFloat)
    .action(async (opts: { trait: string; value: number; agent?: string }) => {
      if (!OCEAN_TRAITS.includes(opts.trait as OCEANTrait)) {
        throw new Error(`Unknown trait "${opts.trait}". Valid: ${OCEAN_TRAITS.join(", ")}`);
      }
      const manager = getManager(opts.agent ?? agentOpts());
      let state = await manager.getState();
      state = manager.setPersonalityTrait(state, opts.trait as OCEANTrait, opts.value);
      await manager.saveState(state);
      console.log(`Set ${opts.trait} = ${opts.value}`);
    });

  // -----------------------------------------------------------------------
  // reset
  // -----------------------------------------------------------------------

  root
    .command("reset")
    .description("Reset emotional state to baseline")
    .option("--agent <id>", "Agent ID", "main")
    .option("--dimensions <names>", "Comma-separated dimension names", (val: string) =>
      val.split(",").map((s) => s.trim()),
    )
    .action(async (opts: { dimensions?: string[]; agent?: string }) => {
      const manager = getManager(opts.agent ?? agentOpts());
      let state = await manager.getState();
      const validDims = opts.dimensions?.filter((d) =>
        DIMENSION_NAMES.includes(d as DimensionName),
      ) as DimensionName[] | undefined;
      state = manager.resetToBaseline(state, validDims);
      await manager.saveState(state);
      console.log(`Reset ${validDims ? validDims.join(", ") : "all dimensions"} to baseline.`);
    });

  // -----------------------------------------------------------------------
  // history
  // -----------------------------------------------------------------------

  root
    .command("history")
    .description("Show recent emotional stimuli")
    .option("--agent <id>", "Agent ID", "main")
    .option("--limit <n>", "Max entries to show", "10")
    .action(async (opts: { limit: string; agent?: string }) => {
      const manager = getManager(opts.agent ?? agentOpts());
      const state = await manager.getState();
      const limit = parseInt(opts.limit, 10) || 10;
      const entries = state.recentStimuli.slice(0, limit);

      if (entries.length === 0) {
        console.log("No recent emotional stimuli.");
        return;
      }

      console.log(`Recent Stimuli (${entries.length}):`);
      for (const entry of entries) {
        const ts = new Date(entry.timestamp).toLocaleString();
        console.log(`  ${ts} | ${entry.label} (${entry.intensity.toFixed(2)}) - ${entry.trigger}`);
      }
    });

  // -----------------------------------------------------------------------
  // decay
  // -----------------------------------------------------------------------

  root
    .command("decay")
    .description("Configure decay rates")
    .option("--agent <id>", "Agent ID", "main")
    .requiredOption("--dimension <name>", "Dimension name")
    .requiredOption("--rate <number>", "Decay rate (per hour)", parseFloat)
    .action(async (opts: { dimension: string; rate: number; agent?: string }) => {
      if (!DIMENSION_NAMES.includes(opts.dimension as DimensionName)) {
        throw new Error(
          `Unknown dimension "${opts.dimension}". Valid: ${DIMENSION_NAMES.join(", ")}`,
        );
      }
      const manager = getManager(opts.agent ?? agentOpts());
      let state = await manager.getState();
      state.decayRates[opts.dimension as DimensionName] = opts.rate;
      await manager.saveState(state);
      console.log(`Set ${opts.dimension} decay rate to ${opts.rate}/hr`);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderBar(value: number, bipolar: boolean): string {
  const width = 20;
  if (bipolar) {
    // -1 to +1 range, center at middle
    const normalized = (value + 1) / 2; // 0 to 1
    const filled = Math.round(normalized * width);
    const center = Math.round(width / 2);
    const bar = Array.from({ length: width }, (_, i) => {
      if (i === center) return "|";
      if ((filled > center && i >= center && i < filled) || (filled < center && i >= filled && i < center)) {
        return "=";
      }
      return ".";
    }).join("");
    return `[${bar}]`;
  }
  // 0 to 1 range
  const filled = Math.round(value * width);
  return `[${"=".repeat(filled)}${".".repeat(width - filled)}]`;
}
