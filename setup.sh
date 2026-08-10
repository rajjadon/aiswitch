#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}  aiswitch — Setup${NC}"
echo -e "${CYAN}  Multi-account AI session manager${NC}"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. Install CLI globally
echo -e "  ${BOLD}[1/3]${NC} Installing aiswitch CLI..."
cd "$SCRIPT_DIR"
npm install --silent
npm link --silent 2>/dev/null || {
  # Fallback: add to PATH via ~/.zshrc
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
  cp "$SCRIPT_DIR/bin/aiswitch.js" "$BIN_DIR/aiswitch"
  chmod +x "$BIN_DIR/aiswitch"
  # Add to shell if not already there
  for RC in ~/.zshrc ~/.bashrc; do
    if [ -f "$RC" ] && ! grep -q 'aiswitch' "$RC"; then
      echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$RC"
    fi
  done
  echo -e "    Installed to $BIN_DIR/aiswitch"
}
echo -e "  ${GREEN}✓${NC} CLI installed"

# 2. Install VS Code extension
echo ""
echo -e "  ${BOLD}[2/3]${NC} Installing VS Code extension..."
EXT_DIR="$HOME/.vscode/extensions/aiswitch-1.0.0"
mkdir -p "$EXT_DIR/src"
cp "$SCRIPT_DIR/vscode-ext/package.json" "$EXT_DIR/"
cp "$SCRIPT_DIR/vscode-ext/src/extension.js" "$EXT_DIR/src/"
echo -e "  ${GREEN}✓${NC} VS Code extension installed → Restart VS Code to activate"

# 3. Create initial config + guided setup
echo ""
echo -e "  ${BOLD}[3/3]${NC} Creating config directory..."
mkdir -p "$HOME/.aiswitch/profiles"
if [ ! -f "$HOME/.aiswitch/profiles.json" ]; then
  echo '{"profiles":[]}' > "$HOME/.aiswitch/profiles.json"
fi
if [ ! -f "$HOME/.aiswitch/active.json" ]; then
  echo '{"active":null,"switchedAt":null}' > "$HOME/.aiswitch/active.json"
fi
echo -e "  ${GREEN}✓${NC} Config at ~/.aiswitch/"

echo ""
echo -e "  ${BOLD}─────────────────────────────────────────${NC}"
echo -e "  ${GREEN}${BOLD}Setup complete!${NC}"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo ""
echo -e "  ${CYAN}1.${NC} Add your Claude accounts:"
echo -e "     ${YELLOW}aiswitch add claude-acct1${NC}"
echo -e "     ${YELLOW}aiswitch add claude-acct2${NC}"
echo ""
echo -e "  ${CYAN}2.${NC} Add ChatGPT Enterprise:"
echo -e "     ${YELLOW}aiswitch add chatgpt-ent${NC}"
echo ""
echo -e "  ${CYAN}3.${NC} Switch to your first Claude account:"
echo -e "     ${YELLOW}aiswitch switch claude-acct1${NC}"
echo -e "     Then run: ${YELLOW}claude${NC}  (it will ask you to log in)"
echo ""
echo -e "  ${CYAN}4.${NC} Start the usage monitor:"
echo -e "     ${YELLOW}aiswitch monitor${NC}"
echo ""
echo -e "  ${CYAN}5.${NC} Restart VS Code — you'll see the status bar item"
echo ""
echo -e "  ${BOLD}Quick reference:${NC}"
echo -e "  ${YELLOW}aiswitch${NC}               → show current status"
echo -e "  ${YELLOW}aiswitch list${NC}           → list all profiles"
echo -e "  ${YELLOW}aiswitch switch <name>${NC}  → switch account"
echo -e "  ${YELLOW}aiswitch monitor${NC}        → watch token usage"
echo ""
