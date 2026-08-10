# aiswitch

Multi-account AI session manager for Claude Code + ChatGPT Enterprise.

Switches between multiple Claude and ChatGPT accounts without logging in/out,
monitors token usage, and alerts you before you hit limits.

---

## What it does

| Feature | How |
|---|---|
| Profile switcher CLI | `aiswitch switch claude-acct1` |
| VS Code status bar | Shows active account + token % |
| VS Code quick-switch | Click status bar → pick account |
| Token usage monitor | Watches Claude Code session in background |
| Desktop alerts | Notifies at 70%, 85%, 95% context usage |
| Limit detection | Alerts + suggests switch when limit hit |
| ChatGPT SSO | Opens browser to correct login URL on switch |

---

## How Claude account switching works

Claude Code stores its auth session in `~/.claude/`. aiswitch maintains a
separate config directory per account under `~/.aiswitch/profiles/<name>/`.

When you switch:
1. Current `~/.claude/` is synced back to the active profile's dir
2. The new profile's dir is copied to `~/.claude/`
3. Claude Code picks up the new session automatically

No logout/login needed — each account's session is preserved.

---

## Install

```bash
git clone <this-repo> ~/aiswitch
cd ~/aiswitch
chmod +x setup.sh
./setup.sh
```

Restart VS Code after setup.

---

## First-time setup

### Add your Claude accounts

```bash
aiswitch add claude-acct1
# Type: Claude
# Email: you@gmail.com

aiswitch add claude-acct2
# Type: Claude
# Email: you2@gmail.com
```

### Add ChatGPT Enterprise

```bash
aiswitch add chatgpt-ent
# Type: ChatGPT Enterprise
# Email: you@company.com
```

### Activate first Claude account

```bash
aiswitch switch claude-acct1
# → copies profile to ~/.claude
claude
# → Claude Code starts, asks for auth if new profile
# → log in via browser → session saved to ~/.claude
```

### Activate second Claude account

```bash
aiswitch switch claude-acct2
# → saves claude-acct1 session, activates claude-acct2
claude
# → log in to second account
```

Now both sessions are saved and you can switch instantly.

---

## Usage

```
aiswitch                     Show current status
aiswitch status              Same
aiswitch list                List all profiles with last-used date
aiswitch switch <name>       Switch to a profile
aiswitch add <name>          Add a new profile (interactive)
aiswitch remove <name>       Remove a profile
aiswitch monitor             Start token usage monitor with alerts
aiswitch code [args...]      Run claude with active profile
aiswitch open <name>         Open claude.ai or chatgpt.com in browser
```

---

## VS Code extension

After setup + VS Code restart, you'll see in the status bar:

```
⚡ Claude: claude-acct1    ▓▓▓▓▓░░░░░ 52%
```

- **Click the account name** → quick-switch picker
- **Click the usage bar** → show details
- Colors: green < 85%, yellow ≥ 85%, red ≥ 95%
- VS Code notification pops up at each threshold with a "Switch" button

### Commands (Cmd+Shift+P)

```
aiswitch: Switch AI Profile
aiswitch: Add Profile
aiswitch: Show Status
aiswitch: Start Usage Monitor
aiswitch: Open Active Account in Browser
```

---

## Token monitor

The monitor watches Claude Code's session files and log output for token
usage. It fires desktop notifications (macOS Notification Center) at:

- **70%** — heads up
- **85%** — consider switching soon
- **95%** — switch now

When a hard rate/token limit is hit it fires a critical alert immediately.

Run standalone in a terminal pane:

```bash
aiswitch monitor
```

Or let the VS Code extension auto-start it (enabled by default).

---

## Config

All config lives in `~/.aiswitch/`:

```
~/.aiswitch/
  profiles.json      # profile registry
  active.json        # currently active profile
  profiles/
    claude-acct1/    # copy of ~/.claude for this account
    claude-acct2/
    chatgpt-ent/     # (empty — ChatGPT is browser-only)
```

---

## Caveats

- Claude Code must be installed: `npm install -g @anthropic-ai/claude-code`
- ChatGPT Enterprise switching opens the browser — SSO is browser-only
- Token usage % is estimated from Claude Code's session files; exact numbers
  depend on what Claude Code exposes in `~/.claude/`
- The VS Code extension requires aiswitch CLI to be on PATH

---

## Recommended workflow

1. Start VS Code → extension shows active account in status bar
2. Work normally with Claude Code
3. When token bar hits yellow → `aiswitch switch claude-acct2` (or click status bar)
4. When both Claude accounts are low → `aiswitch switch chatgpt-ent`
5. Next day → both Claude accounts reset → switch back

With 2× $400/month Claude Enterprise plans + unlimited ChatGPT Enterprise,
you effectively never hit a wall mid-session.

---

## License

[MIT](LICENSE) © 2026 Raj Jadon
