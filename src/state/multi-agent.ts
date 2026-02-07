/**
 * Multi-agent emotional awareness.
 *
 * Loads other agents' emotional states from their workspace directories.
 * This is injected into the system prompt so the agent can be aware of
 * its peers' emotions.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { EmotionStimulus } from "../types.js";
import { readStateFile } from "./state-file.js";
import { listAgentIds, resolveAgentStatePath } from "../paths.js";

export interface OtherAgentEmotion {
  id: string;
  latest: EmotionStimulus;
}

type ConfigShape = Parameters<typeof resolveAgentStatePath>[0];

/**
 * Load emotional states from other agents using their workspace paths.
 *
 * @param openclawConfig - OpenClaw config (agents.list, agents.defaults)
 * @param currentAgentId - ID of the current agent (to exclude from results)
 * @param maxAgents - Maximum number of other agents to return
 */
export async function loadOtherAgentStatesFromConfig(
  openclawConfig: ConfigShape,
  currentAgentId: string,
  maxAgents: number,
): Promise<OtherAgentEmotion[]> {
  const results: OtherAgentEmotion[] = [];
  const ids = listAgentIds(openclawConfig);
  const current = currentAgentId?.trim().toLowerCase() || "main";

  for (const id of ids) {
    const normalized = id.trim().toLowerCase();
    if (normalized === current) continue;
    if (results.length >= maxAgents) break;

    const statePath = resolveAgentStatePath(openclawConfig, id);

    try {
      const state = await readStateFile(statePath);

      const agentBucket =
        state.agents[id] ??
        state.agents[normalized] ??
        Object.values(state.agents)[0];

      if (agentBucket?.latest) {
        results.push({ id, latest: agentBucket.latest });
      }
    } catch {
      continue;
    }
  }

  return results;
}

/**
 * Load emotional states from other agents in a legacy agents directory.
 * Used by tests that mock the agents/ layout.
 *
 * @param agentsRoot - Path to the `agents/` directory (parent of individual agent dirs)
 * @param currentAgentId - ID of the current agent (to exclude from results)
 * @param maxAgents - Maximum number of other agents to return
 */
export async function loadOtherAgentStates(
  agentsRoot: string,
  currentAgentId: string,
  maxAgents: number,
): Promise<OtherAgentEmotion[]> {
  const results: OtherAgentEmotion[] = [];
  const current = currentAgentId?.trim().toLowerCase() || "main";

  try {
    const entries = await fs.readdir(agentsRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const normalized = entry.name.trim().toLowerCase();
      if (normalized === current) continue;
      if (results.length >= maxAgents) break;

      const statePath = path.join(agentsRoot, entry.name, "agent", "openfeelz.json");

      try {
        const state = await readStateFile(statePath);
        const agentBucket =
          state.agents[entry.name] ?? state.agents[normalized] ?? Object.values(state.agents)[0];
        if (agentBucket?.latest) {
          results.push({ id: entry.name, latest: agentBucket.latest });
        }
      } catch {
        continue;
      }
    }
  } catch {
    // agents directory doesn't exist yet
  }

  return results;
}
