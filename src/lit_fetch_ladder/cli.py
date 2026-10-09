"""Command-line front end: `lfl discover|resolve|proxify|fetch|mark|show`."""
import argparse
import json
import os
import sys

from . import discover, fetch, net, proxify, resolve, settings


def _env(name, default=None):
    return os.environ.get(name) or default


def main(argv=None):
    ap = argparse.ArgumentParser(prog="lfl", description="Fetch papers for a literature survey, open access first.")
    ap.add_argument("--email", help="contact address for OpenAlex/Unpaywall (or LFL_EMAIL)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("discover", help="rung 0: ranked search, or a paper's references")
    d.add_argument("query", nargs="?")
    d.add_argument("--refs-of", metavar="DOI")
    d.add_argument("--limit", type=int, default=15)
    d.add_argument("--from-year", type=int)
    d.add_argument("--open-access", action="store_true")
    d.add_argument("--json", action="store_true")

    r = sub.add_parser("resolve", help="rung 1: find a legal open-access copy")
    r.add_argument("doi", nargs="?")
    r.add_argument("--title")
    r.add_argument("--download", metavar="DIR")
    r.add_argument("--json", action="store_true")

    p = sub.add_parser("proxify", help="rewrite a URL (or a DOI's landing page) to the proxy form")
    p.add_argument("url", nargs="?")
    p.add_argument("--doi")
    p.add_argument("--proxy-suffix")
    p.add_argument("--json", action="store_true")

    f = sub.add_parser("fetch", help="run a batch: open access first, the rest staged for the library browser")
    f.add_argument("identifiers", nargs="*", help="DOIs and/or titles")
    f.add_argument("--from-json", help="a `discover --json` file; its DOIs join the batch")
    f.add_argument("--batch", required=True)
    f.add_argument("--base", default=_env("LFL_BASE", "lit-fetch-runs"))
    f.add_argument("--data", default=_env("LFL_DATA"), help="plugin data directory (points the guard at this batch)")
    f.add_argument("--proxy-mode", default=_env("LFL_PROXY_MODE"), choices=fetch.MODES,
                   help="default: ezproxy-host when a library proxy is set, otherwise none (campus or VPN)")
    f.add_argument("--proxy-suffix")
    f.add_argument("--pages-per-paper", type=int, default=fetch.DEFAULT_PAGES_PER_PAPER)
    f.add_argument("--refresh", action="store_true")

    m = sub.add_parser("mark", help="record the library browser's result for one staged paper")
    m.add_argument("doi")
    m.add_argument("--batch", required=True)
    m.add_argument("--base", default=_env("LFL_BASE", "lit-fetch-runs"))
    m.add_argument("--state", required=True, choices=sorted(fetch.MARKABLE))
    m.add_argument("--path")
    m.add_argument("--note")

    s = sub.add_parser("show", help="print a batch manifest")
    s.add_argument("--batch", required=True)
    s.add_argument("--base", default=_env("LFL_BASE", "lit-fetch-runs"))

    a = ap.parse_args(argv)

    if a.cmd == "show":
        print(json.dumps(fetch.load(fetch.paths(a.base, a.batch)[1], a.batch), indent=2))
        return 0

    if a.cmd == "mark":
        row = fetch.mark(a.batch, a.base, a.doi, a.state, a.path, a.note,
                         email=a.email or _env("LFL_EMAIL") or settings.plugin_option("contact_email"))
        print("marked %s -> %s%s" % (row["doi"], row["state"], "  (%s)" % row["path"] if row.get("path") else ""))
        if row.get("warning"):
            print("WARNING: %s. Wait for the article body and save the page again, or mark it ABSTRACT_ONLY." % row["warning"])
        return 0

    email = net.contact_email(a.email)

    if a.cmd == "discover":
        if not a.query and not a.refs_of:
            ap.error("give a query or --refs-of DOI")
        try:
            rows = discover.refs_of(a.refs_of, email, a.limit) if a.refs_of else \
                discover.search(a.query, email, a.limit, a.from_year, a.open_access)
        except RuntimeError as e:
            print("error: %s" % e, file=sys.stderr)
            return 2
        if a.json:
            print(json.dumps(rows, indent=2))
        for i, row in enumerate([] if a.json else rows, 1):
            au = (row["authors"][0] + (" et al." if len(row["authors"]) > 1 else "")) if row["authors"] else "?"
            print("%2d. [%s] %.70s (%s) %s | cited %s | doi:%s"
                  % (i, "OA" if row["is_oa"] else "  ", row["title"] or "?", row["year"], au, row["cited_by"], row["doi"]))
        return 0

    if a.cmd == "resolve":
        if not a.doi and not a.title:
            ap.error("give a DOI or --title")
        code, res = resolve.resolve(email, doi=a.doi, title=a.title, download_dir=a.download)
        print(json.dumps(res, indent=2) if a.json else _resolve_text(code, res))
        return code

    if a.cmd == "proxify":
        suffix = proxify.suffix_from(a.proxy_suffix)
        src, note = a.url, None
        if a.doi:
            src, note = proxify.landing_url(a.doi)
        if not src:
            print("error: could not resolve the DOI (%s)" % note, file=sys.stderr)
            return 2
        out = proxify.proxify_url(src, suffix)
        print(json.dumps({"source": src, "proxied": out}) if a.json else out)
        return 0

    # fetch
    ids = list(a.identifiers)
    if a.from_json:
        with open(a.from_json) as fh:
            ids += [r["doi"] for r in json.load(fh) if r.get("doi")]
    if not ids:
        ap.error("give DOIs/titles or --from-json")
    mode = a.proxy_mode or ("ezproxy-host" if proxify.configured_suffix(a.proxy_suffix) else "none")
    cfg = {"email": email, "mode": mode, "data": a.data,
           "suffix": proxify.suffix_from(a.proxy_suffix) if mode == "ezproxy-host" else None}
    manifest, mpath = fetch.run(ids, a.batch, a.base, cfg, refresh=a.refresh)
    print(fetch.report(manifest, mpath, a.pages_per_paper))
    return 0


def _resolve_text(code, res):
    if code == resolve.UNRESOLVED:
        return "no confident DOI for that title; closest matches:\n" + "\n".join(
            "  - %s (%s)" % (c["title"], c["doi"]) for c in res.get("candidates") or [])
    if code == resolve.ERROR:
        return "error: %s" % res.get("error")
    lines = ["DOI:   %s" % res["doi"], "Title: %s" % (res.get("title") or "?"),
             "Year:  %s   open access: %s (%s)" % (res.get("year"), res.get("is_oa"), res.get("oa_status"))]
    for c in res["oa_locations"]:
        lines.append("  [%s] %s  <%s, %s>" % ("PDF " if c["pdf"] else "page", c["pdf"] or c["landing"],
                                            c.get("version") or "?", c.get("host") or "?"))
    if not res["oa_locations"]:
        lines.append("No open-access copy: a candidate for the library browser.")
    if res.get("downloaded"):
        lines.append("Downloaded: %s %s" % (res["downloaded"].get("path"), res["downloaded"].get("warning") or ""))
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
