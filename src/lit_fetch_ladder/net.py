"""Small stdlib HTTP helpers shared by the tools. No third-party dependencies."""
import json
import os
import urllib.error
import urllib.request

TIMEOUT = 25


def contact_email(explicit=None):
    """The address sent to OpenAlex/Unpaywall as the polite-pool contact.

    Unpaywall refuses requests without one, so a missing address is an error,
    never a silent default.
    """
    email = (explicit or os.environ.get("LFL_EMAIL") or "").strip()
    if not email or "@" not in email:
        raise SystemExit("error: set a contact email with --email or LFL_EMAIL "
                         "(OpenAlex and Unpaywall ask for one; it is sent nowhere else)")
    return email


def get(url, email, want="json"):
    """GET a URL. Returns (payload, None) or (None, error_string)."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "lit-fetch-ladder/0.1 (mailto:%s)" % email,
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


def norm_doi(s):
    s = (s or "").strip()
    for pre in ("https://doi.org/", "http://doi.org/", "doi:"):
        if s.lower().startswith(pre):
            s = s[len(pre):]
    return s.lower() or None
