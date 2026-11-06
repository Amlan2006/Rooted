#!/usr/bin/env bash
# One-command hosted x402 e2e: backend + paid dashboard + agent refusal + agent paid call, then stops everything.
# Prereq: the operator EVM address printed by `node setup.mjs` was funded once at portal.hedera.com/faucet.
# Usage: integrations/x402-agent/e2e.sh [BLOCK_HASH]
#   env: E2E_DATABASE_URL (default .env DATABASE_URL), E2E_BACKEND (127.0.0.1:8095), E2E_DASHBOARD_PORT (3005), ROOTED_BINARY (.tools/rooted)
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/sdk/go/bin:$PATH"
set -a; . ./.env; set +a
backend=${E2E_BACKEND:-127.0.0.1:8095} port=${E2E_DASHBOARD_PORT:-3005} bin=${ROOTED_BINARY:-.tools/rooted} logs=.tools/x402-agent
export DATABASE_URL=${E2E_DATABASE_URL:-$DATABASE_URL} ROOTED_LISTEN_ADDR=$backend ROOTED_XRAY_FOLLOW=false \
  ROOTED_WATCH_ENABLED=false ROOTED_STREAM_ENABLED=false ROOTED_FRAME_ENABLED=false ROOTED_FRAME_STREAM_ENABLED=false
mkdir -p "$logs"
(cd integrations/x402-agent && node setup.mjs --hcs) # exits 2 (and stops here) until the operator is funded
pay_to=$(grep '^ROOTED_EXPECTED_PAY_TO=' integrations/x402-agent/.env | cut -d= -f2)
wait_for() { for _ in $(seq 1 60); do curl -sf -o /dev/null "$1" && return; sleep 1; done; echo "timeout waiting for $1" >&2; exit 1; }
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT

"$bin" migrate
"$bin" serve > "$logs/serve.log" 2>&1 &
wait_for "http://$backend/health"
hash=${1:-$(curl -s "http://$backend/api/v1/xray/blocks?network=sepolia&limit=1" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d[0]["block_hash"] if d else "")')}
if [ -z "$hash" ]; then # no stored report yet: X-ray head-3 (still inside the node's state window)
  head=$(curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$ROOTED_EXECUTION_URL" | python3 -c 'import json,sys; print(hex(int(json.load(sys.stdin)["result"],16)-3))')
  hash=$(curl -s -X POST -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBlockByNumber\",\"params\":[\"$head\",false]}" "$ROOTED_EXECUTION_URL" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["hash"])')
  "$bin" xray "$hash" > "$logs/xray.json"
fi

[ -f dashboard/.next/BUILD_ID ] || (cd dashboard && npm run build)
(cd dashboard && ROOTED_X402_ENABLED=true ROOTED_X402_PAY_TO=$pay_to ROOTED_BACKEND_URL=http://$backend \
  exec node node_modules/next/dist/bin/next start --hostname 127.0.0.1 -p "$port") > "$logs/next.log" 2>&1 &
wait_for "http://127.0.0.1:$port/"

cd integrations/x402-agent
export ROOTED_PUBLIC_URL=http://127.0.0.1:$port
echo "== refusal demo (per-request cap below the price)"
MAX_PER_REQUEST=1 node agent.mjs "$hash" && exit 1 || [ $? -eq 3 ]
echo "== paid call"
node agent.mjs "$hash"
