/**
 * OpenClaw hook handlers for OpenFeelz.
 *
 * - before_agent_start: inject emotional context into system prompt
 * - agent_end: classify emotions from conversation messages
 */

import type { EmotionEngineConfig } from "../types.js";
import { StateManager } from "../state/state-manager.js";
import { loadOtherAgentStatesFromConfig } from "../state/multi-agent.js";
import { classifyEmotion } from "../classify/classifier.js";
import { formatEmotionBlock } from "../format/prompt-formatter.js";
import { extractMessageText } from "../utils/message-content.js";

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
  messages: Array<{ role: string; content: unknown }>;
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
  getManager: (agentId: string) => StateManager,
  config: EmotionEngineConfig,
  openclawConfig?: Record<string, unknown>,
): (event: BootstrapEvent) => Promise<BootstrapResult | undefined> {
  return async (event) => {
    if (!config.contextEnabled) return undefined;

    const agentId = event.agentId ?? "main";
    const manager = getManager(agentId);

    try {
      let state = await manager.getState();

      // Apply time-based decay
      state = manager.applyDecay(state);

      // Advance rumination
      state = manager.advanceRumination(state);

      // Persist
      await manager.saveState(state);

      const userKey = event.userKey ?? "unknown";
      const otherAgents =
        config.maxOtherAgents > 0 && openclawConfig
          ? await loadOtherAgentStatesFromConfig(openclawConfig, agentId, config.maxOtherAgents)
          : [];

      const block = formatEmotionBlock(state, userKey, agentId, {
        maxUserEntries: 3,
        maxAgentEntries: 2,
        halfLifeHours: config.halfLifeHours,
        trendWindowHours: config.trendWindowHours,
        timeZone: config.timezone,
        otherAgents,
        includeUserEmotions: config.includeUserEmotions,
      });

      if (!block) return undefined;

      return { prependContext: block };
    } catch (err) {
      console.error("[openfeelz] Bootstrap hook error:", err);
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
  getManager: (agentId: string) => StateManager,
  config: EmotionEngineConfig,
  classificationLogPath?: string,
  fetchFn?: typeof fetch,
): (event: AgentEndEvent) => Promise<void> {
  return async (event) => {
    if (!event.success || !event.messages || event.messages.length === 0) {
      console.log("[openfeelz] Skipping agent_end: no success or messages");
      return;
    }

    // Need either apiKey or classifierUrl to classify
    if (!config.apiKey && !config.classifierUrl) {
      console.warn("[openfeelz] Skipping classification: no apiKey or classifierUrl configured");
      return;
    }

    const agentId = event.agentId ?? "main";
    const manager = getManager(agentId);

    try {
      let state = await manager.getState();

      const userKey = event.userKey ?? "unknown";

      // Find latest user message
      const userMsg = findLast(event.messages, "user");
      // Find latest assistant message
      const assistantMsg = findLast(event.messages, "assistant");

      console.log(`[openfeelz] Processing messages - user: ${!!userMsg}, assistant: ${!!assistantMsg}`);

      const classifyOpts = {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        provider: config.provider,
        classifierUrl: config.classifierUrl,
        emotionLabels: config.emotionLabels,
        confidenceMin: config.confidenceMin,
        classificationLogPath,
        fetchFn,
      };

      if (userMsg) {
        const text = extractMessageText(userMsg.content);
        if (text) {
          console.log(`[openfeelz] Classifying user message (${text.length} chars)`);
          const result = await classifyEmotion(text, "user", classifyOpts);
          console.log(`[openfeelz] User emotion: ${result.label} (intensity: ${result.intensity}, confidence: ${result.confidence})`);

          if (result.label !== "neutral" || result.confidence > 0) {
            state = manager.updateUserEmotion(state, userKey, result);
            // Also apply as stimulus to the dimensional model
            state = manager.applyStimulus(state, result.label, result.intensity, result.reason);
          }
        }
      }

      if (assistantMsg) {
        const text = extractMessageText(assistantMsg.content);
        if (text) {
          console.log(`[openfeelz] Classifying assistant message (${text.length} chars)`);
          const result = await classifyEmotion(text, "assistant", classifyOpts);
          console.log(`[openfeelz] Assistant emotion: ${result.label} (intensity: ${result.intensity}, confidence: ${result.confidence})`);

          if (result.label !== "neutral" || result.confidence > 0) {
            state = manager.updateAgentEmotion(state, agentId, result);
          }
        }
      }

      await manager.saveState(state);
    } catch (err) {
      console.error("[openfeelz] Agent end hook error:", err);
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLast(
  messages: Array<{ role: string; content: unknown }>,
  role: string,
): { role: string; content: unknown } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === role && extractMessageText(msg.content) !== "") {
      return msg;
    }
  }
  return undefined;
}
