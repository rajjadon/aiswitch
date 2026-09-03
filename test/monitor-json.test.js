import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binPath = path.join(repoRoot, 'bin', 'aiswitch.js');

test('aiswitch monitor --json emits parseable JSON lines the VS Code extension can consume', { timeout: 8000 }, async (t) => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aiswitch-monitor-test-'));
  t.after(() => fs.rmSync(fakeHome, { recursive: true, force: true }));

  const configDir = path.join(fakeHome, '.aiswitch');
  const profileDir = path.join(configDir, 'profiles', 'acct1');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'profiles.json'), JSON.stringify({
    profiles: [{ name: 'acct1', type: 'claude', email: 'a1@x.com', configDir }],
  }));
  fs.writeFileSync(path.join(configDir, 'active.json'), JSON.stringify({
    active: 'acct1', switchedAt: new Date().toISOString(),
  }));

  const claudeDir = path.join(fakeHome, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'session.json'), JSON.stringify({ tokens_used: 5000 }));

  const child = spawn(process.execPath, [binPath, 'monitor', '--json'], {
    env: { ...process.env, HOME: fakeHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGKILL'));

  const firstEvent = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (data) => {
      buf += data.toString();
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      try {
        resolve(JSON.parse(line));
      } catch (err) {
        reject(new Error(`stdout line was not valid JSON: ${JSON.stringify(line)}`));
      }
    });
    child.on('error', reject);
    child.on('close', (code) => reject(new Error(`process exited early with code ${code}`)));
  });

  assert.equal(firstEvent.type, 'usage');
  assert.equal(typeof firstEvent.percent, 'number');
});
