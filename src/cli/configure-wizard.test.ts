/**
 * Tests for configure wizard helpers (formatPresetTable, preset hint).
 */

import { describe, it, expect } from "vitest";
import { formatPresetTable, formatPresetHint } from "./configure-wizard.js";
import { listPresets } from "../config/personality-presets.js";

describe("configure-wizard helpers", () => {
  describe("formatPresetTable", () => {
    it("returns table with header and column labels O C E A N", () => {
      const presets = listPresets();
      const table = formatPresetTable(presets);
      expect(table).toContain("Personality Presets:");
      expect(table).toContain("Name ");
      expect(table).toMatch(/\bO\s+C\s+E\s+A\s+N\b/);
    });

    it("includes all preset names and OCEAN scores", () => {
      const presets = listPresets();
      const table = formatPresetTable(presets);
      expect(presets.length).toBe(10);
      for (const p of presets) {
        expect(table).toContain(p.name);
        expect(table).toContain(p.ocean.openness.toFixed(2));
        expect(table).toContain(p.ocean.conscientiousness.toFixed(2));
      }
    });

    it("uses separator lines", () => {
      const presets = listPresets();
      const table = formatPresetTable(presets);
      expect(table).toContain("─");
    });
  });

  describe("formatPresetHint", () => {
    it("returns compact OCEAN scores for a preset", () => {
      const presets = listPresets();
      const first = presets[0];
      const hint = formatPresetHint(first);
      expect(hint).toMatch(/O:[\d.]+/);
      expect(hint).toMatch(/C:[\d.]+/);
      expect(hint).toMatch(/E:[\d.]+/);
      expect(hint).toMatch(/A:[\d.]+/);
      expect(hint).toMatch(/N:[\d.]+/);
      expect(hint).toContain(first.ocean.openness.toFixed(2));
    });
  });
});
