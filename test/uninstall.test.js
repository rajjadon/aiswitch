import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uninstallPath = path.join(repoRoot, 'uninstall.sh');

test('uninstall.sh removes aiswitch state but never touches ~/.claude', { timeout: 8000 }, async (t) => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aiswitch-uninstall-test-'));
  t.after(() => fs.rmSync(fakeHome, { recursive: true, force: true }));

  // Stub out npm so this test can never touch the real global npm-link state.
  const stubBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiswitch-stubbin-'));
  t.after(() => fs.rmSync(stubBinDir, { recursive: true, force: true }));
  const npmStub = path.join(stubBinDir, 'npm');
  fs.writeFileSync(npmStub, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(npmStub, 0o755);

  // Global Claude Code state that must survive byte-for-byte.
  const claudeDir = path.join(fakeHome, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsFile = path.join(claudeDir, 'settings.json');
  const claudeMdFile = path.join(claudeDir, 'CLAUDE.md');
  const sessionFile = path.join(claudeDir, 'session.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }));
  fs.writeFileSync(claudeMdFile, '# global instructions\n');
  fs.writeFileSync(sessionFile, JSON.stringify({ who: 'currently-active-account' }));

  // aiswitch's own footprint, which uninstall IS expected to remove.
  const aiswitchDir = path.join(fakeHome, '.aiswitch');
  fs.mkdirSync(path.join(aiswitchDir, 'profiles', 'acct1'), { recursive: true });
  fs.writeFileSync(path.join(aiswitchDir, 'profiles.json'), '{"profiles":[]}');

  const extDir = path.join(fakeHome, '.vscode', 'extensions', 'aiswitch-1.0.0');
  fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(path.join(extDir, 'package.json'), '{}');

  const child = spawn('bash', [uninstallPath], {
    env: { ...process.env, HOME: fakeHome, PATH: `${stubBinDir}:${process.env.PATH}` },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.write('y\n');
  child.stdin.end();

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  assert.equal(exitCode, 0);

  // Global Claude config: untouched, byte-for-byte.
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { theme: 'dark' });
  assert.equal(fs.readFileSync(claudeMdFile, 'utf8'), '# global instructions\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(sessionFile, 'utf8')), { who: 'currently-active-account' });

  // aiswitch's own state: gone.
  assert.equal(fs.existsSync(aiswitchDir), false);
  assert.equal(fs.existsSync(extDir), false);
});
