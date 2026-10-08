// Shared by the plugin's scripts: the pinned Playwright MCP package and how to run npx.
import { spawn } from 'node:child_process';

export const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.78';
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
