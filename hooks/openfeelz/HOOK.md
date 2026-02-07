---
name: openfeelz
description: "Inject PAD+Ekman emotional state into agent system prompt"
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "events": ["agent:bootstrap"],
        "requires": { "bins": ["node"] },
      },
  }
---
# OpenFeelz Hook

Standalone workspace hook that injects emotional context into the agent's
system prompt during bootstrap. This is the lightweight version -- for the
full plugin with tool, CLI, dashboard, and MCP server, install the
`openfeelz` plugin instead.

## Install

```bash
cp -R hooks/openfeelz <workspace>/hooks/
openclaw hooks enable openfeelz
```

## Configuration

Set environment variables:

- `OPENAI_API_KEY` - Required for LLM-based emotion classification
- `EMOTION_MODEL` - Model name (default: `gpt-4o-mini`)
- `EMOTION_HALF_LIFE_HOURS` - Decay half-life (default: `12`)
- `EMOTION_TIMEZONE` - IANA timezone (optional)
