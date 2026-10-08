"""Rung 3 helper: rewrite a publisher URL to its library-proxy form.

For the common EZproxy hostname scheme (the convention Zotero and Lean Library
use) the publisher host is rewritten with '-' doubled and '.' turned into '-',
then the proxy suffix is appended:

    https://www.example.com/article/1  ->  https://www-example-com.<suffix>/article/1

This only rewrites addresses. Authentication comes from the saved library login
that the plugin's library browser carries; nothing here sees a credential.
"""
import os
import re
import urllib.parse

from . import net, settings

# The tail of a publisher host written the EZproxy way (www-example-com).
PUBLISHER_TAIL = re.compile(r"-(com|org|net|edu|gov|io|info|int|uk|de|fr|jp|cn|au|ca|nl|ch|it|es|se|eu|in|kr|br|ru|pl)$")


def normalize_suffix(raw):
    """The proxy setting as people paste it: the bare ending (proxy.library.example.edu), the
    address of a paper opened through the library (https://www-example-com.proxy.library.example.edu/...),
    or the library's sign-in link (https://login.proxy.library.example.edu/login?url=...). Returns the
    ending the proxy adds to publisher hostnames, or "". Same as proxySuffix in scripts/common.mjs."""
    s = (raw or "").strip().lower()
    if not s:
        return ""
    if "://" in s:
        s = urllib.parse.urlsplit(s).hostname or ""
    labels = re.split(r"[/?#]", s)[0].split(":")[0].strip(".").split(".")
    if len(labels) > 2 and "-" in labels[0] and PUBLISHER_TAIL.search(labels[0]):
        labels.pop(0)
    if len(labels) > 2 and labels[0] == "login":
        labels.pop(0)
    return ".".join(labels)


def configured_suffix(explicit=None):
    """The proxy from the command line, LFL_PROXY_SUFFIX, or the plugin's settings; "" if none."""
    return normalize_suffix(explicit or os.environ.get("LFL_PROXY_SUFFIX") or settings.plugin_option("proxy_suffix"))


def suffix_from(explicit=None):
    s = configured_suffix(explicit)
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
