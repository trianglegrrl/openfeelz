/**
 * Markdown-formatted status output for the OpenFeelz.
 *
 * Produces a rich, readable markdown summary of the current emotional state,
 * suitable for API responses, MCP tools, and dashboard rendering.
 */

import type { EmotionEngineState } from "../types.js";
import { DIMENSION_NAMES, BASIC_EMOTION_NAMES, OCEAN_TRAITS } from "../types.js";
import { computePrimaryEmotion, computeOverallIntensity } from "../model/emotion-model.js";

/** Format an OpenFeelz state as a markdown document. */
export function formatStatusMarkdown(state: EmotionEngineState): string {
  const primary = computePrimaryEmotion(state.basicEmotions);
  const intensity = computeOverallIntensity(state.basicEmotions);

  const lines: string[] = [];

  lines.push("# OpenFeelz Status");
  lines.push("");
  lines.push(`**Primary Emotion:** ${primary} (intensity: ${(intensity * 100).toFixed(0)}%)`);
  lines.push(`**Last Updated:** ${new Date(state.lastUpdated).toLocaleString()} | **Updates:** ${state.meta.totalUpdates}`);
  lines.push("");

  // Dimensions table
  lines.push("## Dimensions");
  lines.push("");
  lines.push("| Dimension | Value | Baseline | Deviation |");
  lines.push("|-----------|-------|----------|-----------|");
  for (const name of DIMENSION_NAMES) {
    const val = state.dimensions[name];
    const base = state.baseline[name];
    const dev = val - base;
    const arrow = Math.abs(dev) < 0.01 ? "--" : dev > 0 ? "+" + dev.toFixed(2) : dev.toFixed(2);
    lines.push(`| ${name} | ${val.toFixed(2)} | ${base.toFixed(2)} | ${arrow} |`);
  }
  lines.push("");

  // Basic emotions table
  lines.push("## Basic Emotions");
  lines.push("");
  lines.push("| Emotion | Intensity |");
  lines.push("|---------|-----------|");
  for (const name of BASIC_EMOTION_NAMES) {
    const val = state.basicEmotions[name];
    if (val > 0.01) {
      lines.push(`| ${name} | ${val.toFixed(2)} |`);
    }
  }
  if (intensity < 0.01) {
    lines.push("| (neutral) | 0.00 |");
  }
  lines.push("");

  // OCEAN personality
  lines.push("## Personality (OCEAN)");
  lines.push("");
  lines.push("| Trait | Value |");
  lines.push("|-------|-------|");
  for (const trait of OCEAN_TRAITS) {
    lines.push(`| ${trait} | ${state.personality[trait].toFixed(2)} |`);
  }
  lines.push("");

  // Decay rates
  lines.push("## Decay Rates");
  lines.push("");
  lines.push("| Dimension | Rate/hr |");
  lines.push("|-----------|---------|");
  for (const name of DIMENSION_NAMES) {
    lines.push(`| ${name} | ${state.decayRates[name].toFixed(3)} |`);
  }
  lines.push("");

  // Recent stimuli
  if (state.recentStimuli.length > 0) {
    lines.push("## Recent Stimuli");
    lines.push("");
    for (const s of state.recentStimuli.slice(0, 8)) {
      const ts = new Date(s.timestamp).toLocaleString();
      lines.push(`- **${ts}**: ${s.label} (${s.intensity.toFixed(2)}) -- ${s.trigger}`);
    }
    lines.push("");
  }

  // Rumination
  if (state.rumination.active.length > 0) {
    lines.push("## Rumination");
    lines.push("");
    lines.push(`**${state.rumination.active.length} active:**`);
    for (const r of state.rumination.active) {
      lines.push(`- ${r.label} (stage ${r.stage}, intensity ${r.intensity.toFixed(2)})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
