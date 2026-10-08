"""The batch driver and its manifest.

Every request in a batch ends in exactly one recorded state:

    OA_FETCHED     an open-access PDF was downloaded
    OA_LANDING     open access exists, but only as a landing page
    NEEDS_AUTH     no open copy; staged for the library browser
    PROXY_FETCHED  fetched by the library browser (written back with `mark`)
    ABSTRACT_ONLY  no route worked after a real authenticated attempt; abstract kept
    EXCLUDED       resolved to the wrong paper, or dropped by the user
    UNRESOLVED     a title that matched no paper confidently
    ERROR          a network or resolver failure; retried on the next run

Rows staged for the library browser carry `auth_url`. The plugin's guard reads
the active batch through <data>/active.json and lets the library browser open
only those papers, after the user approves the batch once.
"""
import datetime
import hashlib
import json
import os
import re
import shutil
import urllib.parse
from collections import Counter

from . import net, proxify, resolve

DOI_RE = re.compile(r"^10\.\d{4,9}/\S+$")
TERMINAL = {"OA_FETCHED", "OA_LANDING", "PROXY_FETCHED", "ABSTRACT_ONLY", "EXCLUDED"}
MARKABLE = {"PROXY_FETCHED", "ABSTRACT_ONLY", "EXCLUDED", "ERROR"}
MODES = ("ezproxy-host", "none")
DAILY_CAP, DEFAULT_PAGES_PER_PAPER = 60, 5


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(65536), b""):
            h.update(b)
    return h.hexdigest()


def is_doi(s):
    return bool(DOI_RE.match(net.norm_doi(s) or ""))


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)


def paths(base, batch):
    rundir = os.path.abspath(os.path.join(base, batch))
    return rundir, os.path.join(rundir, "manifest.json")


def load(mpath, batch):
    if os.path.exists(mpath):
        with open(mpath) as f:
            return json.load(f)
    return {"batch": batch, "created": datetime.datetime.now().isoformat(timespec="seconds"), "items": []}


def auth_url_for(doi, cfg):
    """Where the library browser should open this paper: the publisher landing page,
    rewritten to the proxy form unless the network itself is entitled (mode none)."""
    landing, _ = proxify.landing_url(doi)
    if not landing or urllib.parse.urlsplit(landing).hostname in (None, "doi.org"):
        return None
    return proxify.proxify_url(landing, cfg["suffix"]) if cfg["mode"] == "ezproxy-host" else landing


def process(row, rundir, cfg):
    """Resolve and fetch one request; returns the updated manifest row."""
    code, res = resolve.resolve(cfg["email"], doi=row.get("doi"),
                                title=None if row.get("doi") else row["input"],
                                download_dir=os.path.join(rundir, "pdfs"))
    if code == resolve.UNRESOLVED:
        row.update(state="UNRESOLVED", note="no confident match for this title; disambiguate with discover",
                   candidates=res.get("candidates"))
        return row
    if code == resolve.ERROR:
        row.update(state="ERROR", note=res.get("error", "resolver or network error"))
        return row

    row.update(doi=res["doi"], title=res.get("title"), year=res.get("year"))
    if res.get("candidates"):
        row["candidates"] = res["candidates"]  # a title query: keep what it was chosen from
    if code == resolve.FOUND:
        dl = res.get("downloaded") or {}
        if dl.get("path") and not dl.get("warning"):
            row.update(state="OA_FETCHED", path=dl["path"], url=dl["url"], sha256=sha256(dl["path"]), note=None)
            return row
        if dl.get("path"):  # the "PDF" was an HTML page; do not keep it as a paper
            os.remove(dl["path"])
        landing = next((l["landing"] for l in res["oa_locations"] if l.get("landing")), None)
        row.update(state="OA_LANDING", url=landing, path=None,
                   note=dl.get("warning") or "open access, landing page only")
        staged = auth_url_for(row["doi"], cfg)
        if staged:
            row["auth_url"] = staged  # the library browser may still get the file
        return row

    staged = auth_url_for(row["doi"], cfg)
    if staged:
        row.update(state="NEEDS_AUTH", auth_url=staged, path=None,
                   note="no open copy; staged for the library browser")
    else:
        row.update(state="ERROR", path=None, note="no open copy, and the DOI did not resolve to a landing page; retry")
    return row


def run(identifiers, batch, base, cfg, refresh=False):
    """Process a batch and point the guard at it. Returns (manifest, manifest_path)."""
    if cfg["mode"] not in MODES:
        raise SystemExit("error: proxy mode must be one of %s" % ", ".join(MODES))
    rundir, mpath = paths(base, batch)
    os.makedirs(os.path.join(rundir, "pdfs"), exist_ok=True)
    manifest = load(mpath, batch)
    by_doi = {i["doi"]: i for i in manifest["items"] if i.get("doi")}
    by_input = {i["input"]: i for i in manifest["items"]}

    for raw in identifiers:
        d = net.norm_doi(raw) if is_doi(raw) else None
        existing = by_doi.get(d) or by_input.get(raw)
        if existing and not refresh:
            st = existing.get("state")
            vanished = st == "OA_FETCHED" and existing.get("path") and not os.path.exists(existing["path"])
            if (st in TERMINAL or st == "NEEDS_AUTH") and not vanished:
                continue
        row = existing or {"input": raw, "doi": d}
        if not existing:
            manifest["items"].append(row)
            by_input[raw] = row
        process(row, rundir, cfg)
        if row.get("doi"):
            by_doi[row["doi"]] = row

    write_json(mpath, manifest)
    if cfg.get("data"):
        write_json(os.path.join(cfg["data"], "active.json"), {"manifest": mpath, "batch": batch})
    return manifest, mpath


def staged(manifest):
    return [i for i in manifest["items"] if i.get("auth_url") and i.get("state") in ("NEEDS_AUTH", "OA_LANDING")]


def report(manifest, mpath, pages_per_paper=DEFAULT_PAGES_PER_PAPER):
    counts = Counter(i["state"] for i in manifest["items"])
    lines = ["batch '%s': %d request(s)" % (manifest["batch"], len(manifest["items"]))]
    for st in ("OA_FETCHED", "OA_LANDING", "NEEDS_AUTH", "PROXY_FETCHED", "ABSTRACT_ONLY",
               "EXCLUDED", "UNRESOLVED", "ERROR"):
        if counts.get(st):
            lines.append("  %-13s %d" % (st, counts[st]))
    todo = staged(manifest)
    if todo:
        need = len(todo) * pages_per_paper
        lines.append("\n%d paper(s) staged for the library browser (budget up to %d page loads)." % (len(todo), need))
        if need > DAILY_CAP:
            lines.append("  This can exceed the %d authenticated page loads allowed per 24 h; split the batch." % DAILY_CAP)
        for i in todo[:8]:
            lines.append("  - %s -> %s" % (i["doi"], i["auth_url"]))
        if len(todo) > 8:
            lines.append("  ... and %d more (see the manifest)" % (len(todo) - 8))
    titled = [i for i in manifest["items"] if i.get("candidates") and i.get("state") not in ("UNRESOLVED", "EXCLUDED")]
    if titled:
        lines.append("\n%d request(s) were bare titles: check each resolved to the right paper." % len(titled))
    lines.append("\nmanifest: %s" % mpath)
    return "\n".join(lines)


def openalex_abstract(doi, email):
    js, err = net.get("https://api.openalex.org/works/doi:%s?mailto=%s&select=abstract_inverted_index"
                      % (urllib.parse.quote(doi), urllib.parse.quote(email)))
    inv = (js or {}).get("abstract_inverted_index") if not err else None
    if not inv:
        return None
    pos = {p: w for w, places in inv.items() for p in places}
    return " ".join(pos[i] for i in sorted(pos))


def mark(batch, base, doi, state, path=None, note=None, email=None):
    """Record the outcome of the library browser's attempt on one staged paper."""
    if state not in MARKABLE:
        raise SystemExit("error: --state must be one of %s" % ", ".join(sorted(MARKABLE)))
    rundir, mpath = paths(base, batch)
    manifest = load(mpath, batch)
    d = net.norm_doi(doi)
    row = next((i for i in manifest["items"] if i.get("doi") == d), None)
    if not row:
        raise SystemExit("error: no row for %s in batch '%s'" % (d, batch))
    if state == "PROXY_FETCHED" and not row.get("auth_url"):
        raise SystemExit("error: %s was never staged for the library browser" % d)
    if path:
        if not os.path.exists(path):
            raise SystemExit("error: no such file: %s" % path)
        with open(path, "rb") as f:
            is_pdf = f.read(5) == b"%PDF-"
        dest_dir = os.path.join(rundir, "pdfs" if is_pdf else "fulltext")
        dest = os.path.abspath(path)
        if not dest.startswith(rundir + os.sep):
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, os.path.basename(path))
            shutil.copy2(path, dest)
        row.update(path=dest, sha256=sha256(dest), kind="pdf" if is_pdf else "fulltext")
    row["state"] = state
    if note is not None:
        row["note"] = note
    if state == "ABSTRACT_ONLY" and not row.get("abstract") and email:
        row["abstract"] = openalex_abstract(d, email)
    write_json(mpath, manifest)
    return row
