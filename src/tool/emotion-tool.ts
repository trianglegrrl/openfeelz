/**
 * OpenClaw tool: emotion_state
 *
 * Exposes OpenFeelz to the agent as a callable tool with actions:
 *   query, modify, set_dimension, reset, set_personality, get_personality
 *
 * Uses @sinclair/typebox for parameter schema definition.
 */

import { Type } from "@sinclair/typebox";
import type { DimensionName, OCEANTrait } from "../types.js";
import { DIMENSION_NAMES, OCEAN_TRAITS } from "../types.js";
import {
  computePrimaryEmotion,
  computeOverallIntensity,
} from "../model/emotion-model.js";
import type { StateManager } from "../state/state-manager.js";

/** Tool result shape matching OpenClaw conventions. */
interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
}

/**
 * Create the emotion_state tool definition for registration
 * via api.registerTool().
 */
export function createEmotionTool(manager: StateManager) {
  return {
    name: "emotion_state",
    label: "Emotion State",
    description:
      "Query, modify, or reset the agent's emotional state. " +
      "Supports dimensional (PAD) model, basic emotions (Ekman), " +
      "and OCEAN personality management.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("query"),
        Type.Literal("modify"),
        Type.Literal("set_dimension"),
        Type.Literal("reset"),
        Type.Literal("set_personality"),
        Type.Literal("get_personality"),
      ], { description: "Action to perform" }),
      format: Type.Optional(
        Type.Union([
          Type.Literal("full"),
          Type.Literal("summary"),
          Type.Literal("dimensions"),
          Type.Literal("emotions"),
        ], { description: "Output format for query action" }),
      ),
      emotion: Type.Optional(Type.String({ description: "Emotion label for modify action" })),
      intensity: Type.Optional(Type.Number({ description: "Intensity 0-1 for modify action" })),
      trigger: Type.Optional(Type.String({ description: "What triggered the emotion" })),
      dimension: Type.Optional(Type.String({ description: "Dimension name for set_dimension action" })),
      value: Type.Optional(Type.Number({ description: "Absolute value for set_dimension or set_personality" })),
      delta: Type.Optional(Type.Number({ description: "Delta value for set_dimension" })),
      dimensions: Type.Optional(Type.Array(Type.String(), { description: "Dimensions to reset (empty = all)" })),
      trait: Type.Optional(Type.String({ description: "OCEAN trait name for set_personality" })),
    }),

    async execute(_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> {
      const action = params.action as string;

      switch (action) {
        case "query":
          return handleQuery(manager, params.format as string | undefined);
        case "modify":
          return handleModify(
            manager,
            params.emotion as string | undefined,
            params.intensity as number | undefined,
            params.trigger as string | undefined,
          );
        case "set_dimension":
          return handleSetDimension(
            manager,
            params.dimension as string | undefined,
            params.value as number | undefined,
            params.delta as number | undefined,
          );
        case "reset":
          return handleReset(manager, params.dimensions as string[] | undefined);
        case "set_personality":
          return handleSetPersonality(
            manager,
            params.trait as string | undefined,
            params.value as number | undefined,
          );
        case "get_personality":
          return handleGetPersonality(manager);
        default:
          throw new Error(`Unknown emotion_state action: ${action}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

async function handleQuery(
  manager: StateManager,
  format?: string,
): Promise<ToolResult> {
  let state = await manager.getState();
  state = manager.applyDecay(state);
  await manager.saveState(state);

  let data: unknown;

  switch (format) {
    case "summary":
      data = {
        primaryEmotion: computePrimaryEmotion(state.basicEmotions),
        overallIntensity: computeOverallIntensity(state.basicEmotions),
        pleasure: state.dimensions.pleasure,
        arousal: state.dimensions.arousal,
        dominance: state.dimensions.dominance,
        recentStimuli: state.recentStimuli.slice(0, 5),
        ruminationActive: state.rumination.active.length,
      };
      break;
    case "dimensions":
      data = state.dimensions;
      break;
    case "emotions":
      data = state.basicEmotions;
      break;
    default: // "full"
      data = {
        dimensions: state.dimensions,
        basicEmotions: state.basicEmotions,
        personality: state.personality,
        primaryEmotion: computePrimaryEmotion(state.basicEmotions),
        overallIntensity: computeOverallIntensity(state.basicEmotions),
        baseline: state.baseline,
        recentStimuli: state.recentStimuli.slice(0, 10),
        ruminationActive: state.rumination.active.length,
        totalUpdates: state.meta.totalUpdates,
      };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: { action: "query", format: format ?? "full" },
  };
}

async function handleModify(
  manager: StateManager,
  emotion?: string,
  intensity?: number,
  trigger?: string,
): Promise<ToolResult> {
  if (!emotion) {
    throw new Error("emotion_state modify requires 'emotion' parameter");
  }

  let state = await manager.getState();
  state = manager.applyDecay(state);
  state = manager.applyStimulus(
    state,
    emotion,
    intensity ?? 0.5,
    trigger ?? "agent self-modulation",
  );
  await manager.saveState(state);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          applied: true,
          emotion,
          intensity: intensity ?? 0.5,
          dimensions: state.dimensions,
          primaryEmotion: computePrimaryEmotion(state.basicEmotions),
        }, null, 2),
      },
    ],
    details: { action: "modify", emotion, intensity },
  };
}

async function handleSetDimension(
  manager: StateManager,
  dimension?: string,
  value?: number,
  delta?: number,
): Promise<ToolResult> {
  if (!dimension) {
    throw new Error("emotion_state set_dimension requires 'dimension' parameter");
  }
  if (!DIMENSION_NAMES.includes(dimension as DimensionName)) {
    throw new Error(
      `Unknown dimension "${dimension}". Valid: ${DIMENSION_NAMES.join(", ")}`,
    );
  }

  let state = await manager.getState();
  state = manager.applyDecay(state);

  if (delta != null) {
    state = manager.applyDimensionDeltaMethod(state, dimension as DimensionName, delta);
  } else if (value != null) {
    state = manager.setDimension(state, dimension as DimensionName, value);
  } else {
    throw new Error("emotion_state set_dimension requires either 'value' or 'delta'");
  }

  await manager.saveState(state);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ dimensions: state.dimensions }, null, 2),
      },
    ],
    details: { action: "set_dimension", dimension, value, delta },
  };
}

async function handleReset(
  manager: StateManager,
  dimensions?: string[],
): Promise<ToolResult> {
  let state = await manager.getState();

  const validDims = dimensions?.filter((d) =>
    DIMENSION_NAMES.includes(d as DimensionName),
  ) as DimensionName[] | undefined;

  state = manager.resetToBaseline(state, validDims);
  await manager.saveState(state);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          reset: true,
          dimensions: state.dimensions,
          basicEmotions: state.basicEmotions,
        }, null, 2),
      },
    ],
    details: { action: "reset", dimensions: validDims },
  };
}

async function handleSetPersonality(
  manager: StateManager,
  trait?: string,
  value?: number,
): Promise<ToolResult> {
  if (!trait) {
    throw new Error("emotion_state set_personality requires 'trait' parameter");
  }
  if (!OCEAN_TRAITS.includes(trait as OCEANTrait)) {
    throw new Error(
      `Unknown OCEAN trait "${trait}". Valid: ${OCEAN_TRAITS.join(", ")}`,
    );
  }
  if (value == null) {
    throw new Error("emotion_state set_personality requires 'value' parameter");
  }

  let state = await manager.getState();
  state = manager.setPersonalityTrait(state, trait as OCEANTrait, value);
  await manager.saveState(state);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          personality: state.personality,
          newBaseline: state.baseline,
        }, null, 2),
      },
    ],
    details: { action: "set_personality", trait, value },
  };
}

async function handleGetPersonality(manager: StateManager): Promise<ToolResult> {
  const state = await manager.getState();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(state.personality, null, 2),
      },
    ],
    details: { action: "get_personality" },
  };
}
