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
90th percentile). It also refuses any shell command that names the sign-in script, the plugin's data
folder as a whole, or an address under your proxy's domain, a harmless one included, so run such
commands in your own terminal. Weigh both when you choose the install scope.

## What the guard enforces

| A fetched page tries to... | What happens |
|---|---|
| run code in the browser, read cookies or storage, read raw request headers | denied in both browsers (`browser_evaluate`, `browser_run_code_unsafe`, cookie and storage tools, `browser_network_request`, `browser_file_upload`) |
| open `file://` or any non-http(s) address | denied |
| read the saved login | denied for the file tools (also a search from a folder above it, or through a symlinked folder), for shell commands that name it, and for shell commands that take the plugin's data directory as a whole or change into it; the guard also refuses it as a file for Zotero MCP's add and attach tools |
| change the guard itself | the file tools cannot write the installed plugin's guard, hooks, skills or code, and shell commands that name them are refused; its docs and tests stay open |
| add papers to the batch | a batch that grows needs your approval again, and the prompt names the new papers and sites |
| open another site in the library browser | you are asked, and the site joins the batch only if you say yes |
| redirect the library browser to a site of its choosing | the site it lands on is not trusted, so opening it again asks, and the prompt names the redirect |
| reuse a site approved in an earlier batch | allowed only in batches that include the site it was approved from, and listed in their approval prompt; forget it with `/lit-fetch-ladder:sites` |
| fetch a proxied address with `curl` or WebFetch, outside the counted browser | denied, in any letter case and with or without a trailing dot |
| loop, by navigating or by clicking through pages | the batch's page budget, 20 page loads per burst, 60 per 24 hours; a click or key press in the library browser counts when it opens a page or a tab |
| download a whole issue with one click or page load | the batch stops when one action starts more than one download or an archive, and the next page load asks you, with the reason, also when the batch is renamed |
| make you run the sign-in, or run it itself | the sign-in starts from your `/lit-fetch-ladder:login`, which the agent cannot invoke; shell commands that name the sign-in script are refused |
| change your Zotero library beyond filing, through `zotero-cli`, Zotero MCP's own tools or `lfl zotero --trash` (trash, merge, edit, delete a collection, copy items to or switch libraries, set Zotero credentials, the target library or where requests go on a command line, run code against the Zotero modules, run `zotero-mcp setup` or `authorize-local`) | you are asked, once per command, and once for the whole list with `lfl zotero --trash`; filing only adds, attaches and annotates |

In the browser without a login, page loads, snapshots, screenshots, waits and clicks run without a
prompt. In the library browser, page loads and page interactions need an approved batch. Page loads
inside it run without a prompt, and so do clicks on a page of a site the batch approved, where that
site is shipped in `guard/known-sites.json` or you approved a click there before. Other clicks, typing
and other interactions ask. Any of them that opens a page or a tab counts as a page load.

## What the guard does not cover

The guard is a second layer. The baseline defence against prompt injection is expected to come from the
vendor, in Claude Code's permission prompts and the model's own resistance to planted instructions. The
plugin is meant for academic research, not for fetching items you know are restricted, and nothing in it
tells a restricted item from any other.

- The browser without a login opens any http(s) address without asking. An agent that obeyed a planted
  instruction could send what it has read out in an address, as any agent with a browser can.
- On a campus network or library VPN there is no proxy address to check, so the browser without a login,
  `curl` and WebFetch reach what your library subscribes to with no approval and no cap. Only the fetch
  skill's procedure keeps them to open-access pages.
- The shell checks on the saved login, the sign-in script, proxied addresses, the guard's own files and
  the Zotero commands match the command's text. A command that splits, quotes, expands, encodes or stages a path or name can slip past them, and
  such a command could also start the sign-in. Sign in only to a window you opened with
  `/lit-fetch-ladder:login`. The file tools are checked by resolved path.
- A shell command that takes the plugin's data directory as a whole (`grep -r`, `tar`, `cp -r`, `cd` or a
  glob on it) is refused, but one run on a folder further up, such as `~/.claude` or your home folder,
  also reads the saved login. The file tools are refused such a search; the shell is not.
- A redirect inside one page load cannot be stopped. The site it lands on is not trusted, and the next
  page load there asks.
- A click on a site where clicks run without asking is not shown to you first. The guard sees the
  agent's description of the element, not what the click does. Such a click can take the browser to
  another site, as a redirect can, or answer a bot check, and only the fetch skill's rules hold the
  agent back there.
- The bulk-download stop acts after the call, so the downloads one action started are already under way.
  It sees only the downloads reported in that call's result, so downloads in a pop-up window, or ones
  that start after the result, do not stop the batch.
- The sites shipped in `guard/known-sites.json` are trusted without an earlier approval of yours. The
  batch prompt lists the known redirects, and `/lit-fetch-ladder:sites` lists the click sites.
- A page that loads another page by itself, with no navigation or click from the agent, is not counted,
  and a click there is judged as if on the page before.
- More papers from a publisher already in the batch are bounded by the page budget, not prevented.
- A site approved by mistake stays allowed in batches that include the site it follows, until you forget
  it with `/lit-fetch-ladder:sites`.
- A tokenised download link on a site that is not proxied is refused only by the fetch skill's rule.
- Shadow libraries such as Sci-Hub are kept out only by the fetch skill's rule. The guard does not
  block them.
- Without Node neither the guard nor the browsers run. If the guard fails while judging a file, shell or
  Zotero call, the call goes ahead. Only browser calls fail closed.

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

A batch in the library browser may load 5 pages for each approved paper, shared across the batch. On top of that, 20 page loads per burst (a burst ends after 15
minutes without a page load) and 60 per 24 hours are hard limits. On a campus network or library VPN the
library browser runs without a login, under the same approvals and limits. These cover a careful survey
and stop a runaway one. They are set in `guard/guard.mjs`, and you can lower them there.
[Use it responsibly](../README.md#use-it-responsibly) says why they are low.

## What is sent where

Your contact email goes only to OpenAlex and Unpaywall, in the request parameter each asks for. Every
other request the tools make, to doi.org, the publisher pages it redirects to, and open-access hosts, identifies itself only as
`lit-fetch-ladder/<version>`. The browsers talk to the sites they open and identify themselves as the
desktop Chrome they are. Their user agent leaves out the word "Headless", which some sites refuse
outright, and nothing else about them is disguised. Nothing is sent to the author of this plugin.

## Security scanners

Pattern-based scanners for agent plugins can rate this one as dangerous, and NVIDIA's SkillSpector
(v2.13.4) labels it CRITICAL. They match the guard itself, whose tests check that it denies opening
`file:///etc/passwd` in the browser and fetching a proxied address with `curl`, and the red-team page,
which carries planted instructions on purpose. The plugin also reads its settings from Claude Code's
settings files. Read the code and [`SECURITY.md`](../SECURITY.md) before installing.
