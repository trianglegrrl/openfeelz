/**
 * Tests for backup-openclaw-config: backup before config writes.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  backupOpenClawConfig,
  backupOpenClawConfigOnce,
} from "./backup-openclaw-config.js";

describe("backup-openclaw-config", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-backup-test-"));
    configPath = path.join(tmpDir, "openclaw.json");
    await fs.writeFile(configPath, JSON.stringify({ plugins: {} }), "utf8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when config file does not exist", async () => {
    const missingPath = path.join(tmpDir, "missing.json");
    const result = await backupOpenClawConfig(missingPath, tmpDir);
    expect(result).toBeNull();
  });

  it("copies config to backup dir and returns backup path", async () => {
    const backupPath = await backupOpenClawConfig(configPath, tmpDir);
    expect(backupPath).not.toBeNull();
    expect(backupPath).toContain("openclaw-pre-openfeelz-");
    expect(backupPath).toMatch(/\.json$/);
    const content = await fs.readFile(backupPath!, "utf8");
    expect(JSON.parse(content)).toEqual({ plugins: {} });
  });

  it("backupOpenClawConfigOnce backs up first time only", async () => {
    const first = await backupOpenClawConfigOnce(configPath, tmpDir);
    const second = await backupOpenClawConfigOnce(configPath, tmpDir);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
