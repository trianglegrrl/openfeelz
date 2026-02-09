/**
 * Tests for backup-openclaw-config: backup before config writes,
 * and setOpenClawPluginConfig (direct JSON write, no shell/spawn).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  backupOpenClawConfig,
  backupOpenClawConfigOnce,
  setOpenClawPluginConfig,
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

  describe("setOpenClawPluginConfig", () => {
    it("writes nested config value and preserves existing structure", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({ plugins: { entries: {} }, other: "kept" }),
        "utf8",
      );
      const ok = await setOpenClawPluginConfig("decayPreset", "fast", configPath);
      expect(ok).toBe(true);
      const raw = await fs.readFile(configPath, "utf8");
      const config = JSON.parse(raw);
      expect(config.other).toBe("kept");
      expect(config.plugins?.entries?.openfeelz?.config?.decayPreset).toBe("fast");
    });

    it("creates plugins.entries.openfeelz.config when missing", async () => {
      await fs.writeFile(configPath, "{}", "utf8");
      const ok = await setOpenClawPluginConfig("decayPreset", "slow", configPath);
      expect(ok).toBe(true);
      const raw = await fs.readFile(configPath, "utf8");
      const config = JSON.parse(raw);
      expect(config.plugins.entries.openfeelz.config.decayPreset).toBe("slow");
    });

    it("overwrites existing openfeelz config key", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          plugins: {
            entries: {
              openfeelz: { config: { decayPreset: "fast", model: "gpt-5-mini" } },
            },
          },
        }),
        "utf8",
      );
      const ok = await setOpenClawPluginConfig("decayPreset", "slow", configPath);
      expect(ok).toBe(true);
      const raw = await fs.readFile(configPath, "utf8");
      const config = JSON.parse(raw);
      expect(config.plugins.entries.openfeelz.config.decayPreset).toBe("slow");
      expect(config.plugins.entries.openfeelz.config.model).toBe("gpt-5-mini");
    });

    it("actually updates the file on disk (before/after read)", async () => {
      const initial = { plugins: { entries: {} }, version: 1 };
      await fs.writeFile(configPath, JSON.stringify(initial, null, 2), "utf8");

      const beforeRaw = await fs.readFile(configPath, "utf8");
      const before = JSON.parse(beforeRaw);
      expect(before.plugins?.entries?.openfeelz?.config?.decayPreset).toBeUndefined();

      const ok = await setOpenClawPluginConfig("decayPreset", "fast", configPath);
      expect(ok).toBe(true);

      const afterRaw = await fs.readFile(configPath, "utf8");
      expect(afterRaw).not.toBe(beforeRaw);
      const after = JSON.parse(afterRaw);
      expect(after.plugins.entries.openfeelz.config.decayPreset).toBe("fast");
      expect(after.version).toBe(1);
    });

    it("updates file when using OPENCLAW_CONFIG (production path resolution)", async () => {
      await fs.writeFile(configPath, "{}", "utf8");
      vi.stubEnv("OPENCLAW_CONFIG", configPath);

      try {
        const ok = await setOpenClawPluginConfig("decayPreset", "slow");
        expect(ok).toBe(true);
        const raw = await fs.readFile(configPath, "utf8");
        const config = JSON.parse(raw);
        expect(config.plugins.entries.openfeelz.config.decayPreset).toBe("slow");
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
