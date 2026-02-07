/**
 * Core type definitions for the OpenFeelz plugin.
 *
 * Combines:
 *  - PAD (Pleasure-Arousal-Dominance) dimensional model
 *  - Ekman's 6 basic emotions
 *  - OCEAN / Big Five personality model
 *  - Extended AI-relevant dimensions (connection, curiosity, energy, trust)
 */

// ---------------------------------------------------------------------------
// Dimensional Model (PAD + extensions)
// ---------------------------------------------------------------------------

/** PAD core dimensions + AI-relevant extensions. */
export interface DimensionalState {
  /** Valence: unpleasant (-1) to pleasant (+1). */
  pleasure: number;
  /** Activation: calm (-1) to excited (+1). */
  arousal: number;
  /** Control: submissive (-1) to dominant (+1). */
  dominance: number;
  /** Social bonding (0 = distant, 1 = close). */
  connection: number;
  /** Intellectual engagement (0 = bored, 1 = fascinated). */
  curiosity: number;
  /** Resource level (0 = depleted, 1 = energized). */
  energy: number;
  /** Interpersonal trust (0 = guarded, 1 = trusting). */
  trust: number;
}

/** Names of all dimension keys. */
export type DimensionName = keyof DimensionalState;

/** All dimension names as a readonly tuple for iteration. */
export const DIMENSION_NAMES: readonly DimensionName[] = [
  "pleasure",
  "arousal",
  "dominance",
  "connection",
  "curiosity",
  "energy",
  "trust",
] as const;

/** Dimensions that range from -1 to +1. */
export const BIPOLAR_DIMENSIONS: readonly DimensionName[] = [
  "pleasure",
  "arousal",
  "dominance",
] as const;

/** Dimensions that range from 0 to 1. */
export const UNIPOLAR_DIMENSIONS: readonly DimensionName[] = [
  "connection",
  "curiosity",
  "energy",
  "trust",
] as const;

// ---------------------------------------------------------------------------
// Basic Emotions (Ekman)
// ---------------------------------------------------------------------------

/** Ekman's 6 basic emotions, each 0.0 to 1.0. */
export interface BasicEmotions {
  happiness: number;
  sadness: number;
  anger: number;
  fear: number;
  disgust: number;
  surprise: number;
}

export type BasicEmotionName = keyof BasicEmotions;

export const BASIC_EMOTION_NAMES: readonly BasicEmotionName[] = [
  "happiness",
  "sadness",
  "anger",
  "fear",
  "disgust",
  "surprise",
] as const;

// ---------------------------------------------------------------------------
// Personality (OCEAN / Big Five)
// ---------------------------------------------------------------------------

/** Big Five personality traits, each 0.0 to 1.0. */
export interface OCEANProfile {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export type OCEANTrait = keyof OCEANProfile;

export const OCEAN_TRAITS: readonly OCEANTrait[] = [
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "neuroticism",
] as const;

// ---------------------------------------------------------------------------
// Decay Configuration
// ---------------------------------------------------------------------------

/** Per-dimension decay rates (units: per hour, higher = faster decay). */
export type DecayRates = Record<DimensionName, number>;

/** Per-basic-emotion decay rates. */
export type EmotionDecayRates = Record<BasicEmotionName, number>;

// ---------------------------------------------------------------------------
// Emotion Stimulus
// ---------------------------------------------------------------------------

/** A classified emotional event with its detected properties. */
export interface EmotionStimulus {
  /** Unique identifier. */
  id: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Detected emotion label (e.g. "joy", "anger", "curiosity"). */
  label: string;
  /** 0.0 to 1.0 intensity of the emotion. */
  intensity: number;
  /** What triggered this emotion. */
  trigger: string;
  /** Classification confidence (0.0 to 1.0). */
  confidence: number;
  /** Source role: "user" | "assistant" | "system". */
  sourceRole: string;
  /** SHA-256 hash of source text (to avoid re-processing). */
  sourceHash?: string;
}

// ---------------------------------------------------------------------------
// Rumination
// ---------------------------------------------------------------------------

/** A single active rumination entry. */
export interface RuminationEntry {
  /** Reference to the original stimulus. */
  stimulusId: string;
  /** Emotion label being ruminated on. */
  label: string;
  /** Current rumination stage (0-indexed). */
  stage: number;
  /** Current intensity (diminishes with each stage). */
  intensity: number;
  /** ISO 8601 timestamp of last stage advancement. */
  lastStageTimestamp: string;
}

/** Aggregate rumination state. */
export interface RuminationState {
  /** Currently active rumination entries. */
  active: RuminationEntry[];
}

// ---------------------------------------------------------------------------
// User / Agent Emotion Buckets
// ---------------------------------------------------------------------------

/** Tracked emotional state for a user or agent. */
export interface EmotionBucket {
  /** Most recent classified emotion. */
  latest?: EmotionStimulus;
  /** History of classified emotions (newest first, capped). */
  history: EmotionStimulus[];
}

// ---------------------------------------------------------------------------
// Cached LLM Analysis
// ---------------------------------------------------------------------------

/** Cached personality analysis from background LLM job. */
export interface CachedPersonalityAnalysis {
  summary: string;
  generatedAt: string;
  pad: { pleasure: number; arousal: number; dominance: number };
  extensions: { connection: number; curiosity: number; energy: number; trust: number };
  ocean: { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number };
}

/** Cached emotional state description from background LLM job. */
export interface CachedEmotionalStateDescription {
  summary: string;
  generatedAt: string;
  primary: string;
  intensity: number;
  notes: string[];
}

export interface CachedAnalysis {
  personality?: CachedPersonalityAnalysis;
  emotionalState?: CachedEmotionalStateDescription;
}

// ---------------------------------------------------------------------------
// Persisted State (v2)
// ---------------------------------------------------------------------------

/** Complete OpenFeelz state persisted to disk. */
export interface EmotionEngineState {
  /** Schema version, always 2. */
  version: 2;
  /** ISO 8601 timestamp of last state update. */
  lastUpdated: string;
  /** OCEAN personality profile. */
  personality: OCEANProfile;
  /** Current dimensional values. */
  dimensions: DimensionalState;
  /** Personality-influenced resting values. */
  baseline: DimensionalState;
  /** Personality-influenced decay rates per dimension. */
  decayRates: DecayRates;
  /** Decay rates for basic emotions. */
  emotionDecayRates: EmotionDecayRates;
  /** Current basic emotion intensities. */
  basicEmotions: BasicEmotions;
  /** Recent emotional stimuli (newest first, capped). */
  recentStimuli: EmotionStimulus[];
  /** Active rumination state. */
  rumination: RuminationState;
  /** Per-user emotion tracking. */
  users: Record<string, EmotionBucket>;
  /** Per-agent emotion tracking (self + others). */
  agents: Record<string, EmotionBucket>;
  /** Metadata. */
  meta: {
    totalUpdates: number;
    createdAt: string;
  };
  /** Cached LLM analysis (written by background service). */
  cachedAnalysis?: CachedAnalysis;
}

// ---------------------------------------------------------------------------
// Classifier Output
// ---------------------------------------------------------------------------

/** Result from the emotion classifier. */
export interface ClassificationResult {
  /** Detected emotion label. */
  label: string;
  /** Intensity: low | medium | high or a 0-1 number. */
  intensity: number;
  /** Short explanation of the trigger. */
  reason: string;
  /** Classification confidence 0-1. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Dimension Delta Map (emotion -> dimension changes)
// ---------------------------------------------------------------------------

/** How a specific emotion label maps to dimensional changes. */
export interface EmotionDimensionDelta {
  /** Partial map of dimension name to delta value. */
  dimensions: Partial<DimensionalState>;
  /** Partial map of basic emotion name to delta value. */
  emotions: Partial<BasicEmotions>;
}

// ---------------------------------------------------------------------------
// Plugin Configuration (resolved)
// ---------------------------------------------------------------------------

/** Fully resolved configuration for the OpenFeelz plugin. */
export interface EmotionEngineConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  /** Force a specific provider: "anthropic" | "openai". Auto-detected from model name if omitted. */
  provider?: "anthropic" | "openai";
  classifierUrl?: string;
  confidenceMin: number;
  halfLifeHours: number;
  trendWindowHours: number;
  maxHistory: number;
  ruminationEnabled: boolean;
  ruminationThreshold: number;
  ruminationMaxStages: number;
  realtimeClassification: boolean;
  contextEnabled: boolean;
  decayServiceEnabled: boolean;
  decayServiceIntervalMinutes: number;
  dashboardEnabled: boolean;
  timezone?: string;
  maxOtherAgents: number;
  emotionLabels: string[];
  personality: OCEANProfile;
  decayRateOverrides: Partial<Record<DimensionName, number>>;
  dimensionBaselineOverrides: Partial<DimensionalState>;
}

/** Default configuration values. */
export const DEFAULT_CONFIG: EmotionEngineConfig = {
  baseUrl: "https://api.openai.com/v1",
  model: "claude-sonnet-4-5-20250514",
  confidenceMin: 0.35,
  halfLifeHours: 12,
  trendWindowHours: 24,
  maxHistory: 100,
  ruminationEnabled: true,
  ruminationThreshold: 0.7,
  ruminationMaxStages: 4,
  realtimeClassification: false,
  contextEnabled: true,
  decayServiceEnabled: false,
  decayServiceIntervalMinutes: 30,
  dashboardEnabled: true,
  maxOtherAgents: 3,
  emotionLabels: [
    "neutral",
    "calm",
    "happy",
    "excited",
    "sad",
    "anxious",
    "frustrated",
    "angry",
    "confused",
    "focused",
    "relieved",
    "optimistic",
    "curious",
    "surprised",
    "disgusted",
    "fearful",
    "trusting",
    "connected",
    "lonely",
    "energized",
    "fatigued",
  ],
  personality: {
    openness: 0.5,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    neuroticism: 0.5,
  },
  decayRateOverrides: {},
  dimensionBaselineOverrides: {},
};
