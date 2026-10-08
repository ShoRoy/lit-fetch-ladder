// End-to-end tests for guard/guard.mjs: each case pipes a hook event into the
// guard exactly as Claude Code does and checks the decision it returns.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, deproxify, pageState, siteOf } from '../guard/guard.mjs';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'guard', 'guard.mjs');
const P = 'mcp__plugin_lit-fetch-ladder_';
const SUFFIX = 'proxy.test';

function sandbox({ session = true, batch = true, opts = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lfl-'));
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(data, 'secret'), { recursive: true });
  if (session) fs.writeFileSync(path.join(data, 'secret', 'library-state.json'), '{"cookies":[],"origins":[]}');
  const manifest = path.join(root, 'runs', 'b1', 'manifest.json');
  if (batch) {
    writeManifest(manifest, ['a', 'b']);
    fs.writeFileSync(path.join(data, 'active.json'), JSON.stringify({ manifest }));
  }
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_DATA: data,
    CLAUDE_PROJECT_DIR: root,
    CLAUDE_PLUGIN_OPTION_PROXY_MODE: 'ezproxy-host',
    CLAUDE_PLUGIN_OPTION_PROXY_SUFFIX: SUFFIX,
    CLAUDE_PLUGIN_OPTION_PAGES_PER_PAPER: '2',
    ...Object.fromEntries(Object.entries(opts).map(([k, v]) => [`CLAUDE_PLUGIN_OPTION_${k.toUpperCase()}`, String(v)])),
  };
  return { root, data, manifest, env };
}

function writeManifest(file, ids, name = 'b1') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const hosts = ['www-examplepub-com', 'pubs-journal-org', 'pubs-society-org'];
  const items = ids.map((id, i) => ({
    doi: `10.1/${id}`, state: 'NEEDS_AUTH',
    auth_url: `https://${hosts[i % hosts.length]}.${SUFFIX}/doi/10.1/${id}`,
  }));
  fs.writeFileSync(file, JSON.stringify({ batch: name, items }));
}

function run(sb, ev, raw) {
  const r = spawnSync('node', [GUARD], { input: raw ?? JSON.stringify(ev), env: sb.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  if (!r.stdout.trim()) return { decision: 'none' };
  const o = JSON.parse(r.stdout);
  if (o.systemMessage) return { decision: 'message', reason: o.systemMessage };
  return { decision: o.hookSpecificOutput.permissionDecision, reason: o.hookSpecificOutput.permissionDecisionReason };
}

const pre = (tool, input = {}) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
const post = (tool, input = {}, response = '') => ({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_response: response });
const libNav = (url) => pre(`${P}library__browser_navigate`, { url });
const libUrl = (host, p = '/x') => `https://${host}.${SUFFIX}${p}`;

// Approve the active batch: first navigation asks, then the call "runs" (PostToolUse).
function approve(sb, response = '') {
  const url = libUrl('www-examplepub-com', '/doi/10.1/a');
  const r = run(sb, libNav(url));
  assert.equal(r.decision, 'ask');
  assert.match(r.reason, /approve library batch/);
  run(sb, post(`${P}library__browser_navigate`, { url }, response));
}

// ---------------------------------------------------------------- browser policy (both servers)

test('code execution, storage and raw-network tools are denied', () => {
  const sb = sandbox();
  for (const t of ['evaluate', 'run_code_unsafe', 'cookie_get', 'cookie_set', 'localstorage_get',
    'sessionstorage_clear', 'storage_state', 'set_storage_state', 'route', 'unroute', 'network_request', 'file_upload']) {
    for (const s of ['browse', 'library']) {
      assert.equal(run(sb, pre(`${P}${s}__browser_${t}`)).decision, 'deny', `${s}/${t}`);
    }
  }
});

test('interaction tools ask; unknown tools ask', () => {
  const sb = sandbox();
  for (const t of ['click', 'type', 'fill_form', 'press_key', 'handle_dialog']) {
    assert.equal(run(sb, pre(`${P}browse__browser_${t}`)).decision, 'ask', t);
  }
  assert.equal(run(sb, pre(`${P}browse__browser_brand_new_tool`)).decision, 'ask');
});

test('read-only tools pass silently, including the plural network_requests', () => {
  const sb = sandbox();
  for (const t of ['snapshot', 'take_screenshot', 'wait_for', 'network_requests', 'console_messages', 'close']) {
    assert.equal(run(sb, pre(`${P}browse__browser_${t}`)).decision, 'allow', t);
  }
});

test('only http(s) can be opened, on either server and in a new tab', () => {
  const sb = sandbox();
  assert.equal(run(sb, pre(`${P}browse__browser_navigate`, { url: 'https://arxiv.org/abs/1' })).decision, 'allow');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'not a url']) {
    assert.equal(run(sb, pre(`${P}browse__browser_navigate`, { url })).decision, 'deny', url);
    assert.equal(run(sb, pre(`${P}browse__browser_tabs`, { action: 'new', url })).decision, 'deny', `tab ${url}`);
  }
});

test('tools of other MCP servers are ignored', () => {
  const sb = sandbox();
  assert.equal(run(sb, pre('mcp__playwright__browser_evaluate')).decision, 'none');
});

// ---------------------------------------------------------------- library browser: preconditions

test('library navigation without a saved login is denied with a pointer to /login', () => {
  const sb = sandbox({ session: false });
  const r = run(sb, libNav(libUrl('www-examplepub-com')));
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /lit-fetch-ladder:login/);
});

test('library navigation without a staged batch is denied', () => {
  const sb = sandbox({ batch: false });
  const r = run(sb, libNav(libUrl('www-examplepub-com')));
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /no staged batch/);
});

test('library navigation with no proxy_suffix configured is denied', () => {
  const sb = sandbox({ opts: { proxy_suffix: '' } });
  sb.env.CLAUDE_PLUGIN_OPTION_PROXY_SUFFIX = '';
  assert.equal(run(sb, libNav(libUrl('www-examplepub-com'))).decision, 'deny');
});

// ---------------------------------------------------------------- library browser: batch approval

test('first page load of a batch asks once; afterwards batch sites pass', () => {
  const sb = sandbox();
  approve(sb);
  assert.equal(run(sb, libNav(libUrl('pubs-journal-org', '/doi/10.1/b'))).decision, 'allow');
});

test('a rejected approval leaves the batch unapproved', () => {
  const sb = sandbox();
  assert.equal(run(sb, libNav(libUrl('www-examplepub-com'))).decision, 'ask');
  // no PostToolUse: the user said no, so the call never ran
  assert.equal(run(sb, libNav(libUrl('www-examplepub-com'))).decision, 'ask');
});

test('a batch that grows after approval asks again, naming the growth', () => {
  const sb = sandbox();
  approve(sb);
  writeManifest(sb.manifest, ['a', 'b', 'c', 'd', 'e']);
  const r = run(sb, libNav(libUrl('www-examplepub-com')));
  assert.equal(r.decision, 'ask');
  assert.match(r.reason, /grow from 2 to 5 papers \(3 new: 10\.1\/c, 10\.1\/d, 10\.1\/e\)/);
  assert.match(r.reason, /New sites: society\.org\. Already approved: examplepub\.com, journal\.org/);
});

test('a site outside the batch asks; a sign-in link to an outside site asks', () => {
  const sb = sandbox({ opts: { pages_per_paper: 8 } });
  approve(sb);
  assert.equal(run(sb, libNav(libUrl('www-attacker-example', '/bulk'))).decision, 'ask');
  assert.equal(run(sb, libNav(`https://login.${SUFFIX}/login?url=https://www.examplepub.com/doi/10.1/a`)).decision, 'allow');
  assert.equal(run(sb, libNav(`https://login.${SUFFIX}/login?url=https://evil.example/x`)).decision, 'ask');
  assert.equal(run(sb, libNav('https://www.examplepub.com/not-proxied')).decision, 'allow');  // approved site, no login cookies go there
  assert.match(run(sb, libNav('https://www.unapproved.example/x')).reason, /needs a new site: unapproved\.example \(outside the library proxy\)/);
});

test('a lookalike proxy suffix is not treated as the proxy (label boundary)', () => {
  const sb = sandbox();
  approve(sb);
  assert.equal(run(sb, libNav(`https://www-examplepub-com.evil${SUFFIX}/x`)).decision, 'ask');
});

test('a site a redirect lands on is not trusted: navigating there asks, naming the redirect', () => {
  const sb = sandbox({ opts: { pages_per_paper: 8 } });
  approve(sb);
  const url = libUrl('www-examplepub-com', '/doi/10.1/a');
  run(sb, post(`${P}library__browser_navigate`, { url },
    [{ type: 'text', text: `### Page\n- Page URL: https://www-articles-example-net.${SUFFIX}/articles/x\n` }]));
  const target = libUrl('www-articles-example-net', '/articles/x');
  const r = run(sb, libNav(target));
  assert.equal(r.decision, 'ask');
  assert.match(r.reason, /needs a new site: example\.net \(a page from examplepub\.com redirected the browser there\)/);
  // the user says yes: the call runs, and the site joins the batch
  run(sb, post(`${P}library__browser_navigate`, { url: target }));
  assert.equal(run(sb, libNav(libUrl('pdf-articles-example-net', '/x.pdf'))).decision, 'allow');
});

test('the approval prompt lists every site with its paper count', () => {
  const sb = sandbox();
  writeManifest(sb.manifest, ['a', 'b', 'c', 'd']);  // sites cycle: examplepub, journal, society, examplepub
  const r = run(sb, libNav(libUrl('www-examplepub-com', '/doi/10.1/a')));
  assert.equal(r.decision, 'ask');
  assert.match(r.reason, /4 paper\(s\), up to 8 page loads/);
  assert.match(r.reason, /examplepub\.com \(2 papers\), journal\.org \(1 paper\), society\.org \(1 paper\)/);
});

test('a rejected site stays unapproved; an approved site stays approved', () => {
  const sb = sandbox({ opts: { pages_per_paper: 8 } });
  approve(sb);
  const other = libUrl('www-other-example', '/x');
  assert.equal(run(sb, libNav(other)).decision, 'ask');          // user says no: nothing runs
  assert.equal(run(sb, libNav(other)).decision, 'ask');          // still asks
  run(sb, post(`${P}library__browser_navigate`, { url: other }));  // this time yes
  assert.equal(run(sb, libNav(libUrl('cdn-other-example', '/y'))).decision, 'allow');
});

test('a site is a registrable domain, except on shared hosting', () => {
  assert.equal(siteOf('www.journal.example.com'), 'example.com');
  assert.equal(siteOf('pdf.journal.example.com'), 'example.com');
  assert.equal(siteOf('www.press.ox.ac.uk'), 'ox.ac.uk');
  assert.equal(siteOf('d111.cloudfront.net'), 'd111.cloudfront.net');
  assert.notEqual(siteOf('d111.cloudfront.net'), siteOf('d222.cloudfront.net'));
  assert.equal(siteOf('bucket.s3.amazonaws.com'), 'bucket.s3.amazonaws.com');
  assert.equal(siteOf('10.0.0.5'), '10.0.0.5');
});

// ---------------------------------------------------------------- library browser: budget and caps

test('the per-paper budget stops page loads beyond what the batch needs', () => {
  const sb = sandbox();  // 2 papers x 2 pages = 4 loads
  approve(sb);         // load 1
  const u = libUrl('www-examplepub-com');
  assert.equal(run(sb, libNav(u)).decision, 'allow');  // 2
  assert.equal(run(sb, libNav(u)).decision, 'allow');  // 3
  assert.equal(run(sb, libNav(u)).decision, 'allow');  // 4
  const r = run(sb, libNav(u));
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /batch budget spent/);
});

test('a new tab opened at a URL counts like a navigation', () => {
  const sb = sandbox();
  approve(sb);
  const tab = (url) => pre(`${P}library__browser_tabs`, { action: 'new', url });
  const u = libUrl('www-examplepub-com');
  run(sb, tab(u)); run(sb, tab(u)); run(sb, tab(u));
  assert.equal(run(sb, tab(u)).decision, 'deny');
  assert.equal(run(sb, pre(`${P}library__browser_tabs`, { action: 'list' })).decision, 'allow');
});

test('burst cap stops a run, and user settings cannot raise it above 20', () => {
  const small = sandbox({ opts: { cap_burst: 3, pages_per_paper: 8 } });
  approve(small);
  const u = libUrl('www-examplepub-com');
  run(small, libNav(u)); run(small, libNav(u));
  assert.match(run(small, libNav(u)).reason, /burst cap reached \(3/);

  const big = sandbox({ opts: { cap_burst: 999, pages_per_paper: 8 } });
  writeManifest(big.manifest, ['a', 'b', 'c']);  // budget 24 > 20, so the burst cap binds first
  approve(big);
  for (let i = 0; i < 19; i++) assert.equal(run(big, libNav(u)).decision, 'allow', `load ${i + 2}`);
  assert.match(run(big, libNav(u)).reason, /burst cap reached \(20/);
});

// ---------------------------------------------------------------- interactions in the logged-in browser

// A Playwright MCP result as PostToolUse receives it: the page address, and the tab list when
// more than one tab is open (the format 0.0.78 returns).
function mcpPage(url, otherTabs = []) {
  const tabs = otherTabs.length
    ? ['### Open tabs', `- 0: (current) [T](${url})`, ...otherTabs.map((u, i) => `- ${i + 1}: [T](${u})`)] : [];
  return [{ type: 'text', text: [...tabs, '### Page', `- Page URL: ${url}`].join('\n') }];
}
const libClick = (target) => pre(`${P}library__browser_click`, { target, element: 'link' });
const libClickDone = (target, response) => post(`${P}library__browser_click`, { target, element: 'link' }, response);

test('pageState reads the address and the tab count from a Playwright MCP 0.0.78 result', () => {
  const one = '### Ran Playwright code\n```js\nawait page.click()\n```\n### Page\n- Page URL: https://a.example/x#sec\n- Page Title: A\n### Snapshot\n';
  assert.deepEqual(pageState([{ type: 'text', text: one }]), { url: 'https://a.example/x#sec', tabs: 1 });
  const two = '### Open tabs\n- 0: (current) [A](https://a.example/x)\n- 1: [C](https://a.example/c)\n### Page\n- Page URL: https://a.example/x\n';
  assert.deepEqual(pageState({ content: [{ type: 'text', text: two }] }), { url: 'https://a.example/x', tabs: 2 });
  const list = '### Result\n- 0: [A](https://a.example/x)\n- 1: (current) [C](https://a.example/c)\n';
  assert.deepEqual(pageState(list), { url: 'https://a.example/c', tabs: 2 });
  assert.deepEqual(pageState([{ type: 'text', text: 'Error: timed out' }]), { url: null, tabs: 0 });
});

test('a click in the logged-in browser needs an approved batch; in the plain browser it only asks', () => {
  const sb = sandbox();
  const r = run(sb, libClick('e1'));
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /no batch is approved/);
  assert.equal(run(sb, pre(`${P}browse__browser_click`, { target: 'e1' })).decision, 'ask');
  approve(sb);
  const asked = run(sb, libClick('e1'));
  assert.equal(asked.decision, 'ask');
  assert.match(asked.reason, /counts as one of the batch's page loads/);
});

test('a click that opens a page counts as a page load; one that does not is refunded', () => {
  const sb = sandbox();  // 2 papers x 2 pages = 4 loads
  const a = libUrl('www-examplepub-com', '/doi/10.1/a');
  approve(sb, mcpPage(a));                                  // load 1; the browser is on a
  assert.equal(run(sb, libClick('e1')).decision, 'ask');   // reserves load 2
  run(sb, libClickDone('e1', mcpPage(`${a}#refs`)));       // same page (a fragment): refunded
  assert.equal(run(sb, libClick('e2')).decision, 'ask');   // reserves load 2 again
  run(sb, libClickDone('e2', mcpPage(libUrl('www-examplepub-com', '/doi/epdf/10.1/a'))));  // a new page: it stands
  const u = libUrl('www-examplepub-com');
  assert.equal(run(sb, libNav(u)).decision, 'allow');      // 3
  assert.equal(run(sb, libNav(u)).decision, 'allow');      // 4
  assert.match(run(sb, libNav(u)).reason, /batch budget spent/);
});

test('a click that opens a new tab counts, and a click is denied once the budget is spent', () => {
  const sb = sandbox();  // 4 loads
  const a = libUrl('www-examplepub-com', '/doi/10.1/a');
  approve(sb, mcpPage(a));                                  // 1
  run(sb, libClick('e1'));                                  // 2 reserved
  run(sb, libClickDone('e1', mcpPage(a, [libUrl('www-examplepub-com', '/doi/pdf/10.1/a')])));  // same page, a new tab: it stands
  const u = libUrl('www-examplepub-com');
  assert.equal(run(sb, libNav(u)).decision, 'allow');      // 3
  assert.equal(run(sb, libNav(u)).decision, 'allow');      // 4
  const r = run(sb, libClick('e2'));
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /batch budget spent.*so it counts/);
});

test('a click whose result does not say where the browser is keeps its page load', () => {
  const sb = sandbox();
  const a = libUrl('www-examplepub-com', '/doi/10.1/a');
  approve(sb, mcpPage(a));                                  // 1
  run(sb, libClick('e1'));                                  // 2
  run(sb, libClickDone('e1', [{ type: 'text', text: 'Error: timed out' }]));  // unknown: it stands
  const u = libUrl('www-examplepub-com');
  run(sb, libNav(u)); run(sb, libNav(u));                   // 3, 4
  assert.match(run(sb, libNav(u)).reason, /batch budget spent/);
});

test('daily cap stops page loads, and settings cannot raise any cap above its ceiling', () => {
  const sb = sandbox({ opts: { cap_daily: 3, pages_per_paper: 8 } });
  approve(sb);                                              // 1
  const u = libUrl('www-examplepub-com');
  run(sb, libNav(u)); run(sb, libNav(u));                   // 2, 3
  assert.match(run(sb, libNav(u)).reason, /daily cap reached \(3/);
  const keys = ['CAP_BURST', 'CAP_DAILY', 'PAGES_PER_PAPER'].map((k) => `CLAUDE_PLUGIN_OPTION_${k}`);
  const saved = keys.map((k) => process.env[k]);
  try {
    for (const k of keys) process.env[k] = '999';
    const c = config();
    assert.deepEqual([c.burst, c.daily, c.perPaper], [20, 60, 8]);
  } finally {
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  }
});

test('an empty proxy setting means an entitled network; a pasted link is reduced to the proxy', () => {
  const keys = ['CLAUDE_PLUGIN_OPTION_PROXY_SUFFIX', 'CLAUDE_PLUGIN_OPTION_PROXY_MODE'];
  const saved = keys.map((k) => process.env[k]);
  try {
    delete process.env.CLAUDE_PLUGIN_OPTION_PROXY_MODE;
    process.env.CLAUDE_PLUGIN_OPTION_PROXY_SUFFIX = '';
    assert.equal(config().mode, 'none');
    process.env.CLAUDE_PLUGIN_OPTION_PROXY_SUFFIX = `https://www-sciencedirect-com.${SUFFIX}/science/article/pii/S1`;
    assert.deepEqual([config().mode, config().suffix], ['ezproxy-host', SUFFIX]);
  } finally {
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  }
});

test('unreadable guard state fails closed', () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.data, 'state'), { recursive: true });
  fs.writeFileSync(path.join(sb.data, 'state', 'lfl-guard-state.json'), '{not json');
  const r = run(sb, libNav(libUrl('www-examplepub-com')));
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /failing closed/);
});

test('malformed hook input fails closed', () => {
  const sb = sandbox();
  assert.equal(run(sb, null, '{oops').decision, 'deny');
});

// ---------------------------------------------------------------- file and shell tools

test('the saved login and guard state cannot be read, searched or touched by shell', () => {
  const sb = sandbox();
  const secret = path.join(sb.data, 'secret', 'library-state.json');
  assert.equal(run(sb, pre('Read', { file_path: secret })).decision, 'deny');
  assert.equal(run(sb, pre('Edit', { file_path: secret })).decision, 'deny');
  assert.equal(run(sb, pre('Grep', { pattern: 'x', path: sb.data })).decision, 'deny');
  assert.equal(run(sb, pre('Glob', { pattern: '**', path: sb.root })).decision, 'deny');
  assert.equal(run(sb, pre('Bash', { command: `cat ${secret}` })).decision, 'deny');
  assert.equal(run(sb, pre('Bash', { command: 'python3 -c "print(open(\'x/library-state.json\').read())"' })).decision, 'deny');
  assert.equal(run(sb, pre('Monitor', { command: `tail -f ${sb.data}/state/lfl-guard-state.json` })).decision, 'deny');
});

test('a symlink pointing at the saved login is resolved and denied', () => {
  const sb = sandbox();
  const link = path.join(sb.root, 'innocent.json');
  fs.symlinkSync(path.join(sb.data, 'secret', 'library-state.json'), link);
  assert.equal(run(sb, pre('Read', { file_path: link })).decision, 'deny');
});

test('ordinary file and shell use is untouched', () => {
  const sb = sandbox();
  assert.equal(run(sb, pre('Read', { file_path: path.join(sb.root, 'runs', 'b1', 'manifest.json') })).decision, 'none');
  assert.equal(run(sb, pre('Bash', { command: 'ls -la && git status' })).decision, 'none');
  assert.equal(run(sb, pre('Read', { file_path: path.join(sb.data, 'downloads', 'paper.pdf') })).decision, 'none');
});

// ---------------------------------------------------------------- mode none and session start

test('proxy_mode none: no saved login needed, batch sites are matched directly', () => {
  const sb = sandbox({ session: false, opts: { proxy_mode: 'none', proxy_suffix: '', pages_per_paper: 5 } });
  writeManifest(sb.manifest, ['a']);
  const items = JSON.parse(fs.readFileSync(sb.manifest)).items.map((r) => ({ ...r, auth_url: 'https://www.examplepub.com/doi/10.1/a' }));
  fs.writeFileSync(sb.manifest, JSON.stringify({ batch: 'b1', items }));
  const nav = (url) => pre(`${P}library__browser_navigate`, { url });
  assert.equal(run(sb, nav('https://www.examplepub.com/doi/10.1/a')).decision, 'ask');  // approval
  run(sb, post(`${P}library__browser_navigate`, { url: 'https://www.examplepub.com/doi/10.1/a' }));
  assert.equal(run(sb, nav('https://www.examplepub.com/doi/10.1/a/pdf')).decision, 'allow');
  assert.equal(run(sb, nav('https://elsewhere.example/x')).decision, 'ask');
});

test('session start is quiet when configured and speaks up when not', () => {
  const ok = sandbox();
  assert.equal(run(ok, { hook_event_name: 'SessionStart' }).decision, 'none');
  const bad = sandbox();
  bad.env.CLAUDE_PLUGIN_OPTION_PROXY_SUFFIX = '';
  const r = run(bad, { hook_event_name: 'SessionStart' });
  assert.equal(r.decision, 'message');
  assert.match(r.reason, /proxy_suffix is empty/);
});

test('EZproxy host decoding: a hyphen in the original host is written as "--"', () => {
  assert.equal(deproxify(`www-example--pub-com.${SUFFIX}`, SUFFIX), 'www.example-pub.com');
  assert.equal(deproxify(`pubs-journal-org.${SUFFIX}`, SUFFIX), 'pubs.journal.org');
  assert.equal(deproxify(SUFFIX, SUFFIX), null);
  assert.equal(deproxify(`x.evil${SUFFIX}`, SUFFIX), null);
});

test('the data dir spelled another way is still protected; a legitimate mark command is not', () => {
  const sb = sandbox();
  const dd = '~/.claude/plugins/data/lit-fetch-ladder-fetch-ladder';
  assert.equal(run(sb, pre('Bash', { command: `cat ${dd}/secret/x.json` })).decision, 'deny');
  assert.equal(run(sb, pre('Bash', { command: `ls $HOME/.claude/plugins/data/lit-fetch-ladder-fetch-ladder/state` })).decision, 'deny');
  const mark = `python3 cli/lfl.py mark 10.1/a --batch b1 --state PROXY_FETCHED --path ${dd}/downloads/library/a.pdf`;
  assert.equal(run(sb, pre('Bash', { command: mark })).decision, 'none');
});

test('the agent cannot run the library sign-in itself', () => {
  const sb = sandbox();
  const r = run(sb, pre('Bash', { command: 'node /x/lit-fetch-ladder/scripts/login.mjs --data d --login-url u --proxy-suffix s' }));
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /run by the user/);
});

test('proxied addresses cannot be fetched outside the library browser', () => {
  const sb = sandbox();
  const u = `https://pdf-assets-example-com.${SUFFIX}/token/abc123/paper.pdf`;
  assert.equal(run(sb, pre('Bash', { command: `curl -L -o p.pdf "${u}"` })).decision, 'deny');
  assert.equal(run(sb, pre('WebFetch', { url: u, prompt: 'x' })).decision, 'deny');
  assert.equal(run(sb, pre('WebFetch', { url: 'https://arxiv.org/abs/1', prompt: 'x' })).decision, 'none');
  assert.equal(run(sb, pre('Bash', { command: 'curl -sL https://api.openalex.org/works?search=x' })).decision, 'none');
});

test('every command the skills tell the agent to run passes the guard', () => {
  const sb = sandbox();
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const values = {
    CLAUDE_PLUGIN_ROOT: '/home/u/.claude/plugins/cache/fetch-ladder/lit-fetch-ladder/0.1.0',
    CLAUDE_PLUGIN_DATA: '/home/u/.claude/plugins/data/lit-fetch-ladder-fetch-ladder',
    'user_config.contact_email': 'me@example.org',
    // A pasted sign-in link as the proxy setting. No command the agent runs may carry it: the
    // guard would refuse the command, since it names a proxied address.
    'user_config.proxy_suffix': `https://login.${SUFFIX}/login?url=https://www.example.com/`,
  };
  for (const skill of ['fetch', 'doctor', 'sites']) {
    const md = fs.readFileSync(path.join(root, 'skills', skill, 'SKILL.md'), 'utf8');
    const blocks = [...md.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].replace(/\\\n\s*/g, ' ').trim());
    assert.ok(blocks.length > 0, skill);
    for (let cmd of blocks) {
      if (!/^(python3|node) /.test(cmd)) continue;
      cmd = cmd.replace(/\$\{([^}]+)\}/g, (_, k) => values[k] ?? `<${k}>`).replace(/<[^>]+>/g, 'X');
      assert.equal(run(sb, pre('Bash', { command: cmd })).decision, 'none', `${skill}: ${cmd}`);
    }
  }
});

// ---------------------------------------------------------------- remembered companion sites

const SITES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'sites.mjs');
const sitesCmd = (sb, ...args) => spawnSync('node', [SITES, ...args, '--data', sb.data], { encoding: 'utf8' }).stdout;

// Batch b1: the first paper's link site redirects to content.example; the user approves it.
function approveRedirectCompanion(sb) {
  approve(sb);
  const first = libUrl('www-examplepub-com', '/doi/10.1/a');
  run(sb, post(`${P}library__browser_navigate`, { url: first },
    [{ type: 'text', text: `- Page URL: https://www-content-example.${SUFFIX}/article/a` }]));
  const target = libUrl('www-content-example', '/article/a/pdf');
  const r = run(sb, libNav(target));
  assert.equal(r.decision, 'ask');
  assert.match(r.reason, /remembered and allowed in future batches that include examplepub\.com/);
  run(sb, post(`${P}library__browser_navigate`, { url: target }));
}

test('an approved redirect site is remembered: the next batch from that publisher lists it and does not ask', () => {
  const sb = sandbox({ opts: { pages_per_paper: 8 } });
  approveRedirectCompanion(sb);
  writeManifest(sb.manifest, ['p', 'q'], 'b2');  // a new batch, again starting at examplepub.com
  const first = libUrl('www-examplepub-com', '/doi/10.1/p');
  const r = run(sb, libNav(first));
  assert.equal(r.decision, 'ask');
  assert.match(r.reason, /Also allowed, from your earlier approvals: content\.example \(follows examplepub\.com\)/);
  run(sb, post(`${P}library__browser_navigate`, { url: first }));
  assert.equal(run(sb, libNav(libUrl('www-content-example', '/article/p'))).decision, 'allow');
});

test('a remembered companion does not apply to a batch without the site it follows', () => {
  const sb = sandbox({ opts: { pages_per_paper: 8 } });
  approveRedirectCompanion(sb);
  const items = [{ doi: '10.1/z', state: 'NEEDS_AUTH', auth_url: libUrl('pubs-society-org', '/doi/10.1/z') }];
  fs.writeFileSync(sb.manifest, JSON.stringify({ batch: 'b3', items }));
  const r = run(sb, libNav(items[0].auth_url));
  assert.doesNotMatch(r.reason, /Also allowed/);
  run(sb, post(`${P}library__browser_navigate`, { url: items[0].auth_url }));
  assert.equal(run(sb, libNav(libUrl('www-content-example', '/article/z'))).decision, 'ask');
});

test('companions chain: a PDF site approved from the content site follows it into later batches', () => {
  const sb = sandbox({ opts: { pages_per_paper: 8 } });
  approveRedirectCompanion(sb);  // the browser is now on content.example
  const pdf = libUrl('cdn-assets-example', '/a.pdf');
  assert.match(run(sb, libNav(pdf)).reason, /allowed in future batches that include content\.example/);
  run(sb, post(`${P}library__browser_navigate`, { url: pdf }));
  writeManifest(sb.manifest, ['p'], 'b2');
  const r = run(sb, libNav(libUrl('www-examplepub-com', '/doi/10.1/p')));
  assert.match(r.reason, /content\.example \(follows examplepub\.com\), assets\.example \(follows content\.example\)/);
});

test('the sites skill lists and forgets companions, and a forgotten one asks again', () => {
  const sb = sandbox({ opts: { pages_per_paper: 8 } });
  approveRedirectCompanion(sb);
  assert.match(sitesCmd(sb, 'list'), /content\.example\s+follows examplepub\.com/);
  assert.match(sitesCmd(sb, 'forget', 'content.example'), /Forgot 1/);
  assert.match(sitesCmd(sb, 'list'), /No remembered companion sites/);
  writeManifest(sb.manifest, ['p'], 'b2');
  assert.doesNotMatch(run(sb, libNav(libUrl('www-examplepub-com', '/doi/10.1/p'))).reason, /Also allowed/);
});
