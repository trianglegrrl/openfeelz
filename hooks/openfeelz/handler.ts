/**
 * Standalone hook handler for workspace-level installation.
 *
 * This is a simplified version of the full plugin's bootstrap hook.
 * For the complete experience, install openfeelz as a plugin.
 */

import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../../src/types.js";
import { StateManager } from "../../src/state/state-manager.js";
import { createBootstrapHook } from "../../src/hook/hooks.js";

export default async function handler(event: any) {
  if (!event || event.type !== "agent" || event.action !== "bootstrap") {
    return;
  }

  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  const agentId = event.context?.agentId ?? "main";
  const workspaceDir =
    process.env.OPENCLAW_WORKSPACE ||
    path.join(stateDir, agentId === "main" ? "workspace" : `workspace-${agentId}`);
  const statePath = path.join(workspaceDir, "openfeelz.json");

  const config = {
    ...DEFAULT_CONFIG,
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.EMOTION_MODEL ?? DEFAULT_CONFIG.model,
    halfLifeHours: Number(process.env.EMOTION_HALF_LIFE_HOURS) || DEFAULT_CONFIG.halfLifeHours,
    timezone: process.env.EMOTION_TIMEZONE,
  };

  const manager = new StateManager(statePath, config);
  const hook = createBootstrapHook(manager, config);

  const result = await hook({
    prompt: event.context?.prompt ?? "",
    userKey: event.context?.senderId ?? "unknown",
    agentId,
  });

  if (result?.prependContext) {
    const context = event.context || {};
    if (!context.bootstrapFiles) context.bootstrapFiles = [];
    context.bootstrapFiles.push({
      path: "EMOTIONS.md",
      content: result.prependContext,
      text: result.prependContext,
    });
  }
}
