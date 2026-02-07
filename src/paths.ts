/**
 * Resolve per-agent workspace and state paths from OpenClaw config.
 * Mirrors OpenClaw's resolveAgentWorkspaceDir so OpenFeelz state
 * lives in each agent's workspace (e.g. ~/.openclaw/workspace/openfeelz.json).
 */

import os from "node:os";
import path from "node:path";

type AgentEntry = { id?: string; workspace?: string; agentDir?: string; default?: boolean };
type ConfigShape = {
  agents?: {
    list?: AgentEntry[];
    defaults?: { workspace?: string };
  };
};

const DEFAULT_AGENT_ID = "main";

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

function normalizeAgentId(id: string | undefined): string {
  const s = String(id ?? DEFAULT_AGENT_ID).trim().toLowerCase();
  return s || DEFAULT_AGENT_ID;
}

function listAgents(cfg: ConfigShape): AgentEntry[] {
  const list = cfg?.agents?.list;
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is AgentEntry => Boolean(e && typeof e === "object"));
}

function resolveDefaultAgentId(cfg: ConfigShape): string {
  const agents = listAgents(cfg);
  if (agents.length === 0) return DEFAULT_AGENT_ID;
  const def = agents.find((a) => a?.default) ?? agents[0];
  return normalizeAgentId(def?.id);
}

function resolveAgentConfig(cfg: ConfigShape, agentId: string): AgentEntry | undefined {
  const id = normalizeAgentId(agentId);
  return listAgents(cfg).find((e) => normalizeAgentId(e.id) === id);
}

const DEFAULT_WORKSPACE_DIR = path.join(os.homedir(), ".openclaw", "workspace");

function resolveStateDir(): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  return path.join(os.homedir(), ".openclaw");
}

/**
 * Resolve the agent directory (where auth-profiles.json lives).
 * Used for API key resolution; state lives in workspace, not here.
 */
export function resolveAgentDir(cfg: ConfigShape | undefined, agentId: string): string {
  const id = normalizeAgentId(agentId);
  const agentConfig = resolveAgentConfig(cfg ?? {}, id);
  const configured = agentConfig?.agentDir?.trim();
  if (configured) return resolveUserPath(configured);
  return path.join(resolveStateDir(), "agents", id, "agent");
}

/**
 * Resolve the workspace directory for an agent from OpenClaw config.
 * Uses per-agent workspace if configured, otherwise defaults.workspace,
 * otherwise ~/.openclaw/workspace (or workspace-{id} for non-default agents).
 */
export function resolveAgentWorkspaceDir(cfg: ConfigShape | undefined, agentId: string): string {
  const id = normalizeAgentId(agentId);
  const c = cfg ?? {};

  const agentConfig = resolveAgentConfig(c, id);
  const configured = agentConfig?.workspace?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }

  const defaultAgentId = resolveDefaultAgentId(c);
  if (id === defaultAgentId) {
    const fallback = c.agents?.defaults?.workspace?.trim();
    if (fallback) return resolveUserPath(fallback);
    return DEFAULT_WORKSPACE_DIR;
  }

  return path.join(os.homedir(), ".openclaw", `workspace-${id}`);
}

/**
 * Resolve the OpenFeelz state file path for an agent.
 * Stored inside the agent's workspace: {workspace}/openfeelz.json
 */
export function resolveAgentStatePath(cfg: ConfigShape | undefined, agentId: string): string {
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  return path.join(workspaceDir, "openfeelz.json");
}

/**
 * List agent IDs from config (for decay service and multi-agent).
 */
export function listAgentIds(cfg: ConfigShape | undefined): string[] {
  const agents = listAgents(cfg ?? {});
  if (agents.length === 0) return [DEFAULT_AGENT_ID];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const e of agents) {
    const id = normalizeAgentId(e?.id);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : [DEFAULT_AGENT_ID];
}
