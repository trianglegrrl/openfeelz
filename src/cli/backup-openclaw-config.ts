/**
 * Back up openclaw.json before the wizard or CLI modifies it.
 * Uses OPENCLAW_CONFIG env if set, else ~/.openclaw/openclaw.json.
 * Backups go to ~/.openclaw/backups/openclaw-pre-openfeelz-YYYYMMDD-HHMMSS.json.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".openclaw", "openclaw.json");
const DEFAULT_BACKUP_DIR = path.join(os.homedir(), ".openclaw", "backups");
const BACKUP_PREFIX = "openclaw-pre-openfeelz-";

function getConfigPath(): string {
  return process.env.OPENCLAW_CONFIG ?? DEFAULT_CONFIG_PATH;
}

/**
 * Back up openclaw.json to ~/.openclaw/backups/ if the file exists.
 * Returns the backup file path, or null if backup was skipped (e.g. no config file yet).
 * @param configPath - Source config path (default: OPENCLAW_CONFIG or ~/.openclaw/openclaw.json)
 * @param backupDir - Where to write backup (default: ~/.openclaw/backups; set for tests)
 */
export async function backupOpenClawConfig(
  configPath?: string,
  backupDir?: string,
): Promise<string | null> {
  const src = configPath ?? getConfigPath();
  const dir = backupDir ?? DEFAULT_BACKUP_DIR;
  try {
    await fs.access(src);
  } catch {
    return null;
  }

  await fs.mkdir(dir, { recursive: true });
  const d = new Date();
  const timestamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  const backupPath = path.join(dir, `${BACKUP_PREFIX}${timestamp}.json`);
  await fs.copyFile(src, backupPath);
  return backupPath;
}

let backupOnceDone = false;

/**
 * Back up openclaw.json once per process before the first config change.
 * Idempotent: subsequent calls no-op and return null.
 * Returns the backup path on first success, null otherwise.
 */
export async function backupOpenClawConfigOnce(
  configPath?: string,
  backupDir?: string,
): Promise<string | null> {
  if (backupOnceDone) return null;
  const result = await backupOpenClawConfig(configPath, backupDir);
  if (result != null) backupOnceDone = true;
  return result;
}

// ---------------------------------------------------------------------------
// Config write (no shell / child_process - direct JSON read/write)
// ---------------------------------------------------------------------------

/**
 * Set a single OpenFeelz plugin config value by reading and writing openclaw.json.
 * Backs up first (once per process). No shell or child_process used.
 * @returns true if write succeeded, false on error or missing config path.
 */
export async function setOpenClawPluginConfig(
  pathKey: string,
  value: unknown,
  configPath?: string,
): Promise<boolean> {
  const configFilePath = configPath ?? getConfigPath();
  await backupOpenClawConfigOnce(configFilePath);

  let config: Record<string, unknown>;
  try {
    const raw = await fs.readFile(configFilePath, "utf8");
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    config = { plugins: { entries: {} } };
  }

  if (!config.plugins || typeof config.plugins !== "object") {
    config.plugins = { entries: {} };
  }
  const entries = config.plugins as Record<string, unknown>;
  if (!entries.entries || typeof entries.entries !== "object") {
    entries.entries = {};
  }
  const pluginsEntries = entries.entries as Record<string, unknown>;
  if (!pluginsEntries.openfeelz || typeof pluginsEntries.openfeelz !== "object") {
    pluginsEntries.openfeelz = { config: {} };
  }
  const openfeelz = pluginsEntries.openfeelz as Record<string, unknown>;
  if (!openfeelz.config || typeof openfeelz.config !== "object") {
    openfeelz.config = {};
  }
  (openfeelz.config as Record<string, unknown>)[pathKey] = value;

  try {
    const dir = path.dirname(configFilePath);
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = `${configFilePath}.openfeelz.${process.pid}.${Date.now()}.json`;
    await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), "utf8");
    await fs.rename(tmpPath, configFilePath);
    return true;
  } catch {
    return false;
  }
}
