# Fetching papers

Running a survey, approving a library batch, and reading what comes back.

## Ask for papers

```
/lit-fetch-ladder:fetch survey graph neural networks for molecular property prediction, top 10 since 2020
/lit-fetch-ladder:fetch 10.1038/nature14539 10.48550/arXiv.1706.03762
/lit-fetch-ladder:fetch the references of 10.1038/nature14539
```

The agent lists the candidates, tells you how many look open access and how many need the library,
and runs the batch. It climbs a ladder and stops at the lowest rung that works.

| Rung | What it does | Runs where |
|---|---|---|
| 0 | find and rank papers, or a paper's references (OpenAlex) | [anywhere with Python 3.9+](#without-claude-code) |
| 1 | download a legal open-access copy (Unpaywall, OpenAlex) | [anywhere with Python 3.9+](#without-claude-code) |
| 2 | open pages that refuse a plain HTTP client, in the browser without a login | Claude Code plugin |
| 3 | open the rest in the library browser, the same browser carrying your library login (no login on a campus network or library VPN) | Claude Code plugin |

The plugin works from DOIs and arXiv IDs. A paper with neither, such as a NeurIPS paper from 2012, is
outside what it fetches and files.

## What comes back

Open-access PDFs land in `lit-fetch-runs/<batch>/pdfs/` in your project. Files the browsers save land
beside them, a PDF in `pdfs/` and page text in `fulltext/`. Saved text without a references section is
usually a page saved before the publisher loaded the article body. The manifest marks it with a warning,
and if the article body never loads, the agent marks the paper `ABSTRACT_ONLY` instead of recording an
abstract as the paper.

Every file is also checked against the paper it was fetched for, by the title of record and the first
author's surname on its first pages. An open copy that fails is dropped and the next one tried, so a
mislabelled copy on a preprint server is not taken for the paper. PDFs are read with `pdftotext` when it
is installed. Without it, or for a scan, the agent reads the first page and records the result with
`lfl confirm`.

Every request ends in one recorded state in a manifest (`OA_FETCHED`, `NEEDS_AUTH`, `PROXY_FETCHED`,
`ABSTRACT_ONLY`, `UNRESOLVED`, ...), so a survey can say what it missed.

## Approving a library batch

On the first library page load Claude Code asks you to approve the batch. The prompt lists every site
the library browser will open, with the number of papers on each, and the page budget.

```
approve library batch "survey": 4 paper(s), up to 20 page loads. Sites the logged-in browser will
open: journal.example (2 papers), society.example (1 paper), press.example (1 paper). One approval
covers these sites for this batch; any other site will be asked about.
```

One approval covers the batch. If the batch needs to grow, you are asked again, and the prompt names
what is new, either more papers with any new sites they bring, or a new site with how the browser came
to it, for example a publisher's link page redirecting to its content site. A site is a registrable
domain, so `pdf.journal.example` is covered by `journal.example`. Shared hosting such as
`cloudfront.net` is the exception.

When you approve a site the browser reached from another one, by a redirect or a link, the plugin
remembers it as following that site. Later batches that include the site it follows allow it without
asking and list it in the approval prompt ("Also allowed, from your earlier approvals: content.example
(follows journal.example)"). It never applies to a batch without the site it follows, and only your
approval in a prompt adds one. `/lit-fetch-ladder:sites` lists and forgets them. After the first batch
from a publisher, a batch usually costs one prompt.

The plugin also ships a short list of sites that publishers are known to redirect to, in
`guard/known-sites.json`, for example sciencedirect.com for Elsevier's link site. A batch that includes
the publisher lists them in its prompt as known redirects, so the one approval covers them.

The agent opens a PDF link by navigating to its address where the page gives one, so it rarely needs to
click. A click in the library browser asks you, except on a site where clicks run without asking: one in
the shipped list (publishers seen in real runs) or one where you approved a click before. Even there a
click runs only inside an approved batch, on a site the batch approved, and counts as a page load when
it opens a page. If one page load or click starts more than one download, or an archive, the guard
stops the batch and tells you. The next page load then asks you again and gives the reason.

## PDFs that open in a viewer

Some publishers, Oxford Academic, ACM and HAL among them, show a PDF in the browser's viewer instead of
downloading it, and only a link that triggers a download lands a file. Otherwise the agent saves the
article's page text, which Zotero indexes, and notes that the PDF is a manual export.

On Linux, the browser downloads every PDF when the managed policy `AlwaysOpenPdfExternally` is set.
Playwright's browser is Chrome for Testing, which reads its own policy directory, not Chrome's or
Chromium's, and the file there is root-owned:

```
sudo mkdir -p /etc/opt/chrome_for_testing/policies/managed
echo '{"AlwaysOpenPdfExternally": true}' | sudo tee /etc/opt/chrome_for_testing/policies/managed/pdf.json
```

The doctor reports whether the file is in place and flags one left in another browser's directory. The
policy's location on macOS and Windows has not been checked.

## When a paper does not come back

Some publishers put a bot check ("Are you a robot?") in front of their article or file servers, and it
can come and go from day to day. The fetch skill tells the agent to stop at it and not try to get past
it. The paper stays staged, and you can open it yourself through your library. Do not retry it in a
loop, because repeated attempts are what bot checks and library proxies watch for. A report through the
"publisher does not download" issue form helps the docs say which sites do this.

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

Filing needs `zotero-cli`, which ships with Zotero MCP (see [Filing into Zotero](zotero.md)). The two
browser servers are ordinary Playwright MCP configurations (see `scripts/mcp-server.mjs`) and work in
any MCP client. The safeguards are Claude Code hooks and do not come with them, so rung 3 without them is
not recommended.
