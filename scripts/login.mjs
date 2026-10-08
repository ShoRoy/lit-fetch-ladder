#!/usr/bin/env node
// Save a library login for the plugin's library browser. Run this yourself, in a
// terminal; the agent never runs it and never sees your password or second factor.
//
//   node login.mjs --data <plugin data dir> [--proxy-suffix <library proxy>] [--login-url <sign-in page>]
//
// The library proxy comes from the plugin's settings; --proxy-suffix overrides it (for signing in
// on a machine where the plugin is not installed). The sign-in page is the proxy's own login
// page, worked out from the proxy; --login-url overrides it for a library that differs.
//
// A browser window opens at your library's sign-in page. Sign in the way you
// normally do, open any paper through the proxy to confirm it works, then close
// the window. Only the proxy's own cookies are kept: the sign-in provider's
// cookies (single sign-on, second factor) are dropped, so the saved file cannot
// sign the agent's browser in anywhere except the library proxy.
import fs from 'node:fs';
import path from 'node:path';
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

async function main() {
  const data = argValue('--data');
  const suffix = proxySuffix(argValue('--proxy-suffix') || pluginOptions().proxy_suffix);
  if (!data || !suffix) {
    console.error('usage: node login.mjs --data <dir> [--proxy-suffix <library proxy>] [--login-url <sign-in page>]\n'
      + (!data ? '(/lit-fetch-ladder:login prints this command)'
        : 'No library proxy is set, so there is nothing to sign in to. On a campus network or VPN no login is\n'
        + 'needed. Otherwise set "Library proxy" in /config under lit-fetch-ladder, or pass --proxy-suffix.'));
    process.exit(2);
  }
  if (!hasDisplay()) {
    console.error('No display: the sign-in window cannot open here. Either forward a display into this\n'
      + 'environment (see the README section "Signing in from a container"), or run this same\n'
      + 'command on a machine with a browser using a temporary --data directory and copy the\n'
      + `resulting secret/library-state.json to ${path.join(data, ...SESSION_FILE)}.`);
    process.exit(3);
  }
  const secretDir = path.join(data, 'secret');
  fs.mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  const raw = path.join(secretDir, 'login-raw.json');
  const out = path.join(data, ...SESSION_FILE);

  const loginUrl = (argValue('--login-url') || '').replace(/%u|\{url\}/gi, '') || await signInUrl(suffix);
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
    console.log('Library sessions usually expire within hours; run this again when fetches bounce to the sign-in page.');
  });
}

if (process.argv[1] && process.argv[1].endsWith('login.mjs')) main();
