#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}  aiswitch — Uninstall${NC}"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo -e "  ${YELLOW}This removes the aiswitch CLI, the VS Code extension, and${NC}"
echo -e "  ${YELLOW}~/.aiswitch/ (all saved profiles + per-account session history).${NC}"
read -p "  Continue? [y/N] " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo -e "  ${CYAN}Cancelled.${NC}"
  echo ""
  exit 0
fi

# 1. Remove CLI
echo ""
echo -e "  ${BOLD}[1/3]${NC} Removing aiswitch CLI..."
(cd "$SCRIPT_DIR" && npm unlink --silent 2>/dev/null) || true
rm -f "$HOME/.local/bin/aiswitch"
echo -e "  ${GREEN}✓${NC} CLI removed"
echo -e "  ${CYAN}Note:${NC} if setup added a PATH line for ~/.local/bin to your"
echo -e "  ~/.zshrc or ~/.bashrc, it's harmless to leave — remove by hand if you like."

# 2. Remove VS Code extension
echo ""
echo -e "  ${BOLD}[2/3]${NC} Removing VS Code extension..."
rm -rf "$HOME/.vscode/extensions/aiswitch-1.0.0"
echo -e "  ${GREEN}✓${NC} Extension removed"

# 3. Remove aiswitch config (profile registry + saved per-account sessions)
echo ""
echo -e "  ${BOLD}[3/3]${NC} Removing ~/.aiswitch/..."
rm -rf "$HOME/.aiswitch"
echo -e "  ${GREEN}✓${NC} Config removed"

echo ""
echo -e "  ${BOLD}─────────────────────────────────────────${NC}"
echo -e "  ${GREEN}${BOLD}Uninstall complete.${NC}"
echo ""
echo -e "  ${CYAN}~/.claude/ was never touched${NC} — your global settings.json,"
echo -e "  CLAUDE.md, hooks/, commands/, agents/, skills/, and whichever Claude"
echo -e "  account is currently active are exactly as they were before."
echo ""
