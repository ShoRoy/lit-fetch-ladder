# Changelog

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
