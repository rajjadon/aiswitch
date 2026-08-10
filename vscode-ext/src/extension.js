const vscode = require('vscode');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, '.aiswitch');
const PROFILES_FILE = path.join(CONFIG_DIR, 'profiles.json');
const ACTIVE_FILE = path.join(CONFIG_DIR, 'active.json');

// ─── State ────────────────────────────────────────────────────────────────────

let statusBarItem;
let tokenBarItem;
let monitorProcess = null;
let monitorOutput = '';
let activeProfile = null;
let tokenPercent = 0;
let fileWatcher = null;

// ─── Activation ──────────────────────────────────────────────────────────────

function activate(context) {
  // Status bar: profile switcher (left side)
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left, 100
  );
  statusBarItem.command = 'aiswitch.switchProfile';
  statusBarItem.tooltip = 'Click to switch AI account';
  context.subscriptions.push(statusBarItem);

  // Status bar: token usage (left side, next to profile)
  tokenBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left, 99
  );
  tokenBarItem.command = 'aiswitch.showStatus';
  tokenBarItem.tooltip = 'Context window usage — click for details';
  context.subscriptions.push(tokenBarItem);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('aiswitch.switchProfile', cmdSwitch),
    vscode.commands.registerCommand('aiswitch.addProfile', cmdAdd),
    vscode.commands.registerCommand('aiswitch.showStatus', cmdStatus),
    vscode.commands.registerCommand('aiswitch.startMonitor', cmdStartMonitor),
    vscode.commands.registerCommand('aiswitch.openBrowser', cmdOpenBrowser),
  );

  // Watch active.json for external changes (CLI switches)
  watchActiveFile(context);

  // Initial state
  refreshStatus();

  // Auto-start monitor if configured
  const cfg = vscode.workspace.getConfiguration('aiswitch');
  if (cfg.get('autoMonitor')) {
    startMonitorProcess();
  }
}

function deactivate() {
  monitorProcess?.kill();
  fileWatcher?.close();
}

// ─── Status bar refresh ──────────────────────────────────────────────────────

function refreshStatus() {
  const active = readActive();
  const profiles = readProfiles();
  activeProfile = active?.active || null;

  const profile = profiles.find(p => p.name === activeProfile);

  if (!activeProfile) {
    statusBarItem.text = '$(account) No AI account';
    statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    const icon = profile?.type === 'claude' ? '$(sparkle)' : '$(globe)';
    const label = profile?.type === 'claude' ? 'Claude' : 'ChatGPT';
    statusBarItem.text = `${icon} ${label}: ${activeProfile}`;
    statusBarItem.color = undefined;
    statusBarItem.backgroundColor = undefined;
  }

  statusBarItem.show();
  refreshTokenBar();
}

function refreshTokenBar() {
  const cfg = vscode.workspace.getConfiguration('aiswitch');
  if (!cfg.get('showTokenBar') || !activeProfile) {
    tokenBarItem.hide();
    return;
  }

  const pct = tokenPercent;
  const filled = Math.round(pct / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const color = pct >= 95
    ? new vscode.ThemeColor('statusBarItem.errorForeground')
    : pct >= 85
    ? new vscode.ThemeColor('statusBarItem.warningForeground')
    : undefined;

  tokenBarItem.text = `$(pulse) ${bar} ${pct}%`;
  tokenBarItem.color = color;
  tokenBarItem.backgroundColor = pct >= 95
    ? new vscode.ThemeColor('statusBarItem.errorBackground')
    : pct >= 85
    ? new vscode.ThemeColor('statusBarItem.warningBackground')
    : undefined;
  tokenBarItem.show();
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdSwitch() {
  const profiles = readProfiles();
  if (profiles.length === 0) {
    const action = await vscode.window.showWarningMessage(
      'No profiles configured. Add one first.',
      'Add Profile'
    );
    if (action === 'Add Profile') cmdAdd();
    return;
  }

  const active = readActive();
  const items = profiles.map(p => ({
    label: `${p.type === 'claude' ? '$(sparkle)' : '$(globe)'} ${p.name}`,
    description: p.email || '',
    detail: p.name === active?.active ? '● currently active' : '',
    profileName: p.name,
    profileType: p.type,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    title: 'Switch AI Account',
    placeHolder: 'Select account to activate',
  });

  if (!pick) return;

  const aiswitchPath = findAiswitch();
  if (!aiswitchPath) {
    vscode.window.showErrorMessage('aiswitch CLI not found. Install it first.');
    return;
  }

  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Switching to ${pick.profileName}...` },
    () => new Promise((resolve, reject) => {
      const proc = spawn(aiswitchPath, ['switch', pick.profileName], { env: process.env });
      let err = '';
      proc.stderr.on('data', d => err += d.toString());
      proc.on('close', code => {
        if (code === 0) {
          refreshStatus();
          resolve();
          vscode.window.showInformationMessage(`Switched to: ${pick.profileName}`);
          if (pick.profileType === 'chatgpt') {
            vscode.window.showInformationMessage('Browser opened for ChatGPT SSO login');
          }
        } else {
          reject(new Error(err || `Exit code ${code}`));
          vscode.window.showErrorMessage(`Switch failed: ${err}`);
        }
      });
    })
  );
}

async function cmdAdd() {
  const name = await vscode.window.showInputBox({
    title: 'Add AI Profile — Name',
    prompt: 'Enter a short profile name',
    placeHolder: 'e.g. claude-acct1, chatgpt-ent',
  });
  if (!name) return;

  const typeChoice = await vscode.window.showQuickPick(
    [
      { label: '$(sparkle) Claude', description: 'Claude Code CLI account', value: 'claude' },
      { label: '$(globe) ChatGPT Enterprise', description: 'Browser SSO account', value: 'chatgpt' },
    ],
    { title: 'Add AI Profile — Type' }
  );
  if (!typeChoice) return;

  const email = await vscode.window.showInputBox({
    title: 'Add AI Profile — Email',
    prompt: `Email for this ${typeChoice.value} account`,
    placeHolder: 'you@example.com',
  });

  const aiswitchPath = findAiswitch();
  if (!aiswitchPath) {
    vscode.window.showErrorMessage('aiswitch CLI not found. Run setup first.');
    return;
  }

  try {
    // Simulate the interactive CLI add via direct module call
    const { addProfile } = requireProfilesModule();
    addProfile(name, typeChoice.value, email || '');
    refreshStatus();
    vscode.window.showInformationMessage(`Profile "${name}" added! Switch to it to start using it.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to add profile: ${err.message}`);
  }
}

async function cmdStatus() {
  const active = readActive();
  const profiles = readProfiles();
  const profile = profiles.find(p => p.name === active?.active);

  if (!active?.active) {
    vscode.window.showInformationMessage('No active AI profile. Use aiswitch: Switch AI Profile.');
    return;
  }

  const status = [
    `Active: ${active.active}`,
    `Type: ${profile?.type || 'unknown'}`,
    `Email: ${profile?.email || 'not set'}`,
    `Context used: ${tokenPercent}%`,
    `Switched at: ${active.switchedAt ? new Date(active.switchedAt).toLocaleTimeString() : 'unknown'}`,
  ].join('\n');

  const action = await vscode.window.showInformationMessage(
    `aiswitch: ${active.active} — ${tokenPercent}% context used`,
    'Switch Account',
    'Open in Browser'
  );

  if (action === 'Switch Account') cmdSwitch();
  if (action === 'Open in Browser') cmdOpenBrowser();
}

function cmdStartMonitor() {
  if (monitorProcess) {
    vscode.window.showInformationMessage('Monitor already running.');
    return;
  }
  startMonitorProcess();
  vscode.window.showInformationMessage('aiswitch: Usage monitor started.');
}

function cmdOpenBrowser() {
  const active = readActive();
  if (!active?.active) return;
  const aiswitchPath = findAiswitch();
  if (aiswitchPath) {
    spawn(aiswitchPath, ['open', active.active], { stdio: 'ignore', detached: true });
  }
}

// ─── Monitor process ─────────────────────────────────────────────────────────

function startMonitorProcess() {
  const aiswitchPath = findAiswitch();
  if (!aiswitchPath) return;

  monitorProcess = spawn(aiswitchPath, ['monitor', '--json'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    detached: false,
  });

  monitorProcess.stdout.on('data', data => {
    monitorOutput += data.toString();
    const lines = monitorOutput.split('\n');
    monitorOutput = lines.pop(); // keep incomplete line
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        handleMonitorEvent(event);
      } catch { /* not JSON — ignore */ }
    }
  });

  monitorProcess.on('close', () => { monitorProcess = null; });
}

function handleMonitorEvent(event) {
  if (event.type === 'usage') {
    tokenPercent = event.percent || 0;
    refreshTokenBar();
  } else if (event.type === 'threshold') {
    const pct = event.percent;
    const msg = `${activeProfile}: ${pct}% context used`;
    if (pct >= 95) {
      vscode.window.showErrorMessage(`⚠ ${msg} — switch account now!`, 'Switch').then(a => {
        if (a === 'Switch') cmdSwitch();
      });
    } else if (pct >= 85) {
      vscode.window.showWarningMessage(`${msg} — consider switching soon`, 'Switch').then(a => {
        if (a === 'Switch') cmdSwitch();
      });
    }
  } else if (event.type === 'limit-hit') {
    vscode.window.showErrorMessage(
      `${activeProfile} hit a token/rate limit! Switch accounts.`,
      'Switch Now'
    ).then(a => { if (a === 'Switch Now') cmdSwitch(); });
  }
}

// ─── File watching ───────────────────────────────────────────────────────────

function watchActiveFile(context) {
  const activeFile = path.join(CONFIG_DIR, 'active.json');
  if (!fs.existsSync(activeFile)) return;

  const watcher = fs.watch(activeFile, () => {
    setTimeout(refreshStatus, 100); // slight delay for write to complete
  });
  fileWatcher = watcher;
  context.subscriptions.push({ dispose: () => watcher.close() });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readProfiles() {
  if (!fs.existsSync(PROFILES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')).profiles || []; }
  catch { return []; }
}

function readActive() {
  if (!fs.existsSync(ACTIVE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8')); }
  catch { return null; }
}

function findAiswitch() {
  try { return execSync('which aiswitch', { encoding: 'utf8' }).trim(); } catch {}
  // Common locations
  for (const p of [
    path.join(HOME, '.npm-global/bin/aiswitch'),
    '/usr/local/bin/aiswitch',
    '/opt/homebrew/bin/aiswitch',
    path.join(HOME, 'aiswitch/bin/aiswitch.js'),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function requireProfilesModule() {
  // Used only for the add-profile path without spawning CLI
  const profilesPath = path.join(findAiswitch() || '', '../../lib/profiles.js');
  // Fallback: write directly to profiles.json
  return {
    addProfile(name, type, email) {
      const data = readProfilesRaw();
      if (data.profiles.find(p => p.name === name)) throw new Error(`"${name}" exists`);
      const profileDir = path.join(CONFIG_DIR, 'profiles', name);
      fs.mkdirSync(profileDir, { recursive: true });
      data.profiles.push({ name, type, email, createdAt: new Date().toISOString(), lastUsed: null, configDir: profileDir });
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2));
    }
  };
}

function readProfilesRaw() {
  if (!fs.existsSync(PROFILES_FILE)) return { profiles: [] };
  try { return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')); }
  catch { return { profiles: [] }; }
}

module.exports = { activate, deactivate };
