#!/usr/bin/env node
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execSync, spawn } from 'child_process';
import readline from 'readline';

// Lazy-load deps so startup stays fast
async function chalk() { return (await import('chalk')).default; }
async function Table() { return (await import('cli-table3')).default; }
async function ora() { return (await import('ora')).default; }

import {
  ensureConfigDir, loadProfiles, loadActive, saveActive,
  addProfile, removeProfile, getProfile,
  activateClaudeProfile, syncClaudeProfileBack,
  getTokenUsage,
} from '../lib/profiles.js';

import { UsageMonitor, notify } from '../lib/monitor.js';

const VERSION = '1.0.0';
const HELP = `
aiswitch v${VERSION} — Multi-account AI session manager

USAGE
  aiswitch                     Show current status
  aiswitch status              Show all profiles + active account
  aiswitch switch <name>       Switch to a profile
  aiswitch add <name>          Add a new profile (interactive)
  aiswitch remove <name>       Remove a profile
  aiswitch list                List all profiles
  aiswitch monitor             Start background usage monitor with alerts
  aiswitch code [args...]      Run claude code with active profile
  aiswitch open <name>         Open ChatGPT/Claude in browser for that profile

OPTIONS
  --help, -h      Show this help
  --version, -v   Show version
`;

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === 'status') await cmdStatus();
else if (cmd === 'switch') await cmdSwitch(args[1]);
else if (cmd === 'add') await cmdAdd(args[1]);
else if (cmd === 'remove' || cmd === 'rm') await cmdRemove(args[1]);
else if (cmd === 'list' || cmd === 'ls') await cmdList();
else if (cmd === 'monitor') await cmdMonitor();
else if (cmd === 'code') await cmdCode(args.slice(1));
else if (cmd === 'open') await cmdOpen(args[1]);
else if (cmd === '--help' || cmd === '-h') console.log(HELP);
else if (cmd === '--version' || cmd === '-v') console.log(`aiswitch v${VERSION}`);
else { console.error(`Unknown command: ${cmd}\n${HELP}`); process.exit(1); }

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdStatus() {
  const c = await chalk();
  ensureConfigDir();
  const active = loadActive();
  const data = loadProfiles();

  console.log('');
  if (!active.active) {
    console.log(c.yellow('  No active profile. Run: aiswitch switch <name>'));
  } else {
    const profile = getProfile(active.active);
    const switchedAt = active.switchedAt
      ? new Date(active.switchedAt).toLocaleTimeString()
      : 'unknown';

    const typeColor = profile?.type === 'claude' ? c.hex('#CC785C') : c.hex('#10A37F');
    const typeLabel = profile?.type === 'claude' ? '◆ Claude' : '◈ ChatGPT';

    console.log(
      `  ${c.bold('Active:')} ${typeColor(typeLabel)}  ${c.bold(active.active)}` +
      `  ${c.dim(`(switched ${switchedAt})`)}`
    );

    if (profile?.email) {
      console.log(`  ${c.dim('Account:')} ${profile.email}`);
    }
  }

  console.log('');
  if (data.profiles.length === 0) {
    console.log(c.dim('  No profiles yet. Run: aiswitch add <name>'));
  } else {
    console.log(c.dim(`  ${data.profiles.length} profile(s) — run "aiswitch list" for details`));
  }
  console.log('');
}

async function cmdList() {
  const c = await chalk();
  const T = await Table();
  ensureConfigDir();
  const data = loadProfiles();
  const active = loadActive();

  if (data.profiles.length === 0) {
    console.log(c.yellow('\n  No profiles. Add one with: aiswitch add <name>\n'));
    return;
  }

  const table = new T({
    head: ['', 'Name', 'Type', 'Email', 'Last used'],
    style: { head: ['cyan'], border: ['dim'] },
    colWidths: [4, 16, 10, 32, 22],
  });

  for (const p of data.profiles) {
    const isActive = p.name === active.active;
    const bullet = isActive ? c.green('●') : c.dim('○');
    const name = isActive ? c.bold(p.name) : p.name;
    const typeStr = p.type === 'claude'
      ? c.hex('#CC785C')('Claude')
      : c.hex('#10A37F')('ChatGPT');
    const lastUsed = p.lastUsed
      ? new Date(p.lastUsed).toLocaleDateString()
      : c.dim('never');

    table.push([bullet, name, typeStr, p.email || c.dim('—'), lastUsed]);
  }

  console.log('');
  console.log(table.toString());
  console.log('');
}

async function cmdSwitch(name) {
  const c = await chalk();
  const spinner = (await ora())({ text: `Switching to ${name}...`, spinner: 'dots' });

  if (!name) {
    // Interactive picker
    const data = loadProfiles();
    if (data.profiles.length === 0) {
      console.log(c.yellow('\n  No profiles. Add one with: aiswitch add <name>\n'));
      return;
    }
    name = await promptChoice('Select profile:', data.profiles.map(p => p.name));
  }

  const profile = getProfile(name);
  if (!profile) {
    console.error(c.red(`\n  Profile "${name}" not found. Run "aiswitch list" to see profiles.\n`));
    process.exit(1);
  }

  spinner.start();

  try {
    const active = loadActive();

    // Sync current Claude config back before switching
    if (active.active) {
      const currentProfile = getProfile(active.active);
      if (currentProfile?.type === 'claude') {
        spinner.text = `Saving ${active.active} session...`;
        syncClaudeProfileBack(active.active);
      }
    }

    if (profile.type === 'claude') {
      spinner.text = `Activating Claude profile: ${name}...`;
      activateClaudeProfile(profile);
      spinner.succeed(c.green(`Switched to Claude: ${c.bold(name)} (${profile.email || 'no email'})`));
      console.log(c.dim(`  ~/.claude now points to this profile's config`));
      console.log(c.dim(`  Run "claude" or use Claude Code in VS Code normally`));
    } else {
      // ChatGPT: update active record + open browser
      const active2 = loadActive();
      active2.active = name;
      active2.switchedAt = new Date().toISOString();
      saveActive(active2);
      spinner.succeed(c.green(`Switched to ChatGPT: ${c.bold(name)} (${profile.email || 'no email'})`));
      console.log(c.dim(`  Opening browser for SSO login...`));
      await cmdOpen(name);
    }
  } catch (err) {
    spinner.fail(c.red(`Switch failed: ${err.message}`));
    process.exit(1);
  }

  console.log('');
}

async function cmdAdd(name) {
  const c = await chalk();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(r => rl.question(c.cyan(`  ${q} `), r));

  console.log(c.bold('\n  Add a new AI profile\n'));

  if (!name) name = (await ask('Profile name (e.g. claude-acct1):')).trim();
  if (!name) { rl.close(); return; }

  const typeChoice = await ask('Type — (1) Claude  (2) ChatGPT Enterprise [1/2]:');
  const type = typeChoice.trim() === '2' ? 'chatgpt' : 'claude';

  const email = (await ask(`Email for this ${type} account:`)).trim();
  const note = (await ask('Optional note (press enter to skip):')).trim();

  rl.close();

  try {
    const profile = addProfile(name, type, email);
    if (note) {
      const { loadProfiles, saveProfiles } = await import('../lib/profiles.js');
      const data = loadProfiles();
      const p = data.profiles.find(x => x.name === name);
      if (p) { p.note = note; saveProfiles(data); }
    }

    console.log('');
    console.log(c.green(`  ✓ Profile "${name}" added`));
    if (type === 'claude') {
      console.log(c.dim(`  Config dir: ~/.aiswitch/profiles/${name}/`));
      console.log(c.dim(`  Switch to it with: aiswitch switch ${name}`));
      console.log(c.dim(`  Then log in via: claude (it will ask for auth)`));
    } else {
      console.log(c.dim(`  Switch to it with: aiswitch switch ${name}`));
      console.log(c.dim(`  It will open your browser for SSO login`));
    }
    console.log('');
  } catch (err) {
    console.error(c.red(`\n  Error: ${err.message}\n`));
    process.exit(1);
  }
}

async function cmdRemove(name) {
  const c = await chalk();
  if (!name) { console.error(c.red('  Usage: aiswitch remove <name>')); process.exit(1); }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const confirm = await new Promise(r =>
    rl.question(c.yellow(`  Remove profile "${name}"? This deletes its config. [y/N] `), r)
  );
  rl.close();

  if (confirm.trim().toLowerCase() !== 'y') {
    console.log(c.dim('  Cancelled.'));
    return;
  }

  try {
    removeProfile(name);
    console.log(c.green(`\n  ✓ Profile "${name}" removed\n`));
  } catch (err) {
    console.error(c.red(`\n  Error: ${err.message}\n`));
    process.exit(1);
  }
}

async function cmdMonitor() {
  const jsonMode = args.includes('--json');
  const c = jsonMode ? null : await chalk();
  const active = loadActive();

  if (!active.active) {
    if (jsonMode) process.exit(1);
    console.log(c.yellow('\n  No active profile. Switch to one first.\n'));
    process.exit(1);
  }

  if (!jsonMode) {
    const profile = getProfile(active.active);
    console.log(c.bold(`\n  Monitoring: ${active.active} (${profile?.email || ''})`));
    console.log(c.dim('  Watching Claude Code session for token usage...'));
    console.log(c.dim('  Press Ctrl+C to stop\n'));
  }

  const monitor = new UsageMonitor({ thresholds: [70, 85, 95] });

  monitor.on('usage', ({ session, daily }) => {
    const pct = Math.round((session / 200_000) * 100);
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ type: 'usage', percent: pct, session, daily }) + '\n');
      return;
    }
    const bar = progressBar(pct, 30);
    process.stdout.write(
      `\r  Context: ${bar} ${c.bold(`${pct}%`)}  (${session.toLocaleString()} tokens)  `
    );
  });

  monitor.on('threshold', async ({ percent, threshold }) => {
    const msg = `${active.active}: ${percent}% context used`;
    const urgency = threshold >= 95 ? 'critical' : 'normal';
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ type: 'threshold', percent, threshold }) + '\n');
    } else {
      console.log(`\n\n  ${c.yellow('⚠')} ${c.bold(msg)}`);
      if (threshold >= 85) {
        console.log(c.dim(`  Consider switching: aiswitch switch <other-account>`));
      }
    }
    await notify('aiswitch — Token Alert', msg, urgency);
  });

  monitor.on('limit-hit', async ({ text }) => {
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ type: 'limit-hit', text }) + '\n');
    } else {
      console.log(`\n\n  ${c.red('✗')} ${c.bold('Token/rate limit hit!')}`);
      console.log(c.dim(`  Run: aiswitch switch <other-account>`));
    }
    await notify('aiswitch — Limit Hit!', `${active.active} hit a limit. Switch now!`, 'critical');
  });

  monitor.start();

  if (!jsonMode) {
    // Show initial status line
    console.log(c.dim('  Waiting for Claude Code activity...\n'));
  }

  // Keep alive
  process.on('SIGINT', () => {
    monitor.stop();
    if (!jsonMode) console.log(c.dim('\n\n  Monitor stopped.\n'));
    process.exit(0);
  });
}

async function cmdCode(extraArgs) {
  const c = await chalk();
  const active = loadActive();
  if (!active.active) {
    console.log(c.yellow('\n  No active profile. Run: aiswitch switch <name>\n'));
    process.exit(1);
  }
  const profile = getProfile(active.active);
  if (profile?.type !== 'claude') {
    console.log(c.yellow(`\n  Active profile "${active.active}" is ChatGPT, not Claude.\n`));
    process.exit(1);
  }

  const claudePath = findClaude();
  if (!claudePath) {
    console.error(c.red('\n  "claude" CLI not found. Install it: npm install -g @anthropic-ai/claude-code\n'));
    process.exit(1);
  }

  console.log(c.dim(`  [aiswitch] Running claude as: ${active.active}\n`));
  const child = spawn(claudePath, extraArgs, { stdio: 'inherit', env: process.env });
  child.on('exit', code => process.exit(code ?? 0));
}

async function cmdOpen(name) {
  const c = await chalk();
  const profile = name ? getProfile(name) : null;

  const urls = {
    claude: 'https://claude.ai',
    chatgpt: 'https://chatgpt.com',
  };

  const type = profile?.type || 'claude';
  const url = urls[type];

  const opener =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32'  ? 'start' : 'xdg-open';

  try {
    execSync(`${opener} "${url}"`, { stdio: 'ignore' });
    if (!name) console.log(c.dim(`  Opened ${url}`));
  } catch {
    console.log(c.dim(`  Open manually: ${url}`));
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function progressBar(pct, width) {
  const filled = Math.round((pct / 100) * width);
  const color = pct >= 95 ? '\x1b[31m' : pct >= 85 ? '\x1b[33m' : '\x1b[32m';
  const reset = '\x1b[0m';
  return `${color}${'█'.repeat(filled)}${'░'.repeat(width - filled)}${reset}`;
}

function findClaude() {
  try { return execSync('which claude', { encoding: 'utf8' }).trim(); }
  catch { return null; }
}

async function promptChoice(prompt, choices) {
  const c = await chalk();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(c.cyan(`\n  ${prompt}\n`));
  choices.forEach((ch, i) => console.log(`  ${c.bold(i + 1)}.  ${ch}`));
  console.log('');
  const answer = await new Promise(r => rl.question(c.cyan('  Enter number: '), r));
  rl.close();
  const idx = parseInt(answer.trim(), 10) - 1;
  return choices[idx] || choices[0];
}
