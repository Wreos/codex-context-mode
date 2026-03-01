#!/bin/bash
# install.sh — configure codex-context-mode for Codex CLI

set -e

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CONFIG="$CODEX_HOME/config.toml"
AGENTS="$CODEX_HOME/AGENTS.md"

# ── MCP server entry ──────────────────────────────────────────────────────────
MCP_ENTRY="
[mcp_servers.context-mode]
command = \"sh\"
args = [\"$PLUGIN_DIR/start.sh\"]
"

if grep -q '\[mcp_servers\.context-mode\]' "$CONFIG" 2>/dev/null; then
  echo "✓ context-mode MCP server already in $CONFIG"
else
  printf '%s\n' "$MCP_ENTRY" >> "$CONFIG"
  echo "✓ Added context-mode MCP server to $CONFIG"
fi

# ── AGENTS.md routing instructions ───────────────────────────────────────────
AGENTS_MARKER="# Context Mode"

if grep -q "$AGENTS_MARKER" "$AGENTS" 2>/dev/null; then
  echo "✓ context-mode routing already in $AGENTS"
else
  printf '\n' >> "$AGENTS" 2>/dev/null || true
  cat "$PLUGIN_DIR/AGENTS.md" >> "$AGENTS"
  echo "✓ Added context-mode routing instructions to $AGENTS"
fi

echo ""
echo "Done. Restart Codex to apply changes."
