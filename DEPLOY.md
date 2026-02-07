# Deployment Log

This document records every step taken to deploy the openfeelz plugin
to a live OpenClaw instance.

## Prerequisites

- Remote OpenClaw instance accessible via SSH (e.g. `ellie@localhost`)
- Plugin source at `workspace/source/openfeelz/`
- `jq` on target for scripted tests

## Automated Deploy (Recommended)

Run from the OpenFeelz source directory:

```bash
./scripts/deploy-to-ellie.sh
```

This script:

1. Backs up `~/.openclaw/openclaw.json` to `~/.openclaw-backups/`
2. Stops the OpenClaw gateway
3. Runs `openclaw doctor`
4. Runs `openclaw doctor --fix`
5. Copies plugin source via rsync (excludes node_modules, dist, .git)
6. Installs dependencies and builds on remote
7. Installs plugin: `openclaw plugins install ~/openfeelz`
8. Enables plugin and restarts gateway

## Scripted Smoke Tests

After deployment, run the smoke tests on the target:

```bash
ssh ellie@localhost 'cd ~/openfeelz && chmod +x scripts/smoke-test.sh && ./scripts/smoke-test.sh'
```

Tests:

- `status --json` outputs valid JSON
- `context` command runs (outputs emotion block or empty message)
- `modify` applies stimulus; status reflects it
- `context` contains `<emotion_state>` after stimulus
- Decay reduces intensity over time (uses `EMOTION_HALF_LIFE_HOURS=0.001` for fast decay)
- `reset` clears state

## Manual Steps

### 1. Backup config

```bash
ssh ellie@localhost 'mkdir -p ~/.openclaw-backups && cp -a ~/.openclaw/openclaw.json ~/.openclaw-backups/openclaw.json.$(date +%Y%m%d-%H%M%S)'
```

### 2. Stop gateway

```bash
ssh ellie@localhost 'openclaw gateway stop'
```

### 3. Run doctor

```bash
ssh ellie@localhost 'openclaw doctor'
ssh ellie@localhost 'openclaw doctor --fix'
```

### 4. Copy and install plugin

```bash
rsync -avz --exclude node_modules --exclude dist --exclude .git \
  . ellie@localhost:~/openfeelz/
ssh ellie@localhost 'cd ~/openfeelz && npm install && npm run build'
ssh ellie@localhost 'openclaw plugins install ~/openfeelz && openclaw plugins enable openfeelz'
```

### 5. Restart gateway

```bash
ssh ellie@localhost 'openclaw gateway restart'
```

### 6. Verify

```bash
ssh ellie@localhost 'openclaw emotion status'
ssh ellie@localhost 'openclaw emotion context'
ssh ellie@localhost 'openclaw emotion status --json'
```
