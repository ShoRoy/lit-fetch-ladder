# Filing into Zotero

This part is optional. A fetch never touches Zotero, and without Zotero MCP none of this page applies.

## Where the plugin stops and Zotero MCP starts

[Zotero MCP](https://github.com/54yyyu/zotero-mcp) (`zotero-mcp-server`) is a separate project that puts
your Zotero library in any AI agent. Once a batch has run, this plugin files each paper it could read,
with its file and a note saying how it was obtained. The plugin's part ends there. Searching, reading,
citing and annotating your library is Zotero MCP's.

## Set up

Install Zotero MCP 0.15 or later, or 0.16 or later if you sync files over WebDAV. From 0.17.1,
`zotero-mcp setup` also asks for the WebDAV settings and keeps them. Zotero MCP needs Python 3.10+.

```
uv tool install zotero-mcp-server      # or: pipx install zotero-mcp-server
zotero-mcp setup
```

Zotero MCP writes to the running Zotero desktop or through the web API. The desktop route needs Zotero
10 or newer, `zotero-mcp authorize-local`, and **Always Allow** in the dialog Zotero shows. The web route
works with any Zotero version and needs an API key and your library ID, which `zotero-mcp setup` asks
for. Use your personal library, not a group library. `/lit-fetch-ladder:doctor` reports whether
`zotero-cli` is found.

## File a batch

After a batch, run `/lit-fetch-ladder:zotero <batch>` or ask the agent to file it. The batch name is the
batch's folder under `lit-fetch-runs/`. Add `--collection "Reading list"` to file into a collection of
your own, or `--dry-run` to print the `zotero-cli` commands and the notes without running them. Outside
Claude Code the same command is `lfl zotero --batch <batch>`
([Without Claude Code](usage.md#without-claude-code)). If `zotero-cli` is not on the agent's PATH, point
at it with `--zotero-cli <path>` or the `LFL_ZOTERO_CLI` environment variable.

## What filing does

Only a paper whose file was confirmed as the paper is filed (see
[Fetching papers](usage.md#what-comes-back)). Filing adds the item by DOI. An arXiv DOI is added as its
arXiv page, which Zotero files as a preprint. The item goes into the collection `lit-fetch-ladder/<batch>`,
or the one `--collection` names, with the tag `lit-fetch-ladder`, so one tag shows everything the plugin
ever filed. The PDF or saved page text is attached under a name made from the DOI. A note titled after
the batch records the date, how the paper was obtained, the file's name and hash, the local path of a
file that stayed on disk, any warning, and the agent's remark. Anything that reads your notes reads these
back, an agent working through Zotero MCP included.

A paper already in your library is reused, not duplicated. It joins the collection and gets the note,
and keeps the file it has, so a fetched file is attached only to an item without one. When filing writes
through the web API, its duplicate check sees only what Zotero has synced, so let Zotero sync before
filing a paper you added moments ago.

A paper without full text (`ABSTRACT_ONLY`) is never filed, since it serves only that round's review.
Papers the batch could not read are listed, not filed, and a second run files only new rows. The manifest
records each filing under `zotero`. Saved page text is a `.yml` file, which Zotero stores as text and
indexes, so it is searchable in Zotero and readable through Zotero MCP.

## Undo a filing

`--trash KEY...` undoes a filing that went wrong. It moves the listed items to Zotero's trash
(recoverable) in one command, so the guard asks once for the whole list instead of once per item.
Nothing else in the plugin deletes anything. The manifest still records a trashed filing, so to file
those papers again, run the filing with `--refresh`.

## Uploads, WebDAV and Zotero Storage

A WebDAV upload that fails is tried once more. A paper whose item was added but whose file did not land
is reported with its item key, and the next run retries the file on that same item.

Zotero MCP before 0.16.0 uploads each file to Zotero Storage first, even when WebDAV is configured, and
with a full quota Zotero refuses the file. The run then stops at the first refused file and says so.

## The other way round

`zotero-cli coverage` lists the items in your library that have no PDF, with their DOIs. Give those DOIs
to `/lit-fetch-ladder:fetch` and file the batch back.

## What the guard asks about

Filing only adds, attaches and annotates. In a folder where this plugin is installed, the guard asks
before the agent edits, trashes, merges or deletes anything in your library, copies items to another
library or switches libraries, through `zotero-cli` or Zotero MCP's own tools. Creating an item, note or
collection does not ask. It also asks before `zotero-mcp setup` or `authorize-local`, which are yours to
run. [Safeguards](safeguards.md) lists the rules and their limits.
