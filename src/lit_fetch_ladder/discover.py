"""Rung 0: ranked discovery and citation-chasing through OpenAlex.

Discovery is the only place fetch targets come from. Citation-chasing uses the
structured `referenced_works` field of the API, never text read out of a fetched
paper, so nothing a fetched page says can add a target.
"""
import urllib.parse

from . import net

OPENALEX = "https://api.openalex.org/works"
SELECT = "id,doi,display_name,publication_year,authorships,primary_location,cited_by_count,open_access"


def _row(w):
    auth = [a.get("author", {}).get("display_name") for a in (w.get("authorships") or [])[:3]]
    ploc = w.get("primary_location") or {}
    return {
        "doi": net.norm_doi(w.get("doi")),
        "title": w.get("display_name"),
        "year": w.get("publication_year"),
        "authors": [a for a in auth if a],
        "venue": (ploc.get("source") or {}).get("display_name"),
        "cited_by": w.get("cited_by_count"),
        "is_oa": (w.get("open_access") or {}).get("is_oa"),
        "openalex_id": w.get("id"),
    }


def search(query, email, limit=15, from_year=None, oa_only=False):
    params = {"search": query, "per-page": min(limit, 50), "mailto": email,
              "sort": "relevance_score:desc", "select": SELECT}
    filt = []
    if from_year:
        filt.append("from_publication_date:%d-01-01" % from_year)
    if oa_only:
        filt.append("is_oa:true")
    if filt:
        params["filter"] = ",".join(filt)
    data, err = net.get(OPENALEX + "?" + urllib.parse.urlencode(params), email)
    if err:
        raise RuntimeError("OpenAlex: %s" % err)
    return [_row(w) for w in data.get("results", [])][:limit]


def refs_of(doi, email, limit=50):
    w, err = net.get(OPENALEX + "/doi:" + urllib.parse.quote(net.norm_doi(doi)) + "?"
                     + urllib.parse.urlencode({"mailto": email, "select": "referenced_works"}), email)
    if err:
        raise RuntimeError("OpenAlex: %s" % err)
    refs = (w.get("referenced_works") or [])[:limit]
    rows = []
    for i in range(0, len(refs), 50):  # the filter takes at most 50 ids per call
        ids = "|".join(r.rsplit("/", 1)[-1] for r in refs[i:i + 50])
        data, err = net.get(OPENALEX + "?" + urllib.parse.urlencode(
            {"filter": "openalex_id:" + ids, "per-page": 50, "mailto": email, "select": SELECT}), email)
        if err:
            raise RuntimeError("OpenAlex: %s" % err)
        rows += [_row(x) for x in data.get("results", [])]
    return rows
