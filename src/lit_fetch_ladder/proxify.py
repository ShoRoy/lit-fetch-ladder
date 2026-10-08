"""Rung 3 helper: rewrite a publisher URL to its library-proxy form.

For the common EZproxy hostname scheme (the convention Zotero and Lean Library
use) the publisher host is rewritten with '-' doubled and '.' turned into '-',
then the proxy suffix is appended:

    https://www.example.com/article/1  ->  https://www-example-com.<suffix>/article/1

This only rewrites addresses. Authentication comes from the saved library login
that the plugin's library browser carries; nothing here sees a credential.
"""
import os
import urllib.parse

from . import net


def suffix_from(explicit=None):
    s = (explicit or os.environ.get("LFL_PROXY_SUFFIX") or "").strip().strip(".").lower()
    if not s:
        raise SystemExit("error: set your library's proxy suffix with --proxy-suffix or LFL_PROXY_SUFFIX "
                         "(for example proxy.library.example.edu; your library's site lists it)")
    return s


def is_proxied(host, suffix):
    host = (host or "").lower()
    return host == suffix or host.endswith("." + suffix)  # label boundary, not a bare endswith


def rewrite_host(host, suffix):
    host = host.lower()
    if is_proxied(host, suffix):
        return host
    return host.replace("-", "--").replace(".", "-") + "." + suffix


def proxify_url(url, suffix):
    if "://" not in url:
        url = "https://" + url
    p = urllib.parse.urlsplit(url)
    if not p.hostname:
        raise ValueError("no host in URL: %r" % url)
    if is_proxied(p.hostname, suffix):
        return url
    netloc = rewrite_host(p.hostname, suffix) + (":%d" % p.port if p.port else "")
    return urllib.parse.urlunsplit((p.scheme or "https", netloc, p.path, p.query, p.fragment))


def landing_url(doi):
    """Follow doi.org to the publisher's landing page. Many publishers answer a
    script with 403, but the redirect target is still the landing URL."""
    import urllib.error
    import urllib.request
    req = urllib.request.Request("https://doi.org/" + urllib.parse.quote(net.norm_doi(doi)),
                                 headers={"User-Agent": net.USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=net.TIMEOUT) as r:
            return r.geturl(), None
    except urllib.error.HTTPError as e:
        return getattr(e, "url", None), "HTTP %s" % e.code
    except Exception as e:
        return None, "%s: %s" % (type(e).__name__, e)
