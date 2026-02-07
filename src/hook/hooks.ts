/**
 * OpenClaw hook handlers for the emotion engine.
 *
 * - before_agent_start: inject emotional context into system prompt
 * - agent_end: classify emotions from conversation messages
 */

import type { EmotionEngineConfig } from "../types.js";
import { StateManager } from "../state/state-manager.js";
import { classifyEmotion } from "../classify/classifier.js";
import { formatEmotionBlock } from "../format/prompt-formatter.js";

// ---------------------------------------------------------------------------
// Types for hook events (minimal, matching OpenClaw's plugin hook API)
// ---------------------------------------------------------------------------

interface BootstrapEvent {
  prompt: string;
  userKey?: string;
  agentId?: string;
}

interface BootstrapResult {
  prependContext: string;
}

interface AgentEndEvent {
  success: boolean;
  messages: Array<{ role: string; content: string }>;
  userKey?: string;
  agentId?: string;
}

// ---------------------------------------------------------------------------
// Bootstrap Hook (before_agent_start)
// ---------------------------------------------------------------------------

/**
 * Create the before_agent_start hook handler.
 *
 * On every agent bootstrap:
 * 1. Load state from disk
 * 2. Apply time-based decay
 * 3. Advance rumination (if active)
 * 4. Format emotional context
 * 5. Persist updated state
 * 6. Return prependContext for emotional context prepend
 */
export function createBootstrapHook(
  manager: StateManager,
  config: EmotionEngineConfig,
): (event: BootstrapEvent) => Promise<BootstrapResult | undefined> {
  return async (event) => {
    if (!config.contextEnabled) return undefined;

    try {
      let state = await manager.getState();

      // Apply time-based decay
      state = manager.applyDecay(state);

      // Advance rumination
      state = manager.advanceRumination(state);

      // Persist
      await manager.saveState(state);

      // Format emotion block
      const userKey = event.userKey ?? "unknown";
      const agentId = event.agentId ?? "main";

      const block = formatEmotionBlock(state, userKey, agentId, {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: config.halfLifeHours,
        trendWindowHours: config.trendWindowHours,
        timeZone: config.timezone,
      });

      if (!block) return undefined;

      return { prependContext: block };
    } catch (err) {
      console.error("[emotion-engine] Bootstrap hook error:", err);
      return undefined;
    }
  };
}

// ---------------------------------------------------------------------------
// Agent End Hook
// ---------------------------------------------------------------------------

/**
 * Create the agent_end hook handler.
 *
 * After each agent turn:
 * 1. Extract the latest user and assistant messages
 * 2. Classify their emotions via LLM
 * 3. Apply emotion mappings to state
 * 4. Record in user/agent buckets
 * 5. Persist
 */
export function createAgentEndHook(
  manager: StateManager,
  config: EmotionEngineConfig,
  fetchFn?: typeof fetch,
): (event: AgentEndEvent) => Promise<void> {
  return async (event) => {
    if (!event.success || !event.messages || event.messages.length === 0) {
      return;
    }

    // Need either apiKey or classifierUrl to classify
    if (!config.apiKey && !config.classifierUrl) {
      return;
    }

    try {
      let state = await manager.getState();

      const userKey = event.userKey ?? "unknown";
      const agentId = event.agentId ?? "main";

      // Find latest user message
      const userMsg = findLast(event.messages, "user");
      // Find latest assistant message
      const assistantMsg = findLast(event.messages, "assistant");

      if (userMsg) {
        const result = await classifyEmotion(userMsg.content, "user", {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
          classifierUrl: config.classifierUrl,
          emotionLabels: config.emotionLabels,
          confidenceMin: config.confidenceMin,
          fetchFn,
        });

        if (result.label !== "neutral" || result.confidence > 0) {
          state = manager.updateUserEmotion(state, userKey, result);
          // Also apply as stimulus to the dimensional model
          state = manager.applyStimulus(state, result.label, result.intensity, result.reason);
        }
      }

      if (assistantMsg) {
        const result = await classifyEmotion(assistantMsg.content, "assistant", {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
          classifierUrl: config.classifierUrl,
          emotionLabels: config.emotionLabels,
          confidenceMin: config.confidenceMin,
          fetchFn,
        });

        if (result.label !== "neutral" || result.confidence > 0) {
          state = manager.updateAgentEmotion(state, agentId, result);
        }
      }

      await manager.saveState(state);
    } catch (err) {
      console.error("[emotion-engine] Agent end hook error:", err);
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLast(
  messages: Array<{ role: string; content: string }>,
  role: string,
): { role: string; content: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role && messages[i].content.trim()) {
      return messages[i];
    }
  }
  return undefined;
}
