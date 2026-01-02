#!/bin/sh
set -eu

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  if [ -x "/usr/local/bin/node" ]; then
    NODE_BIN="/usr/local/bin/node"
  elif [ -x "/opt/homebrew/bin/node" ]; then
    NODE_BIN="/opt/homebrew/bin/node"
  else
    echo "Error: node not found in PATH or common locations" >&2
    exit 127
  fi
fi

CODEX_JS="/Users/mac/.npm-global/lib/node_modules/@openai/codex/bin/codex.js"

exec "$NODE_BIN" "$CODEX_JS" "$@"
