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

export function hasDisplay(env = process.env, platform = process.platform) {
  return platform !== 'linux' || !!(env.DISPLAY || env.WAYLAND_DISPLAY);
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
  if (!hasDisplay()) {
    stop(3, 'no display, so the sign-in window cannot open here. Forward a display into this environment\n'
      + '(README, "Signing in from a container"), or run this command on a machine with a browser, using a\n'
      + `temporary --data directory, and copy the resulting secret/library-state.json to ${path.join(data, ...SESSION_FILE)}.`);
  }
  const loginUrl = (argValue('--login-url') || '').replace(/%u|\{url\}/gi, '') || await signInUrl(suffix);
  if (background) {
    startInBackground(data, suffix, loginUrl);
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
// the window and save the login when the window closes. Its output goes to <data>/login.log.
function startInBackground(data, suffix, loginUrl) {
  const pidFile = path.join(data, 'login.pid');
  const running = fs.existsSync(pidFile) ? Number.parseInt(fs.readFileSync(pidFile, 'utf8'), 10) : 0;
  if (running && isAlive(running)) {
    console.log('ALREADY OPEN: a sign-in window is already open. Finish signing in there and close it.');
    return;
  }
  fs.mkdirSync(data, { recursive: true });
  const log = fs.openSync(path.join(data, 'login.log'), 'w');
  const args = [fileURLToPath(import.meta.url), '--data', data, '--proxy-suffix', suffix];
  if (loginUrl) args.push('--login-url', loginUrl);
  const child = spawn(process.execPath, args, {
    detached: true, stdio: ['ignore', log, log], env: { ...process.env, LFL_LOGIN_PID_FILE: pidFile },
  });
  fs.writeFileSync(pidFile, String(child.pid));
  child.unref();
  fs.closeSync(log);
  console.log(`OPENING: a browser window is opening${loginUrl ? ` at your library's sign-in page (${loginUrl})` : ''}.`);
  console.log('Sign in, open one paper through your library to check access, then close the window.');
  console.log(`The login is saved when the window closes (log: ${path.join(data, 'login.log')}).`);
}

if (process.argv[1] && process.argv[1].endsWith('login.mjs')) main();
