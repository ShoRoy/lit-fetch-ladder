// The sign-in keeps only the library proxy's cookies, and the slash command's background start
// reports every outcome and saves the login when the window closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopeState, hasDisplay } from '../scripts/login.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'login.mjs');

// A home and project with no Claude Code settings, so the runner's own settings never leak in.
function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-login-'));
  return { root, data: path.join(root, 'data'), env: { ...process.env, HOME: root, USERPROFILE: root } };
}
const start = (s, args, env) => spawnSync(process.execPath, [SCRIPT, '--data', s.data, ...args, '--background'],
  { cwd: s.root, env, encoding: 'utf8' });

test('the background start reports why it cannot open a window, and exits 0 so the command still shows', () => {
  const s = scratch();
  const noProxy = start(s, [], { ...s.env, DISPLAY: ':0' });
  assert.equal(noProxy.status, 0);
  assert.match(noProxy.stdout, /^NOT OPENED: no library proxy is set/);
  if (process.platform === 'linux') {
    const env = { ...s.env };
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
    const noDisplay = start(s, ['--proxy-suffix', 'proxy.example.edu'], env);
    assert.equal(noDisplay.status, 0);
    assert.match(noDisplay.stdout, /^NOT OPENED: no display/);
  }
});

test('the background start opens the sign-in detached and saves only the proxy cookies when it closes',
  { skip: process.platform === 'win32' && 'the fake browser is a shell script' }, async () => {
    const s = scratch();
    // A stand-in for "npx ... playwright open --save-storage=<file> <url>": it "signs in" at once.
    const bin = path.join(s.root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\n'
      + 'for a in "$@"; do case "$a" in --save-storage=*) f="${a#--save-storage=}";; esac; done\n'
      + 'printf \'%s\' \'{"cookies":[{"name":"ez","domain":".proxy.example.edu"},{"name":"sso","domain":"idp.example.edu"}],"origins":[]}\' > "$f"\n',
    { mode: 0o755 });
    const env = { ...s.env, DISPLAY: ':0', PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const r = start(s, ['--proxy-suffix', 'https://login.proxy.example.edu/login?url=x',
      '--login-url', 'https://login.proxy.example.edu/login'], env);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^OPENING: a browser window is opening at your library's sign-in page \(https:\/\/login\.proxy\.example\.edu\/login\)/);
    const saved = path.join(s.data, 'secret', 'library-state.json');
    for (let i = 0; i < 100 && !(fs.existsSync(saved) && !fs.existsSync(path.join(s.data, 'login.pid'))); i++) {
      await new Promise((ok) => setTimeout(ok, 50));
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(saved, 'utf8')).cookies.map((c) => c.name), ['ez']);
    assert.equal(fs.statSync(saved).mode & 0o077, 0, 'readable only by the user');
    assert.match(fs.readFileSync(path.join(s.data, 'login.log'), 'utf8'), /Saved: .*Kept 1 proxy cookie/s);
    assert.equal(fs.existsSync(path.join(s.data, 'login.pid')), false, 'the running marker is removed');
  });

test('a second start while a sign-in window is open does not open another', () => {
  const s = scratch();
  fs.mkdirSync(s.data, { recursive: true });
  fs.writeFileSync(path.join(s.data, 'login.pid'), String(process.pid));  // a process that is alive
  const r = start(s, ['--proxy-suffix', 'proxy.example.edu', '--login-url', 'https://login.proxy.example.edu/login'],
    { ...s.env, DISPLAY: ':0' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^ALREADY OPEN/);
});

test('only cookies and origins under the proxy suffix survive', () => {
  const state = {
    cookies: [
      { name: 'ezproxy', domain: '.proxy.example.edu' },
      { name: 'login', domain: 'login.proxy.example.edu' },
      { name: 'pub', domain: 'www-example-com.proxy.example.edu' },
      { name: 'sso', domain: '.example.edu' },
      { name: 'idp', domain: 'idp.example.edu' },
      { name: '2fa', domain: 'api.second-factor.example' },
      { name: 'lookalike', domain: 'evilproxy.example.edu' },
      { name: 'trick', domain: 'proxy.example.edu.attacker.test' },
    ],
    origins: [
      { origin: 'https://www-example-com.proxy.example.edu', localStorage: [] },
      { origin: 'https://idp.example.edu', localStorage: [] },
      { origin: 'not a url', localStorage: [] },
    ],
  };
  const { scoped, dropped } = scopeState(state, 'proxy.example.edu');
  assert.deepEqual(scoped.cookies.map((c) => c.name), ['ezproxy', 'login', 'pub']);
  assert.equal(scoped.origins.length, 1);
  assert.equal(dropped.length, 5);
});

test('a display is required only on Linux', () => {
  assert.equal(hasDisplay({}, 'linux'), false);
  assert.equal(hasDisplay({ DISPLAY: ':0' }, 'linux'), true);
  assert.equal(hasDisplay({ WAYLAND_DISPLAY: 'w' }, 'linux'), true);
  assert.equal(hasDisplay({}, 'darwin'), true);
  assert.equal(hasDisplay({}, 'win32'), true);
});
