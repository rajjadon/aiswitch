import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// profiles.js reads os.homedir() (which reads $HOME on POSIX) once at
// import time, so HOME must be set before the dynamic import below.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aiswitch-test-'));
process.env.HOME = fakeHome;

const { addProfile, activateClaudeProfile, syncClaudeProfileBack } =
  await import('../lib/profiles.js');

const claudeDir = path.join(fakeHome, '.claude');
const settingsFile = path.join(claudeDir, 'settings.json');
const sessionFile = path.join(claudeDir, 'session.json');

test('global settings survive account switches; per-account session data does not', async (t) => {
  t.after(() => fs.rmSync(fakeHome, { recursive: true, force: true }));

  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }));
  fs.writeFileSync(sessionFile, JSON.stringify({ who: 'preexisting' }));

  const acct1 = addProfile('acct1', 'claude', 'a1@x.com');
  const acct2 = addProfile('acct2', 'claude', 'a2@x.com');

  // First activation: global settings must survive even though the fresh
  // profile dir is empty and per-account data gets wiped.
  activateClaudeProfile(acct1);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { theme: 'dark' });
  assert.equal(fs.existsSync(sessionFile), false);

  // Simulate using the account, then save its per-account state before switching away.
  fs.writeFileSync(sessionFile, JSON.stringify({ who: 'acct1' }));
  syncClaudeProfileBack('acct1');

  // The profile snapshot must hold per-account data...
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(acct1.configDir, 'session.json'), 'utf8')),
    { who: 'acct1' }
  );
  // ...but must never capture global config, or it would fork.
  assert.equal(fs.existsSync(path.join(acct1.configDir, 'settings.json')), false);

  // User changes the global setting directly (e.g. via `claude config`).
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'light' }));

  // Switch to a second, brand-new account.
  activateClaudeProfile(acct2);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { theme: 'light' },
    'global settings must not be reverted or deleted by switching to another account'
  );
  assert.equal(fs.existsSync(sessionFile), false, 'acct1 session data must not leak into acct2');

  // Switch back to acct1: per-account data round-trips, global stays put.
  syncClaudeProfileBack('acct2');
  activateClaudeProfile(acct1);
  assert.deepEqual(JSON.parse(fs.readFileSync(sessionFile, 'utf8')), { who: 'acct1' });
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { theme: 'light' });
});
