#!/usr/bin/env bash
# Scripted smoke tests for OpenFeelz on a live OpenClaw instance.
# Run on the target machine after deployment (e.g. ssh ellie@localhost 'cd ~/openfeelz && ./scripts/smoke-test.sh').
#
# Uses EMOTION_HALF_LIFE_HOURS=0.001 (~3.6 sec) for fast decay tests.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_DIR"

# Fast decay for testing: ~3.6 second half-life
export EMOTION_HALF_LIFE_HOURS=0.001

OPENCLAW="${OPENCLAW:-openclaw}"
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}PASS${NC}: $*"; }
fail() { echo -e "${RED}FAIL${NC}: $*"; exit 1; }

echo "=== OpenFeelz Smoke Tests ==="
echo "Using: $OPENCLAW"
echo ""

# -----------------------------------------------------------------------
# Test 1: status --json outputs valid JSON
# -----------------------------------------------------------------------
echo "[1] status --json outputs valid JSON..."
OUT="$($OPENCLAW emotion status --json 2>/dev/null)" || fail "status --json failed"
echo "$OUT" | jq -e . >/dev/null 2>&1 || fail "status --json is not valid JSON"
pass "status --json"
echo ""

# -----------------------------------------------------------------------
# Test 2: context command exists and runs
# -----------------------------------------------------------------------
echo "[2] context command runs..."
CONTEXT="$($OPENCLAW emotion context 2>/dev/null)" || fail "context failed"
# Empty state returns the neutral message
if echo "$CONTEXT" | grep -q "no emotion context"; then
  pass "context (empty state)"
elif echo "$CONTEXT" | grep -q "<emotion_state>"; then
  pass "context (has emotion block)"
else
  pass "context"
fi
echo ""

# -----------------------------------------------------------------------
# Test 3: modify applies stimulus, status reflects it
# -----------------------------------------------------------------------
echo "[3] modify applies stimulus..."
$OPENCLAW emotion reset 2>/dev/null || true
$OPENCLAW emotion modify --emotion angry --intensity 0.8 --trigger "smoke test" 2>/dev/null || fail "modify failed"
ANGER="$($OPENCLAW emotion status --json 2>/dev/null | jq -r '.basicEmotions.anger')"
[[ -n "$ANGER" ]] || fail "could not read anger"
case "$ANGER" in
  0|0.0) fail "anger should be > 0.1 after stimulus, got $ANGER" ;;
  *) pass "modify -> anger=$ANGER" ;;
esac
echo ""

# -----------------------------------------------------------------------
# Test 4: context contains emotion after stimulus
# -----------------------------------------------------------------------
echo "[4] context contains emotion block after stimulus..."
CONTEXT="$($OPENCLAW emotion context 2>/dev/null)"
echo "$CONTEXT" | grep -q "<emotion_state>" || fail "context should contain <emotion_state>"
echo "$CONTEXT" | grep -q "dimensions" || fail "context should mention dimensions"
pass "context has emotion block"
echo ""

# -----------------------------------------------------------------------
# Test 5: decay reduces intensity over time
# -----------------------------------------------------------------------
echo "[5] decay reduces intensity over time..."
BEFORE="$($OPENCLAW emotion status --json 2>/dev/null | jq -r '.basicEmotions.anger')"
echo "  Before sleep: anger=$BEFORE"
sleep 5
AFTER="$($OPENCLAW emotion status --json 2>/dev/null | jq -r '.basicEmotions.anger')"
echo "  After 5s sleep: anger=$AFTER"
# After 5 seconds with half-life ~3.6s, anger should have decayed
# 5/3.6 ≈ 1.4 half-lives, so expect ~37% of original
if command -v awk >/dev/null 2>&1; then
  GREATER="$(awk -v b="$BEFORE" -v a="$AFTER" 'BEGIN { print (b > a) ? 1 : 0 }')"
  [[ "$GREATER" -eq 1 ]] || fail "anger should decay (before=$BEFORE, after=$AFTER)"
else
  # Fallback: just check we got numbers
  [[ -n "$BEFORE" && -n "$AFTER" ]] || fail "could not read anger values"
fi
pass "decay (anger: $BEFORE -> $AFTER)"
echo ""

# -----------------------------------------------------------------------
# Test 6: reset clears state
# -----------------------------------------------------------------------
echo "[6] reset clears state..."
$OPENCLAW emotion reset 2>/dev/null || fail "reset failed"
OUT="$($OPENCLAW emotion status --json 2>/dev/null)"
ANGER="$(echo "$OUT" | jq -r '.basicEmotions.anger')"
PLEASURE="$(echo "$OUT" | jq -r '.dimensions.pleasure')"
# After reset, anger should be 0 or very small
if awk -v a="$ANGER" 'BEGIN { exit (a >= 0.01) ? 1 : 0 }' 2>/dev/null; then
  :
else
  [[ "$ANGER" == "0" || "$ANGER" == "0.0" ]] || fail "anger should be ~0 after reset, got $ANGER"
fi
pass "reset"
echo ""

echo "=== All smoke tests passed ==="
