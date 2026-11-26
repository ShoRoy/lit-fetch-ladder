// The browsers' identity, the proxy setting as people paste it, the sign-in page, and how the
// scripts read the plugin's settings.   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BROWSER_DEPS, CHROME_MAJOR, CHROMIUM_REVISION, SESSION_FILE, browserStartProblem, childPath, defaultDataDir, desktopUserAgent, pluginOptions, proxySuffix, signInUrl } from '../scripts/common.mjs';
import { proxySuffix as guardProxySuffix } from '../guard/guard.mjs';

test('a script run by hand finds the plugin data directory: the environment, else the one Claude Code keeps', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-home-'));
  const noManifest = path.join(home, 'elsewhere');  // a plugin root without a marketplace manifest
  assert.equal(defaultDataDir({}, home), '');  // nothing installed yet
  const root = path.join(home, '.claude', 'plugins', 'data');
  fs.mkdirSync(path.join(root, 'lit-fetch-ladder-fetch-ladder'), { recursive: true });
  assert.equal(defaultDataDir({}, home), path.join(root, 'lit-fetch-ladder-fetch-ladder'));  // named after this plugin's marketplace
  assert.equal(defaultDataDir({}, home, noManifest), path.join(root, 'lit-fetch-ladder-fetch-ladder'));  // the one candidate
  assert.equal(defaultDataDir({ CLAUDE_PLUGIN_DATA: '/given' }, home), '/given');
  fs.mkdirSync(path.join(root, 'lit-fetch-ladder-other'));
  assert.equal(defaultDataDir({}, home), path.join(root, 'lit-fetch-ladder-fetch-ladder'));  // the manifest decides
  assert.equal(defaultDataDir({}, home, noManifest), '');  // two candidates and no manifest: do not guess
  fs.rmSync(home, { recursive: true, force: true });
});

test('the browsers identify as desktop Chrome of the bundled version, without "Headless"', () => {
  for (const p of ['linux', 'darwin', 'win32']) {
    const ua = desktopUserAgent(p);
    assert.match(ua, new RegExp(`Chrome/${CHROME_MAJOR}\\.0\\.0\\.0 Safari/537\\.36$`), p);
    assert.doesNotMatch(ua, /Headless/i, p);
  }
  assert.match(desktopUserAgent('darwin'), /Macintosh/);
  assert.match(desktopUserAgent('win32'), /Windows NT/);
});

test('the proxy setting is understood however it is pasted, the same way in the guard', () => {
  const cases = {
    'proxy.lib.example.edu': 'proxy.lib.example.edu',
    'https://login.proxy.lib.example.edu/login?qurl=%u': 'proxy.lib.example.edu',
    'login.proxy.lib.example.edu/login?url=https://www.example.com/': 'proxy.lib.example.edu',
    'https://www-sciencedirect-com.proxy.lib.example.edu/science/article/pii/S1': 'proxy.lib.example.edu',
    'onlinelibrary-wiley-com.proxy.lib.example.edu/doi/10.1/x': 'proxy.lib.example.edu',
    'www-example--pub-com.proxy.lib.example.edu': 'proxy.lib.example.edu',
    'ezproxy-prd.bodleian.ox.ac.uk': 'ezproxy-prd.bodleian.ox.ac.uk',
    'https://www-jstor-org.ezproxy-prd.bodleian.ox.ac.uk/stable/1': 'ezproxy-prd.bodleian.ox.ac.uk',
    'HTTPS://Proxy.Lib.Example.EDU:443/': 'proxy.lib.example.edu',
    '.proxy.test.': 'proxy.test',
    '  ': '',
    '': '',
  };
  for (const [raw, want] of Object.entries(cases)) {
    assert.equal(proxySuffix(raw), want, raw);
    assert.equal(guardProxySuffix(raw), want, `guard: ${raw}`);
  }
});

test("the sign-in page is the proxy's login page: login.<proxy> first, then the proxy itself", async () => {
  const answers = (names) => async (h) => { if (!names.includes(h)) throw new Error('ENOTFOUND'); };
  assert.equal(await signInUrl('proxy.example.edu', answers(['login.proxy.example.edu', 'proxy.example.edu'])), 'https://login.proxy.example.edu/login');
  assert.equal(await signInUrl('proxy.example.edu', answers(['proxy.example.edu'])), 'https://proxy.example.edu/login');
  assert.equal(await signInUrl('proxy.example.edu', answers([])), null);
});

test("the scripts read the plugin's settings: user, then project, then project-local", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-proj-'));
  const write = (dir, file, options) => {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', file), JSON.stringify({ pluginConfigs: {
      'lit-fetch-ladder@fetch-ladder': { options }, 'other-plugin@x': { options: { proxy_suffix: 'not.this' } } } }));
  };
  assert.deepEqual(pluginOptions(cwd, home), {});
  write(home, 'settings.json', { contact_email: 'me@example.org', proxy_suffix: 'proxy.one.edu' });
  write(cwd, 'settings.local.json', { proxy_suffix: 'proxy.two.edu' });
  assert.deepEqual(pluginOptions(cwd, home), { contact_email: 'me@example.org', proxy_suffix: 'proxy.two.edu' });
});

test('doctor --login says whether a sign-in is needed, without reading the saved login', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-home-'));
  const data = path.join(home, 'data');
  const doctor = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'doctor.mjs');
  const run = (...args) => spawnSync(process.execPath, [doctor, '--login', '--data', data, ...args],
    { cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
  let r = run();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /not needed \(no library proxy set\)/);
  r = run('--proxy-suffix', 'proxy.example.edu');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /NEEDED, none saved/);
  const sess = path.join(data, ...SESSION_FILE);
  fs.mkdirSync(path.dirname(sess), { recursive: true });
  fs.writeFileSync(sess, '{}');
  r = run('--proxy-suffix', 'proxy.example.edu');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /saved 0\.0 h ago/);
  const old = new Date(Date.now() - 13 * 3600000);
  fs.utimesSync(sess, old, old);
  r = run('--proxy-suffix', 'proxy.example.edu');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /NEEDED, saved 13\.0 h ago and probably expired/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('the doctor wants the Chromium build the pinned Playwright MCP needs, not any Chromium', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-home-'));
  const browsers = path.join(home, 'ms-playwright');
  const doctor = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'doctor.mjs');
  const line = () => spawnSync(process.execPath, [doctor, '--data', path.join(home, 'data')],
    { cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home, PLAYWRIGHT_BROWSERS_PATH: browsers }, encoding: 'utf8' })
    .stdout.split('\n').find((l) => l.includes('Chromium for Playwright'));
  fs.mkdirSync(path.join(browsers, 'chromium-1000'), { recursive: true });
  assert.match(line(), /^FIX /);
  fs.mkdirSync(path.join(browsers, `chromium-${CHROMIUM_REVISION}`));
  assert.match(line(), /^ ok /);
  fs.rmSync(home, { recursive: true, force: true });
});

test('a browser that is installed but cannot start (missing system libraries) is found before launch',
  { skip: process.platform !== 'linux' && 'the check runs on Linux' }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-browsers-'));
    const bin = path.join(root, `chromium-${CHROMIUM_REVISION}`, 'chrome-linux64', 'chrome');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '#!/bin/sh\necho "chrome: error while loading shared libraries: libnspr4.so: cannot open shared object file" >&2\nexit 127\n', { mode: 0o755 });
    assert.match(browserStartProblem([root]), /chrome does not start: .*libnspr4\.so/);
    fs.writeFileSync(bin, '#!/bin/sh\necho "Google Chrome for Testing 151.0"\n', { mode: 0o755 });
    assert.equal(browserStartProblem([root]), '');
    assert.equal(browserStartProblem([path.join(root, 'none')]), '');  // not installed is the other check's business
    assert.match(BROWSER_DEPS, /playwright install-deps chromium$/);
    fs.rmSync(root, { recursive: true, force: true });
  });

test("npx's PATH gets the running node's folder at the end, so a node started by its full path finds npx", () => {
  const sep = path.delimiter;
  assert.deepEqual(childPath({ PATH: ['/a', '/b'].join(sep) }, '/opt/node/bin/node'), { key: 'PATH', value: ['/a', '/b', '/opt/node/bin'].join(sep) });
  assert.deepEqual(childPath({ PATH: ['/opt/node/bin', '/a'].join(sep) }, '/opt/node/bin/node'), { key: 'PATH', value: ['/opt/node/bin', '/a'].join(sep) });
  assert.deepEqual(childPath({ Path: 'C:\\x' }, '/n/node'), { key: 'Path', value: ['C:\\x', '/n'].join(sep) });
  assert.deepEqual(childPath({}, '/n/node'), { key: 'PATH', value: '/n' });
});

test('the doctor says when the plugin is installed for every folder (user scope) instead of one', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-home-'));
  const doctor = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'doctor.mjs');
  const out = () => spawnSync(process.execPath, [doctor, '--data', path.join(home, 'data')],
    { cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' }).stdout;
  const installed = (scope) => {
    fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'lit-fetch-ladder@fetch-ladder': [{ scope, version: '0.2.2' }] } }));
  };
  installed('user');
  assert.match(out(), /installed for every folder \(user scope\)/);
  installed('local');
  assert.doesNotMatch(out(), /user scope/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('doctor --preflight names each missing prerequisite with its fix, then the login, before any fetch', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-home-'));
  const browsers = path.join(home, 'browsers');
  const doctor = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'doctor.mjs');
  const run = () => spawnSync(process.execPath, [doctor, '--preflight', '--data', path.join(home, 'data'), '--proxy-suffix', 'proxy.example.edu'],
    { cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home, PLAYWRIGHT_BROWSERS_PATH: browsers }, encoding: 'utf8' });
  let r = run();  // no browser at all
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^MISSING the browser: run npx -y -p @playwright\/mcp@[\d.]+ playwright install chromium/m);
  assert.match(r.stdout, /only open-access copies can be fetched/);
  assert.match(r.stdout, /^library login: NEEDED, none saved/m);
  if (process.platform === 'linux') {  // installed, but it cannot start
    const chrome = path.join(browsers, `chromium-${CHROMIUM_REVISION}`, 'chrome-linux64', 'chrome');
    fs.mkdirSync(path.dirname(chrome), { recursive: true });
    fs.writeFileSync(chrome, '#!/bin/sh\necho "chrome: error while loading shared libraries: libnspr4.so" >&2\nexit 127\n', { mode: 0o755 });
    r = run();
    assert.match(r.stdout, /^MISSING the browser's system libraries \(chrome does not start: .*libnspr4\.so\): run .*install-deps chromium, which needs root once/m);
    fs.writeFileSync(chrome, '#!/bin/sh\necho "Chrome 151"\n', { mode: 0o755 });
    r = run();
    assert.doesNotMatch(r.stdout, /MISSING the browser|only open-access/);
  }
  fs.rmSync(home, { recursive: true, force: true });
});
