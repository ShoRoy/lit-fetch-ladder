# Filing into Zotero

Filing is optional, and a fetch never touches Zotero. After a batch, the plugin files each paper it could
read, with its file and a note on how it was obtained, through `zotero-cli`, which ships with
[Zotero MCP](https://github.com/54yyyu/zotero-mcp) (`zotero-mcp-server`), a separate project. Searching,
reading, citing and annotating your library is Zotero MCP's.

## Set up

Run `/lit-fetch-ladder:zotero setup` in the folder where you use the plugin. The agent installs Zotero
MCP (0.17.4 or later), asks you to run its setup in your own terminal, and then installs Zotero
MCP's `zotero-cli` skill in the folder's `.claude/skills/`. After a restart of Claude Code, the agent
there can file batches and also search, read, cite and annotate your library. If you want semantic
search over the full text of your papers, say so when asked: it adds Zotero MCP's `semantic` extra, a
download of a few GB, and `zotero-mcp update-db --fulltext` builds the index. By hand, the same is:

```
uv tool install "zotero-mcp-server>=0.17.4"    # or "zotero-mcp-server[semantic]>=0.17.4"; or pipx
zotero-mcp setup --no-local --no-claude        # web route: API key, library ID, WebDAV settings
zotero-mcp install-skill --target claude        # in the folder where you use the plugin
```

Zotero MCP needs Python 3.10+. The web route (`--no-local`) works with any Zotero version, also from a
container, and asks for an API key, your library ID and WebDAV settings. Plain `zotero-mcp setup` sets up
the desktop route instead, which writes only after `zotero-mcp authorize-local` and **Always Allow** in
Zotero (10 or newer, same machine). `--no-claude` skips the Claude Desktop configuration. A filing's
first line says where files will go, or that nothing can be written yet. Use your personal library,
not a group library. Filing works with Zotero MCP 0.15 or later. If you sync files
over WebDAV, use 0.17.4 or later: earlier versions upload to Zotero Storage first (before 0.16) or give
up on a WebDAV upload after 10 seconds. `/lit-fetch-ladder:doctor` reports whether `zotero-cli` is found.

## File a batch

After a batch, run `/lit-fetch-ladder:zotero <batch>` or ask the agent to file it. The batch name is the
batch's folder under `lit-fetch-runs/`. Add `--collection "Reading list"` to file into a collection of
your own, or `--dry-run` to print the `zotero-cli` commands and the notes without running them. Outside
Claude Code the same command is `lfl zotero --batch <batch>`
([Without Claude Code](usage.md#without-claude-code)). If `zotero-cli` is not on the agent's PATH, point
at it with `--zotero-cli <path>` or the `LFL_ZOTERO_CLI` environment variable.

## What filing does

Only a paper whose file was confirmed as the paper is filed (see
[Fetching papers](usage.md#what-comes-back)). The rest, `ABSTRACT_ONLY` included, are listed, and a
second run files only new rows. Filing adds the item by DOI, an arXiv paper as a preprint. The item goes
into the collection `lit-fetch-ladder/<batch>`, or the one `--collection` names, with the tag
`lit-fetch-ladder`, so one tag shows everything the plugin ever filed. The PDF or saved page text is
attached under a name made from the DOI. A note titled after the batch records the date, how the paper
was obtained, the file's name and hash, the local path of a file that stayed on disk, any warning, and
the agent's remark. Anything that reads your notes reads these back, an agent working through Zotero MCP
included.

A paper already in your library is reused, not duplicated. It joins the collection and gets the note,
and keeps the file it has, so a fetched file is attached only to an item without one. When filing writes
through the web API, its duplicate check sees only what Zotero has synced, so let Zotero sync before
filing a paper you added moments ago. A file that fails to upload is reported with its item key, and the
next run retries it on the same item.

The manifest records each filing under `zotero`. Saved page text is attached when it is a `.yml`, `.yaml` or
`.md` file, which Zotero indexes as text. Text in another type stays on disk, and the note says where.

## Undo a filing

`--trash KEY...` undoes a filing that went wrong. It moves the listed items to Zotero's trash
(recoverable) in one command, so the guard asks once for the whole list instead of once per item.
Nothing else in the plugin deletes anything. The manifest still records a trashed filing, so to file
those papers again, run the filing with `--refresh`.

## The other way round

`zotero-cli coverage` lists the items in your library that have no PDF, with their DOIs. Give those DOIs
to `/lit-fetch-ladder:fetch` and file the batch back.

## What the guard asks about

Filing only adds, attaches and annotates. In a folder where this plugin is installed, the guard asks
before the agent edits or removes anything else in your library, copies items to another library or
switches libraries, through `zotero-cli` or Zotero MCP's own tools. It also asks before `zotero-mcp
setup` or `authorize-local`, which are yours to run. [Safeguards](safeguards.md) lists the rules and
their limits.
