#!/usr/bin/env bash
# Endpoint verification for the new Next.js/Cloudflare Sites app (local Miniflare runtime).
# Run AFTER `npm run dev` is up. Uses Host: terminal.local to satisfy vite allowedHosts.
set -u
PORT="${PORT:-5173}"
HOST_HDR="terminal.local"
BASE="http://127.0.0.1:${PORT}"
PASS=0; FAIL=0
log(){ echo "[verify] $*"; }

# --- wait for server ---
up=0
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: ${HOST_HDR}" "${BASE}/" 2>/dev/null)
  if [ "$code" = "200" ]; then log "server up after ~$((i*2))s (HTTP $code)"; up=1; break; fi
  sleep 2
done
if [ "$up" = "0" ]; then log "FAIL: dev server did not come up on ${BASE}"; echo "==== SUMMARY pass=$PASS fail=$((FAIL+1)) ===="; exit 1; fi

check_status(){
  local name="$1"; local expected="$2"; local method="$3"; local path="$4"; local auth="${5:-}"; local data="${6:-}"
  local -a args=(-s -o /dev/null -w "%{http_code}" -H "Host: ${HOST_HDR}" -X "$method")
  if [ -n "$auth" ]; then args+=(-H "Authorization: Bearer ${auth}"); fi
  if [ -n "$data" ]; then args+=(-H "Content-Type: application/json" -d "$data"); fi
  local got; got=$(curl "${args[@]}" "${BASE}${path}" 2>/dev/null)
  if [ "$got" = "$expected" ]; then log "PASS $name -> $got"; PASS=$((PASS+1));
  else log "FAIL $name -> expected $expected got $got"; FAIL=$((FAIL+1)); fi
}

# 1) homepage contains the required workbench copy (UTF-8 safe via node; bash grep mis-handles multibyte)
#    Updated for the 3-column workbench redesign: the hero copy was replaced by the
#    workbench, so we assert the new required copy instead of the legacy hero string.
curl -s -H "Host: ${HOST_HDR}" "${BASE}/" -o ./_home_check.html 2>/dev/null
if node -e "const s=require('fs').readFileSync('./_home_check.html','utf8'); const ok=s.includes('生成我的基础报告')&&s.includes('流程进度')&&s.includes('方案摘要'); process.exit(ok?0:1)"; then log "PASS homepage contains workbench copy ('生成我的基础报告' / '流程进度' / '方案摘要')"; PASS=$((PASS+1));
else log "FAIL homepage missing required workbench copy (len=$(wc -c < ./_home_check.html 2>/dev/null))"; FAIL=$((FAIL+1)); fi

# 2) /checkout?plan=match_29_9
check_status "GET /checkout?plan=match_29_9" 200 GET "/checkout?plan=match_29_9" "" ""
# 3) /dashboard
check_status "GET /dashboard" 200 GET "/dashboard" "" ""
# 4) POST /api/orders -> 201 + paymentReady:false
resp=$(curl -s -H "Host: ${HOST_HDR}" -X POST -H "Content-Type: application/json" \
  -d '{"planId":"match_29_9","channel":"wechat","sessionId":"verify"}' "${BASE}/api/orders" 2>/dev/null)
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: ${HOST_HDR}" -X POST -H "Content-Type: application/json" \
  -d '{"planId":"match_29_9","channel":"wechat","sessionId":"verify"}' "${BASE}/api/orders" 2>/dev/null)
if [ "$code" = "201" ]; then log "PASS POST /api/orders -> 201"; PASS=$((PASS+1));
else log "FAIL POST /api/orders -> $code body=$resp"; FAIL=$((FAIL+1)); fi
if echo "$resp" | grep -q '"paymentReady": *false'; then log "PASS paymentReady=false"; PASS=$((PASS+1));
else log "FAIL paymentReady not false in: $resp"; FAIL=$((FAIL+1)); fi

# 5) POST /api/collect -> 204 (open dev mode, no write token set)
check_status "POST /api/collect" 204 POST "/api/collect" "" '{"name":"page_view","sessionId":"verify","environment":"production"}'
# 6) GET /api/metrics authorized -> 200
check_status "GET /api/metrics (auth)" 200 GET "/api/metrics" "test-read-token" ""
# 7) GET /api/metrics unauthorized -> 401
check_status "GET /api/metrics (no auth)" 401 GET "/api/metrics" "" ""

echo "==== SUMMARY pass=$PASS fail=$FAIL ===="
[ "$FAIL" = "0" ] && exit 0 || exit 1
