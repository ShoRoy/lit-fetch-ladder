"""Rung 1: find a legal open-access copy through Unpaywall and OpenAlex.

Published open access, accepted manuscripts, preprints and repository deposits
all count. No authentication and no proxy are involved here; a paper with no open
copy is reported as such and becomes a candidate for the library browser.
"""
import os
import urllib.parse

from . import net

VER_RANK = {"publishedVersion": 0, "acceptedVersion": 1, "submittedVersion": 2}

# Return codes, kept from the command-line tool this was ported from.
FOUND, NO_OA, UNRESOLVED, ERROR = 0, 3, 4, 2


def title_to_doi(title, email):
    """Resolve a free-text title to a DOI. Returns (doi, candidates, error)."""
    q = urllib.parse.urlencode({"search": title, "per_page": 3, "mailto": email})
    js, err = net.get("https://api.openalex.org/works?" + q, email)
    if err:
        return None, [], err
    cands = [{"title": w.get("title"), "doi": net.norm_doi(w.get("doi")), "year": w.get("publication_year")}
             for w in js.get("results", [])]
    return (cands[0]["doi"] if cands and cands[0]["doi"] else None), cands, None


def _loc(pdf, landing, version, license_, host, source):
    return {"pdf": pdf, "landing": landing, "version": version,
            "license": license_, "host": host, "source": source}


def from_unpaywall(doi, email):
    js, err = net.get("https://api.unpaywall.org/v2/%s?email=%s"
                      % (urllib.parse.quote(doi), urllib.parse.quote(email)), email)
    if err:
        return None, [], err
    meta = {"title": js.get("title"), "year": js.get("year"),
            "is_oa": js.get("is_oa"), "oa_status": js.get("oa_status")}
    locs = [_loc(l.get("url_for_pdf"), l.get("url_for_landing_page") or l.get("url"),
                 l.get("version"), l.get("license"), l.get("host_type"), "unpaywall")
            for l in [js.get("best_oa_location")] + (js.get("oa_locations") or []) if l]
    return meta, locs, None


def from_openalex(doi, email):
    js, err = net.get("https://api.openalex.org/works/https://doi.org/%s?mailto=%s"
                      % (urllib.parse.quote(doi), urllib.parse.quote(email)), email)
    if err:
        return None, [], err
    oa = js.get("open_access") or {}
    meta = {"title": js.get("title"), "year": js.get("publication_year"),
            "is_oa": oa.get("is_oa"), "oa_status": oa.get("oa_status")}
    cand = ([js["best_oa_location"]] if js.get("best_oa_location") else []) \
        + [l for l in (js.get("locations") or []) if l.get("is_oa")]
    locs = [_loc(l.get("pdf_url"), l.get("landing_page_url"), l.get("version"), l.get("license"),
                 (l.get("source") or {}).get("display_name"), "openalex") for l in cand]
    return meta, locs, None


def _rank(locs):
    seen, uniq = set(), []
    for c in locs:
        key = c["pdf"] or c["landing"]
        if key and key not in seen:
            seen.add(key)
            uniq.append(c)
    uniq.sort(key=lambda c: (0 if c["pdf"] else 1, VER_RANK.get(c["version"], 3)))
    return uniq


def download(url, outdir, email):
    """Fetch one PDF. Returns (path, warning). The magic-byte check catches the
    HTML landing or challenge pages that many 'PDF' links actually return."""
    os.makedirs(outdir, exist_ok=True)
    data, err = net.get(url, email, want="bytes")
    if err:
        return None, err
    is_pdf = data[:5] == b"%PDF-"
    base = urllib.parse.urlparse(url).path.rsplit("/", 1)[-1] or "download"
    if not base.lower().endswith(".pdf"):
        base += ".pdf" if is_pdf else ".bin"
    path = os.path.join(outdir, base)
    with open(path, "wb") as f:
        f.write(data)
    return path, None if is_pdf else "not a PDF (an HTML landing or challenge page)"


def resolve(email, doi=None, title=None, download_dir=None):
    """Find (and optionally download) an open-access copy. Returns (code, result)."""
    candidates = None
    if not doi:
        doi, candidates, err = title_to_doi(title, email)
        if err:
            return ERROR, {"error": "title lookup failed: %s" % err}
        if not doi:
            return UNRESOLVED, {"query": title, "candidates": candidates}
    doi = net.norm_doi(doi)

    mu, lu, eu = from_unpaywall(doi, email)
    mo, lo, eo = from_openalex(doi, email)
    if eu and eo:
        return ERROR, {"doi": doi, "error": "unpaywall: %s; openalex: %s" % (eu, eo)}
    meta = {k: ((mu or {}).get(k) if (mu or {}).get(k) is not None else (mo or {}).get(k))
            for k in ("title", "year", "is_oa", "oa_status")}
    locs = _rank((lu or []) + (lo or []))
    result = dict(meta, doi=doi, oa_locations=locs, downloaded=None,
                  candidates=candidates)
    if download_dir and locs:
        target = next((c for c in locs if c["pdf"]), None)
        if target:
            path, warn = download(target["pdf"], download_dir, email)
            result["downloaded"] = {"path": path, "url": target["pdf"], "warning": warn}
        else:
            result["downloaded"] = {"path": None, "warning": "no direct PDF link among open copies; landing pages only"}
    return (FOUND if locs else NO_OA), result
