# OpenFeelz

> *"Let's build robots with Genuine People Personalities, they said. So they tried it out with me. I'm a personality prototype. You can tell can't you?"*
> -- Douglas Adams, *The Hitchhiker's Guide to the Galaxy*

[![CI](https://github.com/trianglegrrl/openfeelz/actions/workflows/ci.yml/badge.svg)](https://github.com/trianglegrrl/openfeelz/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![npm](https://img.shields.io/npm/v/openfeelz.svg)](https://www.npmjs.com/package/openfeelz)

An [OpenClaw](https://openclaw.com) plugin that gives AI agents a multidimensional emotional model with personality-influenced decay, rumination, and multi-agent awareness.

Most agents vibes-check each message independently and forget everything between turns. OpenFeelz gives them emotional short-term memory -- the agent knows you've been frustrated for the last three messages, and it carries that context forward. It's not sentience, it's just better interaction design. (But it's pretty cool.)

## Features

- **PAD Dimensional Model** -- Pleasure, Arousal, Dominance + Connection, Curiosity, Energy, Trust
- **Ekman Basic Emotions** -- Happiness, Sadness, Anger, Fear, Disgust, Surprise
- **OCEAN Personality** -- Big Five traits influence baselines, decay rates, and response intensity
- **Exponential Decay** -- Emotions fade toward personality-influenced baselines over time
- **Rumination Engine** -- Intense emotions continue to influence state across interactions
- **Goal-Aware Modulation** -- Personality-inferred goals amplify relevant emotions
- **Multi-Agent Awareness** -- Agents see other agents' emotional states in the system prompt
- **Custom Taxonomy** -- Define your own emotion labels with dimension mappings
- **LLM Classification** -- Automatically classify user/agent emotions via OpenAI-compatible models
- **Web Dashboard** -- Glassmorphism UI at `/emotion-dashboard`
- **MCP Server** -- Expose emotional state to Cursor, Claude Desktop, etc.
- **CLI Tools** -- `openclaw emotion status`, `reset`, `personality`, `history`, `decay`, **`configure`** (interactive wizard)

## Installation

OpenClaw resolves plugin names from the npm registry, so you can install by package name (no URL or path needed):

```bash
openclaw plugins install openfeelz
openclaw plugins enable openfeelz
```

Restart the gateway after installing. To pin a version: `openclaw plugins install openfeelz@0.9.4`. To install from a local clone (e.g. for development), run `npm run build` in the repo first, then `openclaw plugins install /path/to/openfeelz`.

When using **reasoning models** (e.g. gpt-5-mini, o1, o3), the classifier omits custom temperature so the API accepts the request. Optional classification logging can be enabled via config (see `docs/OPENFEELZ-FIX-COMPLETE.md`).

## How It Works

Every agent turn, OpenFeelz hooks into the lifecycle:

```
User sends a message
        |
        v
  [before_agent_start hook]
        |
        v
  1. Load emotion state from disk
  2. Apply exponential decay based on elapsed time
  3. Advance any active rumination entries
  4. Format state into an <emotion_state> XML block
  5. Return as "prependContext" to OpenClaw
        |
        v
  Agent sees emotional context in its system prompt
        |
        v
  [Agent responds]
        |
        v
  [agent_end hook]
        |
        v
  1. Classify emotions in user + agent messages via LLM
  2. Map to dimensional changes
  3. Start rumination if intensity exceeds threshold
  4. Save updated state to disk
```

### What the Agent Sees

The plugin prepends an `<emotion_state>` block to the system prompt:

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

- **`<dimensions>`** -- PAD dimensions that deviate >0.15 from personality baseline
- **`<user>`** -- Last 3 classified user emotions with timestamps, intensity, and triggers
- **`<agent>`** -- Last 2 agent emotions (continuity across turns)
- **`<others>`** -- Other agents' recent emotional states (up to `maxOtherAgents`)

The block only appears when there's something to show. Set `contextEnabled: false` to disable injection while keeping classification, decay, and the dashboard active.

## Decay Model

Emotions return to personality-influenced baselines via exponential decay:

```
newValue = baseline + (currentValue - baseline) * e^(-rate * elapsedHours)
halfLife = ln(2) / rate
```

### Default Rates

| Dimension / Emotion | Rate (per hour) | Half-Life | Notes |
|---------------------|-----------------|-----------|-------|
| Pleasure | 0.058 | ~12h | |
| Arousal | 0.087 | ~8h | Activation calms quickly |
| Dominance | 0.046 | ~15h | Sense of control shifts slowly |
| Connection | 0.035 | ~20h | Social bonds persist |
| Curiosity | 0.058 | ~12h | |
| Energy | 0.046 | ~15h | |
| Trust | 0.035 | ~20h | Hard-won, slow to fade |
| Happiness | 0.058 | ~12h | |
| Sadness | 0.046 | ~15h | Lingers longer than joy |
| Anger | 0.058 | ~12h | |
| Fear | 0.058 | ~12h | |
| Disgust | 0.046 | ~15h | |
| Surprise | 0.139 | ~5h | Fades the fastest |

### Personality Modulation

OCEAN traits adjust decay rates:

- **High neuroticism** -- Negative emotions linger (~0.84-0.88x decay rate)
- **High extraversion** -- Sadness fades faster (~1.16x), arousal/pleasure recover quicker
- **High agreeableness** -- Anger fades faster (~1.12x), connection decays slower
- **High openness** -- Curiosity and surprise persist longer

### When Decay Runs

Decay is computed on-demand, not on a timer:

1. **`before_agent_start`** -- Primary mechanism. Applied based on elapsed time since last update.
2. **Tool `query` action** -- Decay applied before reading, so values are accurate.
3. **Optional background service** -- Set `decayServiceEnabled: true` for dashboard accuracy between interactions.

### Configuring Decay

Three levels of control:

- **Global half-life** -- `halfLifeHours: 6` makes everything fade 2x faster
- **Per-dimension overrides** -- `"decayRates": { "pleasure": 0.1, "trust": 0.02 }`
- **Personality-driven** -- Change OCEAN traits and rates recalculate automatically

## Configuration

In `~/.openclaw/openclaw.json` under `plugins.entries.openfeelz.config`:

```json
{
  "plugins": {
    "entries": {
      "openfeelz": {
        "config": {
          "apiKey": "${OPENAI_API_KEY}",
          "model": "gpt-5-mini",
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

Also configurable via the OpenClaw web UI.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | _(required)_ | API key for LLM emotion classification |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Custom API base URL |
| `EMOTION_MODEL` | `gpt-5-mini` | Classification model (when OpenAI key present) |
| `EMOTION_CLASSIFIER_URL` | _(none)_ | External HTTP classifier (bypasses LLM) |
| `EMOTION_HALF_LIFE_HOURS` | `12` | Global decay half-life |
| `EMOTION_CONFIDENCE_MIN` | `0.35` | Min confidence threshold |
| `EMOTION_HISTORY_SIZE` | `100` | Max stored stimuli per agent |
| `EMOTION_TIMEZONE` | _(system)_ | IANA timezone for display |

### Full Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | `$OPENAI_API_KEY` | API key for LLM classification |
| `baseUrl` | string | OpenAI default | API base URL |
| `model` | string | `claude-sonnet-4-5` / `gpt-5-mini` | Classification model (auto-selected by available API key) |
| `classifierUrl` | string | _(none)_ | External classifier URL |
| `confidenceMin` | number | `0.35` | Min confidence threshold |
| `halfLifeHours` | number | `12` | Global decay half-life |
| `trendWindowHours` | number | `24` | Trend computation window |
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

The agent can inspect and modify its own emotional state:

| Action | Description | Parameters |
|--------|-------------|------------|
| `query` | Get current emotional state | `format?: "full" / "summary" / "dimensions" / "emotions"` |
| `modify` | Apply an emotional stimulus | `emotion, intensity?, trigger?` |
| `set_dimension` | Set or adjust a dimension | `dimension, value?` or `dimension, delta?` |
| `reset` | Reset to personality baseline | `dimensions?` (comma-separated, or all) |
| `set_personality` | Set an OCEAN trait | `trait, value` |
| `get_personality` | Get current OCEAN profile | _(none)_ |

## CLI

```bash
openclaw emotion status              # Formatted state with bars
openclaw emotion status --json       # Raw JSON
openclaw emotion personality         # OCEAN profile
openclaw emotion personality set --trait openness --value 0.8
openclaw emotion reset               # Reset all to baseline
openclaw emotion reset --dimensions pleasure,arousal
openclaw emotion history --limit 20  # Recent stimuli
openclaw emotion decay --dimension pleasure --rate 0.05
openclaw emotion configure           # Interactive configuration wizard (see below)
```

### Configuration wizard: `openclaw emotion configure`

The **configuration wizard** is the CLI option for guided setup. It runs an interactive (TUI-style) flow where you can:

- **a) Choose a preset** — Pick one of 10 famous-personality presets (OCEAN profiles based on biographical research). Each option is listed with a short explanation. The wizard applies that preset’s personality to your agent’s state.
- **b) Customize** — Skip presets and go straight to custom settings, or after picking a preset you can optionally configure model, decay half-life, rumination, context injection, and dashboard.

So: run **`openclaw emotion configure`** to open the wizard; it will ask whether you want a **preset** (with explanations) or **custom**, then optionally walk through key config fields with validation and help text.

#### Default personalities in the picker

The preset picker offers these 10 options (diverse across time, region, and domain; OCEAN values from biographical/psychological literature, see `docs/personality-presets-research.md`):

| Preset | Description |
|--------|-------------|
| **Albert Einstein** | Theoretical physicist (Germany/US, 20th c.) — high openness & conscientiousness, introspective. |
| **Marie Curie** | Physicist and chemist (Poland/France, 19th–20th c.) — perseverance, solitary focus. |
| **Nelson Mandela** | Anti-apartheid leader, President of South Africa (20th c.) — high agreeableness & extraversion, emotional stability. |
| **Wangari Maathai** | Environmentalist and Nobel Peace laureate (Kenya, 20th c.) — Green Belt Movement; visionary, resilient. |
| **Frida Kahlo** | Painter (Mexico, 20th c.) — high openness and emotional intensity. |
| **Confucius** | Philosopher and teacher (Ancient China) — high conscientiousness & agreeableness, emphasis on li and ren. |
| **Simón Bolívar** | Liberator and revolutionary (South America, 19th c.) — visionary, charismatic; driven, mood swings. |
| **Sitting Bull** | Lakota leader and resistance figure (Indigenous Americas, 19th c.) — steadfast, defiant sovereignty, calm under pressure. |
| **Sejong the Great** | King and scholar, creator of Hangul (Korea, 15th c.) — scholarly, benevolent, humble. |
| **Rabindranath Tagore** | Poet and philosopher, Nobel laureate (India, 20th c.) — very high openness and agreeableness. |

Choosing a preset updates the agent’s OCEAN personality (and thus baselines and decay rates). You can still edit config manually or via the OpenClaw web UI.

## Dashboard

`http://localhost:<gateway-port>/emotion-dashboard`

Real-time visualization of PAD dimensions, basic emotions, OCEAN profile, recent stimuli, and active rumination. Append `?format=json` for the raw API.

## MCP Server

Works with any MCP-compatible client (Cursor, Claude Desktop, etc.):

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

**Resources:** `emotion://state`, `emotion://personality`

**Tools:** `query_emotion`, `modify_emotion`, `set_personality`

## Migration from v1

```bash
openclaw hooks disable emotion-state
openclaw emotion migrate
```

Converts v1 state files (flat labels + string intensities) to v2 format (dimensional model + numeric intensities). Uses a separate state file (`openfeelz.json`), so no risk of data loss.

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
    migrate-v1.ts        v1 -> v2 converter
```

## Development

```bash
npm install
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
npm run typecheck     # TypeScript strict mode
npm run lint          # oxlint
npm run build         # Compile to dist/
```

## Contributing

Issues, PRs, and questions are all welcome. If you want to poke around the model or improve it, please do -- I'd love to collaborate. :)

## License

[MIT](LICENSE)

---

Made with ❤️ by [@trianglegrrl](https://github.com/trianglegrrl) for the OpenClaw community 🦞
