/**
 * Emotion Engine - OpenClaw Plugin Entry Point
 *
 * Registers:
 *  - emotion_state tool (query/modify/reset/personality)
 *  - before_agent_start hook (inject emotional context)
 *  - agent_end hook (classify emotions from conversation)
 *  - background service (optional periodic decay)
 *  - CLI commands (openclaw emotion ...)
 *  - HTTP dashboard route (/emotion-dashboard)
 */

import os from "node:os";
import path from "node:path";
import type { EmotionEngineConfig, OCEANProfile } from "./src/types.js";
import { DEFAULT_CONFIG } from "./src/types.js";
import { StateManager } from "./src/state/state-manager.js";
import { createEmotionTool } from "./src/tool/emotion-tool.js";
import { createBootstrapHook, createAgentEndHook } from "./src/hook/hooks.js";
import { registerEmotionCli } from "./src/cli/cli.js";
import { createDashboardHandler } from "./src/http/dashboard.js";

/**
 * Resolve plugin configuration from raw pluginConfig + environment variables.
 */
function resolveConfig(raw?: Record<string, unknown>): EmotionEngineConfig {
  const env = process.env;
  const personality = (raw?.personality ?? {}) as Partial<OCEANProfile>;

  return {
    apiKey: (raw?.apiKey as string) ?? env.OPENAI_API_KEY ?? undefined,
    baseUrl: (raw?.baseUrl as string) ?? env.OPENAI_BASE_URL ?? DEFAULT_CONFIG.baseUrl,
    model: (raw?.model as string) ?? env.EMOTION_MODEL ?? DEFAULT_CONFIG.model,
    classifierUrl: (raw?.classifierUrl as string) ?? env.EMOTION_CLASSIFIER_URL ?? undefined,
    confidenceMin: (raw?.confidenceMin as number) ?? (Number(env.EMOTION_CONFIDENCE_MIN) || DEFAULT_CONFIG.confidenceMin),
    halfLifeHours: (raw?.halfLifeHours as number) ?? (Number(env.EMOTION_HALF_LIFE_HOURS) || DEFAULT_CONFIG.halfLifeHours),
    trendWindowHours: (raw?.trendWindowHours as number) ?? DEFAULT_CONFIG.trendWindowHours,
    maxHistory: (raw?.maxHistory as number) ?? (Number(env.EMOTION_HISTORY_SIZE) || DEFAULT_CONFIG.maxHistory),
    ruminationEnabled: (raw?.ruminationEnabled as boolean) ?? DEFAULT_CONFIG.ruminationEnabled,
    ruminationThreshold: (raw?.ruminationThreshold as number) ?? DEFAULT_CONFIG.ruminationThreshold,
    ruminationMaxStages: (raw?.ruminationMaxStages as number) ?? DEFAULT_CONFIG.ruminationMaxStages,
    realtimeClassification: (raw?.realtimeClassification as boolean) ?? DEFAULT_CONFIG.realtimeClassification,
    contextEnabled: (raw?.contextEnabled as boolean) ?? DEFAULT_CONFIG.contextEnabled,
    decayServiceEnabled: (raw?.decayServiceEnabled as boolean) ?? DEFAULT_CONFIG.decayServiceEnabled,
    decayServiceIntervalMinutes: (raw?.decayServiceIntervalMinutes as number) ?? DEFAULT_CONFIG.decayServiceIntervalMinutes,
    dashboardEnabled: (raw?.dashboardEnabled as boolean) ?? DEFAULT_CONFIG.dashboardEnabled,
    timezone: (raw?.timezone as string) ?? env.EMOTION_TIMEZONE ?? undefined,
    maxOtherAgents: (raw?.maxOtherAgents as number) ?? DEFAULT_CONFIG.maxOtherAgents,
    emotionLabels: (raw?.emotionLabels as string[]) ?? DEFAULT_CONFIG.emotionLabels,
    personality: {
      openness: personality.openness ?? DEFAULT_CONFIG.personality.openness,
      conscientiousness: personality.conscientiousness ?? DEFAULT_CONFIG.personality.conscientiousness,
      extraversion: personality.extraversion ?? DEFAULT_CONFIG.personality.extraversion,
      agreeableness: personality.agreeableness ?? DEFAULT_CONFIG.personality.agreeableness,
      neuroticism: personality.neuroticism ?? DEFAULT_CONFIG.personality.neuroticism,
    },
    decayRateOverrides: (raw?.decayRates as Record<string, number>) ?? {},
    dimensionBaselineOverrides: (raw?.dimensionBaselines as Record<string, number>) ?? {},
  };
}

// ---------------------------------------------------------------------------
// Plugin Definition
// ---------------------------------------------------------------------------

const emotionEnginePlugin = {
  id: "emotion-engine",
  name: "Emotion Engine",
  description:
    "PAD + Ekman + OCEAN emotional model with personality-influenced decay, " +
    "rumination, and multi-agent awareness",

  register(api: any) {
    const config = resolveConfig(api.pluginConfig);

    // Resolve state file path
    const stateDir = api.resolvePath
      ? api.resolvePath(".")
      : path.join(os.homedir(), ".openclaw", "agents", "main", "agent");
    const statePath = path.join(stateDir, "emotion-engine.json");

    const manager = new StateManager(statePath, config);

    api.logger?.info?.(
      `emotion-engine: registered (state: ${statePath}, model: ${config.model})`,
    );

    // -- Tool --
    api.registerTool(createEmotionTool(manager), { name: "emotion_state" });

    // -- Hooks --
    const bootstrapHandler = createBootstrapHook(manager, config);
    api.on("before_agent_start", async (event: any) => {
      const result = await bootstrapHandler({
        prompt: event.prompt ?? "",
        userKey: event.senderId ?? event.sessionKey ?? "unknown",
        agentId: event.agentId ?? "main",
      });
      return result;
    });

    const agentEndHandler = createAgentEndHook(manager, config);
    api.on("agent_end", async (event: any) => {
      await agentEndHandler({
        success: event.success ?? true,
        messages: event.messages ?? [],
        userKey: event.senderId ?? event.sessionKey ?? "unknown",
        agentId: event.agentId ?? "main",
      });
    });

    // -- Service (optional background decay) --
    if (config.decayServiceEnabled) {
      let intervalHandle: ReturnType<typeof setInterval> | null = null;

      api.registerService({
        id: "emotion-engine-decay",
        start: () => {
          const ms = config.decayServiceIntervalMinutes * 60_000;
          intervalHandle = setInterval(async () => {
            try {
              let state = await manager.getState();
              state = manager.applyDecay(state);
              state = manager.advanceRumination(state);
              await manager.saveState(state);
            } catch (err) {
              api.logger?.error?.(`[emotion-engine] Decay service error: ${err}`);
            }
          }, ms);
          api.logger?.info?.(
            `emotion-engine: decay service started (interval: ${config.decayServiceIntervalMinutes}m)`,
          );
        },
        stop: () => {
          if (intervalHandle) {
            clearInterval(intervalHandle);
            intervalHandle = null;
          }
          api.logger?.info?.("emotion-engine: decay service stopped");
        },
      });
    }

    // -- CLI --
    api.registerCli(
      ({ program }: { program: any }) => registerEmotionCli({ program, manager }),
      { commands: ["emotion"] },
    );

    // -- HTTP Dashboard --
    if (config.dashboardEnabled) {
      api.registerHttpRoute({
        path: "/emotion-dashboard",
        handler: createDashboardHandler(manager),
      });
    }
  },
};

export default emotionEnginePlugin;
