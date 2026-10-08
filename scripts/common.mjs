// Shared by the plugin's scripts: the pinned Playwright MCP package, the browsers' identity,
// how to read the proxy setting, and how to run npx.
import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.78';
// The Chrome that PLAYWRIGHT_MCP bundles (151.0.7922 for 0.0.78). Change it with the pin.
export const CHROME_MAJOR = 151;
export const SESSION_FILE = ['secret', 'library-state.json'];

// Windows needs a shell to run npx.cmd; quote arguments that contain spaces there.
export function npx(args, opts = {}) {
  const win = process.platform === 'win32';
  const a = win ? args.map((x) => (/[\s"]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x)) : args;
  return spawn(win ? 'npx.cmd' : 'npx', a, { stdio: 'inherit', shell: win, ...opts });
}

export function underSuffix(host, suffix) {
  host = (host || '').toLowerCase().replace(/^\./, '');
  return !!suffix && (host === suffix || host.endsWith('.' + suffix));
}

export function argValue(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

// The browsers identify as the desktop Chrome they are, without the "HeadlessChrome" marker
// that first-line bot checks refuse. Nothing else about the browser is disguised.
export function desktopUserAgent(platform = process.platform) {
  const system = platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
    : platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
}

// The proxy setting as people paste it: the bare ending (proxy.library.example.edu), the
// address of a paper opened through the library (https://www-example-com.proxy.library.example.edu/...),
// or the library's sign-in link (https://login.proxy.library.example.edu/login?url=...). Returns the ending the proxy adds to publisher hostnames, or '' when none is set.
// guard/guard.mjs carries the same function, so the guard stands alone.
const PUBLISHER_TAIL = /-(com|org|net|edu|gov|io|info|int|uk|de|fr|jp|cn|au|ca|nl|ch|it|es|se|eu|in|kr|br|ru|pl)$/;
export function proxySuffix(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('://')) {
    try { s = new URL(s).hostname; } catch { /* not a URL after all; trimmed below */ }
  }
  const labels = s.split(/[/?#]/)[0].split(':')[0].replace(/^\.+|\.+$/g, '').split('.');
  // A pasted paper address starts with the publisher's host written with dashes (www-example-com).
  if (labels.length > 2 && labels[0].includes('-') && PUBLISHER_TAIL.test(labels[0])) labels.shift();
  // A pasted sign-in link starts with login.
  if (labels.length > 2 && labels[0] === 'login') labels.shift();
  return labels.join('.');
}

// Where the sign-in starts: the proxy's own login page, which EZproxy serves at
// login.<ending> and usually at the ending itself. The first name that resolves wins.
export async function signInUrl(suffix, lookup = (host) => dns.lookup(host)) {
  for (const host of [`login.${suffix}`, suffix]) {
    try {
      await lookup(host);
      return `https://${host}/login`;
    } catch { /* try the next name */ }
  }
  return null;
}

// The plugin's settings as Claude Code saved them (pluginConfigs): the user's settings file,
// then the project's, then the project's local one, each overriding the one before. Scripts read
// them here, so the proxy setting never has to appear on a command line.
export function pluginOptions(cwd = process.cwd(), home = os.homedir()) {
  const files = [path.join(home, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.local.json')];
  const opts = {};
  for (const f of files) {
    try {
      const cfg = JSON.parse(fs.readFileSync(f, 'utf8')).pluginConfigs || {};
      for (const [id, v] of Object.entries(cfg)) {
        if (id.startsWith('lit-fetch-ladder@')) Object.assign(opts, (v && v.options) || {});
      }
    } catch { /* missing or unreadable settings file */ }
  }
  return opts;
}
