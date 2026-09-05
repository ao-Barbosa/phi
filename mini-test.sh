#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINI_SRC="$SCRIPT_DIR/packages/coding-agent/src/experimental/mini/main.ts"
MINI_DIST="$SCRIPT_DIR/packages/coding-agent/dist/experimental/mini/main.js"

# The session server is spawned detached and outlives the TUI, so it keeps running whatever code it
# started with. Restart it after changing anything under mini/, or the protocol will not match.
stop_server() {
  pkill -f "mini/server/entry" 2>/dev/null || true
  rm -f "${PHI_AGENT_DIR:-$HOME/.phi/agent}/experimental/mini.sock"
}

USE_DIST=false
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dist) USE_DIST=true ;;
    --fresh) stop_server ;;
    --stop) stop_server; echo "Stopped the mini session server."; exit 0 ;;
    --help)
      cat <<'USAGE'
Usage: ./mini-test.sh [--dist] [--fresh] [--stop] [mini args...]

  --dist    run built output with bun instead of sources
  --fresh   stop the detached session server first, so it picks up your changes
  --stop    stop the detached session server and exit

Mini args are passed through, for example:
  ./mini-test.sh --continue
USAGE
      exit 0 ;;
    *) ARGS+=("$arg") ;;
  esac
done

if [[ "$USE_DIST" == "true" ]]; then
  if [[ ! -f "$MINI_DIST" ]]; then
    echo "No build found. Run: bun run --filter @ao-barbosa/phi-coding-agent build" >&2
    exit 1
  fi
  exec bun "$MINI_DIST" ${ARGS[@]+"${ARGS[@]}"}
fi

exec bun "$MINI_SRC" ${ARGS[@]+"${ARGS[@]}"}
