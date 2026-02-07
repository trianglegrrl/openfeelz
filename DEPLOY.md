# Deployment Guide

How to deploy the OpenFeelz plugin to a remote OpenClaw instance.

## Prerequisites

- Remote OpenClaw instance accessible via SSH
- Plugin source at hand (clone or local copy)
- `jq` on target for scripted smoke tests

## Automated Deploy

Run from the OpenFeelz source directory:

```bash
REMOTE=user@host ./scripts/deploy.sh
```

Set `REMOTE` to your SSH target (defaults to `localhost`). The script:

1. Backs up `~/.openclaw/openclaw.json` to `~/.openclaw-backups/`
2. Stops the OpenClaw gateway
3. Copies plugin source via rsync (excludes node_modules, dist, .git)
4. Installs dependencies and builds on remote
5. Copies plugin into `~/.openclaw/extensions/openfeelz/`
6. Runs `openclaw doctor` and `openclaw doctor --fix`
7. Enables plugin and restarts gateway

## Smoke Tests

After deployment, run the smoke tests on the target:

```bash
ssh user@host 'cd ~/openfeelz && chmod +x scripts/smoke-test.sh && ./scripts/smoke-test.sh'
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
ssh user@host 'mkdir -p ~/.openclaw-backups && cp -a ~/.openclaw/openclaw.json ~/.openclaw-backups/openclaw.json.$(date +%Y%m%d-%H%M%S)'
```

### 2. Stop gateway

```bash
ssh user@host 'openclaw gateway stop'
```

### 3. Copy and install plugin

```bash
rsync -avz --exclude node_modules --exclude dist --exclude .git \
  . user@host:~/openfeelz/
ssh user@host 'cd ~/openfeelz && npm install && npm run build'
ssh user@host 'mkdir -p ~/.openclaw/extensions && rm -rf ~/.openclaw/extensions/openfeelz && cp -a ~/openfeelz ~/.openclaw/extensions/openfeelz'
```

### 4. Enable and restart

```bash
ssh user@host 'openclaw plugins enable openfeelz && openclaw gateway restart'
```

### 5. Verify

```bash
ssh user@host 'openclaw emotion status'
ssh user@host 'openclaw emotion context'
ssh user@host 'openclaw emotion status --json'
```
