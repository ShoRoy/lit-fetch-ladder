// Shared by the plugin's scripts: the pinned Playwright MCP package, the browsers' identity,
// how to read the proxy setting, and how to run npx.
import { spawn, spawnSync } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.78';
// The Chrome that PLAYWRIGHT_MCP bundles (151.0.7922 for 0.0.78). Change it with the pin.
export const CHROME_MAJOR = 151;
// The Chromium build PLAYWRIGHT_MCP installs (playwright-core's browsers.json). Change it with the pin.
export const CHROMIUM_REVISION = 1232;
// What installs the system libraries the browser needs on a minimal Linux (it asks for sudo).
export const BROWSER_DEPS = `npx -y -p ${PLAYWRIGHT_MCP} playwright install-deps chromium`;

// Where Playwright keeps its browsers.
export function browserCacheRoots(env = process.env, home = os.homedir()) {
  return [env.PLAYWRIGHT_BROWSERS_PATH, path.join(home, '.cache', 'ms-playwright'),
    path.join(home, 'Library', 'Caches', 'ms-playwright'), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'ms-playwright')].filter(Boolean);
}

// Whether the pinned build's browsers start, not only whether they are installed. On a minimal
// Linux (an Ubuntu server, WSL, a Docker image) the binaries are there but their system libraries
// are not, and the browser stops at launch. `--version` loads every library without opening a
// window, so it fails exactly where a launch would. '' when every installed binary starts.
export function browserStartProblem(roots = browserCacheRoots(), platform = process.platform) {
  if (platform !== 'linux') return '';
  for (const root of roots) {
    for (const [dir, exe] of [[`chromium-${CHROMIUM_REVISION}`, 'chrome'], [`chromium_headless_shell-${CHROMIUM_REVISION}`, 'chrome-headless-shell']]) {
      let subs = [];
      try { subs = fs.readdirSync(path.join(root, dir)); } catch { continue; }
      for (const bin of subs.map((s) => path.join(root, dir, s, exe)).filter((b) => fs.existsSync(b))) {
        const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000 });
        if (r.status === 0) continue;
        const why = `${r.stderr || ''}\n${r.stdout || ''}`.split('\n').map((l) => l.trim()).find(Boolean);
        return `${exe} does not start: ${(why || (r.error && r.error.message) || `exit ${r.status}`).slice(0, 200)}`;
      }
    }
  }
  return '';
}
export const SESSION_FILE = ['secret', 'library-state.json'];

// Windows needs a shell to run npx.cmd; quote arguments that contain spaces there.
// The child's PATH with the folder of the node running this script added at the end. A node started
// by its full path, its folder not on PATH, then still finds its own npx, and npx (itself a node
// script) finds node; an npx already on PATH still comes first.
export function childPath(env = process.env, execPath = process.execPath) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const dirs = (env[key] || '').split(path.delimiter).filter(Boolean);
  const own = path.dirname(execPath);
  return { key, value: (dirs.includes(own) ? dirs : [...dirs, own]).join(path.delimiter) };
}

export function npx(args, opts = {}) {
  const win = process.platform === 'win32';
  const q = (x) => (/[\s"]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x);
  const env = opts.env || process.env;
  const { key, value } = childPath(env);
  const child = spawn(win ? 'npx.cmd' : 'npx', win ? args.map(q) : args,
    { stdio: 'inherit', shell: win, ...opts, env: { ...env, [key]: value } });
  child.on('error', (e) => {
    console.error(`error: npx could not start (${e.code || e.message}). Install Node 18 or later, which brings npx, or put its folder on PATH.`);
    process.exit(1);
  });
  return child;
}

export function underSuffix(host, suffix) {
  host = (host || '').toLowerCase().replace(/^\./, '');
  return !!suffix && (host === suffix || host.endsWith('.' + suffix));
}

export function argValue(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

// The plugin's data directory for a script run by hand: CLAUDE_PLUGIN_DATA when Claude Code set it,
// else the directory Claude Code keeps for this plugin, named <plugin>-<marketplace> (the marketplace
// name comes from the plugin's own manifest), else the one such directory that exists; '' otherwise.
export function defaultDataDir(env = process.env, home = os.homedir(), pluginRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  if (env.CLAUDE_PLUGIN_DATA) return env.CLAUDE_PLUGIN_DATA;
  const root = path.join(home, '.claude', 'plugins', 'data');
  try {
    const market = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'marketplace.json'), 'utf8')).name;
    const own = path.join(root, `lit-fetch-ladder-${market}`);
    if (market && fs.existsSync(own)) return own;
  } catch { /* no manifest to read: fall through */ }
  let dirs = [];
  try { dirs = fs.readdirSync(root).filter((d) => d.startsWith('lit-fetch-ladder-')); } catch { /* no plugin data yet */ }
  return dirs.length === 1 ? path.join(root, dirs[0]) : '';
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
