#!/bin/bash
# Install memory-control skill for Gemini CLI

set -euo pipefail

SKILL_DIR="$HOME/.gemini/skills/memory-control"
SETTINGS_FILE="$HOME/.gemini/settings.json"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing memory-control skill..."

# 1. Copy skill to ~/.gemini/skills/
mkdir -p "$HOME/.gemini/skills"
cp -r "$SCRIPT_DIR" "$SKILL_DIR"
chmod +x "$SKILL_DIR/src/"*.mjs

echo "✅ Copied skill to $SKILL_DIR"

# 2. Check if settings.json exists
if [ ! -f "$SETTINGS_FILE" ]; then
    echo "⚠️  No settings.json found. Creating one..."
    echo '{}' > "$SETTINGS_FILE"
fi

# 3. Show manual hook configuration
echo ""
echo "📝 Add the following hooks to $SETTINGS_FILE:"
echo ""
cat << 'EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "name": "memory-control-inject",
            "type": "command",
            "command": "node ~/.gemini/skills/memory-control/src/inject-recap-hook.mjs",
            "timeout": 5000
          }
        ]
      }
    ],
    "PostResponse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "name": "memory-control-compress",
            "type": "command",
            "command": "node ~/.gemini/skills/memory-control/src/auto-compress-hook.mjs",
            "timeout": 120000
          }
        ]
      }
    ]
  }
}
EOF

echo ""
echo "✅ Installation complete!"
echo ""
echo "To uninstall: rm -rf $SKILL_DIR"
