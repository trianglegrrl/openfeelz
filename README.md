# OpenFeelz

> *"Let's build robots with Genuine People Personalities, they said. So they tried it out with me. I'm a personality prototype. You can tell can't you?"*
> -- Douglas Adams, *The Hitchhiker's Guide to the Galaxy*

[![CI](https://github.com/trianglegrrl/openfeelz/actions/workflows/ci.yml/badge.svg)](https://github.com/trianglegrrl/openfeelz/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-plugin-purple.svg)](https://openclaw.com)

---

Hey folks! :)

So here's the thing: AI agents don't have feelings. Obviously. But the way they *respond* to emotional context -- the way they mirror, adapt, and adjust their tone -- that matters a lot. And right now, most agents are just... flat. They don't track that you've been frustrated for the last three messages. They don't notice that they themselves have been cheerful while you're clearly having a bad day. They just vibes-check every single message independently and hope for the best.

OpenFeelz is my attempt to fix that. It's an [OpenClaw](https://openclaw.com) plugin that gives AI agents a real emotional model -- not a toy "sentiment is positive!" flag, but a proper multidimensional system with personality-influenced baselines, exponential decay, rumination, and multi-agent awareness. Think of it as giving your agent the emotional equivalent of short-term memory.

I'm not claiming this makes agents *sentient* or whatever. (I am not a philosopher and I have no reputation to care about there.) But I've spent a lot of time working on this, and I think the difference in interaction quality is genuinely noticeable. The agent remembers that you were frustrated, and it carries a little residual empathy into the next exchange. That's... actually kind of cool? Life is so cool.

## What's Under the Hood

- **PAD Dimensional Model** -- Pleasure, Arousal, Dominance + Connection, Curiosity, Energy, Trust. Seven continuous dimensions that capture emotional state way better than discrete labels alone.
- **Ekman Basic Emotions** -- Happiness, Sadness, Anger, Fear, Disgust, Surprise. The classics. These map onto the dimensional model.
- **OCEAN Personality** -- Big Five traits (Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism) influence baselines, decay rates, and response intensity. Your agent can be a neurotic introvert or a chill extravert. :)
- **Exponential Decay** -- Emotions fade over time toward personality-influenced baselines. Surprise fades fast (~5 hours). Trust fades slow (~20 hours). This isn't arbitrary -- it's modeled on actual affect research.
- **Rumination Engine** -- Intense emotions don't just disappear. They echo. If the agent experiences something strongly enough, it continues to process across interactions, just like humans do.
- **Goal-Aware Modulation** -- Personality-inferred goals amplify relevant emotions. A high-openness agent gets *more* curious, not less.
- **Multi-Agent Awareness** -- If you're running multiple agents, they can see each other's emotional states. Empathetic coordination!
- **Custom Taxonomy** -- Don't like my emotion labels? Define your own with custom dimension mappings.
- **LLM Classification** -- Automatically detects emotions in user and agent messages via OpenAI-compatible models.
- **Web Dashboard** -- Glassmorphism UI at `/emotion-dashboard` because I like pretty things.
- **MCP Server** -- Expose emotional state to Cursor, Claude Desktop, etc.
- **CLI Tools** -- `openclaw emotion status`, `reset`, `personality`, `history`, `decay`

## Installation

```bash
openclaw plugins install openfeelz
openclaw plugins enable openfeelz
```

That's it. No, really. :)

## How Emotional Context Gets Into the Agent

This is the core of what the plugin does, so let me walk you through it. I think it's worth understanding in detail because it's actually pretty elegant (if I do say so myself).

### The Lifecycle

Every time the agent starts a new turn, OpenFeelz runs through this sequence:

```
User sends a message
        |
        v
  [before_agent_start hook fires]
        |
        v
  1. Load emotion state from disk
  2. Compute elapsed time since last update
  3. Apply exponential decay to all dimensions and basic emotions
  4. Advance any active rumination entries
  5. Save the updated state back to disk
  6. Format the state into an <emotion_state> XML block
  7. Return it as "prependContext" to OpenClaw
        |
        v
  OpenClaw prepends the block to the agent's system prompt
        |
        v
  Agent sees its own emotional context alongside the user's message
        |
        v
  [Agent generates a response]
        |
        v
  [agent_end hook fires]
        |
        v
  1. Extract the latest user message and assistant message
  2. Send each to the LLM classifier to detect emotions
  3. Map classified emotions to dimensional changes
  4. Record entries in the user and agent history buckets
  5. If intensity exceeds threshold, start rumination
  6. Save updated state to disk
```

### What the Agent Sees

The plugin prepends an `<emotion_state>` XML block to the system prompt. Here's a concrete example of what that looks like:

```xml
<emotion_state>
  <dimensions>
    pleasure: lowered (-0.12), arousal: elevated (0.18), curiosity: elevated (0.72)
  </dimensions>
  <user>
    2026-02-06 09:15: Felt strongly frustrated because deployment keeps failing.
    2026-02-06 08:40: Felt moderately anxious because tight deadline approaching.
    Trend (last 24h): mostly frustrated.
  </user>
  <agent>
    2026-02-06 09:10: Felt moderately focused because working through error logs.
  </agent>
  <others>
    research-agent — 2026-02-06 08:00: Felt mildly curious because investigating new library.
  </others>
</emotion_state>
```

Each section serves a purpose:

- **`<dimensions>`** -- Shows which PAD dimensions have drifted away from the agent's personality baseline. Only dimensions that deviate by more than 0.15 from baseline appear here. This gives the agent a sense of its own internal state.

- **`<user>`** -- The most recent 3 classified emotions from the user, written in natural language. Each entry includes a timestamp, intensity word (mildly/moderately/strongly), the emotion label, and what triggered it. A trend line summarizes the dominant emotion over the past 24 hours, weighted by recency.

- **`<agent>`** -- The most recent 2 classified emotions from the agent itself. This gives the agent continuity about its own emotional trajectory.

- **`<others>`** -- If other agents are running on the same OpenClaw instance, their most recent emotional states appear here (up to 3 by default). This enables empathetic multi-agent coordination.

The block only appears when there is something to show. If the agent has no emotional history yet, no block is injected and the prompt is unchanged.

### When Injection Is Disabled

Set `contextEnabled: false` in your config to stop the block from being prepended. The rest of the system (classification, decay, the tool, the dashboard) still works -- the agent just won't see the emotional context in its prompt.

## How Decay Works

Ok, so this is the part where I get to be a nerd about math. Emotions don't last forever. (If yours do, I am not a doctor, but maybe talk to one?) After an emotional event, every dimension and basic emotion gradually returns to the agent's personality-influenced baseline using exponential decay:

```
newValue = baseline + (currentValue - baseline) * e^(-rate * elapsedHours)
```

This means emotions fade quickly at first and then slowly approach baseline. The rate is expressed in units of "per hour," and the half-life (the time it takes for the distance from baseline to halve) is:

```
halfLife = ln(2) / rate ~ 0.693 / rate
```

### Default Decay Rates

| Dimension / Emotion | Rate (per hour) | Half-Life | Why |
|---------------------|-----------------|-----------|-----|
| Pleasure | 0.058 | ~12 hours | Mood shifts are moderate-duration |
| Arousal | 0.087 | ~8 hours | Activation calms relatively quickly |
| Dominance | 0.046 | ~15 hours | Sense of control is slow to change |
| Connection | 0.035 | ~20 hours | Social bonds persist |
| Curiosity | 0.058 | ~12 hours | Intellectual interest is moderate |
| Energy | 0.046 | ~15 hours | Energy recovers slowly |
| Trust | 0.035 | ~20 hours | Trust is hard-won and slow to fade |
| Happiness | 0.058 | ~12 hours | |
| Sadness | 0.046 | ~15 hours | Sadness lingers longer than joy |
| Anger | 0.058 | ~12 hours | |
| Fear | 0.058 | ~12 hours | |
| Disgust | 0.046 | ~15 hours | |
| Surprise | 0.139 | ~5 hours | Surprise fades the fastest |

### Concrete Example: Anger at 0.85

I find concrete examples more useful than formulas, so here's what happens if the agent receives an anger stimulus at intensity 0.85, with the default rate (0.058/hr, toward baseline 0):

| Hours Elapsed | Anger Value | What It Feels Like |
|---------------|-------------|---------------------|
| 0 | 0.85 | Strongly angry |
| 2 | 0.76 | Still clearly angry |
| 6 | 0.60 | Moderately angry |
| 12 | 0.42 | Mildly angry (one half-life) |
| 24 | 0.21 | Barely noticeable (two half-lives) |
| 48 | 0.05 | Effectively at baseline |

### How Personality Affects Decay

OCEAN personality traits modulate the rates. This is where it gets interesting:

- **High neuroticism (0.9)**: Pleasure decay slows by ~0.8x. Sadness, anger, and fear decay slows by ~0.84-0.88x. Negative emotions linger. (Sound like anyone you know?)
- **High extraversion (0.9)**: Sadness decay speeds up by ~1.16x. Arousal and pleasure recovery speed up. Extraverts bounce back.
- **High agreeableness (0.9)**: Anger fades ~1.12x faster. Connection decays more slowly.
- **High openness (0.9)**: Curiosity and surprise decay more slowly. The agent stays interested longer.

### When Decay Runs

Decay is **computed on-demand**, not on a background timer:

1. **Every `before_agent_start`** -- When the agent wakes up for a new turn, decay is applied based on the time elapsed since the last update. This is the primary mechanism.

2. **Every tool `query` action** -- When the agent asks about its own state, decay is applied first so the reading is accurate.

3. **Optional background service** -- If you set `decayServiceEnabled: true`, a background interval runs every `decayServiceIntervalMinutes` (default 30) to apply decay even when the agent is idle. This keeps the dashboard accurate between interactions.

### Configuring Decay

There are three levels of control:

**Global half-life** -- The simplest knob. Set `halfLifeHours: 6` and all emotions will fade twice as fast as the default.

**Per-dimension overrides** -- Fine-grained control over individual dimensions:

```json
{
  "decayRates": {
    "pleasure": 0.1,
    "trust": 0.02
  }
}
```

**Personality-driven** -- Change OCEAN traits and baselines + rates recalculate automatically:

```bash
openclaw emotion personality set --trait neuroticism --value 0.8
```

## Configuration

Configure in `~/.openclaw/openclaw.json` under `plugins.entries.openfeelz.config`:

```json
{
  "plugins": {
    "entries": {
      "openfeelz": {
        "config": {
          "apiKey": "${OPENAI_API_KEY}",
          "model": "gpt-4o-mini",
          "halfLifeHours": 12,
          "ruminationEnabled": true,
          "personality": {
            "openness": 0.7,
            "conscientiousness": 0.6,
            "extraversion": 0.5,
            "agreeableness": 0.8,
            "neuroticism": 0.3
          }
        }
      }
    }
  }
}
```

All settings are also configurable via the OpenClaw web UI.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | _(required)_ | API key for LLM emotion classification |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Custom API base URL |
| `EMOTION_MODEL` | `gpt-4o-mini` | Which model to use for classification |
| `EMOTION_CLASSIFIER_URL` | _(none)_ | External HTTP classifier (bypasses LLM) |
| `EMOTION_HALF_LIFE_HOURS` | `12` | Global decay half-life |
| `EMOTION_CONFIDENCE_MIN` | `0.35` | Discard classifications below this |
| `EMOTION_HISTORY_SIZE` | `100` | Max stored stimuli per agent |
| `EMOTION_TIMEZONE` | _(system)_ | IANA timezone for display |

### All Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | `$OPENAI_API_KEY` | API key for LLM classification |
| `baseUrl` | string | OpenAI default | API base URL |
| `model` | string | `gpt-4o-mini` | Classification model |
| `classifierUrl` | string | _(none)_ | External classifier URL |
| `confidenceMin` | number | `0.35` | Min confidence threshold |
| `halfLifeHours` | number | `12` | Global decay half-life |
| `trendWindowHours` | number | `24` | Window for trend computation |
| `maxHistory` | number | `100` | Max stored stimuli |
| `ruminationEnabled` | boolean | `true` | Enable rumination engine |
| `ruminationThreshold` | number | `0.7` | Intensity threshold for rumination |
| `ruminationMaxStages` | number | `4` | Max rumination stages |
| `realtimeClassification` | boolean | `false` | Classify on every message |
| `contextEnabled` | boolean | `true` | Prepend emotion context to prompt |
| `decayServiceEnabled` | boolean | `false` | Background decay service |
| `decayServiceIntervalMinutes` | number | `30` | Decay service interval |
| `dashboardEnabled` | boolean | `true` | Serve web dashboard |
| `timezone` | string | _(system)_ | IANA timezone |
| `maxOtherAgents` | number | `3` | Max other agents in prompt |
| `emotionLabels` | string[] | _(21 built-in)_ | Custom label taxonomy |
| `personality` | object | all `0.5` | OCEAN trait values |
| `decayRates` | object | _(see table)_ | Per-dimension rate overrides |
| `dimensionBaselines` | object | _(computed)_ | Per-dimension baseline overrides |

## Agent Tool: `emotion_state`

The agent can call this tool to inspect and modify its own emotional state:

| Action | Description | Parameters |
|--------|-------------|------------|
| `query` | Get current emotional state | `format?: "full" / "summary" / "dimensions" / "emotions"` |
| `modify` | Apply an emotional stimulus | `emotion, intensity?, trigger?` |
| `set_dimension` | Set or adjust a dimension | `dimension, value?` or `dimension, delta?` |
| `reset` | Reset to personality baseline | `dimensions?` (comma-separated, or all) |
| `set_personality` | Set an OCEAN trait | `trait, value` |
| `get_personality` | Get current OCEAN profile | _(none)_ |

## CLI Commands

```bash
openclaw emotion status              # Formatted emotional state with bars
openclaw emotion status --json       # Raw JSON output
openclaw emotion personality         # Show OCEAN profile
openclaw emotion personality set --trait openness --value 0.8
openclaw emotion reset               # Reset all to baseline
openclaw emotion reset --dimensions pleasure,arousal
openclaw emotion history --limit 20  # Recent stimuli
openclaw emotion decay --dimension pleasure --rate 0.05
```

## Dashboard

Access at `http://localhost:<gateway-port>/emotion-dashboard`

Shows real-time visualization of:
- PAD dimensions with baseline markers
- Basic emotion intensities
- OCEAN personality profile
- Recent emotional stimuli
- Active rumination status

Append `?format=json` for a raw JSON API endpoint.

## MCP Server

If you want to use this with Cursor, Claude Desktop, or any MCP-compatible client, you can use the standalone MCP server entry point:

```json
{
  "mcpServers": {
    "openfeelz": {
      "command": "npx",
      "args": ["openfeelz/mcp"]
    }
  }
}
```

### MCP Resources

- `emotion://state` -- Current emotional state
- `emotion://personality` -- OCEAN personality profile

### MCP Tools

- `query_emotion` -- Query emotional state
- `modify_emotion` -- Apply emotional stimulus
- `set_personality` -- Set OCEAN trait

## Migration from emotion-state-1

If you were using the old emotion-state hook:

```bash
openclaw hooks disable emotion-state
openclaw emotion migrate
```

The migration converts v1 state files (flat labels + string intensities) to v2 format (dimensional model + numeric intensities). The new plugin uses a separate state file (`openfeelz.json`) so there is no risk of data loss.

## Architecture

```
index.ts                 Plugin entry: registers tool, hooks, service, CLI, dashboard
src/
  types.ts               All interfaces (DimensionalState, BasicEmotions, OCEANProfile, etc.)
  model/
    emotion-model.ts     Core model: clamping, primary detection, intensity, deltas
    personality.ts       OCEAN: baselines, decay rates, rumination probability
    decay.ts             Exponential decay toward personality-influenced baselines
    mapping.ts           Emotion label -> dimension/emotion delta mapping (60+ labels)
    rumination.ts        Multi-stage internal processing for intense emotions
    goal-modulation.ts   Personality-inferred goals amplify relevant emotions
    custom-taxonomy.ts   User-defined emotion labels with custom mappings
  state/
    state-manager.ts     Orchestrator: classify + map + decay + ruminate + persist
    state-file.ts        Atomic JSON I/O with file locking
    multi-agent.ts       Scan sibling agent states for awareness
  classify/
    classifier.ts        Unified LLM + HTTP classifier with fallback
  tool/
    emotion-tool.ts      OpenClaw tool: query/modify/reset/personality
  hook/
    hooks.ts             before_agent_start + agent_end hooks
  cli/
    cli.ts               Commander.js CLI commands
  http/
    dashboard.ts         Glassmorphism HTML dashboard
  mcp/
    mcp-server.ts        MCP server resources + tools
  format/
    prompt-formatter.ts  System prompt <emotion_state> block builder
  migration/
    migrate-v1.ts        emotion-state-1 v1 -> v2 converter
```

## Development

```bash
npm install
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
npm run typecheck     # TypeScript strict checking
npm run lint          # oxlint
npm run build         # Compile to dist/
```

## Contributing

This is worth digging into more, and I'd love help. If you want to fact-check me, improve the model, or just poke around -- please do! DM me or open an issue. Happy to answer questions! :)

## License

[MIT](LICENSE)
