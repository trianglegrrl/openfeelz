import { describe, it, expect } from "vitest";
import { formatEmotionBlock, formatTimestamp, formatDimensionSummary } from "./prompt-formatter.js";
import { buildEmptyState } from "../state/state-file.js";
import type { EmotionStimulus } from "../types.js";

function makeStimulus(overrides: Partial<EmotionStimulus> = {}): EmotionStimulus {
  return {
    id: "test-1",
    timestamp: "2026-02-06T12:00:00Z",
    label: "happy",
    intensity: 0.7,
    trigger: "positive conversation",
    confidence: 0.9,
    sourceRole: "user",
    ...overrides,
  };
}

describe("prompt-formatter", () => {
  describe("formatTimestamp", () => {
    it("formats ISO timestamp to readable date", () => {
      const formatted = formatTimestamp("2026-02-06T12:00:00Z");
      expect(formatted).toContain("2026");
      expect(formatted).toContain("02");
      expect(formatted).toContain("06");
    });

    it("returns original string on invalid date", () => {
      expect(formatTimestamp("not-a-date")).toBe("not-a-date");
    });

    it("respects timezone when provided", () => {
      const formatted = formatTimestamp("2026-02-06T12:00:00Z", "America/Los_Angeles");
      // LA is UTC-8, so 12:00 UTC = 04:00 LA
      expect(formatted).toContain("04");
    });
  });

  describe("formatDimensionSummary", () => {
    it("produces a compact summary of non-neutral dimensions", () => {
      const state = buildEmptyState();
      state.dimensions.pleasure = 0.6;
      state.dimensions.arousal = -0.3;
      state.dimensions.curiosity = 0.8;
      const summary = formatDimensionSummary(state.dimensions, state.baseline);
      expect(summary).toContain("pleasure");
      expect(summary).toContain("curiosity");
    });

    it("returns empty string when all dimensions are at baseline", () => {
      const state = buildEmptyState();
      const summary = formatDimensionSummary(state.dimensions, state.baseline);
      expect(summary).toBe("");
    });
  });

  describe("formatEmotionBlock", () => {
    it("includes personality block even when no other data (never empty)", () => {
      const state = buildEmptyState();
      const block = formatEmotionBlock(state, "user1", "agent1", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });
      expect(block).not.toBe("");
      expect(block).toContain("<emotion_state>");
      expect(block).toContain("<personality>");
      expect(block).toContain("openness:");
      expect(block).toContain("</personality>");
    });

    it("includes primary emotion when cachedAnalysis.emotionalState exists", () => {
      const state = buildEmptyState();
      state.cachedAnalysis = {
        emotionalState: {
          summary: "Generally calm.",
          generatedAt: new Date().toISOString(),
          primary: "calm",
          intensity: 0.6,
          notes: [],
        },
      };
      const block = formatEmotionBlock(state, "user1", "agent1", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });
      expect(block).toContain("<primary>");
      expect(block).toContain("calm");
      expect(block).toContain("intensity: 0.60");
      expect(block).toContain("</primary>");
    });

    it("omits primary when no cached analysis", () => {
      const state = buildEmptyState();
      const block = formatEmotionBlock(state, "user1", "agent1", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });
      expect(block).not.toContain("<primary>");
    });

    it("includes basic_emotions when any above threshold", () => {
      const state = buildEmptyState();
      state.basicEmotions.happiness = 0.45;
      state.basicEmotions.anger = 0.12;
      const block = formatEmotionBlock(state, "user1", "agent1", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });
      expect(block).toContain("<basic_emotions>");
      expect(block).toContain("happiness: 0.45");
      expect(block).toContain("anger: 0.12");
      expect(block).toContain("</basic_emotions>");
    });

    it("omits basic_emotions when all below threshold", () => {
      const state = buildEmptyState();
      state.basicEmotions.happiness = 0.01;
      state.basicEmotions.sadness = 0.005;
      const block = formatEmotionBlock(state, "user1", "agent1", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });
      expect(block).not.toContain("<basic_emotions>");
    });

    it("dimensions section shows baseline values for deviations", () => {
      const state = buildEmptyState();
      state.dimensions.pleasure = 0.6;
      state.baseline.pleasure = 0.05;
      state.dimensions.curiosity = 0.8;
      state.baseline.curiosity = 0.5;
      const block = formatEmotionBlock(state, "user1", "agent1", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });
      expect(block).toContain("<dimensions>");
      expect(block).toContain("pleasure:");
      expect(block).toContain("elevated");
      expect(block).toContain("baseline: 0.05");
      expect(block).toContain("baseline: 0.50");
      expect(block).toContain("</dimensions>");
    });

    it("includes user emotion entries", () => {
      const state = buildEmptyState();
      state.users["user1"] = {
        history: [makeStimulus({ sourceRole: "user" })],
        latest: makeStimulus({ sourceRole: "user" }),
      };
      const block = formatEmotionBlock(state, "user1", "agent1", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });
      expect(block).toContain("<emotion_state>");
      expect(block).toContain("<user>");
      expect(block).toContain("happy");
      expect(block).toContain("</emotion_state>");
    });

    it("includes agent emotion entries", () => {
      const state = buildEmptyState();
      state.agents["agent1"] = {
        history: [makeStimulus({ sourceRole: "assistant", label: "focused" })],
        latest: makeStimulus({ sourceRole: "assistant", label: "focused" }),
      };
      const block = formatEmotionBlock(state, "user1", "agent1", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });
      expect(block).toContain("<agent>");
      expect(block).toContain("focused");
    });

    it("includes dimensional context when dimensions deviate from baseline", () => {
      const state = buildEmptyState();
      state.dimensions.pleasure = 0.7;
      state.dimensions.curiosity = 0.9;
      state.users["user1"] = {
        history: [makeStimulus()],
        latest: makeStimulus(),
      };
      const block = formatEmotionBlock(state, "user1", "agent1", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });
      expect(block).toContain("<dimensions>");
    });

    it("limits entries to maxUserEntries / maxAgentEntries", () => {
      const state = buildEmptyState();
      state.users["user1"] = {
        history: Array.from({ length: 10 }, (_, i) =>
          makeStimulus({ id: `s${i}`, timestamp: new Date(2026, 1, 6, i).toISOString() }),
        ),
      };
      const block = formatEmotionBlock(state, "user1", "agent1", {
        maxUserEntries: 2,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
      });
      // Should only contain 2 entries' worth of data
      const matches = block.match(/Felt /g);
      expect(matches).toBeDefined();
      expect(matches!.length).toBeLessThanOrEqual(2);
    });

    it("includes other agents when provided", () => {
      const state = buildEmptyState();
      state.users["user1"] = {
        history: [makeStimulus()],
        latest: makeStimulus(),
      };
      const block = formatEmotionBlock(state, "user1", "agent1", {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: 12,
        trendWindowHours: 24,
        otherAgents: [
          { id: "agent2", latest: makeStimulus({ label: "calm" }) },
        ],
      });
      expect(block).toContain("<others>");
      expect(block).toContain("agent2");
      expect(block).toContain("calm");
    });
  });
});
