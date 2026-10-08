#!/usr/bin/env node
// Check that everything lit-fetch-ladder needs is in place. Reads no secrets: for
// the saved login it reports only whether the file exists and how old it is.
//   node doctor.mjs --data <dir>
// Settings are read from Claude Code's settings files (pluginConfigs), so the
// command line never carries the proxy address; --email etc. override them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLAYWRIGHT_MCP, SESSION_FILE, argValue } from './common.mjs';
import { hasDisplay } from './login.mjs';

const rows = [];
const check = (ok, label, hint = '') => rows.push(`${ok ? ' ok ' : 'FIX '} ${label}${!ok && hint ? `\n       -> ${hint}` : ''}`);

// Non-sensitive plugin options live under pluginConfigs in the settings files;
// later files (project, local) override earlier ones (user).
function pluginOptions() {
  const files = [path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.local.json')];
  const opts = {};
  for (const f of files) {
    try {
      const cfg = JSON.parse(fs.readFileSync(f, 'utf8')).pluginConfigs || {};
      for (const [id, v] of Object.entries(cfg)) {
        if (id.startsWith('lit-fetch-ladder@')) Object.assign(opts, v.options || {});
      }
    } catch { /* missing or unreadable settings file */ }
  }
  return opts;
}
const o = pluginOptions();
const data = argValue('--data');
const email = argValue('--email', o.contact_email || '');
const mode = argValue('--proxy-mode', o.proxy_mode || 'ezproxy-host');
const suffix = argValue('--proxy-suffix', o.proxy_suffix || '');
const loginUrl = argValue('--login-url', o.proxy_login_url || '');

const nodeMajor = Number(process.versions.node.split('.')[0]);
check(nodeMajor >= 18, `Node ${process.versions.node}`, 'install Node 18 or later');
const py = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import sys;print(sys.version_info[:2]>=(3,9))'], { encoding: 'utf8' });
check(py.stdout?.trim() === 'True', 'Python 3.9+ for the fetch tools', 'install Python 3.9 or later');
const npx = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
check(npx.status === 0, 'npx available', 'npx ships with Node; check your PATH');

const cacheRoots = [process.env.PLAYWRIGHT_BROWSERS_PATH,
  path.join(os.homedir(), '.cache', 'ms-playwright'),
  path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright')].filter(Boolean);
const chromium = cacheRoots.some((r) => fs.existsSync(r) && fs.readdirSync(r).some((d) => d.startsWith('chromium')));
check(chromium, 'Chromium for Playwright installed', `npx -y -p ${PLAYWRIGHT_MCP} playwright install chromium`);

check(/.+@.+/.test(email), 'contact email set', 'set contact_email in /plugin settings for lit-fetch-ladder');
check(['ezproxy-host', 'none'].includes(mode), `proxy mode: ${mode}`, 'use ezproxy-host or none');
if (mode === 'ezproxy-host') {
  check(!!suffix, `proxy suffix: ${suffix || '(empty)'}`, "set proxy_suffix (your library's site lists it, e.g. proxy.library.example.edu)");
  check(/^https:\/\//.test(loginUrl), 'proxy login URL set', 'set proxy_login_url to the address that starts your library sign-in');
  const sess = data && path.join(data, ...SESSION_FILE);
  if (sess && fs.existsSync(sess)) {
    const st = fs.statSync(sess);
    const hours = (Date.now() - st.mtimeMs) / 3600000;
    const privateFile = process.platform === 'win32' || (st.mode & 0o077) === 0;
    check(hours < 12, `saved library login: ${hours.toFixed(1)} h old`, 'probably expired; run /lit-fetch-ladder:login');
    check(privateFile, 'saved login readable only by you', `chmod 600 "${sess}"`);
  } else {
    check(false, 'saved library login', 'run /lit-fetch-ladder:login (the login opens a browser window)');
  }
  check(hasDisplay(), 'a display for the sign-in window', 'see the README section "Signing in from a container"');
}

console.log(`lit-fetch-ladder doctor\n${rows.join('\n')}`);
console.log(`
Optional second layer: Playwright MCP exposes two code-execution tools that the
plugin's guard denies. To deny them in your own settings as well, add to
"permissions.deny" in ~/.claude/settings.json:
  "mcp__plugin_lit-fetch-ladder_browse__browser_evaluate",
  "mcp__plugin_lit-fetch-ladder_browse__browser_run_code_unsafe",
  "mcp__plugin_lit-fetch-ladder_library__browser_evaluate",
  "mcp__plugin_lit-fetch-ladder_library__browser_run_code_unsafe"`);
process.exit(rows.some((r) => r.startsWith('FIX')) ? 1 : 0);
