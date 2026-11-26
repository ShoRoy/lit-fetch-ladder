"""Small stdlib HTTP helpers shared by the tools. No third-party dependencies."""
import json
import os
import re
import urllib.error
import urllib.request

from . import __version__, settings

TIMEOUT = 25
# Every request names the tool and nothing else. The contact email is not in it: only the
# OpenAlex and Unpaywall API calls carry it, in the query parameter those services ask for.
USER_AGENT = "lit-fetch-ladder/%s" % __version__


def contact_email(explicit=None):
    """The address sent to OpenAlex and Unpaywall, and only to them.

    Unpaywall refuses requests without one, so a missing address is an error,
    never a silent default.
    """
    email = (explicit or os.environ.get("LFL_EMAIL") or settings.plugin_option("contact_email") or "").strip()
    if not email or "@" not in email:
        raise SystemExit("error: set a contact email with --email or LFL_EMAIL "
                         "(OpenAlex and Unpaywall ask for one; it is sent only to them)")
    return email


def get(url, want="json"):
    """GET a URL. Returns (payload, None) or (None, error_string)."""
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json" if want == "json" else "*/*",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        return None, "HTTP %s" % e.code
    except Exception as e:  # network errors, timeouts, TLS
        return None, "%s: %s" % (type(e).__name__, e)
    if want != "json":
        return data, None
    try:
        return json.loads(data), None
    except ValueError as e:
        return None, "bad JSON: %s" % e


def file_stem(doi):
    """A file name made from a DOI, so two papers in one batch never share a file."""
    return re.sub(r"[^A-Za-z0-9._-]+", "_", doi)


DOI_PREFIX = re.compile(r"^(?:(?:https?://)?(?:dx\.)?doi\.org/|doi:\s*)", re.IGNORECASE)
# A new-style arXiv ID, bare or as an arXiv link, is the paper's DataCite DOI.
ARXIV_ID = re.compile(r"^(?:arxiv:\s*|(?:https?://)?(?:www\.)?arxiv\.org/(?:abs|pdf)/)?(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$",
                      re.IGNORECASE)


def norm_doi(s):
    s = DOI_PREFIX.sub("", (s or "").strip())
    m = ARXIV_ID.match(s)
    if m:
        s = "10.48550/arxiv." + m.group(1)
    return s.lower() or None
