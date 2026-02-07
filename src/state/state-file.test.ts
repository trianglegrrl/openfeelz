import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readStateFile,
  writeStateFile,
  acquireLock,
  releaseLock,
  buildEmptyState,
} from "./state-file.js";
import type { EmotionEngineState } from "../types.js";

describe("state-file", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openfeelz-test-"));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // buildEmptyState
  // -----------------------------------------------------------------------

  describe("buildEmptyState", () => {
    it("returns a valid v2 state", () => {
      const state = buildEmptyState();
      expect(state.version).toBe(2);
      expect(state.personality).toBeDefined();
      expect(state.dimensions).toBeDefined();
      expect(state.baseline).toBeDefined();
      expect(state.basicEmotions).toBeDefined();
      expect(state.rumination.active).toEqual([]);
      expect(state.recentStimuli).toEqual([]);
      expect(state.users).toEqual({});
      expect(state.agents).toEqual({});
      expect(state.meta.totalUpdates).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // readStateFile
  // -----------------------------------------------------------------------

  describe("readStateFile", () => {
    it("returns empty state when file does not exist", async () => {
      const filePath = path.join(tmpDir, "nonexistent.json");
      const state = await readStateFile(filePath);
      expect(state.version).toBe(2);
      expect(state.meta.totalUpdates).toBe(0);
    });

    it("reads and parses existing state file", async () => {
      const filePath = path.join(tmpDir, "state.json");
      const state = buildEmptyState();
      state.meta.totalUpdates = 42;
      await fs.writeFile(filePath, JSON.stringify(state), "utf8");

      const loaded = await readStateFile(filePath);
      expect(loaded.meta.totalUpdates).toBe(42);
    });

    it("returns empty state for corrupted JSON", async () => {
      const filePath = path.join(tmpDir, "bad.json");
      await fs.writeFile(filePath, "not valid json{{{", "utf8");

      const state = await readStateFile(filePath);
      expect(state.version).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // writeStateFile
  // -----------------------------------------------------------------------

  describe("writeStateFile", () => {
    it("writes state atomically (via tmp + rename)", async () => {
      const filePath = path.join(tmpDir, "state.json");
      const state = buildEmptyState();
      state.meta.totalUpdates = 7;
      await writeStateFile(filePath, state);

      const raw = await fs.readFile(filePath, "utf8");
      const loaded = JSON.parse(raw) as EmotionEngineState;
      expect(loaded.meta.totalUpdates).toBe(7);
    });

    it("creates parent directories if needed", async () => {
      const filePath = path.join(tmpDir, "deep", "nested", "state.json");
      await writeStateFile(filePath, buildEmptyState());

      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
    });

    it("overwrites existing file", async () => {
      const filePath = path.join(tmpDir, "state.json");
      const state1 = buildEmptyState();
      state1.meta.totalUpdates = 1;
      await writeStateFile(filePath, state1);

      const state2 = buildEmptyState();
      state2.meta.totalUpdates = 2;
      await writeStateFile(filePath, state2);

      const raw = await fs.readFile(filePath, "utf8");
      const loaded = JSON.parse(raw) as EmotionEngineState;
      expect(loaded.meta.totalUpdates).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // File locking
  // -----------------------------------------------------------------------

  describe("acquireLock / releaseLock", () => {
    it("acquires lock when no lock exists", async () => {
      const lockPath = path.join(tmpDir, "state.json.lock");
      const acquired = await acquireLock(lockPath);
      expect(acquired).toBe(true);
      await releaseLock(lockPath);
    });

    it("fails to acquire lock when already held", async () => {
      const lockPath = path.join(tmpDir, "state.json.lock");
      const first = await acquireLock(lockPath);
      expect(first).toBe(true);

      const second = await acquireLock(lockPath);
      expect(second).toBe(false);

      await releaseLock(lockPath);
    });

    it("releases lock and allows re-acquisition", async () => {
      const lockPath = path.join(tmpDir, "state.json.lock");
      await acquireLock(lockPath);
      await releaseLock(lockPath);

      const acquired = await acquireLock(lockPath);
      expect(acquired).toBe(true);
      await releaseLock(lockPath);
    });

    it("acquires stale lock (older than staleMs)", async () => {
      const lockPath = path.join(tmpDir, "state.json.lock");
      // Create a lock file manually
      await fs.writeFile(lockPath, "", "utf8");
      // Backdate it
      const pastTime = new Date(Date.now() - 20_000);
      await fs.utimes(lockPath, pastTime, pastTime);

      // Should acquire because lock is stale (default staleMs = 10_000)
      const acquired = await acquireLock(lockPath, 10_000);
      expect(acquired).toBe(true);
      await releaseLock(lockPath);
    });

    it("releaseLock is idempotent", async () => {
      const lockPath = path.join(tmpDir, "state.json.lock");
      await releaseLock(lockPath); // No-op, should not throw
    });
  });
});
