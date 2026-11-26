// The sign-in keeps only the library proxy's cookies, and the slash command's background start
// reports every outcome and saves the login when the window closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayPlan, scopeState, xTargets } from '../scripts/login.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'login.mjs');

// A home and project with no Claude Code settings, so the runner's own settings never leak in.
function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-login-'));
  return { root, data: path.join(root, 'data'), env: { ...process.env, HOME: root, USERPROFILE: root } };
}
const start = (s, args, env) => spawnSync(process.execPath, [SCRIPT, '--data', s.data, ...args, '--background'],
  { cwd: s.root, env, encoding: 'utf8' });
// The same, without blocking this process, so a fake display server here can answer.
const startAsync = (s, args, env) => new Promise((resolve) => {
  const c = spawn(process.execPath, [SCRIPT, '--data', s.data, ...args, '--background'], { cwd: s.root, env });
  let stdout = '';
  c.stdout.on('data', (d) => { stdout += d; });
  c.on('close', (status) => resolve({ status, stdout }));
});
// A display server that answers whatever a client sends first, and a forwarded socket with nothing
// behind it, which accepts a connection and never replies.
function listen(where, reply) {
  const srv = net.createServer((sock) => sock.once('data', () => reply && sock.write(Buffer.alloc(12))));
  return new Promise((ok) => srv.listen(where, () => ok(srv)));
}
// A stand-in for "npx ... playwright open": it runs the given shell lines.
function fakeNpx(s, body) {
  const bin = path.join(s.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return `${bin}${path.delimiter}${process.env.PATH}`;
}

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
    // It "signs in" at once, and records which display the browser was told to use.
    const PATH = fakeNpx(s, `echo "$XDG_SESSION_TYPE" > "${s.root}/session-type"\n`
      + 'for a in "$@"; do case "$a" in --save-storage=*) f="${a#--save-storage=}";; esac; done\n'
      + 'printf \'%s\' \'{"cookies":[{"name":"ez","domain":".proxy.example.edu"},{"name":"sso","domain":"idp.example.edu"}],"origins":[]}\' > "$f"');
    // Only a Wayland display answers here, so the browser is sent to Wayland.
    const wl = await listen(path.join(s.root, 'wl-0'), true);
    const env = { ...s.env, PATH, WAYLAND_DISPLAY: 'wl-0', XDG_RUNTIME_DIR: s.root };
    delete env.DISPLAY;
    const r = await startAsync(s, ['--proxy-suffix', 'https://login.proxy.example.edu/login?url=x',
      '--login-url', 'https://login.proxy.example.edu/login'], env);
    wl.close();
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
    assert.equal(fs.readFileSync(path.join(s.root, 'session-type'), 'utf8').trim(), 'wayland');
  });

test('a browser that stops at once is reported as NOT OPENED, with the reason from its log',
  { skip: process.platform !== 'linux' && 'the fake display is a Unix socket' }, async () => {
    const s = scratch();
    const PATH = fakeNpx(s, 'echo "[pid=1][err] Missing X server or \\$DISPLAY" >&2; exit 1');
    const wl = await listen(path.join(s.root, 'wl-0'), true);
    const env = { ...s.env, PATH, WAYLAND_DISPLAY: 'wl-0', XDG_RUNTIME_DIR: s.root };
    delete env.DISPLAY;
    const r = await startAsync(s, ['--proxy-suffix', 'proxy.example.edu', '--login-url', 'https://login.proxy.example.edu/login'], env);
    wl.close();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^NOT OPENED: the browser stopped at once: .*Missing X server or \$DISPLAY/);
  });

test('a browser that lacks its system libraries is reported before any window, with the command that installs them',
  { skip: process.platform !== 'linux' && 'the start check runs on Linux' }, async () => {
    const s = scratch();
    const browsers = path.join(s.root, 'browsers');
    const chrome = path.join(browsers, 'chromium-1232', 'chrome-linux64', 'chrome');
    fs.mkdirSync(path.dirname(chrome), { recursive: true });
    fs.writeFileSync(chrome, '#!/bin/sh\necho "chrome: error while loading shared libraries: libnspr4.so: cannot open shared object file" >&2\nexit 127\n', { mode: 0o755 });
    const PATH = fakeNpx(s, `touch "${s.root}/npx-ran"`);
    const wl = await listen(path.join(s.root, 'wl-0'), true);
    const env = { ...s.env, PATH, PLAYWRIGHT_BROWSERS_PATH: browsers, WAYLAND_DISPLAY: 'wl-0', XDG_RUNTIME_DIR: s.root };
    delete env.DISPLAY;
    const r = await startAsync(s, ['--proxy-suffix', 'proxy.example.edu', '--login-url', 'https://login.proxy.example.edu/login'], env);
    wl.close();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^NOT OPENED: the browser cannot start here \(chrome does not start: .*libnspr4\.so.*\)/);
    assert.match(r.stdout, /playwright install-deps chromium/);
    assert.equal(fs.existsSync(path.join(s.root, 'npx-ran')), false, 'no browser was started');
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

test('DISPLAY points at a local socket, or at a TCP port as with SSH X forwarding', () => {
  assert.deepEqual(xTargets(':0', '/x'), ['/x/X0', '\0/x/X0']);
  assert.deepEqual(xTargets('unix:1.0', '/x'), ['/x/X1', '\0/x/X1']);
  assert.deepEqual(xTargets('localhost:10.0'), [{ host: 'localhost', port: 6010 }]);
  assert.deepEqual(xTargets('nonsense'), []);
});

test('the sign-in uses X when it answers, Wayland when only Wayland does, and says why when neither does',
  { skip: process.platform !== 'linux' && 'Unix sockets as fake displays' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-disp-'));
    const opt = { xdir: dir, ms: 300 };
    const x = await listen(path.join(dir, 'X5'), true);
    assert.deepEqual(await displayPlan({ DISPLAY: ':5' }, 'linux', opt), { ok: true, env: {} });
    x.close();
    const silentX = await listen(path.join(dir, 'X6'), false);  // accepts, never answers
    const wl = await listen(path.join(dir, 'wl-0'), true);
    const both = { DISPLAY: ':6', WAYLAND_DISPLAY: 'wl-0', XDG_RUNTIME_DIR: dir };
    const plan = await displayPlan(both, 'linux', opt);
    assert.deepEqual(plan.env, { XDG_SESSION_TYPE: 'wayland' });
    assert.match(plan.note, /no X server answers on DISPLAY=:6/);
    wl.close();
    const none = await displayPlan(both, 'linux', opt);
    assert.equal(none.ok, false);
    assert.match(none.reason, /no display answers on DISPLAY=:6 or WAYLAND_DISPLAY=wl-0/);
    silentX.close();
    const tcp = await listen({ host: '127.0.0.1', port: 0 }, true);
    assert.equal((await displayPlan({ DISPLAY: `127.0.0.1:${tcp.address().port - 6000}` }, 'linux', opt)).ok, true);
    tcp.close();
    assert.match((await displayPlan({}, 'linux', opt)).reason, /no display is set/);
    assert.equal((await displayPlan({}, 'darwin')).ok, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
