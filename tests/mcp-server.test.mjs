// The launcher starts each browser server in its own download folder, with the desktop
// user-agent, and gives only the library browser the saved login (and only with a proxy set).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAUNCHER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'mcp-server.mjs');

function launch(profile, suffix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-server-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // A stand-in for npx that records where it was started and with which arguments.
  fs.writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\npwd > "$LFL_TEST_OUT"\nfor a in "$@"; do echo "$a"; done >> "$LFL_TEST_OUT"\n', { mode: 0o755 });
  const out = path.join(root, 'out.txt');
  const data = path.join(root, 'data');
  const r = spawnSync(process.execPath, [LAUNCHER, profile], { cwd: root, encoding: 'utf8', env: {
    ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CLAUDE_PLUGIN_DATA: data,
    LFL_PROXY_SUFFIX: suffix, LFL_TEST_OUT: out } });
  assert.equal(r.status, 0, r.stderr);
  const [cwd, ...args] = fs.readFileSync(out, 'utf8').trim().split('\n');
  return { cwd, args, downloads: fs.realpathSync(path.join(data, 'downloads', profile)) };
}

test('each browser server runs in its own download folder, so a short file name lands there',
  { skip: process.platform === 'win32' && 'the stand-in npx is a shell script' }, () => {
    for (const profile of ['browse', 'library']) {
      const l = launch(profile, 'proxy.example.edu');
      assert.equal(fs.realpathSync(l.cwd), l.downloads, profile);
    }
  });

test('both browsers send the desktop user-agent; only the library browser loads the saved login, and only with a proxy',
  { skip: process.platform === 'win32' && 'the stand-in npx is a shell script' }, () => {
    const ua = (a) => a[a.indexOf('--user-agent') + 1];
    const browse = launch('browse', 'proxy.example.edu');
    assert.match(ua(browse.args), /Chrome\/\d+\.0\.0\.0 Safari/);
    assert.doesNotMatch(ua(browse.args), /Headless/);
    assert.equal(browse.args.includes('--storage-state'), false);
    assert.equal(launch('library', 'proxy.example.edu').args.includes('--storage-state'), true);
    assert.equal(launch('library', '').args.includes('--storage-state'), false);
  });
