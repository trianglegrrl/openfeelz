#!/usr/bin/env bash
# Deploy OpenFeelz to ellie@localhost with backups and doctor checks.
# Run from the OpenFeelz source directory or pass path as first arg.

set -euo pipefail

REMOTE="${REMOTE:-ellie@localhost}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_PATH="${1:-$REPO_DIR}"

echo "=== Deploy OpenFeelz to $REMOTE ==="
echo "Plugin source: $PLUGIN_PATH"
echo ""

# 1. Backup config
echo "[1/8] Backing up OpenClaw config..."
ssh "$REMOTE" 'mkdir -p ~/.openclaw-backups && cp -a ~/.openclaw/openclaw.json ~/.openclaw-backups/openclaw.json.$(date +%Y%m%d-%H%M%S) 2>/dev/null || true'
echo "Done."
echo ""

# 2. Stop gateway
echo "[2/8] Stopping OpenClaw gateway..."
ssh "$REMOTE" 'openclaw gateway stop 2>/dev/null || systemctl --user stop openclaw-gateway.service 2>/dev/null || true'
sleep 2
echo "Done."
echo ""

# 3. SCP plugin source
echo "[3/8] Copying plugin source to $REMOTE..."
rsync -avz --exclude node_modules --exclude dist --exclude .git \
  "$PLUGIN_PATH/" "$REMOTE:~/openfeelz/"
echo "Done."
echo ""

# 4. Install deps and build on remote
echo "[4/8] Installing dependencies and building on remote..."
ssh "$REMOTE" 'cd ~/openfeelz && npm install && npm run build'
echo "Done."
echo ""

# 5. Install plugin into OpenClaw extensions dir
echo "[5/8] Installing plugin into OpenClaw extensions..."
ssh "$REMOTE" 'mkdir -p ~/.openclaw/extensions && rm -rf ~/.openclaw/extensions/openfeelz && cp -a ~/openfeelz ~/.openclaw/extensions/openfeelz'
echo "Done."
echo ""

# 6. Run doctor (plugin now exists)
echo "[6/8] Running openclaw doctor..."
ssh "$REMOTE" 'openclaw doctor' || true
echo ""

# 7. Run doctor --fix
echo "[7/8] Running openclaw doctor --fix..."
ssh "$REMOTE" 'openclaw doctor --fix' || true
echo ""

# 8. Enable plugin and start gateway
echo "[8/8] Enabling plugin and starting gateway..."
ssh "$REMOTE" 'openclaw plugins enable openfeelz && openclaw gateway restart'
ssh "$REMOTE" 'openclaw gateway restart'
echo "Done."
echo ""

echo "=== Deployment complete. Run smoke tests with: ==="
echo "  ssh $REMOTE 'cd ~/openfeelz && ./scripts/smoke-test.sh'"
echo ""
