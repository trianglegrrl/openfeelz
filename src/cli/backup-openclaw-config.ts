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
