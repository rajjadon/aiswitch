import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');

// Patterns Claude Code writes to its log files
const TOKEN_PATTERNS = [
  /tokens[_\s]used[:\s]+(\d+)/i,
  /usage[:\s]+\{[^}]*"input_tokens"[:\s]+(\d+)/i,
  /"total_tokens"[:\s]+(\d+)/i,
  /context[:\s]+(\d+)[/\s]*(\d+)/i,
];

const LIMIT_PATTERNS = [
  /rate[_\s]limit/i,
  /context[_\s]window[_\s]exceeded/i,
  /token[_\s]limit[_\s]exceeded/i,
  /usage[_\s]limit/i,
  /you've[_\s]reached[_\s]your/i,
  /quota[_\s]exceeded/i,
];

export class UsageMonitor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.thresholds = opts.thresholds || [70, 85, 95];
    this.watchers = [];
    this.sessionTokens = 0;
    this.dailyTokens = 0;
    this.alerted = new Set();
    this.logDir = path.join(CLAUDE_DIR, 'logs');
    this.sessionFile = path.join(CLAUDE_DIR, 'session.json');
  }

  start() {
    this._watchLogs();
    this._watchSession();
    this._pollInterval = setInterval(() => this._readCurrentUsage(), 10_000);
    this._readCurrentUsage();
    return this;
  }

  stop() {
    this.watchers.forEach(w => w.close?.());
    clearInterval(this._pollInterval);
  }

  _watchLogs() {
    if (!fs.existsSync(this.logDir)) return;
    try {
      // Watch for new log files
      const watcher = fs.watch(this.logDir, { persistent: false }, (evt, filename) => {
        if (!filename) return;
        const logFile = path.join(this.logDir, filename);
        this._tailFile(logFile);
      });
      this.watchers.push(watcher);

      // Tail existing logs
      const existing = fs.readdirSync(this.logDir)
        .filter(f => f.endsWith('.log') || f.endsWith('.json'))
        .map(f => path.join(this.logDir, f));
      existing.forEach(f => this._tailFile(f));
    } catch { /* log dir may not exist yet */ }
  }

  _tailFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    try {
      let size = fs.statSync(filePath).size;
      const watcher = fs.watchFile(filePath, { interval: 2000 }, () => {
        const newSize = fs.statSync(filePath).size;
        if (newSize <= size) return;
        const buf = Buffer.alloc(newSize - size);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buf, 0, buf.length, size);
        fs.closeSync(fd);
        size = newSize;
        this._parseLine(buf.toString('utf8'));
      });
      this.watchers.push({ close: () => fs.unwatchFile(filePath) });
    } catch { /* file may have been rotated */ }
  }

  _watchSession() {
    if (!fs.existsSync(this.sessionFile)) return;
    const watcher = fs.watchFile(this.sessionFile, { interval: 3000 }, () => {
      this._readCurrentUsage();
    });
    this.watchers.push({ close: () => fs.unwatchFile(this.sessionFile) });
  }

  _parseLine(text) {
    // Check for hard limit hits first
    if (LIMIT_PATTERNS.some(p => p.test(text))) {
      this.emit('limit-hit', { text: text.trim().slice(0, 200) });
      return;
    }

    // Extract token counts
    for (const pattern of TOKEN_PATTERNS) {
      const m = text.match(pattern);
      if (m) {
        const tokens = parseInt(m[1], 10);
        if (!isNaN(tokens)) {
          this._updateTokens(tokens);
          break;
        }
      }
    }
  }

  _updateTokens(tokens) {
    this.sessionTokens = Math.max(this.sessionTokens, tokens);
    this.emit('usage', { session: this.sessionTokens, daily: this.dailyTokens });
    this._checkThresholds();
  }

  _checkThresholds() {
    // Claude Code's context window is ~200k tokens; we track % of that
    const contextWindow = 200_000;
    const pct = Math.round((this.sessionTokens / contextWindow) * 100);

    for (const threshold of this.thresholds) {
      const key = `${threshold}`;
      if (pct >= threshold && !this.alerted.has(key)) {
        this.alerted.add(key);
        this.emit('threshold', { percent: pct, threshold });
      }
    }
  }

  _readCurrentUsage() {
    // Read Claude Code's session state if it exists
    const possibleFiles = [
      path.join(CLAUDE_DIR, 'session.json'),
      path.join(CLAUDE_DIR, 'usage.json'),
      path.join(CLAUDE_DIR, '.session'),
    ];

    for (const f of possibleFiles) {
      if (!fs.existsSync(f)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(f, 'utf8'));
        const tokens = data.tokens_used || data.input_tokens || data.total_tokens;
        if (tokens) {
          this._updateTokens(parseInt(tokens, 10));
          return;
        }
      } catch { /* skip malformed files */ }
    }
  }

  getStatus() {
    return {
      sessionTokens: this.sessionTokens,
      dailyTokens: this.dailyTokens,
      contextPercent: Math.round((this.sessionTokens / 200_000) * 100),
    };
  }

  resetAlerts() {
    this.alerted.clear();
    this.sessionTokens = 0;
  }
}

// Send a macOS/Linux desktop notification
export async function notify(title, message, urgency = 'normal') {
  try {
    const { default: notifier } = await import('node-notifier');
    notifier.notify({
      title,
      message,
      sound: urgency === 'critical',
      timeout: urgency === 'critical' ? 30 : 8,
      icon: undefined,
    });
  } catch {
    // Fallback: just print to stderr (will show in VS Code terminal)
    process.stderr.write(`\n[ALERT] ${title}: ${message}\n`);
  }
}
