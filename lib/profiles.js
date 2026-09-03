import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, '.aiswitch');
const PROFILES_FILE = path.join(CONFIG_DIR, 'profiles.json');
const CLAUDE_DIR = path.join(HOME, '.claude');
const ACTIVE_FILE = path.join(CONFIG_DIR, 'active.json');

export function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(PROFILES_FILE)) {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify({ profiles: [] }, null, 2));
  }
  if (!fs.existsSync(ACTIVE_FILE)) {
    fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ active: null, switchedAt: null }, null, 2));
  }
}

export function loadProfiles() {
  ensureConfigDir();
  return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
}

export function saveProfiles(data) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2));
}

export function loadActive() {
  ensureConfigDir();
  return JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'));
}

export function saveActive(data) {
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify(data, null, 2));
}

export function getProfileDir(name) {
  return path.join(CONFIG_DIR, 'profiles', name);
}

// Top-level entries inside ~/.claude that are shared config, not per-account
// state. These are never copied, overwritten, or deleted by a profile switch —
// every account sees the exact same settings/CLAUDE.md/hooks/etc.
export const GLOBAL_ENTRIES = [
  'settings.json', 'settings.local.json', 'CLAUDE.md',
  'hooks', 'commands', 'agents', 'skills',
];

function globalExcludeFlags() {
  return GLOBAL_ENTRIES.map(e => `--exclude=/${e}`).join(' ');
}

export function addProfile(name, type, email) {
  const data = loadProfiles();
  const exists = data.profiles.find(p => p.name === name);
  if (exists) throw new Error(`Profile "${name}" already exists`);

  const profileDir = getProfileDir(name);
  fs.mkdirSync(profileDir, { recursive: true });

  const profile = {
    name,
    type,       // 'claude' | 'chatgpt'
    email,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    configDir: profileDir,
    tokenWarningAt: type === 'claude' ? 85 : null,
    note: type === 'claude'
      ? 'Managed via ~/.claude config symlink'
      : 'Opens browser SSO session',
  };

  data.profiles.push(profile);
  saveProfiles(data);
  return profile;
}

export function removeProfile(name) {
  const data = loadProfiles();
  const idx = data.profiles.findIndex(p => p.name === name);
  if (idx === -1) throw new Error(`Profile "${name}" not found`);
  data.profiles.splice(idx, 1);
  saveProfiles(data);
}

export function getProfile(name) {
  const data = loadProfiles();
  return data.profiles.find(p => p.name === name) || null;
}

// Swap the ~/.claude directory to point at a profile's config dir.
// Only per-account state (auth/session/project history) is swapped —
// GLOBAL_ENTRIES are left untouched so every profile shares one global config.
export function activateClaudeProfile(profile) {
  const profileDir = profile.configDir;
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });

  execSync(
    `rsync -a --delete ${globalExcludeFlags()} "${profileDir}/" "${CLAUDE_DIR}/"`,
    { stdio: 'pipe' }
  );

  // Update active state
  const active = loadActive();
  active.active = profile.name;
  active.switchedAt = new Date().toISOString();
  saveActive(active);

  // Update lastUsed on profile
  const data = loadProfiles();
  const p = data.profiles.find(x => x.name === profile.name);
  if (p) { p.lastUsed = new Date().toISOString(); saveProfiles(data); }
}

// Sync current ~/.claude back to the profile dir before switching away.
// GLOBAL_ENTRIES are excluded so they never fork into a per-profile copy.
export function syncClaudeProfileBack(profileName) {
  if (!fs.existsSync(CLAUDE_DIR)) return;
  const profileDir = getProfileDir(profileName);
  fs.mkdirSync(profileDir, { recursive: true });
  execSync(
    `rsync -a --delete ${globalExcludeFlags()} "${CLAUDE_DIR}/" "${profileDir}/"`,
    { stdio: 'pipe' }
  );
}

export function getTokenUsage(profileName) {
  // Claude Code stores usage in ~/.claude/usage.json or similar
  // We read it from the active or backed-up profile dir
  const active = loadActive();
  const isActive = active.active === profileName;
  const dir = isActive ? CLAUDE_DIR : getProfileDir(profileName);
  const usageFile = path.join(dir, 'usage.json');
  const statsFile = path.join(dir, 'stats.json');

  // Try multiple known file locations Claude Code uses
  for (const f of [usageFile, statsFile]) {
    if (fs.existsSync(f)) {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* skip */ }
    }
  }
  return null;
}
