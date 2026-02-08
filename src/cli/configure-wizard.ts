/**
 * Interactive configuration wizard for OpenFeelz.
 * Uses @clack/prompts; run via `openclaw emotion wizard`.
 */

import { spawn } from "node:child_process";
import type { PersonalityPreset } from "../config/personality-presets.js";
import type { StateManager } from "../state/state-manager.js";
import type { EmotionEngineConfig } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";
import { backupOpenClawConfigOnce } from "./backup-openclaw-config.js";
import { validateConfigNumber } from "./configure-validation.js";

export interface ConfigureWizardContext {
  getManager: (agentId: string) => StateManager;
  agentId: string;
  pluginConfig?: Partial<EmotionEngineConfig>;
  openclawConfig?: unknown;
  workspaceDir?: string;
}

async function runOpenClawConfigSet(path: string, value: string | number | boolean): Promise<boolean> {
  const backupPath = await backupOpenClawConfigOnce();
  if (backupPath) {
    console.log(`[openfeelz] Backed up config to ${backupPath}`);
  }
  return new Promise((resolve) => {
    const valStr = typeof value === "string" ? value : JSON.stringify(value);
    const child = spawn("openclaw", ["config", "set", `plugins.entries.openfeelz.config.${path}`, valStr], {
      stdio: "inherit",
      shell: true,
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

/**
 * Run the interactive configure wizard.
 * Persists personality/state via StateManager; plugin config via openclaw config set or instructions.
 */
export async function runConfigureWizard(ctx: ConfigureWizardContext): Promise<void> {
  const clack = await import("@clack/prompts");
  const { intro, outro, select, confirm, text, isCancel } = clack;
  intro("Configure OpenFeelz (model, decay, personality)");

  const current = ctx.pluginConfig ?? {};
  let configChanged = false;

  try {
    const choice = await select({
      message: "Start from a famous-personality preset or configure manually?",
      options: [
        { value: "preset", label: "Choose a famous-personality preset" },
        { value: "custom", label: "Custom (no preset)" },
      ],
    });
    if (isCancel(choice)) {
      outro("Cancelled.");
      return;
    }

    if (choice === "preset") {
      const { listPresets, getPreset, applyPresetToState } = await import("../config/personality-presets.js");
      const presets = listPresets();
      const DONE_VALUE = "__done__";
      let presetApplied = false;

      while (!presetApplied) {
        console.log("\n" + formatPresetTable(presets) + "\n");
        const presetChoice = await select({
          message: "Pick one to see full detail and apply, or Done to skip preset",
          options: [
            ...presets.map((p) => ({
              value: p.id,
              label: `${p.name} — ${p.shortDescription}`,
              hint: formatPresetHint(p),
            })),
            { value: DONE_VALUE, label: "Done (no preset)" },
          ],
        });
        if (isCancel(presetChoice)) {
          outro("Cancelled.");
          return;
        }
        if (presetChoice === DONE_VALUE) {
          break;
        }
        const preset = presetChoice && typeof presetChoice === "string" ? getPreset(presetChoice) : undefined;
        if (!preset) continue;

        // Show detailed info about the selected personality
        console.log("");
        console.log(`  ${preset.name}`);
        console.log(`  ${preset.bio}`);
        console.log("");
        console.log("  OCEAN Profile:");
        const traitLabels = [
          ["openness", "Openness"],
          ["conscientiousness", "Conscientiousness"],
          ["extraversion", "Extraversion"],
          ["agreeableness", "Agreeableness"],
          ["neuroticism", "Neuroticism"],
        ] as const;
        for (const [key, label] of traitLabels) {
          const val = preset.ocean[key];
          const bar = renderTraitBar(val);
          const detail = preset.traitDetails[key] ?? "";
          console.log(`    ${label.padEnd(20)} ${bar} ${val.toFixed(2)}  ${detail}`);
        }
        console.log("");

        const applyIt = await confirm({
          message: `Apply ${preset.name}'s personality? (No = back to list)`,
          initialValue: true,
        });
        if (isCancel(applyIt)) {
          outro("Cancelled.");
          return;
        }
        if (applyIt) {
          const manager = ctx.getManager(ctx.agentId);
          let state = await manager.getState();
          state = applyPresetToState(state, preset.id);
          await manager.saveState(state);
          console.log(`\n  Applied preset: ${preset.name}`);
          presetApplied = true;
        }
        // If !applyIt, loop continues: show table and list again
      }
    }

    const configureMore = await confirm({
      message: "Configure model, decay, and feature flags?",
      initialValue: true,
    });
    if (isCancel(configureMore)) {
      outro("Done.");
      return;
    }
    if (configureMore) {
      const modelVal = await text({
        message: "Classification model",
        placeholder: (current.model as string) ?? DEFAULT_CONFIG.model,
        defaultValue: (current.model as string) ?? DEFAULT_CONFIG.model,
      });
      if (!isCancel(modelVal) && modelVal.trim()) {
        const ok = await runOpenClawConfigSet("model", modelVal.trim());
        if (ok) configChanged = true;
        else console.log("Tip: run openclaw config set plugins.entries.openfeelz.config.model \"<model>\" to save.");
      }

      const decayPresetChoice = await select({
        message: "Decay speed: how quickly emotions fade toward baseline",
        options: [
          {
            value: "fast",
            label: "Fast (AI-style) — emotions fade in ~1 hour",
            hint: "Good for fast-turnaround or model-only use",
          },
          {
            value: "slow",
            label: "Slow (human-like) — ~12h half-life",
            hint: "Emotions linger longer, more human-like",
          },
        ],
        initialValue: (current.decayPreset as string) ?? "slow",
      });
      if (!isCancel(decayPresetChoice)) {
        const ok = await runOpenClawConfigSet("decayPreset", decayPresetChoice);
        if (ok) configChanged = true;
      }

      const halfLifeStr = await text({
        message: "Decay half-life (hours) — used for context trend window",
        placeholder: String((current.halfLifeHours as number) ?? DEFAULT_CONFIG.halfLifeHours),
        defaultValue: String((current.halfLifeHours as number) ?? DEFAULT_CONFIG.halfLifeHours),
      });
      if (!isCancel(halfLifeStr)) {
        const num = parseFloat(halfLifeStr);
        const err = validateConfigNumber("halfLifeHours", num);
        if (err) {
          console.log(`Validation: ${err}`);
        } else {
          const ok = await runOpenClawConfigSet("halfLifeHours", num);
          if (ok) configChanged = true;
        }
      }

      const ruminationEnabledVal = await confirm({
        message: "Enable rumination? (intense emotions influence state over multiple turns)",
        initialValue: (current.ruminationEnabled as boolean) ?? DEFAULT_CONFIG.ruminationEnabled,
      });
      if (!isCancel(ruminationEnabledVal)) {
        const ok = await runOpenClawConfigSet("ruminationEnabled", ruminationEnabledVal);
        if (ok) configChanged = true;
      }

      const contextEnabledVal = await confirm({
        message: "Prepend emotional context to the agent system prompt?",
        initialValue: (current.contextEnabled as boolean) ?? DEFAULT_CONFIG.contextEnabled,
      });
      if (!isCancel(contextEnabledVal)) {
        const ok = await runOpenClawConfigSet("contextEnabled", contextEnabledVal);
        if (ok) configChanged = true;
      }

      const dashboardEnabledVal = await confirm({
        message: "Serve emotion dashboard at /emotion-dashboard?",
        initialValue: (current.dashboardEnabled as boolean) ?? DEFAULT_CONFIG.dashboardEnabled,
      });
      if (!isCancel(dashboardEnabledVal)) {
        const ok = await runOpenClawConfigSet("dashboardEnabled", dashboardEnabledVal);
        if (ok) configChanged = true;
      }
    }

    if (configChanged) {
      outro("Done. Restart the gateway to apply plugin config changes.");
    } else {
      outro("Done.");
    }
  } catch (err) {
    if (err && typeof err === "object" && "message" in err && String((err as Error).message).includes("cancel")) {
      outro("Cancelled.");
    } else {
      throw err;
    }
  }
}

function renderTraitBar(value: number): string {
  const width = 15;
  const filled = Math.round(value * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

const NAME_WIDTH = 26;
const COL_WIDTH = 5;

/**
 * Format presets as a printable table with Name and O C E A N columns.
 * Exported for tests.
 */
export function formatPresetTable(presets: readonly PersonalityPreset[]): string {
  const sep = "  " + "─".repeat(NAME_WIDTH + COL_WIDTH * 5 + 4);
  const lines: string[] = [
    "  Personality Presets:",
    sep,
    `  ${"Name".padEnd(NAME_WIDTH)}  O     C     E     A     N`,
    sep,
  ];
  for (const p of presets) {
    const name = p.name.slice(0, NAME_WIDTH).padEnd(NAME_WIDTH);
    const o = p.ocean.openness.toFixed(2).padStart(4);
    const c = p.ocean.conscientiousness.toFixed(2).padStart(4);
    const e = p.ocean.extraversion.toFixed(2).padStart(4);
    const a = p.ocean.agreeableness.toFixed(2).padStart(4);
    const n = p.ocean.neuroticism.toFixed(2).padStart(4);
    lines.push(`  ${name}  ${o}  ${c}  ${e}  ${a}  ${n}`);
  }
  lines.push(sep);
  lines.push("  O=Openness  C=Conscientiousness  E=Extraversion  A=Agreeableness  N=Neuroticism");
  return lines.join("\n");
}

/**
 * Format a one-line hint for select option (O:0.95 C:0.70 ...).
 * Exported for tests.
 */
export function formatPresetHint(preset: PersonalityPreset): string {
  return `O:${preset.ocean.openness.toFixed(2)} C:${preset.ocean.conscientiousness.toFixed(2)} E:${preset.ocean.extraversion.toFixed(2)} A:${preset.ocean.agreeableness.toFixed(2)} N:${preset.ocean.neuroticism.toFixed(2)}`;
}
