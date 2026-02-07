import { describe, it, expect } from "vitest";
import {
  createCustomMapping,
  mergeCustomMappings,
  validateTaxonomy,
} from "./custom-taxonomy.js";

describe("custom-taxonomy", () => {
  describe("createCustomMapping", () => {
    it("creates a valid emotion mapping", () => {
      const mapping = createCustomMapping("awe", {
        dimensions: { pleasure: 0.2, arousal: 0.15, curiosity: 0.2, dominance: -0.1 },
        emotions: { surprise: 0.2, happiness: 0.1 },
      });
      expect(mapping.dimensions.pleasure).toBe(0.2);
      expect(mapping.dimensions.curiosity).toBe(0.2);
      expect(mapping.emotions.surprise).toBe(0.2);
    });

    it("filters out invalid dimension names", () => {
      const mapping = createCustomMapping("test", {
        dimensions: { pleasure: 0.1, invalid_dim: 0.5 } as any,
        emotions: {},
      });
      expect(mapping.dimensions.pleasure).toBe(0.1);
      expect((mapping.dimensions as any).invalid_dim).toBeUndefined();
    });
  });

  describe("mergeCustomMappings", () => {
    it("adds custom labels to the mapping table", () => {
      const custom = {
        awe: {
          dimensions: { pleasure: 0.2, arousal: 0.15, curiosity: 0.2 },
          emotions: { surprise: 0.2 },
        },
        nostalgic: {
          dimensions: { pleasure: 0.1, arousal: -0.1, connection: 0.15 },
          emotions: { sadness: 0.1, happiness: 0.05 },
        },
      };

      const merged = mergeCustomMappings(custom);
      expect(merged["awe"]).toBeDefined();
      expect(merged["nostalgic"]).toBeDefined();
      // Original mappings still present
      expect(merged["happy"]).toBeDefined();
      expect(merged["angry"]).toBeDefined();
    });

    it("overrides existing labels with custom definitions", () => {
      const custom = {
        happy: {
          dimensions: { pleasure: 0.99 },
          emotions: { happiness: 0.99 },
        },
      };
      const merged = mergeCustomMappings(custom);
      expect(merged["happy"].dimensions.pleasure).toBe(0.99);
    });
  });

  describe("validateTaxonomy", () => {
    it("returns valid for default labels", () => {
      const result = validateTaxonomy([
        "neutral", "happy", "sad", "angry", "fearful",
        "calm", "curious", "excited",
      ]);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("warns about labels without mappings", () => {
      const result = validateTaxonomy(["happy", "sad", "zzz_unknown_emotion"]);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("zzz_unknown_emotion");
    });

    it("requires at least one label", () => {
      const result = validateTaxonomy([]);
      expect(result.valid).toBe(false);
    });

    it("warns about duplicate labels", () => {
      const result = validateTaxonomy(["happy", "happy", "sad"]);
      expect(result.warnings.some((w) => w.includes("duplicate"))).toBe(true);
    });
  });
});
