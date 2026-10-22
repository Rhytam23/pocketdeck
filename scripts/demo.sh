#!/usr/bin/env bash
# Starts a local relay, builds the bridge and prints the commands for the rest of the demo.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm install
npm run build -w @pocketdeck/desktop-bridge >/dev/null

KEY="${RELAY_ACCESS_KEYS:-$(openssl rand -hex 16)}"
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-127.0.0.1}"
PORT="${PORT:-8787}"

cat <<MSG
Relay will listen on 0.0.0.0:$PORT (LAN only; use TLS for anything else).

In other terminals:
  node apps/desktop-bridge/dist/cli.js install-hooks
  node apps/desktop-bridge/dist/cli.js pair --relay ws://$HOST_IP:$PORT --access-key $KEY
  npm run start -w @pocketdeck/mobile      # scan the QR with the app
  claude                                   # in any project; approve from the phone

MSG

RELAY_ACCESS_KEYS="$KEY" HOST=0.0.0.0 PORT="$PORT" exec npm run start -w @pocketdeck/relay
