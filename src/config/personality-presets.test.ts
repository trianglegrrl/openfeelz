/**
 * TDD: personality presets (famous figures, OCEAN).
 * Validated fixture data: all OCEAN 0–1, preset shape enforced.
 */

import { describe, it, expect } from "vitest";
import { buildEmptyState } from "../state/state-file.js";
import {
  listPresets,
  getPreset,
  applyPresetToState,
  isPresetValid,
  type PersonalityPreset,
} from "./personality-presets.js";
import { OCEAN_TRAITS } from "../types.js";

describe("personality-presets", () => {
  const validState = buildEmptyState();

  describe("listPresets", () => {
    it("returns exactly 10 presets", () => {
      const presets = listPresets();
      expect(presets).toHaveLength(10);
    });

    it("each preset has id, name, shortDescription, bio, ocean, traitDetails, and rationale", () => {
      const presets = listPresets();
      for (const p of presets) {
        expect(p.id).toBeDefined();
        expect(typeof p.id).toBe("string");
        expect(p.id.length).toBeGreaterThan(0);
        expect(p.name).toBeDefined();
        expect(typeof p.name).toBe("string");
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.shortDescription).toBeDefined();
        expect(typeof p.shortDescription).toBe("string");
        expect(p.shortDescription.length).toBeGreaterThan(0);
        expect(p.bio).toBeDefined();
        expect(typeof p.bio).toBe("string");
        expect(p.bio.length).toBeGreaterThan(0);
        expect(p.ocean).toBeDefined();
        expect(typeof p.ocean).toBe("object");
        for (const trait of OCEAN_TRAITS) {
          expect(p.ocean[trait]).toBeDefined();
          expect(typeof p.ocean[trait]).toBe("number");
          expect(p.ocean[trait]).toBeGreaterThanOrEqual(0);
          expect(p.ocean[trait]).toBeLessThanOrEqual(1);
        }
        expect(p.traitDetails).toBeDefined();
        expect(typeof p.traitDetails).toBe("object");
        for (const trait of OCEAN_TRAITS) {
          expect(p.traitDetails[trait]).toBeDefined();
          expect(typeof p.traitDetails[trait]).toBe("string");
          expect(p.traitDetails[trait].length).toBeGreaterThan(0);
        }
        expect(p.rationale).toBeDefined();
        expect(typeof p.rationale).toBe("string");
      }
    });

    it("all presets pass isPresetValid", () => {
      const presets = listPresets();
      for (const p of presets) {
        expect(isPresetValid(p)).toBe(true);
      }
    });
  });

  describe("getPreset", () => {
    it("returns preset when id exists", () => {
      const presets = listPresets();
      const first = presets[0];
      expect(getPreset(first.id)).toEqual(first);
    });

    it("returns undefined for unknown id", () => {
      expect(getPreset("nonexistent-id")).toBeUndefined();
    });
  });

  describe("isPresetValid", () => {
    it("rejects preset with out-of-range OCEAN", () => {
      const presets = listPresets();
      const bad: PersonalityPreset = {
        ...presets[0],
        ocean: { ...presets[0].ocean, openness: 1.5 },
      };
      expect(isPresetValid(bad)).toBe(false);
    });

    it("rejects preset with missing required field", () => {
      const presets = listPresets();
      const bad = { ...presets[0], id: "" };
      expect(isPresetValid(bad)).toBe(false);
    });
  });

  describe("applyPresetToState", () => {
    it("returns state with personality equal to preset ocean", () => {
      const presets = listPresets();
      const preset = presets[0];
      const next = applyPresetToState(validState, preset.id);
      expect(next.personality.openness).toBe(preset.ocean.openness);
      expect(next.personality.conscientiousness).toBe(preset.ocean.conscientiousness);
      expect(next.personality.extraversion).toBe(preset.ocean.extraversion);
      expect(next.personality.agreeableness).toBe(preset.ocean.agreeableness);
      expect(next.personality.neuroticism).toBe(preset.ocean.neuroticism);
    });

    it("updates baseline and decay rates", () => {
      const presets = listPresets();
      const preset = presets[0];
      const next = applyPresetToState(validState, preset.id);
      expect(next.baseline).not.toEqual(validState.baseline);
      expect(next.decayRates).not.toEqual(validState.decayRates);
      expect(next.emotionDecayRates).not.toEqual(validState.emotionDecayRates);
    });

    it("throws for unknown preset id", () => {
      expect(() => applyPresetToState(validState, "nonexistent")).toThrow();
    });
  });
});
