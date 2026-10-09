#!/usr/bin/env node
// lit-fetch-ladder guard: the plugin's safeguards, run as one hook script for
// PreToolUse and PostToolUse. No dependencies; Node 18 or later. It registers nothing at
// session start, so a session that never fetches a paper sees nothing from it.
//
// What it enforces:
//   1. Browser tools that run code, touch cookies/storage, read raw network
//      traffic or upload local files are denied on both browser servers.
//   2. Interaction tools (click, type, ...) always ask the user.
//   3. The library (logged-in) browser opens only papers in an approved batch:
//      the first page load of a batch asks the user to approve it, a batch that
//      grows asks again, and a site outside the batch asks.
//   4. Page loads on the library browser are budgeted per approved paper and
//      capped per burst and per 24 hours, including a page that a click, key
//      press or form action opens. Counting happens before the call, so a
//      failure errs toward fewer loads, never more.
//   5. The saved login and the guard's own state are off-limits to the agent's
//      file and shell tools.
// A crash while judging a browser call denies the call (fail closed).

import fs from 'node:fs';
import path from 'node:path';

const PLUGIN = 'lit-fetch-ladder';
const BROWSER_RE = new RegExp(`^mcp__plugin_${PLUGIN}_(browse|library)__browser_(.+)$`);

const DENY_RE = /^(evaluate|run_code.*|route.*|unroute.*|cookie_.*|localstorage_.*|sessionstorage_.*|storage_state|set_storage_state|network_state_set|network_request|file_upload|pdf_save)$/;
const ASK_RE = /^(click|drag|drop|fill_form|handle_dialog|hover|press_key|select_option|type|mouse_.*)$/;
const ALLOW = new Set(['close', 'console_messages', 'find', 'navigate', 'navigate_back',
  'network_requests', 'resize', 'snapshot', 'tabs', 'take_screenshot', 'wait_for']);

// Hard ceilings, and the defaults. The environment may lower these, never raise them.
const MAX_BURST = 20, MAX_DAILY = 60, MAX_PER_PAPER = 8;
const STATE_FILE = 'lfl-guard-state.json';
const IDLE_MS = 15 * 60 * 1000, DAY_MS = 24 * 3600 * 1000, APPROVAL_MS = DAY_MS;

// ---------------------------------------------------------------- config

function opt(key, fallback) {
  const v = process.env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`];
  return v === undefined || v === '' ? fallback : v;
}

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

// The proxy setting as people paste it: the bare ending, the address of a paper opened through
// the library, or the library's sign-in link. Returns the ending the proxy adds to publisher hostnames, or ''.
// Same as proxySuffix in scripts/common.mjs, repeated so the guard stands alone.
const PUBLISHER_TAIL = /-(com|org|net|edu|gov|io|info|int|uk|de|fr|jp|cn|au|ca|nl|ch|it|es|se|eu|in|kr|br|ru|pl)$/;
export function proxySuffix(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('://')) {
    try { s = new URL(s).hostname; } catch { /* not a URL after all; trimmed below */ }
  }
  const labels = s.split(/[/?#]/)[0].split(':')[0].replace(/^\.+|\.+$/g, '').split('.');
  // A pasted paper address starts with the publisher's host written with dashes (www-example-com).
  if (labels.length > 2 && labels[0].includes('-') && PUBLISHER_TAIL.test(labels[0])) labels.shift();
  // A pasted sign-in link starts with login.
  if (labels.length > 2 && labels[0] === 'login') labels.shift();
  return labels.join('.');
}

// The user sets two things: a contact email and the proxy suffix. With no suffix the network
// itself is entitled (campus or VPN), so there is no proxy and no saved login. The page-load
// caps are fixed; the environment can only lower them, which the test suite uses, as it uses
// the proxy_mode override.
export function config() {
  const data = process.env.CLAUDE_PLUGIN_DATA || '';
  const suffix = proxySuffix(opt('proxy_suffix', ''));
  return {
    data,
    mode: String(opt('proxy_mode', suffix ? 'ezproxy-host' : 'none')).trim().toLowerCase(),
    suffix,
    burst: clampInt(opt('cap_burst', MAX_BURST), 1, MAX_BURST, MAX_BURST),
    daily: clampInt(opt('cap_daily', MAX_DAILY), 1, MAX_DAILY, MAX_DAILY),
    perPaper: clampInt(opt('pages_per_paper', 5), 1, MAX_PER_PAPER, 5),
    secretDir: data ? path.join(data, 'secret') : '',
    stateDir: data ? path.join(data, 'state') : '',
    sessionFile: data ? path.join(data, 'secret', 'library-state.json') : '',
  };
}

// ---------------------------------------------------------------- hosts

function hostOf(url) {
  try {
    const u = new URL(url);
    return { scheme: u.protocol.replace(/:$/, ''), host: u.hostname.toLowerCase(), url: u };
  } catch {
    return null;
  }
}

function underSuffix(host, suffix) {
  return !!suffix && (host === suffix || host.endsWith('.' + suffix));
}

// EZproxy hostname form: www-example-com.<suffix> -> www.example.com
// ('-' in the original host is written as '--').
export function deproxify(host, suffix) {
  if (!underSuffix(host, suffix) || host === suffix) return null;
  const label = host.slice(0, host.length - suffix.length - 1);
  return label.replace(/--/g, '\u0000').replace(/-/g, '.').replace(/\u0000/g, '-');
}

function isLoginHost(host, suffix) {
  return host === suffix || host === 'login.' + suffix;
}

// Sites are approved at registrable-domain level ("journal.example" covers
// www.journal.example and pdf.journal.example), so one publisher is one approval.
// Second-level public suffixes, and shared hosting where one domain serves many
// unrelated tenants, keep one more label.
const MULTI_SUFFIX = new Set(['ac.uk', 'co.uk', 'gov.uk', 'org.uk', 'ac.jp', 'co.jp', 'or.jp', 'com.au', 'edu.au',
  'org.au', 'gov.au', 'com.cn', 'edu.cn', 'org.cn', 'ac.in', 'co.in', 'edu.in', 'res.in', 'ac.kr', 'co.kr', 'com.br',
  'edu.br', 'ac.nz', 'co.nz', 'ac.za', 'co.za', 'com.sg', 'edu.sg', 'com.hk', 'edu.hk', 'com.tw', 'edu.tw', 'ac.il', 'co.il']);
const SHARED_HOSTING = new Set(['cloudfront.net', 'amazonaws.com', 'github.io', 'githubusercontent.com',
  'googleusercontent.com', 'appspot.com', 'azureedge.net', 'azurewebsites.net', 'herokuapp.com', 'netlify.app',
  'vercel.app', 'pages.dev', 'workers.dev', 'blogspot.com', 'akamaized.net', 'akamaihd.net', 'fastly.net',
  'b-cdn.net', 'firebaseapp.com', 'web.app', 's3.amazonaws.com', 'blob.core.windows.net']);

export function siteOf(host) {
  host = (host || '').toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host;  // an IP address is its own site
  const labels = host.split('.').filter(Boolean);
  let keep = 2;
  if (MULTI_SUFFIX.has(labels.slice(-2).join('.')) || SHARED_HOSTING.has(labels.slice(-2).join('.'))) keep = 3;
  if (SHARED_HOSTING.has(labels.slice(-3).join('.'))) keep = 4;
  return labels.slice(-Math.min(keep, labels.length)).join('.');
}

// ---------------------------------------------------------------- state

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function withLock(cfg, fn) {
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  const lock = path.join(cfg.stateDir, 'guard.lock');
  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch {
      try {  // break a lock left by a crashed run
        if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.unlinkSync(lock);
      } catch { /* raced with another run; retry */ }
      if (Date.now() > deadline) throw new Error('guard state is locked');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lock); } catch { /* already gone */ }
  }
}

export function loadState(cfg) {
  const file = path.join(cfg.stateDir, STATE_FILE);
  if (!fs.existsSync(file)) return { approvals: [], loads: [], burst: { last: 0, count: 0 } };
  try {
    return readJson(file);
  } catch {  // the caller fails closed; the message says how to recover
    throw new Error(`the guard state is unreadable; delete ${file} to reset the page counts`);
  }
}

export function saveState(cfg, st) {
  writeJsonAtomic(path.join(cfg.stateDir, STATE_FILE), st);
}

// ---------------------------------------------------------------- batch

// The batch driver writes <data>/active.json -> { manifest: <abs path> }. Targets
// are manifest rows the driver staged for the library browser (they carry auth_url).
function activeBatch(cfg) {
  const ptr = path.join(cfg.data, 'active.json');
  if (!fs.existsSync(ptr)) return null;
  const { manifest } = readJson(ptr);
  if (!manifest || !fs.existsSync(manifest)) return null;
  const m = readJson(manifest);
  const rows = (m.items || []).filter((r) => typeof r.auth_url === 'string' && r.auth_url);
  const targets = [...new Set(rows.map((r) => r.doi || r.auth_url))].sort();
  const sites = new Map();  // site -> number of papers
  for (const r of rows) {
    const s = targetSite(cfg, r.auth_url);
    if (s) sites.set(s, (sites.get(s) || 0) + 1);
  }
  return { name: m.batch || '?', targets, sites };
}

// The site a library-browser address belongs to: the publisher behind a proxied
// hostname, the target of a proxy sign-in link, or the host itself.
function targetSite(cfg, url) {
  const h = hostOf(url);
  if (!h) return null;
  if (cfg.mode === 'none') return siteOf(h.host);
  if (isLoginHost(h.host, cfg.suffix)) {
    const inner = hostOf(h.url.searchParams.get('url') || h.url.searchParams.get('qurl') || '');
    return inner ? siteOf(inner.host) : null;
  }
  const orig = deproxify(h.host, cfg.suffix);
  return siteOf(orig === null ? h.host : orig);
}

function findApproval(st, batch, now) {
  return [...st.approvals].reverse().find((a) => now - a.ts < APPROVAL_MS
    && batch.targets.every((t) => a.targets.includes(t)));
}

// A stable key for one tool call, so PostToolUse can tell that the call the user
// was asked about is the one that ran.
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
const callKey = (toolName, input) => JSON.stringify([toolName, canon(input || {})]);

const listSites = (sites) => [...sites].map(([s, n]) => `${s} (${n} paper${n === 1 ? '' : 's'})`).join(', ');

// Companion sites the user approved in earlier batches, remembered against the site
// that led to them (a link site that redirects to a content site, a content site
// whose PDFs live on another domain). They apply only in batches that include the
// site they follow, transitively, and every batch prompt lists them.
//   st.companions = { "<site>": { "<companion>": <approved at, ms> } }
export function companionsFor(companions, roots) {
  const found = new Map();  // companion -> the site it follows
  const queue = [...roots];
  const seen = new Set(roots);
  while (queue.length) {
    const site = queue.shift();
    for (const c of Object.keys((companions || {})[site] || {})) {
      if (seen.has(c)) continue;
      seen.add(c);
      found.set(c, site);
      queue.push(c);
    }
  }
  return found;
}

const listCompanions = (found) => [...found].map(([c, from]) => `${c} (follows ${from})`).join(', ');

// ---------------------------------------------------------------- decisions

const out = (decision, reason) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: `lit-fetch-ladder: ${reason}` },
});
// Read-only browser calls, and library page loads the guard has judged, are allowed
// outright. A plugin cannot ship allow rules, so without this every navigate and
// snapshot would prompt. A hook's allow never overrides a deny rule the user set.
const ok = (reason) => out('allow', reason);

function navigationUrl(tool, input) {
  if (tool === 'navigate') return input.url;
  if (tool === 'tabs' && input.action === 'new') return input.url || null;
  return null;
}

function isNavigation(tool, input) {
  return tool === 'navigate' || tool === 'navigate_back' || (tool === 'tabs' && input.action === 'new' && !!input.url);
}

function judgeBrowser(cfg, server, tool, input, now, key) {
  if (DENY_RE.test(tool)) return out('deny', `browser tool "${tool}" is disabled (it can run code, read session data, or move local files).`);
  if (ASK_RE.test(tool)) {
    if (server === 'library') return judgeLibraryInteraction(cfg, tool, now, key);
    return out('ask', `"${tool}" interacts with the page; confirm it is part of fetching a paper you asked for.`);
  }
  if (!ALLOW.has(tool)) return out('ask', `unrecognised browser tool "${tool}"; confirm before it runs.`);

  const url = navigationUrl(tool, input);
  if (url !== null && url !== undefined) {
    const h = hostOf(url);
    if (!h || (h.scheme !== 'http' && h.scheme !== 'https')) return out('deny', `only http(s) addresses may be opened (got "${String(url).slice(0, 80)}").`);
  }
  if (server === 'browse' || !isNavigation(tool, input)) return ok(`read-only browser tool "${tool}"`);
  return judgeLibraryNavigation(cfg, tool, input, url, now, key);
}

// Drop what has aged out: page loads and approvals older than a day, and page loads
// reserved for interactions whose result never came back.
function prune(st, now) {
  st.loads = st.loads.filter((t) => now - t < DAY_MS);
  st.approvals = st.approvals.filter((a) => now - a.ts < APPROVAL_MS);
  for (const [k, r] of Object.entries(st.reservations || {})) if (now - r.ts >= DAY_MS) delete st.reservations[k];
}

// The page-load caps, shared by navigations and by interactions that may load a page.
// Returns { reason } when one is reached, otherwise { burst }: the burst count after this load.
function checkCaps(cfg, st, approval, now) {
  if (st.loads.length + 1 > cfg.daily) {
    return { reason: `daily cap reached (${cfg.daily} authenticated page loads in 24 h). Stop and tell the user.` };
  }
  const burst = now - st.burst.last > IDLE_MS ? 1 : st.burst.count + 1;
  if (burst > cfg.burst) {
    return { reason: `burst cap reached (${cfg.burst} page loads). An unexpected overrun is the signature of a runaway or injected loop. Stop and confirm the scope with the user.` };
  }
  const budget = approval ? approval.targets.length * cfg.perPaper : 0;
  if (approval && approval.used + 1 > budget) {
    return { reason: `batch budget spent (${budget} page loads for ${approval.targets.length} paper(s)). Report progress; a new batch needs the user's approval.` };
  }
  return { burst };
}

function judgeLibraryNavigation(cfg, tool, input, url, now, key) {
  if (cfg.mode !== 'none') {
    if (!cfg.suffix) return out('deny', 'proxy_suffix is not configured; set it in /plugin settings.');
    if (!fs.existsSync(cfg.sessionFile)) return out('deny', 'no saved library login. Ask the user to run /lit-fetch-ladder:login.');
  }
  const batch = activeBatch(cfg);
  if (!batch || batch.targets.length === 0) {
    return out('deny', 'no staged batch. The library browser opens only papers staged by the batch driver (run the fetch skill first).');
  }

  return withLock(cfg, () => {
    const st = loadState(cfg);
    prune(st, now);
    const approval = findApproval(st, batch, now);
    const cap = checkCaps(cfg, st, approval, now);
    if (cap.reason) {
      saveState(cfg, st);
      return out('deny', cap.reason);
    }

    let decision = null;
    if (!approval) {
      decision = askForBatch(cfg, st, batch, key, now);
    } else {
      approval.used += 1;
      if (url) decision = judgeSite(cfg, st, url, approval, batch, key, now);
    }

    st.loads.push(now);
    st.burst = { last: now, count: cap.burst };
    saveState(cfg, st);
    return decision || ok('approved batch, within budget');
  });
}

// A click, key press, form action or dialog in the logged-in browser can open a page, so
// it is charged to the approved batch like a navigation: the caps are checked and one page
// load is reserved before the call. PostToolUse refunds it if the call opened no page and
// no tab. With no approved batch there is nothing to charge, so the call is denied.
function judgeLibraryInteraction(cfg, tool, now, key) {
  const batch = activeBatch(cfg);
  return withLock(cfg, () => {
    const st = loadState(cfg);
    prune(st, now);
    const approval = batch && batch.targets.length ? findApproval(st, batch, now) : null;
    if (!approval) {
      return out('deny', `"${tool}" in the logged-in browser can open a page, which is charged to an approved batch, and no batch is approved. Open a staged paper first.`);
    }
    const cap = checkCaps(cfg, st, approval, now);
    if (cap.reason) {
      saveState(cfg, st);
      return out('deny', `${cap.reason} A click or key press in the logged-in browser can open a page, so it counts.`);
    }
    (st.reservations ||= {})[key] = { ts: now, approvalTs: approval.ts, burst: st.burst };
    approval.used += 1;
    st.loads.push(now);
    st.burst = { last: now, count: cap.burst };
    saveState(cfg, st);
    return out('ask', `"${tool}" interacts with the logged-in page; confirm it is part of fetching a paper you asked for. If it opens a page, that counts as one of the batch's page loads.`);
  });
}

// First page load of a batch, or of a batch that has grown past its approval: ask,
// listing every site the logged-in browser will open and what is new.
function askForBatch(cfg, st, batch, key, now) {
  const prev = [...st.approvals].reverse().find((a) => a.batch === batch.name);
  const newTargets = prev ? batch.targets.filter((t) => !prev.targets.includes(t)) : batch.targets;
  const roots = [...new Set([...(prev ? prev.sites : []), ...batch.sites.keys()])];
  const remembered = companionsFor(st.companions, roots);
  for (const c of roots) remembered.delete(c);
  const sites = [...new Set([...roots, ...remembered.keys()])];
  const alsoText = remembered.size ? ` Also allowed, from your earlier approvals: ${listCompanions(remembered)}.` : '';
  st.pending = { kind: 'batch', call: key, batch: batch.name, targets: batch.targets, sites,
    used: (prev ? prev.used : 0) + 1, replaces: prev ? prev.ts : null, ts: now };
  const budget = batch.targets.length * cfg.perPaper;
  if (!prev) {
    return out('ask', `approve library batch "${batch.name}": ${batch.targets.length} paper(s), up to ${budget} page loads. `
      + `Sites the logged-in browser will open: ${listSites(batch.sites)}.${alsoText} One approval covers these sites for this batch; any other site will be asked about.`);
  }
  const added = [...batch.sites.keys()].filter((s) => !prev.sites.includes(s));
  return out('ask', `batch "${batch.name}" wants to grow from ${prev.targets.length} to ${batch.targets.length} papers `
    + `(${newTargets.length} new: ${newTargets.slice(0, 5).join(', ')}${newTargets.length > 5 ? ', ...' : ''}), up to ${budget} page loads in total. `
    + `New sites: ${added.length ? added.join(', ') : 'none'}. Already approved: ${prev.sites.join(', ')}.`
    + `${[...remembered.keys()].some((c) => !prev.sites.includes(c)) ? alsoText : ''} Approve the larger batch?`);
}

// A page load inside an approved batch: sites already approved pass; any other
// site asks to be added to the batch, saying how the browser came to it.
function judgeSite(cfg, st, url, approval, batch, key, now) {
  const h = hostOf(url);
  const site = targetSite(cfg, url);
  if (!site) return out('ask', 'the library sign-in link points at an unknown site; confirm it belongs to a paper you asked for.');
  if (approval.sites.includes(site)) return null;
  const outsideProxy = cfg.mode !== 'none' && !isLoginHost(h.host, cfg.suffix) && deproxify(h.host, cfg.suffix) === null;
  const redirectedFrom = (approval.redirected || {})[site];
  const from = redirectedFrom || (approval.sites.includes(st.lastSite) ? st.lastSite : null);
  st.pending = { kind: 'site', call: key, site, from, approvalTs: approval.ts, ts: now };
  return out('ask', `batch "${batch.name}" needs a new site: ${site}`
    + `${redirectedFrom ? ` (a page from ${redirectedFrom} redirected the browser there)` : ''}`
    + `${outsideProxy ? ' (outside the library proxy)' : ''}. `
    + `Approved so far: ${approval.sites.join(', ')}. Approve adding ${site} to this batch?`
    + `${from && from !== site ? ` If you approve, it is remembered and allowed in future batches that include ${from} (list or forget with /lit-fetch-ladder:sites).` : ''}`);
}

// ---------------------------------------------------------------- file and shell tools

const PATH_KEYS = ['file_path', 'notebook_path', 'path'];
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor']);
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob']);

function norm(p) {
  let r = path.resolve(p);
  try { r = fs.realpathSync(r); } catch { /* may not exist yet */ }
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function judgeFiles(cfg, tool, input) {
  if (!cfg.data) return null;
  const protectedRoots = [cfg.secretDir, cfg.stateDir].map(norm);
  const inside = (p, root) => p === root || p.startsWith(root + path.sep);

  if (FILE_TOOLS.has(tool)) {
    for (const k of PATH_KEYS) {
      if (typeof input[k] !== 'string' || !input[k]) continue;
      const p = norm(input[k]);
      // A target inside a protected dir, or a search rooted above one (Grep/Glob recurse).
      const hit = protectedRoots.some((root) => inside(p, root) || ((tool === 'Grep' || tool === 'Glob') && inside(root, p)));
      if (hit) return out('deny', 'the saved library login and the guard state are not readable by the agent.');
    }
  }
  if (SHELL_TOOLS.has(tool) && typeof input.command === 'string') {
    const c = process.platform === 'win32' ? input.command.toLowerCase() : input.command;
    const markers = [...protectedRoots, 'library-state', 'login-raw', STATE_FILE].filter(Boolean);
    // Also catch the data dir spelled another way (~, $HOME, a relative path).
    const spelled = new RegExp(`plugins[\\\\/]+data[\\\\/]+[^\\\\/\\s"']*${PLUGIN}[^\\\\/\\s"']*[\\\\/]+(secret|state)(?![\\w-])`, 'i');
    if (markers.some((m) => c.includes(m)) || spelled.test(c)) {
      return out('deny', 'shell access to the saved library login or the guard state is blocked.');
    }
    if (cfg.suffix && cfg.mode === 'ezproxy-host' && c.includes('.' + cfg.suffix)) {
      return out('deny', 'proxied addresses are opened only by the library browser, where page loads are approved and counted.');
    }
    if (/scripts[\\/]+login\.mjs/.test(c)) {
      return out('deny', 'the library sign-in is run by the user in their own terminal, never by the agent (see /lit-fetch-ladder:login).');
    }
  }
  if (tool === 'WebFetch' && typeof input.url === 'string' && cfg.mode === 'ezproxy-host') {
    const h = hostOf(input.url);
    if (h && underSuffix(h.host, cfg.suffix)) {
      return out('deny', 'proxied addresses are opened only by the library browser, where page loads are approved and counted.');
    }
  }
  return null;
}

// ---------------------------------------------------------------- events

function preToolUse(cfg, ev, now) {
  const m = BROWSER_RE.exec(ev.tool_name || '');
  const input = ev.tool_input || {};
  if (m) {
    try {
      return judgeBrowser(cfg, m[1], m[2], input, now, callKey(ev.tool_name, input));
    } catch (e) {
      return out('deny', `guard error, failing closed: ${e.message}`);
    }
  }
  try {
    return judgeFiles(cfg, ev.tool_name || '', input);
  } catch {
    return null;
  }
}

// After a library browser call ran. A navigation only runs if the user said yes to its
// prompt, so the pending approval it carried (a batch, a grown batch, or a new site) is
// recorded. Sites the browser was redirected to are noted, not approved: navigating to one
// later asks, and the prompt says where it came from. An interaction's reserved page load
// is settled. Every result also updates where the browser is and how many tabs it has
// open, which is what the next interaction is compared against.
function postToolUse(cfg, ev, now) {
  const m = BROWSER_RE.exec(ev.tool_name || '');
  if (!m || m[1] !== 'library') return null;
  const tool = m[2];
  const input = ev.tool_input || {};
  const navigated = isNavigation(tool, input);
  const interacted = ASK_RE.test(tool);
  if (!navigated && !interacted && tool !== 'tabs') return null;
  withLock(cfg, () => {
    const st = loadState(cfg);
    const page = pageState(ev.tool_response);
    if (interacted) settleInteraction(cfg, st, callKey(ev.tool_name, input), page, now);
    if (navigated) recordNavigation(cfg, st, ev, tool, input, now);
    if (page.url) st.lastUrl = page.url;
    if (page.tabs) st.tabCount = page.tabs;
    saveState(cfg, st);
  });
  return null;
}

function recordNavigation(cfg, st, ev, tool, input, now) {
  const p = st.pending;
  if (p && p.call === callKey(ev.tool_name, input)) {
    if (p.kind === 'batch') {
      st.approvals = st.approvals.filter((a) => a.ts !== p.replaces);
      st.approvals.push({ batch: p.batch, targets: p.targets, sites: p.sites, used: p.used, ts: p.ts, redirected: {} });
    } else if (p.kind === 'site') {
      const a = st.approvals.find((x) => x.ts === p.approvalTs);
      if (a && !a.sites.includes(p.site)) a.sites.push(p.site);
      if (p.from && p.from !== p.site) ((st.companions ||= {})[p.from] ||= {})[p.site] = now;
    }
    delete st.pending;
  }
  const batch = activeBatch(cfg);
  const approval = batch && findApproval(st, batch, now);
  const requested = navigationUrl(tool, input);
  if (approval && requested) {
    const fromSite = targetSite(cfg, requested);
    const landed = [...JSON.stringify(ev.tool_response || '').matchAll(/Page URL: (https?:\/\/[^\s"\\]+)/g)].map((x) => x[1]);
    for (const u of landed) {
      const site = targetSite(cfg, u);
      if (site && !approval.sites.includes(site)) (approval.redirected ||= {})[site] = fromSite;
    }
  }
  if (requested) {  // the site the browser is now on: the last page it landed on
    const landedLast = [...JSON.stringify(ev.tool_response || '').matchAll(/Page URL: (https?:\/\/[^\s"\\]+)/g)].pop();
    st.lastSite = targetSite(cfg, landedLast ? landedLast[1] : requested) || st.lastSite;
  }
}

// An interaction's result. If it opened a page (the address changed, ignoring a #fragment)
// or a tab (more tabs open than before), the page load reserved for it stands, plus one per
// extra tab. A result that does not say where the browser is counts as a page load too.
// Otherwise the reservation is refunded.
function settleInteraction(cfg, st, key, page, now) {
  const r = (st.reservations || {})[key];
  if (r) delete st.reservations[key];
  const approval = r ? st.approvals.find((a) => a.ts === r.approvalTs) : null;
  const moved = !page.url || !st.lastUrl || pageKey(page.url) !== pageKey(st.lastUrl);
  const loads = (moved ? 1 : 0) + Math.max(0, page.tabs - (st.tabCount || 1));
  if (r && loads === 0) {
    if (approval) approval.used = Math.max(0, approval.used - 1);
    const i = st.loads.lastIndexOf(r.ts);
    if (i >= 0) st.loads.splice(i, 1);
    st.burst = st.burst.last === r.ts ? r.burst : { last: st.burst.last, count: Math.max(0, st.burst.count - 1) };
    return;
  }
  for (let i = 1; i < loads; i++) {
    st.loads.push(now);
    if (approval) approval.used += 1;
    st.burst = { last: now, count: st.burst.count + 1 };
  }
  if (page.url) st.lastSite = targetSite(cfg, page.url) || st.lastSite;
}

// What a Playwright MCP result says about the browser after a call: the current page's
// address, and how many tabs are open (the result lists tabs only when there is more than one).
function responseText(resp) {
  if (typeof resp === 'string') return resp;
  const blocks = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.content) ? resp.content : null);
  if (blocks) return blocks.map((b) => (typeof b === 'string' ? b : (b && b.text) || '')).join('\n');
  return JSON.stringify(resp ?? '').replace(/\\n/g, '\n');
}

export function pageState(resp) {
  const text = responseText(resp);
  const tabs = [...text.matchAll(/^- \d+: (\(current\) )?\[.*\]\((\S+)\)\s*$/gm)];
  const current = tabs.find((t) => t[1]);
  const shown = [...text.matchAll(/Page URL: (https?:\/\/[^\s"\\]+)/g)].pop();
  const url = shown ? shown[1] : (current ? current[2] : null);
  return { url, tabs: tabs.length || (url ? 1 : 0) };
}

function pageKey(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.href;
  } catch {
    return u;
  }
}

export function handle(ev, now = Date.now()) {
  const cfg = config();
  switch (ev.hook_event_name) {
    case 'PreToolUse': return preToolUse(cfg, ev, now);
    case 'PostToolUse':
    case 'PostToolUseFailure': return postToolUse(cfg, ev, now);
    default: return null;
  }
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let ev;
  try {
    ev = JSON.parse(raw || '{}');
  } catch {
    process.stdout.write(JSON.stringify(out('deny', 'unreadable hook input, failing closed')));
    return;
  }
  let res;
  try {
    res = handle(ev);
  } catch (e) {
    res = BROWSER_RE.test(ev.tool_name || '') && ev.hook_event_name === 'PreToolUse'
      ? out('deny', `guard error, failing closed: ${e.message}`) : null;
  }
  if (res) process.stdout.write(JSON.stringify(res));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('guard.mjs')) {
  main();
}
