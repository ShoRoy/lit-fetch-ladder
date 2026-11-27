# Changelog

## Unreleased

- While the browser cannot start, the doctor and `--preflight` say to sign in once the browser starts,
  instead of pointing at a sign-in that cannot open a window yet.
- Docs: the Quick start is shorter again. The requirements table keeps one column of reasons, and what
  to do when the browsers do not start (missing libraries, Node installed after the plugin) moved to
  Fetching papers.

## 0.2.4

- Fewer questions. A fetch no longer checks anything up front. Only when open access leaves papers for
  a browser does it run `doctor.mjs --preflight`, and it asks about the library login only when
  papers in the batch need the library, once, with the count, and not again in the same conversation.
  A missing browser or `pdftotext` is no longer a question: the batch goes on with what works, and
  the report ends with the fix.
- Install scope is yours to choose. The README describes user scope (every folder) and local scope
  (one folder) side by side with what the guard costs wherever it loads, and the doctor states which
  scope is installed instead of suggesting a reinstall.

## 0.2.3

- The install dialog's first option, "Install for you (user scope)", loads the plugin and its guard in
  every folder, and it was picked on both test machines. The README now names the third option,
  "Install for you, in this repo only (local scope)", and the doctor notes a user-scope install with
  how to move it to one folder.
- When the browser cannot start, the sign-in's message no longer breaks mid-sentence, and the login
  skill points to the library install or to signing in on another machine instead of the terminal
  command, which would fail the same way.
- Prerequisites first. The README's Quick start opens with what must be on the machine (Node with npx,
  Python, poppler-utils, and root once on a minimal Linux), and every fetch now starts with
  `doctor.mjs --preflight`, which names each missing one with its fix before anything is fetched, says
  when only open-access copies can be fetched, and then gives the login line.

## 0.2.2

- The doctor and the sign-in check that the browser starts, not only that it is installed. On a
  minimal Linux (an Ubuntu server, WSL, a Docker image) Chromium can lack system libraries and stop at
  launch; the doctor now marks that FIX, and `/lit-fetch-ladder:login` says NOT OPENED, naming the
  missing library and `playwright install-deps chromium`. Found in a fresh install on Ubuntu 22.04.
- poppler-utils (`pdftotext`) is now listed as needed, not optional: without it a PDF cannot be checked
  against its paper, Claude Code cannot read it either, and it stays unconfirmed and unfiled. The fetch
  skill leaves such a row unconfirmed and does not install a PDF library.
- Starting npx no longer crashes when its folder is not on PATH, as with a node started by its full
  path: the node's own folder is added to the end of npx's PATH, and an npx that still cannot start
  gives a clear message instead of an unhandled error. The terminal sign-in announces the window only
  once the browser has started.
- Filing says "nothing can be written yet" for a Zotero MCP configuration without write access, such
  as the desktop route `zotero-mcp setup` writes by default before `zotero-mcp authorize-local`, instead
  of naming Zotero Storage. The setup docs and skill now give `zotero-mcp setup --no-local --no-claude`
  for the web route, which asks for the API key, library ID and WebDAV settings.
- A terminal sign-in whose browser stopped says so, instead of "the window may have been closed". The
  doctor reminds you to remove the proxy address before pasting its output into an issue.
- The README says to install Node before the plugin, and to reconnect the two browser servers in `/mcp`
  if Node came later (Claude Code otherwise waits 15 minutes before it retries them).

## 0.2.1

- Each fetch starts by checking for a saved library login (`doctor.mjs --login`, no network, never the
  file's contents). When a proxy is set and there is none, or it is more than 12 hours old, the agent
  asks whether to sign in first with `/lit-fetch-ladder:login` or to fetch without the library.
- `/lit-fetch-ladder:zotero setup` installs Zotero MCP (0.17.4 or later, with semantic search if you
  want it), has you run `zotero-mcp setup`, and installs Zotero MCP's `zotero-cli` skill in the folder,
  so fetching, filing and working with the library run as one pipeline.
- More publishers' own platforms where a click in the library browser runs without asking inside an
  approved batch: ACS, Biochemical Society (Portland Press), Cambridge University Press, Cold Spring
  Harbor Laboratory Press, Company of Biologists, IOP (with ECS), John Benjamins, Microbiology Society,
  PNAS, Royal Society and Royal Society of Chemistry.
- Guard: a batch's first page load must be on a site its approval prompt names, so the prompt cannot
  approve a page load to a site it does not show. The batch name and new DOIs in the prompt are shown
  as printable text only, so a manifest cannot rewrite or push down the prompt. zotero-cli's short
  command names (`n`, `ann`, `coll`), flags before a subcommand, shortened global flags and an annotation
  batch that replaces existing ones now ask, like the full spellings. A shell command that takes the
  plugin's data directory as a whole (`grep -r`, `tar`, `cp -r`, `cd` or a glob on it) is refused, since
  the saved login is inside it; a path inside it and the `--data` argument still work.
- Files are named after the paper's DOI, so two papers whose links end alike (`/pdf`) or two pages saved
  under one name no longer overwrite each other and get filed under the wrong item.
- DOI links (`https://doi.org/...`, `dx.doi.org`, `doi: ...`) and arXiv IDs or links are read as DOIs,
  not as titles to search for.
- `lfl discover --refs-of` returns up to 200 references instead of the first 15.
- The doctor checks for the Chromium build the pinned Playwright MCP needs, not any Chromium.
- The sign-in checks that a display answers before it opens the window, not only that one is named.
  When `DISPLAY` is set but no X server answers (VS Code's forwarding on Windows), the window opens on
  Wayland. When no display answers, or the browser stops at once, `/lit-fetch-ladder:login` says NOT
  OPENED and why, instead of OPENING. The doctor runs the same check.
- Guard: `zotero-cli config --show-secrets` (Zotero MCP 0.17), which prints the API key and WebDAV
  password, asks first.
- Fewer prompts in the library browser. The plugin ships `guard/known-sites.json`: sites publishers are
  known to redirect to (Elsevier's link site to sciencedirect.com and its file host), which a batch
  that includes the publisher lists in its one approval prompt, and sites where a click in the library
  browser runs without asking inside an approved batch. A click you approve on a site the batch approved
  adds that site to the click list, and `/lit-fetch-ladder:sites` lists and forgets the learned ones. A
  click in the browser without a login no longer asks, since that browser already opens any address
  unasked. The fetch skill navigates to a PDF link's address instead of clicking it where it can.
- The guard stops a batch when one page load or click starts more than one download, or an archive
  (a whole issue, for example), tells the user, and asks again at the next page load with the reason. A
  learned click site that led to it loses its trust.
- zotero-mcp 0.16.0 writes attached files to WebDAV directly, and from 0.17.1 `zotero-mcp setup` asks
  for the WebDAV settings and keeps them on a re-run (zotero-mcp #806 and #820, which came out of this
  plugin's filing runs). docs/zotero.md and the message for a full Zotero Storage quota now name the
  version to use.
- Guard: two Zotero MCP tools added in zotero-mcp 0.16 and 0.17 now ask before they run:
  `zotero_manage_collection` when it updates or deletes a collection (a delete is permanent; a create
  passes, as filing may need one) and `zotero_copy_items_between_libraries`. The hook's matcher changed,
  so restart Claude Code after updating.
- Fetch skill: the agent stops at a bot check or captcha on a publisher's page and leaves the paper
  staged for the user, without clicking through, retrying or looking for another route.
- Docs: the README is now a short overview with a schematic of the pipeline, from the rungs to filing
  into Zotero MCP. The details moved to four pages in `docs/` (signing in, fetching papers, filing into
  Zotero, safeguards), and the guard's known limits moved from SECURITY.md to Safeguards. Safeguards now
  states that the browser without a login opens any http(s) address without asking, what the guard
  hook costs per tool call, that it refuses a shell command naming the sign-in script or the proxy's
  domain, and that only browser calls fail closed. Added CONTRIBUTING.md, two issue forms, and tests
  that run on pull requests and pushes to main. The doctor and the skills point at the new pages.
- Contributions: pull requests are welcome outside the security-sensitive paths, which a check on each
  pull request enforces; changes to those come from the author, and ideas for them come as issues.
- The two settings are changed with `/plugin configure lit-fetch-ladder@fetch-ladder`, which the
  README, the doctor and the sign-in now say; an install from a shell does not ask for them.

## 0.2.0

- `lfl zotero --batch <name>` files a finished batch into Zotero through `zotero-cli` (it ships with
  Zotero MCP): each paper the batch could read is added by DOI (an item that already carries the DOI
  is reused), its PDF or saved page text is attached under a DOI-based name, and a note records the
  batch, the date, how the paper was obtained and the file's hash, titled after the batch. A row without
  full text (`ABSTRACT_ONLY`) is never filed: it serves that round's review and nothing more. Rows the
  batch could not read are listed, not filed; the manifest records each filing,
  so a re-run files only new rows. `--dry-run` prints the commands. Filing is opt-in: it has its own
  skill, `/lit-fetch-ladder:zotero`, which runs only when the user asks; a fetch never touches Zotero.
  The doctor reports whether `zotero-cli` is found.
- Filing protocol: everything filed carries the tag `lit-fetch-ladder` and lands in
  `lit-fetch-ladder/<batch>`; a paper already in the library joins the collection and gets the note but
  keeps its own file, so nothing of the user's is duplicated or replaced. A full Zotero Storage quota
  (zotero-mcp up to 0.15.2 uploads there first even with WebDAV) stops the run at the first refused
  file, with Zotero's message.
- Guard: `zotero-cli` commands and Zotero MCP tools that trash, merge, bulk-edit or switch the library
  ask before they run; filing never needs them. `lfl zotero --trash KEY...` moves a listed set of items to
  Zotero's trash in one guarded command, so undoing a filing is one confirmation rather than one per item.
  The guard also asks when Zotero credentials or the target library are set on the command line, on
  inline code against the Zotero modules, on `zotero-mcp setup` and `authorize-local`, and on a note
  update through Zotero MCP; it reads shell text through quotes, escapes and line breaks; adding or
  attaching a file from the plugin's secret or state directory is refused.
- Saved page text is `.yml`, which `zotero-cli` attaches and Zotero indexes (zotero-mcp 0.15 or
  later). Text in a type it does not take stays on disk, and the note says where.
- Only an attachment that holds a file counts as the item's file: an empty shell left by a refused
  upload, a web link, a saved web page or an attachment in Zotero's trash does not, so the fetched file
  is attached. A failed upload is tried once more, then is an error; an item that was added before its
  file failed is reported with its key and kept for the next run, which retries the file on that item.
  Uploads may take up to 300 s (`ZOTERO_WEBDAV_TIMEOUT` overrides). A refresh keeps the note it wrote
  before, and refiles papers after a `--trash`. A dry run leaves the manifest untouched.
- Every fetched file is checked against the paper it was fetched for: the title of record (or the
  part before a colon) and the first author's surname on its first pages, read with `pdftotext` when
  installed. Rung 1 drops an open copy that fails and tries the next (up to three), so a copy
  mislabelled in OpenAlex is no longer taken for the paper; `mark` records the result. A file that
  could not be checked (no `pdftotext`, a scan) or that failed is confirmed by reading its first page
  and running `lfl confirm`; only confirmed files are filed into Zotero. The doctor reports whether
  `pdftotext` is found.
- Ranking of open copies: an arXiv DOI takes arXiv's own PDF first, and a copy with no known host
  ranks below one with a host. OpenAlex listed, for "Attention Is All You Need", files labelled
  accepted versions on a preprint server with no source, one of them an unrelated paper; they used
  to rank first.
- `mark` drops the row's staging remark when a file is recorded, so it no longer reaches the Zotero
  note, and takes `--url` for a file that came from another address than the row's landing page.
- Staging drops a publisher's cookie-check query from the landing address (Nature's
  `?error=cookies_not_supported&code=...`), which through the proxy showed the access options instead
  of the article. `lfl mark --state OA_FETCHED --path <file>` records an open copy the browser saved
  (rung 2). The doctor finds the plugin's data directory on its own when run by hand. An arXiv DOI
  (`10.48550/arXiv.<id>`) is added as its arXiv page, since zotero-cli's DOI route asks CrossRef, which
  does not carry DataCite DOIs.

## 0.1.0

First release.

- Rungs 0-1 (`lfl discover`, `lfl fetch`): OpenAlex discovery and citation-chasing, Unpaywall/OpenAlex
  open-access download, a manifest with one recorded end state per request.
- Rungs 2-3: Microsoft's Playwright MCP server (`@playwright/mcp@0.0.78`) as two browsers, one without
  credentials and one carrying a saved library login (EZproxy hostname form, or none for an entitled
  network).
- Guard hook: denies code-execution, cookie, storage, raw-network and upload tools; asks before page
  interaction, and in the logged-in browser charges a click or key press that opens a page or a
  tab to the page budget (refunded when it opens nothing); requires a batch approval for the logged-in browser and again when the batch grows;
  asks before unapproved sites; per-paper budget, 20 loads per burst, 60 per 24 hours; protects the
  saved login and its own state; blocks proxied addresses outside the browser and the agent running
  the sign-in.
- Two settings: your email, and your library proxy. Paste a paper's address or the library's sign-in
  link and the plugin keeps the proxy's part; leave it empty on an entitled network (campus or VPN).
  The sign-in page is worked out from the proxy. The scripts read both settings themselves, so no
  command line carries the proxy.
- Both browsers identify as desktop Chrome of the bundled version, without "Headless".
- `/lit-fetch-ladder:login` opens the sign-in window itself, in the background, and the login is saved
  when the window closes; only the user can run it. The terminal command remains the fallback.
- Login keeps only the proxy's cookies.
- Saved page text is checked: `lfl mark` warns, and notes in the manifest, when it has no references
  section, since many publishers load the article body after the page. The fetch skill waits for the
  body before saving. Each browser server runs in its own download folder, so a snapshot saved under a
  short file name never lands loose in the user's project.
- Nothing runs at session start, so sessions that never fetch a paper see nothing from the plugin.
  The README recommends installing it for the one folder used for literature surveys.
- The contact email goes only to OpenAlex and Unpaywall, in the parameter each asks for. Every other
  request (doi.org, open-access hosts) names the tool and nothing else.
- Batch approval names every site (registrable domain) the logged-in browser will open, with paper
  counts. Growth asks again: more papers, or a new site. A site reached by a redirect is not trusted
  until the user approves it.
- Approved sites are remembered as companions of the site the browser came from (for example a link
  site's content site) and allowed, listed in the prompt, in later batches that include that site.
  `/lit-fetch-ladder:sites` lists and forgets them.
