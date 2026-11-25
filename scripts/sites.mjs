#!/usr/bin/env node
// List or forget the sites lit-fetch-ladder remembers from your approvals:
//   - companions: a site you approved in an earlier batch (for example a publisher's content
//     site that its link site redirects to). It is allowed automatically, and listed in the
//     approval prompt, in later batches that include the site it follows.
//   - click sites: a site where you approved a click in the library browser. Later clicks
//     there run without asking, inside an approved batch.
// The list also shows the sites the plugin ships in guard/known-sites.json, which cannot be
// forgotten here. This script can only list and forget. There is deliberately no way to add one.
//   node sites.mjs list --data <dir>
//   node sites.mjs forget <site> --data <dir>
//   node sites.mjs forget-all --data <dir>
import { argValue } from './common.mjs';

const data = argValue('--data');
const [cmd, site] = process.argv.slice(2);
if (!data || !['list', 'forget', 'forget-all'].includes(cmd) || (cmd === 'forget' && (!site || site.startsWith('--')))) {
  console.error('usage: node sites.mjs list|forget <site>|forget-all --data <plugin data dir>');
  process.exit(2);
}
process.env.CLAUDE_PLUGIN_DATA = data;
const { config, withLock, loadState, saveState } = await import('../guard/guard.mjs');
const cfg = config();

const rows = (st) => Object.entries(st.companions || {})
  .flatMap(([from, cs]) => Object.entries(cs).map(([c, ts]) => ({ c, from, ts })))
  .sort((a, b) => a.from.localeCompare(b.from) || a.c.localeCompare(b.c));
const clicks = (st) => Object.entries(st.clickSites || {}).sort(([a], [b]) => a.localeCompare(b));
const day = (ts) => new Date(ts).toISOString().slice(0, 10);

withLock(cfg, () => {
  const st = loadState(cfg);
  if (cmd === 'list') {
    const r = rows(st);
    if (!r.length) console.log('No remembered companion sites.');
    else {
      console.log('Remembered companion sites (allowed in batches that include the site they follow):');
      for (const { c, from, ts } of r) console.log(`  ${c.padEnd(32)} follows ${from.padEnd(28)} approved ${day(ts)}`);
    }
    const k = clicks(st);
    if (!k.length) console.log('No remembered click sites.');
    else {
      console.log('Remembered click sites (clicks there run without asking, inside an approved batch):');
      for (const [s, ts] of k) console.log(`  ${s.padEnd(32)} approved ${day(ts)}`);
    }
    const follows = Object.entries(cfg.known.follows).flatMap(([from, cs]) => cs.map((c) => `${c} (follows ${from})`));
    console.log(`Built in (guard/known-sites.json): known redirects ${follows.join(', ') || 'none'}; click sites ${cfg.known.click.join(', ') || 'none'}.`);
    return;
  }
  const before = rows(st).length + clicks(st).length;
  if (cmd === 'forget-all') {
    st.companions = {};
    st.clickSites = {};
  } else {
    for (const from of Object.keys(st.companions || {})) {
      delete st.companions[from][site];
      if (from === site) delete st.companions[from];
      else if (!Object.keys(st.companions[from]).length) delete st.companions[from];
    }
    if (st.clickSites) delete st.clickSites[site];
  }
  saveState(cfg, st);
  console.log(`Forgot ${before - rows(st).length - clicks(st).length} remembered site(s).`);
});
