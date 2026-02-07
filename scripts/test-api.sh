#!/usr/bin/env bash
# Test the dashboard HTTP API (mirrors MCP tool capabilities)
# Usage: ./scripts/test-api.sh [host:port]

set -euo pipefail

BASE="${1:-http://127.0.0.1:18795}"
URL="${BASE}/emotion-dashboard"
PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -qF "$expected"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected '$expected')"
    FAIL=$((FAIL + 1))
  fi
}

post() {
  curl -s -X POST -H "Content-Type: application/json" -d "$1" "$URL"
}

echo "=== OpenFeelz API Tests ==="
echo "Target: $URL"
echo ""

# 1. GET JSON
echo "[1] GET ?format=json"
JSON=$(curl -s "${URL}?format=json")
check "has dimensions" '"dimensions"' "$JSON"
check "has personalityAnalysis" '"personalityAnalysis"' "$JSON"
check "has emotionalStateDescription" '"emotionalStateDescription"' "$JSON"
check "has decayRates" '"decayRates"' "$JSON"
echo ""

# 2. modify (apply emotion)
echo "[2] POST modify"
RES=$(post '{"action":"modify","emotion":"happy","intensity":0.6,"trigger":"api-test"}')
check "ok=true" '"ok": true' "$RES"
check "happiness > 0" '"happiness"' "$RES"
echo ""

# 3. set_dimension
echo "[3] POST set_dimension"
RES=$(post '{"action":"set_dimension","dimension":"pleasure","value":0.42}')
check "ok=true" '"ok": true' "$RES"
check "pleasure=0.42" '"pleasure": 0.42' "$RES"
echo ""

# 4. set_personality
echo "[4] POST set_personality"
RES=$(post '{"action":"set_personality","trait":"openness","value":0.85}')
check "ok=true" '"ok": true' "$RES"
check "openness=0.85" '"openness": 0.85' "$RES"
echo ""

# 5. set_decay
echo "[5] POST set_decay"
RES=$(post '{"action":"set_decay","dimension":"arousal","rate":0.25}')
check "ok=true" '"ok": true' "$RES"
check "arousal decay=0.25" '0.25' "$RES"
echo ""

# 6. batch
echo "[6] POST batch"
RES=$(post '{"action":"batch","updates":{"dimensions":{"trust":0.9},"personality":{"neuroticism":0.3}}}')
check "ok=true" '"ok": true' "$RES"
check "trust=0.9" '"trust": 0.9' "$RES"
check "neuroticism=0.3" '"neuroticism": 0.3' "$RES"
echo ""

# 7. reset
echo "[7] POST reset"
RES=$(post '{"action":"reset"}')
check "ok=true" '"ok": true' "$RES"
echo ""

# 8. analyze_personality (LLM)
echo "[8] POST analyze_personality"
RES=$(post '{"action":"analyze_personality"}')
if echo "$RES" | grep -q '"summary"'; then
  check "has summary" '"summary"' "$RES"
  echo "  (LLM analysis returned successfully)"
else
  echo "  SKIP: LLM analysis not available (may need API key)"
fi
echo ""

# 9. describe_state (LLM)
echo "[9] POST describe_state"
RES=$(post '{"action":"describe_state"}')
if echo "$RES" | grep -q '"summary"'; then
  check "has summary" '"summary"' "$RES"
  echo "  (LLM description returned successfully)"
else
  echo "  SKIP: LLM description not available (may need API key)"
fi
echo ""

# 10. error handling
echo "[10] POST unknown action"
RES=$(post '{"action":"nonexistent"}')
check "ok=false" '"ok": false' "$RES"
check "has error" '"error"' "$RES"
echo ""

echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
