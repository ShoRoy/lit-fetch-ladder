# Fetching papers

## Ask for papers

```
/lit-fetch-ladder:fetch survey graph neural networks for molecular property prediction, top 10 since 2020
/lit-fetch-ladder:fetch 10.1038/nature14539 10.48550/arXiv.1706.03762
/lit-fetch-ladder:fetch the references of 10.1038/nature14539
```

The agent first checks your library login ([Signing in](sign-in.md)). It lists the candidates, tells
you how many look open access and how many need the library, and runs the batch. It climbs a ladder and stops at the lowest rung that works.

| Rung | What it does | Runs where |
|---|---|---|
| 0 | find and rank papers, or a paper's references (OpenAlex) | [anywhere with Python 3.9+](#without-claude-code) |
| 1 | download a legal open-access copy (Unpaywall, OpenAlex) | [anywhere with Python 3.9+](#without-claude-code) |
| 2 | open pages that refuse a plain HTTP client, in the browser without a login | Claude Code plugin |
| 3 | open the rest in the library browser, the same browser carrying your library login (no login on a campus network or library VPN) | Claude Code plugin |

The plugin works from DOIs and arXiv IDs, or links to either, and matches a bare title to a DOI through
OpenAlex. A paper without a DOI, such as a NeurIPS paper from 2012, is outside what it fetches
and files.

## What comes back

Files land in `lit-fetch-runs/<batch>/` in your project, PDFs in `pdfs/` and saved page text in
`fulltext/`. Every request ends in one recorded state in the batch's manifest (`OA_FETCHED`,
`NEEDS_AUTH`, `PROXY_FETCHED`, `ABSTRACT_ONLY`, `UNRESOLVED`, ...). Saved text without a references
section gets a warning, and a paper whose article body never loads is marked `ABSTRACT_ONLY`.

Every file is also checked against the paper it was fetched for, by the title of record and the first
author's surname on its first pages. An open copy that fails is dropped and the next one tried, so a
mislabelled copy on a preprint server is not taken for the paper. PDFs are read with `pdftotext` when it
is installed. Without it, or for a scan, the agent reads the first page and records the result with
`lfl confirm`.

## Approving a library batch

On the first library page load Claude Code asks you to approve the batch. The prompt lists every site
the library browser will open, with the number of papers on each, and the page budget.

```
approve library batch "survey": 4 paper(s), up to 20 page loads. Sites the logged-in browser will
open: journal.example (2 papers), society.example (1 paper), press.example (1 paper). One approval
covers these sites for this batch; any other site will be asked about.
```

If the batch grows, you are asked again, and the prompt names the new papers, or the new site and how
the browser reached it. A site is a registrable domain, so `pdf.journal.example` is covered by
`journal.example`, except on shared hosting such as `cloudfront.net`.

When you approve a site the browser reached from another one, the plugin remembers it as following that
site. Later batches that include that site allow it without asking and list it in their prompt. Only
your approval adds one, and `/lit-fetch-ladder:sites` lists and forgets them. After the first batch from
a publisher, a batch usually costs one prompt.

The plugin also ships a short list of sites that publishers are known to redirect to, in
`guard/known-sites.json`, for example sciencedirect.com for Elsevier's link site. A batch that includes
the publisher lists them in its prompt as known redirects, so the one approval covers them.

The agent opens a PDF link by its address where the page gives one, so it rarely needs to click. A
click in the library browser asks you unless its site is in the shipped list (publishers' own journal
platforms) or you approved a click there before, and no click runs outside an approved batch
([Safeguards](safeguards.md#what-the-guard-enforces)). If one action starts more than one download, or
an archive, the guard stops the batch.

## PDFs that open in a viewer

Some publishers, Oxford Academic, ACM and HAL among them, show a PDF in the browser's viewer instead of
downloading it, and only a link that triggers a download lands a file. Otherwise the agent saves the
article's page text, which Zotero indexes, and notes that the PDF is a manual export.

On Linux, the browser downloads every PDF when the managed policy `AlwaysOpenPdfExternally` is set.
Playwright's browser is Chrome for Testing, which reads its own policy directory:

```
sudo mkdir -p /etc/opt/chrome_for_testing/policies/managed
echo '{"AlwaysOpenPdfExternally": true}' | sudo tee /etc/opt/chrome_for_testing/policies/managed/pdf.json
```

The doctor checks that the file is in place. Its location on macOS and Windows has not been checked.

## When a paper does not come back

Some publishers put a bot check in front of their articles or files, and it can come and go from day to
day. The agent stops at it and does not try to get past it. Open the paper yourself through your
library, and do not retry it in a loop, since repeated attempts are what bot checks and library proxies
watch for. The "publisher does not download" issue form collects such sites.

Each library pays for its own set of journals. A paper your library does not cover shows a purchase or
"get access" page, and the agent marks it `ABSTRACT_ONLY` with a note.

## Without Claude Code

Rungs 0 and 1 and the manifest work on their own, with no dependencies beyond Python 3.9.

```
pip install git+https://github.com/ShoRoy/lit-fetch-ladder
export LFL_EMAIL=you@example.org
lfl discover "graph neural networks molecular property prediction" --limit 10
lfl fetch 10.48550/arXiv.1706.03762 --batch survey --proxy-mode none
lfl zotero --batch survey              # file it into Zotero, with zotero-cli installed
```

Filing needs Zotero MCP's `zotero-cli` ([Filing into Zotero](zotero.md)). The two browser servers
(`scripts/mcp-server.mjs`) run in any MCP client that sets `CLAUDE_PLUGIN_DATA` (and `LFL_PROXY_SUFFIX`
for the library browser) in the server's environment, but the guard is Claude Code hooks and does not
come with them, so rung 3 without it is not recommended.
