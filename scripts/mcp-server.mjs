#!/usr/bin/env node
// Starts Microsoft's Playwright MCP server for one of the plugin's two browsers:
//   browse   rung 2, no credentials
//   library  rung 3, the same server carrying the saved library login
// The argument list is built here, in code: the plugin never passes --caps (which
// adds cookie, storage and network-routing tools), and both browsers identify as the
// desktop Chrome they are (see desktopUserAgent). Note that this server version exposes two code-execution
// tools (browser_evaluate, browser_run_code_unsafe) even without --caps and has no
// option to remove them; the plugin's guard denies both.
import fs from 'node:fs';
import path from 'node:path';
import { PLAYWRIGHT_MCP, SESSION_FILE, desktopUserAgent, npx, proxySuffix } from './common.mjs';

const profile = process.argv[2];
if (profile !== 'browse' && profile !== 'library') {
  console.error('usage: mcp-server.mjs browse|library');
  process.exit(2);
}
const data = process.env.CLAUDE_PLUGIN_DATA;
if (!data) {
  console.error('lit-fetch-ladder: CLAUDE_PLUGIN_DATA is not set');
  process.exit(2);
}
// With no proxy suffix the network itself is entitled (campus or VPN): no saved login to load.
const suffix = proxySuffix(process.env.LFL_PROXY_SUFFIX);
const outDir = path.join(data, 'downloads', profile);
fs.mkdirSync(outDir, { recursive: true });

const args = ['-y', PLAYWRIGHT_MCP, '--browser', 'chromium', '--isolated', '--headless', '--output-dir', outDir,
  '--user-agent', desktopUserAgent()];
if (profile === 'library' && suffix) args.push('--storage-state', path.join(data, ...SESSION_FILE));

// Run the server inside its download folder: a snapshot or screenshot the agent saves under a short
// file name lands there, never loose in the user's project.
const child = npx(args, { cwd: outDir });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
