/**
 * OpenFeelz - OpenClaw Plugin Entry Point
 *
 * Registers:
 *  - emotion_state tool (query/modify/reset/personality)
 *  - before_agent_start hook (inject emotional context)
 *  - agent_end hook (classify emotions from conversation)
 *  - background service (optional periodic decay)
 *  - CLI commands (openclaw emotion ...)
 *  - HTTP dashboard route (/emotion-dashboard)
 *
 * State is stored per-agent in each agent's workspace:
 *   {workspace}/openfeelz.json
 */

import fs from "node:fs";
import path from "node:path";
import type { EmotionEngineConfig, OCEANProfile } from "./src/types.js";
import { DEFAULT_CONFIG } from "./src/types.js";
import { StateManager } from "./src/state/state-manager.js";
import { resolveAgentDir, resolveAgentStatePath, listAgentIds } from "./src/paths.js";
import { createEmotionTool } from "./src/tool/emotion-tool.js";
import { createBootstrapHook, createAgentEndHook } from "./src/hook/hooks.js";
import { registerEmotionCli } from "./src/cli/cli.js";
import { createDashboardHandler } from "./src/http/dashboard.js";
import { analyzePersonalityViaLLM, describeEmotionalStateViaLLM } from "./src/analysis/analyzer.js";

/**
 * Resolve plugin configuration from raw pluginConfig + environment variables.
 */
function resolveConfig(raw?: Record<string, unknown>): EmotionEngineConfig {
  const env = process.env;
  const personality = (raw?.personality ?? {}) as Partial<OCEANProfile>;

  const apiKey = (raw?.apiKey as string) ?? env.ANTHROPIC_API_KEY ?? env.OPENAI_API_KEY ?? undefined;
  const explicitModel = (raw?.model as string) ?? env.EMOTION_MODEL;
  const hasAnthropicKey = !!(raw?.apiKey || env.ANTHROPIC_API_KEY);
  const hasOpenAIKey = !!(raw?.apiKey || env.OPENAI_API_KEY);

  let model = explicitModel ?? DEFAULT_CONFIG.model;
  let baseUrl = (raw?.baseUrl as string) ?? env.OPENAI_BASE_URL ?? DEFAULT_CONFIG.baseUrl;

  if (!explicitModel && hasOpenAIKey && !hasAnthropicKey) {
    model = "gpt-5-mini";
    baseUrl = baseUrl || "https://api.openai.com/v1";
  }

  return {
    apiKey,
    baseUrl,
    model,
    provider: (raw?.provider as "anthropic" | "openai" | undefined) ?? undefined,
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

/**
 * Attempt to resolve an Anthropic API key from OpenClaw's auth-profiles.json.
 * Falls back gracefully if the file doesn't exist or has no Anthropic profile.
 */
function resolveApiKeyFromAuthProfiles(api: any, agentId = "main"): string | undefined {
  try {
    const agentDir = resolveAgentDir(api.config, agentId);
    const authFile = path.join(agentDir, "auth-profiles.json");
    if (!fs.existsSync(authFile)) return undefined;
    const raw = JSON.parse(fs.readFileSync(authFile, "utf8"));
    const profiles = raw?.profiles ?? {};
    for (const profile of Object.values(profiles) as any[]) {
      if (profile?.provider === "anthropic" && profile?.token) {
        return profile.token;
      }
    }
  } catch {
    // Not critical
  }
  return undefined;
}

const emotionEnginePlugin = {
  id: "openfeelz",
  name: "OpenFeelz",
  description:
    "PAD + Ekman + OCEAN emotional model with personality-influenced decay, " +
    "rumination, and multi-agent awareness",

  register(api: any) {
    const config = resolveConfig(api.pluginConfig);

    // Resolve API key from OpenClaw auth profiles if not explicitly configured
    if (!config.apiKey) {
      const resolvedKey = resolveApiKeyFromAuthProfiles(api);
      if (resolvedKey) {
        config.apiKey = resolvedKey;
      }
    }

    const cfg = api.config;

    // Per-agent StateManager cache (state path = workspace/openfeelz.json)
    const managerCache = new Map<string, StateManager>();
    const getManager = (agentId: string): StateManager => {
      const id = agentId?.trim() || "main";
      let m = managerCache.get(id);
      if (!m) {
        const statePath = resolveAgentStatePath(cfg, id);
        m = new StateManager(statePath, config);
        managerCache.set(id, m);
      }
      return m;
    };

    const defaultStatePath = resolveAgentStatePath(cfg, "main");
    api.logger?.info?.(
      `openfeelz: registered (state: ${defaultStatePath}, model: ${config.model}, provider: ${config.provider ?? "auto"})`,
    );

    // -- Tool -- (uses main agent when agent context not available)
    api.registerTool(createEmotionTool(getManager("main")), { name: "emotion_state" });

    // -- Hooks --
    const bootstrapHandler = createBootstrapHook(getManager, config, cfg);
    api.on("before_agent_start", async (event: any) => {
      const agentId = event.agentId ?? "main";
      const result = await bootstrapHandler({
        prompt: event.prompt ?? "",
        userKey: event.senderId ?? event.sessionKey ?? "unknown",
        agentId,
      });
      return result;
    });

    const agentEndHandler = createAgentEndHook(getManager, config);
    api.on("agent_end", async (event: any) => {
      const agentId = event.agentId ?? "main";
      await agentEndHandler({
        success: event.success ?? true,
        messages: event.messages ?? [],
        userKey: event.senderId ?? event.sessionKey ?? "unknown",
        agentId,
      });
    });

    // -- Service (background analysis: startup + every 30m) --
    if (config.apiKey) {
      let analysisIntervalHandle: ReturnType<typeof setInterval> | null = null;

      const runAnalysis = async () => {
        try {
          for (const agentId of listAgentIds(cfg)) {
            const manager = getManager(agentId);
            const state = await manager.getState();
            const opts = {
              apiKey: config.apiKey!,
              model: config.model,
              provider: config.provider,
              baseUrl: config.baseUrl,
            };
            const [personality, emotionalState] = await Promise.all([
              analyzePersonalityViaLLM(state, opts),
              describeEmotionalStateViaLLM(state, opts),
            ]);
            const now = new Date().toISOString();
            const updated = {
              ...state,
              cachedAnalysis: {
                personality: { ...personality, generatedAt: now },
                emotionalState: { ...emotionalState, generatedAt: now },
              },
            };
            await manager.saveState(updated);
          }
        } catch (err) {
          api.logger?.error?.(`[openfeelz] Analysis service error: ${err}`);
        }
      };

      api.registerService({
        id: "openfeelz-analysis",
        start: () => {
          runAnalysis();
          analysisIntervalHandle = setInterval(runAnalysis, 30 * 60_000);
          api.logger?.info?.("openfeelz: analysis service started (interval: 30m)");
        },
        stop: () => {
          if (analysisIntervalHandle) {
            clearInterval(analysisIntervalHandle);
            analysisIntervalHandle = null;
          }
          api.logger?.info?.("openfeelz: analysis service stopped");
        },
      });
    }

    // -- Service (optional background decay) --
    if (config.decayServiceEnabled) {
      let intervalHandle: ReturnType<typeof setInterval> | null = null;

      api.registerService({
        id: "openfeelz-decay",
        start: () => {
          const ms = config.decayServiceIntervalMinutes * 60_000;
          intervalHandle = setInterval(async () => {
            try {
              for (const agentId of listAgentIds(cfg)) {
                const manager = getManager(agentId);
                let state = await manager.getState();
                state = manager.applyDecay(state);
                state = manager.advanceRumination(state);
                await manager.saveState(state);
              }
            } catch (err) {
              api.logger?.error?.(`[openfeelz] Decay service error: ${err}`);
            }
          }, ms);
          api.logger?.info?.(
            `openfeelz: decay service started (interval: ${config.decayServiceIntervalMinutes}m)`,
          );
        },
        stop: () => {
          if (intervalHandle) {
            clearInterval(intervalHandle);
            intervalHandle = null;
          }
          api.logger?.info?.("openfeelz: decay service stopped");
        },
      });
    }

    // -- CLI --
    api.registerCli(
      ({ program }: { program: any }) => registerEmotionCli({ program, getManager, config }),
      { commands: ["emotion"] },
    );

    // -- HTTP Dashboard --
    if (config.dashboardEnabled) {
      api.registerHttpRoute({
        path: "/emotion-dashboard",
        handler: createDashboardHandler(getManager),
      });
    }
  },
};

export default emotionEnginePlugin;
