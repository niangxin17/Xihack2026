#!/usr/bin/env bash
# Online verification against a published Sites/Cloudflare backup URL.
# Mirrors the local verify-endpoints.sh assertions, but targets a real HTTPS origin
# (no Host-header hack, no Miniflare-only assumptions).
#
# Usage:
#   bash verify-online.sh <BASE_URL> [READ_TOKEN]
#   e.g. bash verify-online.sh https://laoyou-staging.workers.dev
#        bash verify-online.sh https://laoyou-staging.workers.dev s3cr3t-read-token
#
# If READ_TOKEN is omitted, the authenticated /api/metrics -> 200 check is skipped
# (the 401 gate is still verified). Supply it for a full check.
set -u
BASE="${1:-}"; TOKEN="${2:-}"
if [ -z "$BASE" ]; then echo "usage: bash verify-online.sh <base-url> [read-token]"; exit 2; fi
BASE="${BASE%/}"
PASS=0; FAIL=0
log(){ echo "[verify] $*"; }
chk(){ local want="$1" got="$2" name="$3"; if [ "$got" = "$want" ]; then log "PASS $name -> $got"; PASS=$((PASS+1)); else log "FAIL $name -> expected $want got $got"; FAIL=$((FAIL+1)); fi; }

# --- wait for server ---
up=0
for i in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/" 2>/dev/null)
  if [ "$code" = "200" ]; then log "server up after ~$((i*2))s (HTTP $code)"; up=1; break; fi
  sleep 2
done
if [ "$up" = "0" ]; then log "FAIL: backup URL not reachable: $BASE"; echo "==== SUMMARY pass=$PASS fail=$((FAIL+1)) ===="; exit 1; fi

# 1) homepage contains the required hero copy (UTF-8 safe via node)
curl -s "$BASE/" -o ./_home_online.html 2>/dev/null
if node -e "const s=require('fs').readFileSync('./_home_online.html','utf8'); const ok=s.includes('输入分数')&&s.includes('找到更适合')&&s.includes('高中'); process.exit(ok?0:1)"; then log "PASS homepage contains '输入分数，找到更适合的高中'"; PASS=$((PASS+1)); else log "FAIL homepage missing required hero copy"; FAIL=$((FAIL+1)); fi
rm -f ./_home_online.html

# 2) /checkout?plan=match_29_9
chk 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/checkout?plan=match_29_9")" "GET /checkout?plan=match_29_9"
# 3) /dashboard
chk 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/dashboard")" "GET /dashboard"

# 4) POST /api/orders -> 201 + paymentReady:false
OD='{"planId":"match_29_9","channel":"wechat","sessionId":"verify"}'
oresp=$(curl -s -X POST -H "Content-Type: application/json" -d "$OD" "$BASE/api/orders" 2>/dev/null)
ocode=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" -d "$OD" "$BASE/api/orders" 2>/dev/null)
chk 201 "$ocode" "POST /api/orders"
if echo "$oresp" | grep -q '"paymentReady": *false'; then log "PASS paymentReady=false"; PASS=$((PASS+1)); else log "FAIL paymentReady not false in: $oresp"; FAIL=$((FAIL+1)); fi

# 5) POST /api/collect -> 204
chk 204 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" -d '{"name":"page_view","sessionId":"verify","environment":"production"}' "$BASE/api/collect")" "POST /api/collect"

# 6) GET /api/metrics unauthorized -> 401
chk 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/metrics")" "GET /api/metrics (no token)"

# 7) GET /api/metrics authorized -> 200 (only if token supplied)
if [ -n "$TOKEN" ]; then
  chk 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE/api/metrics")" "GET /api/metrics (token)"
else
  log "SKIP GET /api/metrics (token) -> 200 (no token supplied; 401 gate already verified)"
fi

echo "==== SUMMARY pass=$PASS fail=$FAIL ===="
[ "$FAIL" = "0" ] && exit 0 || exit 1
