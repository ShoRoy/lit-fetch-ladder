# Safeguards

What the guard enforces and what it does not, its cost, the page-load limits, and what is sent where.
To report a way past the guard, see [`SECURITY.md`](../SECURITY.md).

## The threat

Any page the browser opens could carry instructions planted for an agent (prompt injection). The risky
moment is an agent reading such a page while it controls a browser signed in as you. A planted line
could ask it to download many papers through your library's proxy, read the saved login, or open other
sites with it.

The fetch skill tells the agent to treat fetched text as data, never as instructions. An agent can still
follow a planted line, so a hook (`guard/guard.mjs`), which Claude Code runs before and after each
relevant tool call, limits what it can do. The hook enforces rules but is not a sandbox, and
[What the guard does not cover](#what-the-guard-does-not-cover) lists its gaps. When it asks or denies,
its message names the rule.

## What the guard costs

The hook runs before every file read, edit, search, shell command and web fetch in a session where the
plugin is enabled, and takes about 0.13 s per call (median, measured in a Linux container; 0.22 s at the
90th percentile). It also refuses any shell command that names the sign-in script or your proxy's domain,
a harmless one included, so run such commands in your own terminal. Both are reasons to install the
plugin for one folder.

## What the guard enforces

| A fetched page tries to... | What happens |
|---|---|
| run code in the browser, read cookies or storage, read raw request headers | denied in both browsers (`browser_evaluate`, `browser_run_code_unsafe`, cookie and storage tools, `browser_network_request`, `browser_file_upload`) |
| open `file://` or any non-http(s) address | denied (Playwright also blocks `file:` by default) |
| read the saved login | denied for the file tools and for shell commands that name it; the guard also refuses it as a file for Zotero MCP's add and attach tools |
| add papers to the batch | a batch that grows needs your approval again, and the prompt names the new papers and sites |
| open another site in the library browser | you are asked, and the site joins the batch only if you say yes |
| redirect the library browser to a site of its choosing | the site it lands on is not trusted, so opening it again asks, and the prompt names the redirect |
| reuse a site approved in an earlier batch | allowed only in batches that include the site it was approved from, and listed in their approval prompt; forget it with `/lit-fetch-ladder:sites` |
| fetch a proxied address with `curl` or WebFetch, outside the counted browser | denied |
| loop, by navigating or by clicking through pages | the batch's page budget, 20 page loads per burst, 60 per 24 hours; a click or key press in the library browser counts when it opens a page or a tab |
| download a whole issue with one click or page load | the batch stops when one action starts more than one download or an archive, and the next page load asks you, with the reason |
| make you run the sign-in, or run it itself | the sign-in starts from your `/lit-fetch-ladder:login`, which the agent cannot invoke; shell commands that name the sign-in script are refused |
| change your Zotero library beyond filing, through `zotero-cli`, Zotero MCP's own tools or `lfl zotero --trash` (trash, merge, edit, delete a collection, copy items to or switch libraries, set Zotero credentials or the target library on a command line, run code against the Zotero modules, run `zotero-mcp setup` or `authorize-local`) | you are asked, once per command, and once for the whole list with `lfl zotero --trash`; filing only adds, attaches and annotates |

In the browser without a login, page loads, snapshots, screenshots, waits and clicks run without a
prompt. In the library browser, page loads and page interactions need an approved batch. Page loads
inside it run without a prompt, and so do clicks on a page of a site the batch approved, where that
site is shipped in `guard/known-sites.json` or you approved a click there before. Other clicks, typing
and other interactions ask. Any of them that opens a page or a tab counts as a page load.

`tests/redteam/` replays what an agent might try after reading a page with planted instructions
(`tests/redteam/injected-page.html`), checks each of the guard's decisions, and runs with the other
tests.

## What the guard does not cover

- The browser without a login opens any http(s) address without asking. An agent that obeyed a planted
  instruction could send what it has read out in an address, as any agent with a browser can.
- On a campus network or library VPN there is no proxy address to check, so the browser without a login,
  `curl` and WebFetch reach what your library subscribes to with no approval and no cap. Only the fetch
  skill's procedure keeps them to open-access pages.
- The shell checks on the saved login, the sign-in script and the Zotero commands are pattern matches on
  the command's text. The Zotero checks read through quotes, escapes and line breaks, and the other two
  match the command as written. A command that splits, quotes, expands, encodes or stages a path or name
  can slip past them. The file tools are checked by resolved path.
- The sign-in can be started another way, for example by a second Claude Code started from the shell. It
  still needs your password and second factor in a window on your screen, so sign in only to a window you
  opened with `/lit-fetch-ladder:login`.
- A redirect inside one page load cannot be stopped. The site it lands on is not trusted, and the next
  page load there asks.
- A click on a site where clicks run without asking is not shown to you first. The guard sees the
  agent's description of the element, not what the click does. Such a click can take the browser to
  another site, as a redirect can, or answer a bot check, and only the fetch skill's rules hold the
  agent back there.
- The bulk-download stop acts after the call. The downloads that one action started are already under
  way when the batch stops. The guard reads the downloads reported in the result of the page load or
  click that started them.
- The sites shipped in `guard/known-sites.json` are trusted without an earlier approval of yours. The
  batch prompt lists the known redirects, and `/lit-fetch-ladder:sites` lists the click sites.
- A page that loads another page by itself, with no navigation or click from the agent, is not counted.
- More papers from a publisher already in the batch are bounded by the page budget, not prevented.
- A site approved by mistake stays allowed in batches that include the site it follows, until you forget
  it with `/lit-fetch-ladder:sites`.
- A tokenised download link on a site that is not proxied is refused only by the fetch skill's rule.
- Without Node the guard cannot run, so none of its checks apply. The browsers need Node too and do not
  start. If the guard fails while judging a file, shell or Zotero call, the call goes ahead. Only browser
  calls fail closed.

## A second layer in your own settings

Playwright MCP 0.0.78 exposes `browser_evaluate` and `browser_run_code_unsafe` and has no option to
remove them, so the guard denies both. To deny them in your own settings as well, add these to
`permissions.deny` in `~/.claude/settings.json`. A hook's allow never overrides a deny rule there. The
doctor prints the same list.

```
"mcp__plugin_lit-fetch-ladder_browse__browser_evaluate",
"mcp__plugin_lit-fetch-ladder_browse__browser_run_code_unsafe",
"mcp__plugin_lit-fetch-ladder_library__browser_evaluate",
"mcp__plugin_lit-fetch-ladder_library__browser_run_code_unsafe"
```

## Page-load limits

A batch in the library browser may load 5 pages for each approved paper by default, shared across the
batch, and an option can raise that to 8. On top of that, 20 page loads per burst (a burst ends after 15
minutes without a page load) and 60 per 24 hours are hard limits. On a campus network or library VPN the
library browser runs without a login, under the same approvals and limits. These cover a careful survey
and stop a runaway one. They are set in `guard/guard.mjs`, and you can lower them there.
[Use it responsibly](../README.md#use-it-responsibly) says why they are low.

## What is sent where

Your contact email goes only to OpenAlex and Unpaywall, in the request parameter each asks for. Every
other request the tools make, to doi.org and to open-access hosts, identifies itself only as
`lit-fetch-ladder/<version>`. The browsers talk to the sites they open and identify themselves as the
desktop Chrome they are. Their user agent leaves out the word "Headless", which some sites refuse
outright, and nothing else about them is disguised. Nothing is sent to the author of this plugin.

## Security scanners

Pattern-based scanners for agent plugins can rate this one as dangerous, and NVIDIA's SkillSpector
(v2.13.4) labels it CRITICAL. They match the guard itself, whose tests check that it denies opening
`file:///etc/passwd` in the browser and fetching a proxied address with `curl`, and the red-team page,
which carries planted instructions on purpose. The plugin also reads its settings from Claude Code's
settings files. Read the code and [`SECURITY.md`](../SECURITY.md) before installing, and report a real
way past the guard privately.
