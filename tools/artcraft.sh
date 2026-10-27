#!/usr/bin/env bash
# Start the four artcraft desktop apps with their control servers on,
# so the MCP bridges in .mcp.json can drive the live windows.
#
#   tools/artcraft.sh          start whichever apps are not running yet
#   tools/artcraft.sh stop     close them again
#   tools/artcraft.sh status   show which ports are listening
#
# Ports (vectorcraft and designcraft both default to 7979, so designcraft moves):
#   photocraft 7878 · vectorcraft 7979 · designcraft 7980 · effectcraft 9877
#
# File access: photocraft and vectorcraft are confined to this repo.
# effectcraft and designcraft have no root flags on the desktop app, so a
# bridged session there can touch any file you can. Their control servers
# still only listen on 127.0.0.1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="${XDG_CACHE_HOME:-$HOME/.cache}/artcraft"
PHOTO_TOKEN="${XDG_CONFIG_HOME:-$HOME/.config}/photocraft/control.token"   # created by photocraft on first start
mkdir -p "$LOGS"

listening() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }

start() {   # name port cmd...
  local name=$1 port=$2; shift 2
  if listening "$port"; then echo "$name: already on :$port"; return; fi
  setsid nohup "$@" >"$LOGS/$name.log" 2>&1 </dev/null &
  echo "$name: starting on :$port (log: $LOGS/$name.log)"
}

case "${1:-start}" in
  start)
    start photocraft 7878 photocraft --new-instance --control 7878 \
      --control-token-file "$PHOTO_TOKEN" \
      --automation-read-root "$ROOT" --automation-write-root "$ROOT"
    start vectorcraft 7979 vectorcraft --control 7979 \
      --automation-read-root "$ROOT" --automation-write-root "$ROOT"
    start designcraft 7980 designcraft --control 7980
    start effectcraft 9877 effectcraft --control 9877
    ;;
  stop)
    for app in photocraft vectorcraft designcraft effectcraft; do
      pkill -x "$app" && echo "$app: stopped" || echo "$app: not running"
    done
    ;;
  status)
    for p in photocraft:7878 vectorcraft:7979 designcraft:7980 effectcraft:9877; do
      listening "${p#*:}" && echo "${p%%:*}: up" || echo "${p%%:*}: down"
    done
    ;;
  *) echo "usage: $0 [start|stop|status]" >&2; exit 2 ;;
esac
