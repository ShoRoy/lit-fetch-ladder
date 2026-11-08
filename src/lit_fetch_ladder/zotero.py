"""Filing a finished batch into Zotero, through zotero-cli (it ships with Zotero MCP).

Zotero MCP adds a paper by DOI with its open-access PDF; for a paywalled paper it stores the
metadata and no file. This files what the batch could read:

    OA_FETCHED, PROXY_FETCHED   the item, the PDF or the saved page text, and a note, once the
                                file was found to be the paper (the row's `verified`)
    every other state           not filed; listed in the report. A paper without full text
                                (ABSTRACT_ONLY) serves that round's review and nothing more.

The protocol towards the user's library: everything lands in the collection
lit-fetch-ladder/<batch> and carries the tag lit-fetch-ladder, so one tag shows all of it. An
item is added with if-exists=file, so a paper already in the library is reused (collection and
note added, no duplicate item) and keeps the file it has: the fetched file is attached only when
the item has none. The manifest row records the filing under "zotero", so a re-run files only
new rows. Filing only adds, attaches and annotates; it never merges or edits. The one deletion is
the undo, trash(): it moves the items the user lists to Zotero's trash, which is recoverable.
"""
import datetime
import json
import os
import re
import subprocess

from . import fetch

FILED = ("OA_FETCHED", "PROXY_FETCHED")
TAG = "lit-fetch-ladder"
# The file types zotero-cli attaches (zotero-mcp 0.15). Saved page text is .yml, which Zotero
# stores as text and indexes; an .html or .txt file stays on disk and the note says where.
ATTACHABLE = {".pdf", ".epub", ".djvu", ".doc", ".docx", ".odt", ".rtf", ".md", ".yaml", ".yml"}
KEY_RE = re.compile(r"Item key: `([A-Z0-9]{8})`")
# zotero-cli's DOI route asks CrossRef, which does not carry DataCite's arXiv DOIs; an arXiv paper
# goes in as its arXiv page instead, which zotero-cli files as a preprint.
ARXIV_DOI = re.compile(r"^10\.48550/arxiv\.(.+)$", re.IGNORECASE)
EXISTING = "Already in library"
NO_WRITE_PATH = "Cannot perform write operations"
# Zotero's answer when an upload would overflow the account's Zotero Storage quota. zotero-mcp
# up to 0.15.2 uploads to Zotero Storage first even when WebDAV is configured, so the refusal
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
        reply = json.loads(p.stdout)
    except ValueError:
        raise ZoteroError("no JSON from zotero-cli: %s" % (p.stderr.strip() or p.stdout.strip())[:300])
    if not reply.get("ok"):
        raise ZoteroError((reply.get("error") or {}).get("message") or "zotero-cli failed")
    if data:
        return reply.get("data")
    text = (reply.get("data") or {}).get("text") or ""
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


KEY_OK = re.compile(r"[A-Z0-9]{8}")  # checked with fullmatch: `$` would let a trailing newline through


def trash(keys, cli="zotero-cli", dry_run=False):
    """Move the listed items to Zotero's trash, one zotero-cli call each but one command for the
    agent, so the plugin's guard asks once for the whole list. For undoing a filing that went
    wrong. Zotero's trash is recoverable. Returns (report lines, items trashed, ok)."""
    lines, done, ok = [], 0, True
    for key in keys:
        if not KEY_OK.fullmatch(key):
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
    """Whether the item already carries a file: an attachment that holds one (its md5 is set) or
    a link to a file on disk. An empty shell left by a failed upload, a web link, a saved web page
    (a connector snapshot, text/html) and an attachment in Zotero's trash are not one.
    The children listing is a summary, so each attachment's own record is read for its link mode."""
    kids = call(cli, ["get", "children", key], data=True, env=env) or {}
    rows = kids.get("items") if isinstance(kids, dict) else kids
    for r in rows or []:
        r = r.get("data") or r
        if r.get("itemType") != "attachment":
            continue
        a = call(cli, ["get", "metadata", r["key"]], data=True, env=env) or {}
        a = a.get("data") or a
        if a.get("deleted") or a.get("contentType") == "text/html":
            continue
        mode = a.get("linkMode") or ""
        if mode == "linked_file" or (mode.startswith("imported") and a.get("md5")):
            return True
    return False


WEBDAV_FAILED = "WebDAV upload failed"


def attach(cli, att, env=None):
    """One attach, tried twice when the WebDAV upload fails: zotero-mcp removes the empty shell on
    such a failure, so the retry is clean. A released zotero-mcp reports the failure inside a success
    answer ("(WARNING: WebDAV upload failed ...)"); the WebDAV-first fix reports it as an error."""
    for attempt in (1, 2):
        try:
            answer = call(cli, att, env=env)
        except ZoteroError as e:
            if WEBDAV_FAILED not in str(e) or attempt == 2:
                raise
            continue
        if "(WARNING:" not in answer:
            return answer
        if attempt == 2:
            raise ZoteroError("the file did not land, on two tries: %s" % answer)


def has_note(cli, key, batch, env=None):
    """Whether the item already carries this batch's filing note."""
    reply = call(cli, ["notes", "list", "--item-key", key], data=True, env=env) or {}
    mark = 'lit-fetch-ladder: batch "%s"' % batch
    return any(mark in ((n.get("data") or n).get("text") or "") for n in reply.get("notes") or [])


def how(row):
    """How the batch obtained the paper, for the note."""
    kind = row.get("kind") or ("pdf" if (row.get("path") or "").lower().endswith(".pdf") else "fulltext")
    if row["state"] == "OA_FETCHED":
        where = row.get("url") or "an open-access host"
        return ("open-access PDF from %s" if kind == "pdf" else "open-access page text saved from %s") % where
    return ("PDF fetched through the library login" if kind == "pdf"
            else "page text saved through the library login (the publisher showed a viewer, not a file)")


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
    if row.get("note"):
        lines.append("Note: %s." % row["note"])
    return "\n".join(lines)


def plan(row, collection, batch):
    """The zotero-cli commands that file one row: the add, the attach (None when the row has no
    file or the file is not a type zotero-cli takes) and the note command, titled after the batch
    (zotero-cli would title it "CLI Note"). "<key>" is filled in once the add has answered."""
    path = row.get("path") or ""
    ext = os.path.splitext(path)[1].lower()
    m = ARXIV_DOI.match(row["doi"])
    source = ["url", "https://arxiv.org/abs/" + m.group(1)] if m else ["doi", row["doi"]]
    add = ["add"] + source + ["-c", collection, "--create-collections", "--tags", TAG,
                              "--if-exists", "file", "--attach-mode", "none"]
    stored = re.sub(r"[^A-Za-z0-9._-]+", "_", row["doi"]) + ext
    att = ["attach", "<key>", "--file", path, "--filename", stored] if path and ext in ATTACHABLE else None
    note = ["notes", "create", "--item-key", "<key>", "--title", "%s: %s" % (TAG, batch), "--text", "-"]
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
    hybrid = filing_env(env)
    if hybrid:
        head += " (the configuration is in local mode; filing uses the web API so the duplicate check sees your whole library)"
    extra = dict(hybrid)
    if "ZOTERO_WEBDAV_TIMEOUT" not in os.environ:  # a large PDF on a slow uplink needs more than zotero-mcp's 60 s
        extra["ZOTERO_WEBDAV_TIMEOUT"] = "300"
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
        if row.get("verified") is not True:
            lines.append("  skip  %-13s %s (file not confirmed as the paper: read its first page, then "
                         "lfl confirm %s --batch %s)" % (st, doi, doi, batch))
            continue
        add, att, note = plan(row, collection, batch)
        state = "attached" if att else ("not_attachable" if row.get("path") else None)
        if dry_run:
            lines.append("  would %-13s %s" % (st, doi))
            for cmd in (add, att):
                if cmd:
                    lines.append("        zotero-cli " + " ".join(cmd))
            lines.append("        zotero-cli %s  <<< %s" % (" ".join(note), note_text(row, batch, when, state).replace("\n", " / ")))
            continue
        key = None
        try:
            answer = call(cli, add, env=extra)
            m = KEY_RE.search(answer)
            if not m:
                raise ZoteroError("no item key in zotero-cli's answer: %s" % answer[:200])
            key = m.group(1)
            existing = EXISTING in answer
            partial = row.get("zotero_partial") or {}
            if partial.get("key") == key:  # an earlier run added this item, then its file failed
                existing = partial["existing"]
            if att and existing and has_file(cli, key, extra):
                att, state = None, "kept"
            if att:
                att[1] = key
                answer = attach(cli, att, extra)
            note[3] = key
            kept_note = bool(row.get("zotero")) and has_note(cli, key, batch, extra)  # a refresh keeps the note it wrote
            if not kept_note:
                call(cli, note, stdin=note_text(row, batch, when, state), env=extra)
        except ZoteroError as e:
            msg = " ".join(l.strip() for l in str(e).splitlines() if l.strip())
            if key:  # the item exists but its file or note did not land: keep its key for the next run
                row["zotero_partial"] = {"key": key, "existing": existing}
            if NO_WRITE_PATH in msg:
                fetch.write_json(mpath, manifest)
                lines.append("\nzotero-cli has no way to write to your library. Its message:\n%s" % msg)
                return lines, filed, False
            if QUOTA_FULL in msg:
                fetch.write_json(mpath, manifest)
                lines.append("\nZotero refused the file: the account's Zotero Storage quota is full. zotero-mcp "
                             "up to 0.15.2 uploads to Zotero Storage first even when WebDAV is configured, so "
                             "every file in this run would be refused. Free quota, use local mode or a zotero-mcp "
                             "with the WebDAV-first attach, then rerun: rows already filed are kept. Zotero's "
                             "message:\n%s" % msg)
                return lines, filed, False
            where = ("" if not key else " [your item %s; the next run retries]" % key if existing
                     else " [item %s was added; the next run retries its file, or --trash %s removes it]" % (key, key))
            lines.append("  ERROR %-13s %s: %s%s" % (st, doi, msg[:300], where))
            continue
        row.pop("zotero_partial", None)
        row["zotero"] = {"key": key, "collection": collection, "attachment": att[5] if att else None,
                         "filed": when, "existing": existing}
        filed += 1
        tail = (" (already in your library: collection%s added, its file kept)" % ("" if kept_note else " and note")
                if state == "kept" else "" if att else " (no file attached)")
        if kept_note:
            tail += " (its note from this batch kept)"
        lines.append("  filed %-13s %s -> %s%s" % (st, doi, key, tail))
    if not dry_run:  # a dry run leaves the manifest untouched
        fetch.write_json(mpath, manifest)
    return lines, filed, True
