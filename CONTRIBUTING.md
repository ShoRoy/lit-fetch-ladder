# Contributing

Issues and pull requests are welcome. This page says what belongs here, how to run the tests, and the
rules a change to the guard has to follow.

## What belongs here

lit-fetch-ladder covers finding and fetching papers, up to filing a batch into Zotero. Everything in the
library after that (search, reading, citing, annotating) belongs to
[Zotero MCP](https://github.com/54yyyu/zotero-mcp), and changes of that kind go there. Filing
stays limited to adding items, attaching files and writing a note, plus moving the plugin's own filings
to the trash.

## Reporting a problem

- **A bug.** Use the bug report form. Paste the doctor's output after removing your email and your
  library's proxy address.
- **A publisher that does not download.** Use the "publisher does not download" form. Give the DOI and
  the publisher, never your proxy address or a link copied from a logged-in page, because such links can
  carry your session.
- **A way past the guard.** Report it privately, as described in [SECURITY.md](SECURITY.md), not in a
  public issue.

## Working on the code

Clone the repository and run the tests:

```
node --test tests/*.test.mjs tests/redteam/*.test.mjs   # guard, sign-in, launcher, red-team replay
python3 -m unittest discover -s tests                     # rungs 0-1, the manifest and filing, offline
claude plugin validate --strict .                         # manifests, hooks, MCP servers, skills
```

The Python tests run offline and need nothing beyond the standard library. One test also reads a real
PDF when `pdftotext` is installed and is skipped otherwise. The same checks run on every pull request
and every push to main, on the oldest and the newest Python and Node the plugin supports.

To try a change in Claude Code, add your clone as a marketplace with
`/plugin marketplace add <path to your clone>` and install the plugin from it. Claude Code reads hooks
at start, so restart it after changing `hooks/hooks.json`.

To change the README's figures, edit `docs/assets/make_figures.py` and run it. The SVG files are
generated from it.

## Rules for the guard

The guard (`guard/guard.mjs`) is the part where a mistake turns into a hole, so a change to it follows
four rules.

- It comes with a test in `tests/guard.test.mjs` that fails before the change and passes after it.
- It keeps the red-team replay in `tests/redteam/` passing, and adds a line to it when the change
  concerns something a planted instruction could try.
- It keeps `hooks/hooks.json` and the guard's own list of tools in step.
- It never raises the page-load limits or removes a check. Lowering them is welcome.

An entry in `guard/known-sites.json` widens what one approval covers, so add one only for a redirect or
a site seen in a real run, and say in the pull request where you saw it.

A change that sends data to a new place updates "What is sent where" in
[docs/safeguards.md](docs/safeguards.md). A new dependency needs a reason. The Python tools have none,
and the plugin pins one npm package, `@playwright/mcp`. Bumping that pin also means bumping
`CHROME_MAJOR` in `scripts/common.mjs` to the Chrome version it bundles.

## Commits and pull requests

Say what a change does and why, in plain words. Add a line to the "Unreleased" section of
[CHANGELOG.md](CHANGELOG.md) for anything a user would notice.
