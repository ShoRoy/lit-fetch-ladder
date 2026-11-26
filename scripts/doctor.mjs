#!/usr/bin/env node
// Check that everything lit-fetch-ladder needs is in place. Reads no secrets: for
// the saved login it reports only whether the file exists and how old it is.
//   node doctor.mjs --data <dir>
// The plugin's two settings are read from Claude Code's settings files (pluginConfigs), so
// the command line never carries the proxy address; --email and --proxy-suffix override them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BROWSER_DEPS, CHROME_MAJOR, CHROMIUM_REVISION, PLAYWRIGHT_MCP, browserCacheRoots, browserStartProblem, SESSION_FILE, argValue, defaultDataDir, pluginOptions, proxySuffix, signInUrl } from './common.mjs';
import { displayPlan } from './login.mjs';

const rows = [];
const check = (ok, label, hint = '') => rows.push(`${ok ? ' ok ' : 'FIX '} ${label}${!ok && hint ? `\n       -> ${hint}` : ''}`);

const note = (label) => rows.push(`     ${label}`);

const o = pluginOptions();
const data = argValue('--data') || defaultDataDir();
const email = argValue('--email', o.contact_email || '');
const rawProxy = argValue('--proxy-suffix', o.proxy_suffix || '').trim();
const suffix = proxySuffix(rawProxy);
const LOGIN_MAX_HOURS = 12;

// --login: one line saying whether a library sign-in is needed now, without the checks below.
// Exits 1 when one is needed. The fetch skill runs this at the start of every fetch.
if (process.argv.includes('--login')) {
  const sess = suffix && data && path.join(data, ...SESSION_FILE);
  const hours = sess && fs.existsSync(sess) ? (Date.now() - fs.statSync(sess).mtimeMs) / 3600000 : -1;
  const needed = !!suffix && (hours < 0 || hours >= LOGIN_MAX_HOURS);
  if (!suffix) console.log('library login: not needed (no library proxy set)');
  else if (hours < 0) console.log('library login: NEEDED, none saved. Sign in with /lit-fetch-ladder:login.');
  else if (needed) console.log(`library login: NEEDED, saved ${hours.toFixed(1)} h ago and probably expired. Sign in with /lit-fetch-ladder:login.`);
  else console.log(`library login: saved ${hours.toFixed(1)} h ago`);
  process.exit(needed ? 1 : 0);
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
check(nodeMajor >= 18, `Node ${process.versions.node}`, 'install Node 18 or later');
const py = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import sys;print(sys.version_info[:2]>=(3,9))'], { encoding: 'utf8' });
check(py.stdout?.trim() === 'True', 'Python 3.9+ for the fetch tools', 'install Python 3.9 or later');
const npx = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
check(npx.status === 0, 'npx available', 'npx ships with Node; check your PATH');
const pt = spawnSync(process.platform === 'win32' ? 'pdftotext.exe' : 'pdftotext', ['-v'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (pt.status === 0) check(true, 'pdftotext found: downloaded PDFs are checked against the paper they were fetched for');
else note('pdftotext not found: install poppler-utils. Without it the plugin cannot check a PDF against its paper and Claude Code cannot read one, so PDFs stay unconfirmed and are not filed');
const zc = spawnSync(process.platform === 'win32' ? 'zotero-cli.exe' : 'zotero-cli', ['--help'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (zc.status === 0) check(true, 'zotero-cli found: fetched batches can be filed into Zotero (lfl zotero)');
else note('zotero-cli not found (optional): /lit-fetch-ladder:zotero setup installs Zotero MCP, to file batches into Zotero');

const cacheRoots = browserCacheRoots();
// The build the pinned Playwright MCP needs, not any Chromium another project installed.
const chromium = cacheRoots.some((r) => fs.existsSync(r) && fs.readdirSync(r).includes(`chromium-${CHROMIUM_REVISION}`));
check(chromium, `Chromium for Playwright installed (build ${CHROMIUM_REVISION})`, `npx -y -p ${PLAYWRIGHT_MCP} playwright install chromium`);
if (chromium) {
  const why = browserStartProblem(cacheRoots);
  check(!why, 'the browser starts', `${why}; install its system libraries with: ${BROWSER_DEPS} (asks for sudo)`);
}
// A PDF address renders inside the headless browser unless the browser is told to download PDFs;
// the managed policy AlwaysOpenPdfExternally does that (docs/usage.md, "PDFs that open in a viewer").
// Playwright's build is Chrome for Testing, which reads its own policy directory (compiled in as
// /etc/opt/chrome_for_testing/policies), not Chrome's or Chromium's.
const PDF_POLICY_DIR = '/etc/opt/chrome_for_testing/policies/managed';
let pdfPolicy = '';
if (process.platform === 'linux') {
  for (const dir of [PDF_POLICY_DIR, '/etc/opt/chrome/policies/managed', '/etc/chromium/policies/managed']) {
    try {
      if (fs.readdirSync(dir).some((f) => f.endsWith('.json')
        && JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).AlwaysOpenPdfExternally === true)) pdfPolicy = dir;
    } catch { /* no such policy directory */ }
    if (pdfPolicy) break;
  }
}
if (pdfPolicy) check(pdfPolicy === PDF_POLICY_DIR, `PDF addresses download (policy AlwaysOpenPdfExternally in ${pdfPolicy})`,
  `that directory belongs to another browser; Playwright's Chrome for Testing reads ${PDF_POLICY_DIR}`);
else note('a PDF that opens in the browser\'s viewer is saved as page text; a policy makes it download (docs/usage.md, "PDFs that open in a viewer")');

check(/.+@.+/.test(email), 'contact email set', 'set "Your email" with /plugin configure lit-fetch-ladder@fetch-ladder (Unpaywall requires one)');
note(`the browsers identify as desktop Chrome ${CHROME_MAJOR}, without the word "Headless"`);
// The install dialog's first option, "Install for you (user scope)", loads the plugin and its guard in every
// folder; the README asks for "in this repo only (local scope)". Claude Code records the scope here.
try {
  const reg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
  const entries = Object.entries(reg.plugins || {}).filter(([k]) => k.startsWith('lit-fetch-ladder@')).flatMap(([, v]) => [].concat(v));
  if (entries.some((e) => e && e.scope === 'user')) {
    note('installed for every folder (user scope), so the guard runs in all your projects. To keep it to one');
    note('folder, uninstall it in /plugin and install it again choosing "Install for you, in this repo only".');
  }
} catch { /* no record of installed plugins */ }
if (!suffix) {
  note('no library proxy set: the library browser opens publisher sites directly, which works on a');
  note('campus network or VPN. Set "Library proxy" with /plugin configure to sign in elsewhere.');
} else {
  check(true, `library proxy: ${suffix}${rawProxy.toLowerCase() !== suffix ? `  (taken from "${rawProxy}")` : ''}`);
  const url = await signInUrl(suffix);
  check(!!url, `library sign-in page: ${url || 'not found'}`,
    `neither login.${suffix} nor ${suffix} answers; check the proxy setting, or pass --login-url to the login command`);
  const sess = data && path.join(data, ...SESSION_FILE);
  if (sess && fs.existsSync(sess)) {
    const st = fs.statSync(sess);
    const hours = (Date.now() - st.mtimeMs) / 3600000;
    const privateFile = process.platform === 'win32' || (st.mode & 0o077) === 0;
    check(hours < LOGIN_MAX_HOURS, `saved library login: ${hours.toFixed(1)} h old`, 'probably expired; run /lit-fetch-ladder:login');
    check(privateFile, 'saved login readable only by you', `chmod 600 "${sess}"`);
  } else {
    check(false, 'saved library login', data ? 'run /lit-fetch-ladder:login (the login opens a browser window)'
      : 'no plugin data directory found; pass --data <dir> (Claude Code sets it when it runs the doctor)');
  }
  if (data) note(`plugin data: ${data}`);
  const display = await displayPlan();
  check(display.ok, `a display for the sign-in window${display.note ? `: ${display.note}` : ''}`,
    `${display.reason}; see "Signing in from a container" in docs/sign-in.md`);
}

console.log(`lit-fetch-ladder doctor\n${rows.join('\n')}`);
if (suffix) console.log('\nBefore you paste this into an issue, remove your library\'s proxy address and sign-in page.');
console.log(`
Optional second layer: Playwright MCP exposes two code-execution tools that the
plugin's guard denies. To deny them in your own settings as well, add to
"permissions.deny" in ~/.claude/settings.json:
  "mcp__plugin_lit-fetch-ladder_browse__browser_evaluate",
  "mcp__plugin_lit-fetch-ladder_browse__browser_run_code_unsafe",
  "mcp__plugin_lit-fetch-ladder_library__browser_evaluate",
  "mcp__plugin_lit-fetch-ladder_library__browser_run_code_unsafe"`);
process.exit(rows.some((r) => r.startsWith('FIX')) ? 1 : 0);
