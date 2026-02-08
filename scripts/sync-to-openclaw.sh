#!/usr/bin/env bash
# Sync built OpenFeelz into OpenClaw's plugin directory so "openclaw emotion"
# uses this copy (e.g. to see "wizard" without reinstalling).
# Usage: ./scripts/sync-to-openclaw.sh [destination_dir]
# Default destination: ${OPENCLAW_EXTENSIONS_DIR:-$HOME/.openclaw/extensions}/openfeelz

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="${1:-${OPENCLAW_EXTENSIONS_DIR:-$HOME/.openclaw/extensions}/openfeelz}"

echo "Building..."
cd "$REPO_ROOT"
npm run build

echo "Syncing to $DEST ..."
mkdir -p "$DEST"
rsync -a --delete "$REPO_ROOT/dist/" "$DEST/dist/"
cp "$REPO_ROOT/package.json" "$REPO_ROOT/openclaw.plugin.json" "$REPO_ROOT/README.md" "$REPO_ROOT/LICENSE" "$DEST/"

echo "Done. Check version: openclaw emotion -V  (expect 0.9.6+; then wizard should appear in openclaw emotion --help)"
echo "  If you use OPENCLAW_STATE_DIR, sync there instead: $0 \"\$OPENCLAW_STATE_DIR/extensions/openfeelz\""
echo "  (Restart gateway if it was running and you need plugins reloaded.)"
