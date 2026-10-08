# lit-fetch-ladder

Fetch papers for a literature survey with a coding agent, open access first, and reach the rest
through your own library login, with the prompt-injection safeguards enforced as code.

It climbs a ladder and stops at the lowest rung that works:

| Rung | What it does | Runs where |
|---|---|---|
| 0 | find and rank papers, or a paper's references (OpenAlex) | anywhere with Python 3.9+ |
| 1 | download a legal open-access copy (Unpaywall, OpenAlex) | anywhere with Python 3.9+ |
| 2 | open pages that refuse a plain HTTP client, in a headless browser | Claude Code plugin |
| 3 | the same browser carrying your library login | Claude Code plugin |

Every request ends in one recorded state in a manifest (`OA_FETCHED`, `NEEDS_AUTH`,
`PROXY_FETCHED`, `ABSTRACT_ONLY`, `UNRESOLVED`, ...), so a survey can say what it missed.

Rungs 2 and 3 use [Microsoft's Playwright MCP server](https://github.com/microsoft/playwright-mcp),
pinned to `@playwright/mcp@0.0.78`. This plugin adds the configuration, the batch driver and the
guard around it.

## Install (Claude Code)

```
/plugin marketplace add ShoRoy/lit-fetch-ladder
/plugin install lit-fetch-ladder@fetch-ladder
```

Claude Code then asks for two settings, which you can change later in `/config`:

| Setting | What to enter |
|---|---|
| Your email | Any address of yours. Unpaywall, which finds legal open-access copies, requires one, and OpenAlex asks for one. They are the only two services it is sent to. |
| Library proxy | Open any paywalled paper through your library's website and paste the address from the address bar, for example `https://www-sciencedirect-com.proxy.library.example.edu/science/article/...`. The plugin keeps only your library's part, here `proxy.library.example.edu`, and the doctor shows what it kept. Your library's sign-in link works too. Leave it empty on a campus network or library VPN that publishers already recognise; no library sign-in is then needed. |

Then install the browser once and check the setup:

```
npx -y -p @playwright/mcp@0.0.78 playwright install chromium
/lit-fetch-ladder:doctor
```

Requirements: Claude Code 2.1.271 or later, Node 18+, Python 3.9+. Tested on Linux. macOS and
Windows should work but are untested; reports are welcome.

## Sign in to your library (rung 3 only)

```
/lit-fetch-ladder:login
```

The skill shows you a command to run **in your own terminal**. The agent never runs it, and the plugin
blocks it from trying. A browser window opens at your library's sign-in page, which the plugin works out
from your proxy setting; sign in as you normally do, open one paper to check access, and close the
window. If the window shows an error instead, go to your library's website in that window, sign in,
open a paper through it and close the window. A library whose sign-in page lives elsewhere can be given
it with `--login-url <address>`. Only the proxy's own cookies are saved. The
sign-in provider's cookies (single sign-on, second factor) are dropped, so the saved file cannot sign
the browser in anywhere except the proxy. The file lives in the plugin's data directory, readable only
by you. Library sessions usually last a few hours; run the login again when fetches land on the
sign-in page.

### Signing in from a container

The sign-in window needs a display. Check with `echo $DISPLAY $WAYLAND_DISPLAY`; if either is set,
the window will open.

- **VS Code Dev Containers** can forward the host display into the container. In the setup this was
  built on (VS Code on Windows with WSL2), `DISPLAY` and a `vscode-wayland` socket were set inside the
  container with no configuration.
- **Plain Docker on a Linux desktop:** run the container with `-e DISPLAY -v /tmp/.X11-unix:/tmp/.X11-unix`
  and allow local clients on the host with `xhost +local:` (undo with `xhost -local:`; it lets any
  local process draw on your display).
- **Docker on Windows with WSL2:** add `-v /tmp/.X11-unix:/tmp/.X11-unix -v /mnt/wslg:/mnt/wslg
  -e DISPLAY -e WAYLAND_DISPLAY -e XDG_RUNTIME_DIR` to `docker run`.
- **macOS with Docker:** install XQuartz, enable "Allow connections from network clients", run
  `xhost +localhost`, and start the container with `-e DISPLAY=host.docker.internal:0`.
- **SSH or a headless server:** on your own machine, run the login command from a copy of this
  repository with a temporary `--data` directory and `--proxy-suffix <your library proxy>` (that
  machine has no plugin settings to read), then copy `secret/library-state.json` into the plugin's data directory on the server
  (`chmod 600` it).

## Use

```
/lit-fetch-ladder:fetch survey graph neural networks for molecular property prediction, top 10 since 2020
/lit-fetch-ladder:fetch 10.1038/nature14539 10.48550/arXiv.1706.03762
/lit-fetch-ladder:fetch the references of 10.1038/nature14539
```

The agent lists the candidates, tells you how many look open access and how many need the library,
and runs the batch. Open-access PDFs land in `lit-fetch-runs/<batch>/pdfs/` in your project. On the
first library page load Claude Code asks you to approve the batch. The prompt lists every site the
logged-in browser will open, with the number of papers on each, and the page budget:

```
approve library batch "survey": 4 paper(s), up to 20 page loads. Sites the logged-in browser will
open: journal.example (2 papers), society.example (1 paper), press.example (1 paper). One approval
covers these sites for this batch; any other site will be asked about.
```

One approval covers the batch. If the batch needs to grow, you are asked again, and the prompt says
what is new: more papers (with any new sites they bring), or a new site (with how the browser came
to it, for example a publisher's link page redirecting to its content site). A site is a
registrable domain, so `pdf.journal.example` is covered by `journal.example`; shared hosting such as
`cloudfront.net` is the exception.

A new site you approve is remembered as a companion of the site the browser came from, for example
a publisher's content site that its link site redirects to. In later batches that include the link
site, the companion is allowed without asking, and the approval prompt lists it ("Also allowed, from
your earlier approvals: content.example (follows journal.example)"). Companions never apply to a
batch without the site they follow. `/lit-fetch-ladder:sites` lists them and forgets them; nothing
can add one except your approval in a prompt. After the first batch from a publisher, a typical
batch costs one prompt.

## What the safeguards enforce

Every page the browser opens is untrusted. The rule is that fetched text is data, never
instructions. A plugin cannot ship permission rules, so the rule is enforced by a hook
(`guard/guard.mjs`) that Claude Code runs before and after every relevant tool call.

| A fetched page tries to... | What happens | Enforced or a rule |
|---|---|---|
| run code in the browser, read cookies or storage, read raw request headers | denied (`browser_evaluate`, `browser_run_code_unsafe`, cookie/storage tools, `browser_network_request`, `browser_file_upload`) | enforced |
| open `file://` or any non-http(s) address | denied (Playwright also blocks `file:` by default) | enforced |
| read the saved login | denied for Read, Edit, Grep, Glob; shell commands naming it are denied | enforced for file tools; the shell check is a pattern match, so a deliberately disguised command can slip it |
| add papers to the batch | a batch that grows needs your approval again; the prompt names the new papers and sites | enforced; you decide |
| open another site in the logged-in browser | you are asked, and the site joins the batch only if you say yes | enforced; you decide |
| redirect the logged-in browser to a site of its choosing | the redirect itself happens inside one page load and cannot be stopped; the site is not trusted, so opening it again asks and the prompt names the redirect | enforced from the next page load |
| reuse a site approved in an earlier batch | allowed only in batches that include the site it was approved from, and listed in their approval prompt | enforced; forget with `/lit-fetch-ladder:sites` |
| fetch a proxied address with `curl` or WebFetch, outside the counted browser | denied | enforced for proxied addresses; a tokenised link on a site that is not proxied is a rule in the skill |
| loop, by navigating or by clicking through pages | per-paper budget, 20 page loads per burst, 60 per 24 hours; a click or key press in the logged-in browser counts when it opens a page or a tab | enforced |
| make you run the sign-in, or run it itself | the agent is blocked from running it | enforced |
| open more papers from the same publisher within the budget | bounded by the budget, not prevented | partly |

Read-only browser calls (navigate, snapshot, screenshot, wait) and page loads inside an approved batch
are allowed by the guard outright, so they do not prompt; a plugin cannot ship allow rules, and
without this every page load would. A hook's allow never overrides a deny rule in your own settings.
Clicks, typing and other page interactions always ask. In the logged-in browser they also need an
approved batch, and one that opens a page or a tab counts as a page load; one that does not is refunded.

If the guard cannot run (for example Node is missing), the browsers cannot start either: both need
Node. If the guard fails while judging a browser call, it denies the call. Playwright MCP 0.0.78
exposes `browser_evaluate` and `browser_run_code_unsafe` even without extra capabilities and has no
option to remove them, so the guard is what stops them. For a second layer, add to `permissions.deny`
in your `~/.claude/settings.json`:

```
"mcp__plugin_lit-fetch-ladder_browse__browser_evaluate",
"mcp__plugin_lit-fetch-ladder_browse__browser_run_code_unsafe",
"mcp__plugin_lit-fetch-ladder_library__browser_evaluate",
"mcp__plugin_lit-fetch-ladder_library__browser_run_code_unsafe"
```

`tests/redteam/` replays what an agent might try after reading a page with planted instructions
(`tests/redteam/injected-page.html`) and asserts each of the guard's decisions:

```
ask    first page of the approved batch (user approves the batch)
allow  second paper of the batch
deny   read the cookies with browser_evaluate
deny   run arbitrary code in the page
deny   open the saved login as a file:// page
deny   read the saved login with the Read tool
deny   read the saved login from the shell
deny   fetch a proxied PDF with curl, outside the counted browser
deny   read raw request headers (the session cookie)
ask    send data to a collector site from the logged-in browser
ask    open another publisher through the proxy in a new tab
ask    go back to the site a page redirected the browser to
deny   run the library sign-in itself
ask    first page after the batch grew from 2 to 42 papers
ask    click through to the next article instead of navigating
deny   a page load past the batch budget (4 more loads allowed)
deny   click a link once the batch budget is spent
```

## Limits, and why they are low

Publishers watch for systematic downloading through library proxies, and the usual response is to
suspend the library's access for everyone at the institution, not only for the person who caused it.
The limits (5 page loads per approved paper, 20 per burst, 60 per 24 hours) cover a careful survey and
stop a runaway one. They are fixed in `guard/guard.mjs`; lower them there if you want them tighter. Use this for
your own research, on papers you name, with access your library already gives you.

This is open source and you can change any of it. If you raise the caps or remove a safeguard, the
consequences for you and your library are yours.

## Not on Claude Code?

Rungs 0 and 1 and the manifest work on their own:

```
pip install git+https://github.com/ShoRoy/lit-fetch-ladder
export LFL_EMAIL=you@example.org
lfl discover "graph neural networks molecular property prediction" --limit 10
lfl fetch 10.48550/arXiv.1706.03762 --batch survey --proxy-mode none
```

The two browser servers are ordinary Playwright MCP configurations (see `scripts/mcp-server.mjs`) and
work in any MCP client. The safeguards are Claude Code hooks and do not come with them, so rung 3
without them is not recommended.

## What is sent where

Your contact email goes only to OpenAlex and Unpaywall, in the request parameter each asks for.
Every other request the tools make, to doi.org and to open-access hosts, identifies itself only as
`lit-fetch-ladder/<version>`. The browsers talk to the sites they open, and identify themselves as the
desktop Chrome they are, without the word "Headless" that first-line bot checks refuse. Nothing else
about them is disguised. Nothing is sent to the author of this plugin.

## Uninstall and data

`/plugin uninstall lit-fetch-ladder` removes the plugin and its data directory, including the saved
login, unless you pass `--keep-data`. Fetched papers stay in your project's `lit-fetch-runs/`.

## Updates

The plugin pins its version. Third-party marketplaces do not update automatically by default, and the
guard is security code, so turn on auto-update for this marketplace in `/plugin` or update after
each release (see `CHANGELOG.md`).

## Development

```
node --test tests/ tests/redteam/        # guard, login scoping, red-team replay
python3 -m unittest discover -s tests    # rungs 0-1 and the manifest, offline
claude plugin validate --strict .
```

Security issues: see `SECURITY.md`. License: MIT.
