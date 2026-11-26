#!/usr/bin/env node
// Save a library login for the plugin's library browser. The agent never sees your password or
// second factor: you sign in yourself, in a browser window on your screen.
//
//   /lit-fetch-ladder:login        in Claude Code (only you can run it; the agent cannot)
//   node login.mjs --data <plugin data dir> [--proxy-suffix <library proxy>] [--login-url <sign-in page>]
//
// The slash command runs this with --background: it starts a second, detached copy that opens the
// window and saves the login when you close it, and returns at once, because Claude Code stops a
// slash command's command after two minutes. Run by hand, it opens the window and waits.
//
// The library proxy comes from the plugin's settings; --proxy-suffix overrides it (for signing in
// on a machine where the plugin is not installed). The sign-in page is the proxy's own login
// page, worked out from the proxy; --login-url overrides it for a library that differs.
//
// Only the proxy's own cookies are kept: the sign-in provider's cookies (single sign-on, second
// factor) are dropped, so the saved file cannot sign the agent's browser in anywhere except the
// library proxy.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAYWRIGHT_MCP, SESSION_FILE, argValue, npx, pluginOptions, proxySuffix, signInUrl, underSuffix } from './common.mjs';

export function scopeState(state, suffix) {
  const cookies = state.cookies || [];
  const kept = cookies.filter((c) => underSuffix(c.domain, suffix));
  const dropped = [...new Set(cookies.filter((c) => !underSuffix(c.domain, suffix))
    .map((c) => (c.domain || '').replace(/^\./, '')))].sort();
  const origins = (state.origins || []).filter((o) => {
    try { return underSuffix(new URL(o.origin).hostname, suffix); } catch { return false; }
  });
  return { scoped: { cookies: kept, origins }, dropped };
}

function writePrivate(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

// Whether a display server really answers, not only whether a variable names one: a forwarded
// socket (VS Code's, in a container) can accept a connection with nothing working behind it. X is
// sent the start of its connection setup and Wayland a sync request; any reply means it is there.
function answers(where, request, ms) {
  return new Promise((resolve) => {
    const s = net.connect(where);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), ms);
    s.on('connect', () => s.write(request));
    s.on('data', () => finish(true));
    s.on('end', () => finish(false));
    s.on('error', () => finish(false));
  });
}

const X_SETUP = Buffer.from([0x6c, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0]);    // little-endian, protocol 11.0, no auth
const WL_SYNC = Buffer.from([1, 0, 0, 0, 0, 0, 12, 0, 2, 0, 0, 0]);        // wl_display@1.sync(new callback 2)

// Where DISPLAY points: ":0" and "unix:0" are the socket X0 in /tmp/.X11-unix (or Linux's abstract
// socket of that name), "host:10.0" is TCP port 6010, as with SSH X forwarding.
export function xTargets(display, xdir = '/tmp/.X11-unix') {
  const m = /^(.*):(\d+)(?:\.\d+)?$/.exec(display || '');
  if (!m) return [];
  if (m[1] === '' || m[1] === 'unix') return [path.join(xdir, `X${m[2]}`), `\0${path.join(xdir, `X${m[2]}`)}`];
  return [{ host: m[1], port: 6000 + Number(m[2]) }];
}

// How the sign-in window can open here: { ok: true, env, note } with the variables the browser
// needs, or { ok: false, reason }. X is used when it answers; when only Wayland does, the browser is
// told to use Wayland (XDG_SESSION_TYPE=wayland), since Chromium tries X whenever DISPLAY is set.
export async function displayPlan(env = process.env, platform = process.platform, { xdir, ms = 2000 } = {}) {
  if (platform !== 'linux') return { ok: true, env: {} };
  for (const t of env.DISPLAY ? xTargets(env.DISPLAY, xdir) : []) {
    if (await answers(t, X_SETUP, ms)) return { ok: true, env: {} };
  }
  const w = env.WAYLAND_DISPLAY;
  const wsock = w && (path.isAbsolute(w) ? w : env.XDG_RUNTIME_DIR && path.join(env.XDG_RUNTIME_DIR, w));
  if (wsock && await answers(wsock, WL_SYNC, ms)) {
    return { ok: true, env: { XDG_SESSION_TYPE: 'wayland' },
      note: env.DISPLAY ? `no X server answers on DISPLAY=${env.DISPLAY}, so the window opens on Wayland` : '' };
  }
  if (!env.DISPLAY && !w) return { ok: false, reason: 'no display is set (DISPLAY, WAYLAND_DISPLAY)' };
  const dead = [env.DISPLAY && `DISPLAY=${env.DISPLAY}`, w && `WAYLAND_DISPLAY=${w}`].filter(Boolean).join(' or ');
  return { ok: false, reason: `no display answers on ${dead}` };
}

// The line in a failed sign-in's log that says why, else its last line.
function whyStopped(logFile) {
  let lines = [];
  try { lines = fs.readFileSync(logFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean); } catch { /* no log */ }
  const why = lines.find((l) => /missing x server|cannot open display|executable doesn't exist|error|failed/i.test(l));
  return (why || lines.at(-1) || 'no output').replace(/^[║╔╚═\s]+|[║\s]+$/g, '').slice(0, 200);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function main() {
  const background = process.argv.includes('--background');
  // In the background (the slash command) a failing exit would abort the command before the user
  // saw why, so every outcome there is a status line and the exit is 0.
  const stop = (code, message) => {
    if (background) console.log(`NOT OPENED: ${message}`);
    else console.error(message);
    process.exit(background ? 0 : code);
  };
  const data = argValue('--data');
  if (!data) stop(2, 'usage: node login.mjs --data <dir> [--proxy-suffix <library proxy>] [--login-url <sign-in page>]');
  const suffix = proxySuffix(argValue('--proxy-suffix') || pluginOptions().proxy_suffix);
  if (!suffix) {
    stop(2, 'no library proxy is set, so there is nothing to sign in to. On a campus network or VPN no login\n'
      + 'is needed. Otherwise set "Library proxy" in /config under lit-fetch-ladder, or pass --proxy-suffix.');
  }
  const openPid = path.join(data, 'login.pid');
  const running = background && fs.existsSync(openPid) ? Number.parseInt(fs.readFileSync(openPid, 'utf8'), 10) : 0;
  if (running && isAlive(running)) {
    console.log('ALREADY OPEN: a sign-in window is already open. Finish signing in there and close it.');
    return;
  }
  const display = await displayPlan();
  if (!display.ok) {
    stop(3, `${display.reason}, so the sign-in window cannot open here. Forward a display into this environment\n`
      + '(docs/sign-in.md, "Signing in from a container"), or run this command on a machine with a browser, using a\n'
      + `temporary --data directory, and copy the resulting secret/library-state.json to ${path.join(data, ...SESSION_FILE)}.`);
  }
  Object.assign(process.env, display.env);  // the browser, and the background copy, inherit it
  const loginUrl = (argValue('--login-url') || '').replace(/%u|\{url\}/gi, '') || await signInUrl(suffix);
  if (background) {
    await startInBackground(data, suffix, loginUrl, display.note);
    return;
  }

  const secretDir = path.join(data, 'secret');
  fs.mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  const raw = path.join(secretDir, 'login-raw.json');
  const out = path.join(data, ...SESSION_FILE);
  const pidFile = process.env.LFL_LOGIN_PID_FILE;
  if (pidFile) process.on('exit', () => fs.rmSync(pidFile, { force: true }));

  console.log(`\nA browser window is opening${loginUrl ? ` at your library's sign-in page (${loginUrl})` : ''}.`);
  console.log('Sign in, open one paper through your library to check access, then CLOSE THE WINDOW.');
  console.log("If the window does not show your library's sign-in, go to your library's website in it, sign in\n"
    + 'there and open a paper through it, then close the window.\n');
  const child = npx(['-y', '-p', PLAYWRIGHT_MCP, 'playwright', 'open', `--save-storage=${raw}`, ...(loginUrl ? [loginUrl] : [])]);
  child.on('exit', () => {
    let state;
    try {
      state = JSON.parse(fs.readFileSync(raw, 'utf8'));
    } catch {
      console.error('No login was saved (the window may have been closed before the page loaded).');
      process.exit(1);
    }
    fs.rmSync(raw, { force: true });
    const { scoped, dropped } = scopeState(state, suffix);
    if (scoped.cookies.length === 0) {
      console.error(`NOT SAVED: no cookies for ${suffix} were captured, so the sign-in probably did not finish.`
        + '\nThe previous saved login, if any, is unchanged.');
      process.exit(1);
    }
    writePrivate(out, scoped);
    console.log(`Saved: ${out} (readable only by you).`);
    console.log(`Kept ${scoped.cookies.length} proxy cookie(s); dropped cookies for ${dropped.length} other site(s)`
      + `${dropped.length ? `: ${dropped.join(', ')}` : ''}.`);
    console.log('Library sessions usually expire within hours; sign in again when fetches land on the sign-in page.');
  });
}

// The slash command cannot wait for a sign-in, so it starts this script again, detached, to open
// the window and save the login when the window closes. Its output goes to <data>/login.log. A
// browser that cannot start stops within seconds, while one that opened stays until the user closes
// it, so the first seconds tell which line to print.
const STARTUP_MS = 4000;
async function startInBackground(data, suffix, loginUrl, note) {
  const pidFile = path.join(data, 'login.pid');
  const logFile = path.join(data, 'login.log');
  fs.mkdirSync(data, { recursive: true });
  const log = fs.openSync(logFile, 'w');
  const args = [fileURLToPath(import.meta.url), '--data', data, '--proxy-suffix', suffix];
  if (loginUrl) args.push('--login-url', loginUrl);
  const child = spawn(process.execPath, args, {
    detached: true, stdio: ['ignore', log, log], env: { ...process.env, LFL_LOGIN_PID_FILE: pidFile },
  });
  fs.writeFileSync(pidFile, String(child.pid));
  fs.closeSync(log);
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), STARTUP_MS);
    child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
  });
  child.unref();
  if (code !== null && code !== 0) {
    console.log(`NOT OPENED: the browser stopped at once: ${whyStopped(logFile)} (log: ${logFile}).`);
    return;
  }
  console.log(`OPENING: a browser window is opening${loginUrl ? ` at your library's sign-in page (${loginUrl})` : ''}.`);
  console.log('Sign in, open one paper through your library to check access, then close the window.');
  console.log(`The login is saved when the window closes (log: ${logFile}).`);
  if (note) console.log(`Note: ${note}.`);
}

if (process.argv[1] && process.argv[1].endsWith('login.mjs')) main();
