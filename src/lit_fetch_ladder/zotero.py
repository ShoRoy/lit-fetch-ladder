"""Filing a finished batch into Zotero, through zotero-cli (it ships with Zotero MCP).

Zotero MCP adds a paper by DOI with its open-access PDF; for a paywalled paper it stores the
metadata and no file. This files what the batch got:

    OA_FETCHED, PROXY_FETCHED   the item, the PDF or the saved page text, and a note
    ABSTRACT_ONLY               the item and a note saying why there is no file
    every other state           not filed; listed in the report

The protocol towards the user's library: everything lands in the collection
lit-fetch-ladder/<batch> and carries the tag lit-fetch-ladder, so one tag shows all of it. An
item is added with if-exists=file, so a paper already in the library is reused (collection and
note added, no duplicate item) and keeps the file it has: the fetched file is attached only when
the item has none. The manifest row records the filing under "zotero", so a re-run files only
new rows. Filing only adds, attaches and annotates; it never deletes, merges or edits.
"""
import datetime
import json
import os
import re
import subprocess

from . import fetch

FILED = ("OA_FETCHED", "PROXY_FETCHED", "ABSTRACT_ONLY")
TAG = "lit-fetch-ladder"
# The file types zotero-cli attaches (zotero-mcp 0.15). Saved page text is .yml, which Zotero
# stores as text and indexes; an .html or .txt file stays on disk and the note says where.
ATTACHABLE = {".pdf", ".epub", ".djvu", ".doc", ".docx", ".odt", ".rtf", ".md", ".yaml", ".yml"}
KEY_RE = re.compile(r"Item key: `([A-Z0-9]{8})`")
EXISTING = "Already in library"
NO_WRITE_PATH = "Cannot perform write operations"
# Zotero's answer when an upload would overflow the account's Zotero Storage quota. zotero-mcp
# up to 0.15.1 uploads to Zotero Storage first even when WebDAV is configured, so the refusal
# would repeat for every file in the run.
QUOTA_FULL = "exceed quota"


class ZoteroError(Exception):
    pass


def call(cli, args, stdin=None, data=False, env=None):
    """One zotero-cli command; returns the text it reports (its JSON data with data=True), or
    raises ZoteroError. env adds to the environment it runs in."""
    try:
        p = subprocess.run([cli, "--json"] + list(args), input=stdin, capture_output=True, text=True,
                           env={**os.environ, **env} if env else None)
    except OSError as e:
        raise ZoteroError("cannot run %s: %s" % (cli, e))
    try:
        env = json.loads(p.stdout)
    except ValueError:
        raise ZoteroError("no JSON from zotero-cli: %s" % (p.stderr.strip() or p.stdout.strip())[:300])
    if not env.get("ok"):
        raise ZoteroError((env.get("error") or {}).get("message") or "zotero-cli failed")
    if data:
        return env.get("data")
    text = (env.get("data") or {}).get("text") or ""
    if text.startswith(("Error", "Failed")):
        raise ZoteroError(text)
    return text


WEBDAV_KEYS = ("ZOTERO_WEBDAV_URL", "ZOTERO_WEBDAV_USERNAME", "ZOTERO_WEBDAV_PASSWORD")


def settings(cli):
    """zotero-cli's configuration, values masked, so only presence counts."""
    return (call(cli, ["config"], data=True) or {}).get("settings") or {}


def filing_env(env):
    """Environment for the filing calls. When the configuration is in local mode but writes go
    through the web API anyway (hybrid: an API key, no local API key), zotero-cli runs its
    duplicate check on the read client, the Zotero desktop's local API; where that is unreachable,
    as in a container, the check finds nothing and a second item is created. ZOTERO_LOCAL=false puts
    the check on the web API, which sees the whole library. A local write is left alone."""
    local = env.get("ZOTERO_LOCAL", "").lower() in ("true", "yes", "1")
    if local and env.get("ZOTERO_API_KEY") and not env.get("ZOTERO_LOCAL_API_KEY"):
        return {"ZOTERO_LOCAL": "false"}
    return {}


def route(env):
    """Where zotero-cli will put the files, from its configuration. zotero-mcp decides per upload
    from the same values: WebDAV-first when the three WebDAV values are set and the write goes
    through the web API to a personal library; Zotero Storage, with its quota, otherwise; a local
    write hands the file to the running Zotero."""
    if env.get("ZOTERO_LOCAL_API_KEY"):
        return "route: files go to the running Zotero desktop, which syncs them itself"
    if env.get("ZOTERO_LIBRARY_TYPE") == "group":
        return "route: files go to Zotero Storage (a group library cannot use WebDAV; the quota applies)"
    missing = [k for k in WEBDAV_KEYS if not env.get(k)]
    if not missing:
        return "route: files go to WebDAV"
    if len(missing) < len(WEBDAV_KEYS):
        return ("route: WARNING, WebDAV is only partly configured (%s missing), so files go to Zotero "
                "Storage and the quota applies" % ", ".join(missing))
    return "route: files go to Zotero Storage (the quota applies); set %s in zotero-mcp's config to use WebDAV" % "/".join(WEBDAV_KEYS)


KEY_OK = re.compile(r"^[A-Z0-9]{8}$")


def trash(keys, cli="zotero-cli", dry_run=False):
    """Move the listed items to Zotero's trash, one zotero-cli call each but one command for the
    agent, so the plugin's guard asks once for the whole list. For undoing a filing that went
    wrong. Zotero's trash is recoverable. Returns (report lines, items trashed, ok)."""
    lines, done, ok = [], 0, True
    for key in keys:
        if not KEY_OK.match(key):
            lines.append("  skip  %s: not an item key (8 letters or digits)" % key)
            ok = False
            continue
        if dry_run:
            lines.append("  would zotero-cli delete item %s" % key)
            continue
        try:
            answer = call(cli, ["delete", "item", key])
        except ZoteroError as e:
            lines.append("  ERROR %s: %s" % (key, " ".join(l.strip() for l in str(e).splitlines() if l.strip())[:300]))
            ok = False
            continue
        done += 1
        lines.append("  trashed %s: %s" % (key, (answer.splitlines() or [""])[0][:160]))
    return lines, done, ok


def has_file(cli, key, env=None):
    """Whether the item already carries an attachment, i.e. a file the user has."""
    kids = call(cli, ["get", "children", key], data=True, env=env) or {}
    rows = kids.get("items") if isinstance(kids, dict) else kids
    return any((r.get("data") or r).get("itemType") == "attachment" for r in rows or [])


def how(row):
    """How the batch obtained the paper, for the note."""
    st = row["state"]
    if st == "OA_FETCHED":
        return "open-access PDF from %s" % (row.get("url") or "an open-access host")
    if st == "PROXY_FETCHED":
        kind = row.get("kind") or ("pdf" if (row.get("path") or "").lower().endswith(".pdf") else "fulltext")
        return ("PDF fetched through the library login" if kind == "pdf"
                else "page text saved through the library login (the publisher showed a viewer, not a file)")
    return "no full text: " + (row.get("note") or "no route worked after an authenticated attempt")


WHERE = {
    "attached": "",
    "kept": ", left on disk at %s (the item already has a file)",
    "not_attachable": ", left on disk at %s (not a type zotero-cli attaches)",
}


def note_text(row, batch, when, file_state):
    """The note; file_state says what happened to the row's file: attached, kept (the item in
    the library already had one), not_attachable, or None when the row has no file."""
    lines = ['lit-fetch-ladder: batch "%s", filed %s.' % (batch, when), "How: %s." % how(row)]
    if row.get("path"):
        where = WHERE[file_state]
        if "%s" in where:
            where = where % row["path"]
        lines.append("File: %s%s (sha256 %s)." % (os.path.basename(row["path"]), where, (row.get("sha256") or "")[:12]))
    if row.get("warning"):
        lines.append("Warning: %s." % row["warning"])
    if row["state"] != "ABSTRACT_ONLY" and row.get("note"):
        lines.append("Note: %s." % row["note"])
    if row["state"] == "ABSTRACT_ONLY" and row.get("abstract"):
        lines.extend(["", "Abstract (OpenAlex): %s" % row["abstract"]])
    return "\n".join(lines)


def plan(row, collection):
    """The zotero-cli commands that file one row: the add, the attach (None when the row has no
    file or the file is not a type zotero-cli takes) and the note command. "<key>" is filled in
    once the add has answered."""
    path = row.get("path") or ""
    ext = os.path.splitext(path)[1].lower()
    add = ["add", "doi", row["doi"], "-c", collection, "--create-collections", "--tags", TAG,
           "--if-exists", "file", "--attach-mode", "none"]
    stored = re.sub(r"[^A-Za-z0-9._-]+", "_", row["doi"]) + ext
    att = ["attach", "<key>", "--file", path, "--filename", stored] if path and ext in ATTACHABLE else None
    note = ["notes", "create", "--item-key", "<key>", "--text", "-"]
    return add, att, note


def file_batch(batch, base, cli="zotero-cli", collection=None, refresh=False, dry_run=False, when=None):
    """File a batch. Returns (report lines, rows filed, ok). The first answer that says there is
    no way to write to the library, or that Zotero Storage is full, ends the run: it names the
    fix, and nothing is retried."""
    rundir, mpath = fetch.paths(base, batch)
    if not os.path.exists(mpath):
        raise SystemExit("error: no batch '%s' under %s" % (batch, base))
    manifest = fetch.load(mpath, batch)
    collection = collection or "lit-fetch-ladder/%s" % batch
    when = when or datetime.date.today().isoformat()
    try:
        env = settings(cli)
        head = "  " + route(env)
    except ZoteroError as e:
        env, head = {}, "  route: unknown (%s)" % str(e).splitlines()[0][:120]
    extra = filing_env(env)
    if extra:
        head += " (the configuration is in local mode; filing uses the web API so the duplicate check sees your whole library)"
    lines, filed = [head], 0
    for row in manifest["items"]:
        doi, st = row.get("doi"), row.get("state")
        if st not in FILED or not doi:
            lines.append("  skip  %-13s %s" % (st, doi or row.get("input")))
            continue
        if row.get("zotero") and not refresh:
            z = row["zotero"]
            lines.append("  filed %-13s %s -> %s (already, %s)" % (st, doi, z["key"], z["filed"]))
            continue
        add, att, note = plan(row, collection)
        state = "attached" if att else ("not_attachable" if row.get("path") else None)
        if dry_run:
            lines.append("  would %-13s %s" % (st, doi))
            for cmd in (add, att):
                if cmd:
                    lines.append("        zotero-cli " + " ".join(cmd))
            lines.append("        zotero-cli %s  <<< %s" % (" ".join(note), note_text(row, batch, when, state).replace("\n", " / ")))
            continue
        try:
            answer = call(cli, add, env=extra)
            m = KEY_RE.search(answer)
            if not m:
                raise ZoteroError("no item key in zotero-cli's answer: %s" % answer[:200])
            key = m.group(1)
            existing = EXISTING in answer
            if att and existing and has_file(cli, key, extra):
                att, state = None, "kept"
            if att:
                att[1] = key
                call(cli, att, env=extra)
            note[3] = key
            call(cli, note, stdin=note_text(row, batch, when, state), env=extra)
        except ZoteroError as e:
            msg = " ".join(l.strip() for l in str(e).splitlines() if l.strip())
            if NO_WRITE_PATH in msg:
                fetch.write_json(mpath, manifest)
                lines.append("\nzotero-cli has no way to write to your library. Its message:\n%s" % msg)
                return lines, filed, False
            if QUOTA_FULL in msg:
                fetch.write_json(mpath, manifest)
                lines.append("\nZotero refused the file: the account's Zotero Storage quota is full. zotero-cli up to "
                             "zotero-mcp 0.15.1 uploads to Zotero Storage first even when WebDAV is configured, so "
                             "every file in this run would be refused. Free quota, use local mode or a zotero-mcp "
                             "with the WebDAV-first attach, then rerun: rows already filed are kept. Zotero's "
                             "message:\n%s" % msg)
                return lines, filed, False
            lines.append("  ERROR %-13s %s: %s" % (st, doi, msg[:300]))
            continue
        row["zotero"] = {"key": key, "collection": collection, "attachment": att[5] if att else None,
                         "filed": when, "existing": existing}
        filed += 1
        tail = (" (already in your library: collection and note added, its file kept)" if state == "kept"
                else "" if att else " (no file attached)")
        lines.append("  filed %-13s %s -> %s%s" % (st, doi, key, tail))
    fetch.write_json(mpath, manifest)
    return lines, filed, True
