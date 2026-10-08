"""lit-fetch-ladder: fetch papers for a literature survey, open access first.

Rungs 0-1 (discovery, open-access download) and the batch manifest live here and
run anywhere Python 3.9+ does. Rungs 2-3 (the headless browser, and the same
browser carrying a library login) are driven by a coding agent through the
Claude Code plugin in this repository, which also carries the safeguards.
"""
__version__ = "0.1.0"
