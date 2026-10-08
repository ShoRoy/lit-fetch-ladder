// The sign-in keeps only the library proxy's cookies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeState, hasDisplay } from '../scripts/login.mjs';

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
