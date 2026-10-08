// The browsers' identity, the proxy setting as people paste it, the sign-in page, and how the
// scripts read the plugin's settings.   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHROME_MAJOR, desktopUserAgent, pluginOptions, proxySuffix, signInUrl } from '../scripts/common.mjs';
import { proxySuffix as guardProxySuffix } from '../guard/guard.mjs';

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
