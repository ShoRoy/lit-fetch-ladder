"""Offline tests for the Python tools. The network is replaced with stubs.

Run: python3 -m unittest discover -s tests
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.parse
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from lit_fetch_ladder import cli, discover, fetch, net, proxify, resolve, settings  # noqa: E402


# The tests never read the real Claude Code settings of whoever runs them.
_settings = mock.patch.object(settings, "plugin_option", return_value=None)


def setUpModule():
    _settings.start()


def tearDownModule():
    _settings.stop()

SUFFIX = "proxy.example.edu"
CFG = {"email": "me@example.org", "mode": "ezproxy-host", "suffix": SUFFIX}


class Proxify(unittest.TestCase):
    def test_rewrite(self):
        self.assertEqual(proxify.proxify_url("https://www.example.com/a?b=1#c", SUFFIX),
                         "https://www-example-com.%s/a?b=1#c" % SUFFIX)

    def test_hyphen_is_doubled(self):
        self.assertEqual(proxify.rewrite_host("www.example-pub.com", SUFFIX), "www-example--pub-com." + SUFFIX)

    def test_already_proxied_is_left_alone(self):
        url = "https://pubs-journal-org.%s/x" % SUFFIX
        self.assertEqual(proxify.proxify_url(url, SUFFIX), url)

    def test_label_boundary(self):
        # a host that merely ends with the same characters is not the proxy
        self.assertFalse(proxify.is_proxied("evil" + SUFFIX, SUFFIX))
        self.assertTrue(proxify.is_proxied("a." + SUFFIX, SUFFIX))
        self.assertTrue(proxify.proxify_url("https://evil%s/x" % SUFFIX, SUFFIX).endswith("." + SUFFIX + "/x"))

    def test_scheme_and_port(self):
        self.assertEqual(proxify.proxify_url("example.com:8443/p", SUFFIX), "https://example-com.%s:8443/p" % SUFFIX)

    def test_pasted_settings_are_reduced_to_the_proxy(self):
        cases = {
            "https://login.proxy.example.edu/login?qurl=%u": SUFFIX,
            "https://www-sciencedirect-com.proxy.example.edu/science/article/pii/S1": SUFFIX,
            "onlinelibrary-wiley-com.proxy.example.edu/doi/10.1/x": SUFFIX,
            "ezproxy-prd.bodleian.ox.ac.uk": "ezproxy-prd.bodleian.ox.ac.uk",
            "https://www-jstor-org.ezproxy-prd.bodleian.ox.ac.uk/stable/1": "ezproxy-prd.bodleian.ox.ac.uk",
            "": "",
        }
        for raw, want in cases.items():
            self.assertEqual(proxify.normalize_suffix(raw), want, raw)

    def test_suffix_is_required(self):
        with mock.patch.dict(os.environ, {"LFL_PROXY_SUFFIX": ""}):
            with self.assertRaises(SystemExit):
                proxify.suffix_from(None)


class Email(unittest.TestCase):
    def test_email_is_required(self):
        with mock.patch.dict(os.environ, {"LFL_EMAIL": ""}):
            with self.assertRaises(SystemExit):
                net.contact_email(None)
        self.assertEqual(net.contact_email("a@b.org"), "a@b.org")


def fake_resolve(table):
    """Stub resolve.resolve with a per-DOI/title table of (code, result)."""
    def _resolve(email, doi=None, title=None, download_dir=None):
        code, res = table[doi or title]
        res = dict(res)
        if code == resolve.FOUND and res.get("pdf_bytes") is not None:
            os.makedirs(download_dir, exist_ok=True)
            path = os.path.join(download_dir, res["doi"].replace("/", "_") + ".pdf")
            with open(path, "wb") as f:
                f.write(res.pop("pdf_bytes"))
            with open(path, "rb") as fh:
                is_pdf = fh.read(5) == b"%PDF-"
            res["downloaded"] = {"path": path, "url": "https://repo.example/x.pdf",
                                 "warning": None if is_pdf else "not a PDF"}
        return code, res
    return _resolve


TABLE = {
    "10.1/open": (resolve.FOUND, {"doi": "10.1/open", "title": "Open", "year": 2020, "pdf_bytes": b"%PDF-1.7 x",
                                  "oa_locations": [{"pdf": "https://repo.example/x.pdf", "landing": None}]}),
    "10.1/paywalled": (resolve.NO_OA, {"doi": "10.1/paywalled", "title": "Closed", "year": 2019, "oa_locations": []}),
    "10.1/landing": (resolve.FOUND, {"doi": "10.1/landing", "title": "Landing", "year": 2018, "pdf_bytes": b"<html>",
                                     "oa_locations": [{"pdf": "https://repo.example/y", "landing": "https://repo.example/y"}]}),
    "a title nobody wrote": (resolve.UNRESOLVED, {"candidates": [{"title": "Close", "doi": "10.9/z"}]}),
    "10.1/broken": (resolve.ERROR, {"error": "HTTP 503"}),
}


def fake_landing(doi):
    return "https://www.publisher-x.com/doi/%s" % doi, None


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.data = os.path.join(self.tmp, "data")
        self.cfg = dict(CFG, data=self.data)
        p1 = mock.patch.object(resolve, "resolve", side_effect=fake_resolve(TABLE))
        p2 = mock.patch.object(proxify, "landing_url", side_effect=fake_landing)
        p1.start(), p2.start()
        self.addCleanup(p1.stop)  # not patch.stopall: that would also stop the module-wide settings stub
        self.addCleanup(p2.stop)
        self.addCleanup(shutil.rmtree, self.tmp)

    def run_batch(self, ids, **kw):
        return fetch.run(ids, "b1", self.tmp, kw.get("cfg", self.cfg))


class Driver(Base):
    def test_every_request_ends_in_one_named_state(self):
        manifest, _ = self.run_batch(["10.1/open", "10.1/paywalled", "10.1/landing", "a title nobody wrote", "10.1/broken"])
        states = {i["input"]: i["state"] for i in manifest["items"]}
        self.assertEqual(states, {"10.1/open": "OA_FETCHED", "10.1/paywalled": "NEEDS_AUTH",
                                  "10.1/landing": "OA_LANDING", "a title nobody wrote": "UNRESOLVED",
                                  "10.1/broken": "ERROR"})

    def test_open_pdf_is_hashed(self):
        manifest, _ = self.run_batch(["10.1/open"])
        row = manifest["items"][0]
        self.assertEqual(len(row["sha256"]), 64)
        self.assertTrue(os.path.exists(row["path"]))

    def test_html_masquerading_as_pdf_is_not_kept(self):
        manifest, _ = self.run_batch(["10.1/landing"])
        row = manifest["items"][0]
        self.assertIsNone(row["path"])
        self.assertEqual(os.listdir(os.path.join(self.tmp, "b1", "pdfs")), [])

    def test_staged_rows_get_a_proxied_address_and_the_guard_pointer(self):
        manifest, mpath = self.run_batch(["10.1/paywalled", "10.1/landing"])
        staged = {i["doi"]: i["auth_url"] for i in fetch.staged(manifest)}
        self.assertEqual(staged["10.1/paywalled"], "https://www-publisher--x-com.%s/doi/10.1/paywalled" % SUFFIX)
        self.assertIn("10.1/landing", staged)
        with open(os.path.join(self.data, "active.json")) as f:
            self.assertEqual(json.load(f)["manifest"], mpath)

    def test_mode_none_stages_the_unproxied_landing(self):
        manifest, _ = self.run_batch(["10.1/paywalled"], cfg=dict(self.cfg, mode="none", suffix=None))
        self.assertEqual(manifest["items"][0]["auth_url"], "https://www.publisher-x.com/doi/10.1/paywalled")

    def test_rerun_skips_finished_rows(self):
        self.run_batch(["10.1/open", "10.1/paywalled"])
        resolve.resolve.reset_mock()
        self.run_batch(["10.1/open", "10.1/paywalled"])
        resolve.resolve.assert_not_called()

    def test_report_names_bare_titles_and_the_budget(self):
        manifest, mpath = self.run_batch(["10.1/paywalled", "a title nobody wrote"])
        text = fetch.report(manifest, mpath)
        self.assertIn("1 paper(s) staged for the library browser (budget up to 5 page loads)", text)


class Mark(Base):
    def test_only_outcome_states_can_be_written(self):
        self.run_batch(["10.1/paywalled"])
        with self.assertRaises(SystemExit):
            fetch.mark("b1", self.tmp, "10.1/paywalled", "OA_FETCHED")

    def test_unstaged_rows_cannot_be_marked_fetched_under_entitlement(self):
        self.run_batch(["10.1/open"])
        with self.assertRaises(SystemExit):
            fetch.mark("b1", self.tmp, "10.1/open", "PROXY_FETCHED")

    def test_marking_copies_the_file_into_the_run_and_hashes_it(self):
        self.run_batch(["10.1/paywalled"])
        dl = os.path.join(self.tmp, "downloads")
        os.makedirs(dl)
        pdf, html = os.path.join(dl, "p.pdf"), os.path.join(dl, "p.html")
        with open(pdf, "wb") as fh:
            fh.write(b"%PDF-1.4 y")
        with open(html, "wb") as fh:
            fh.write(b"<html>full text</html>")
        row = fetch.mark("b1", self.tmp, "10.1/paywalled", "PROXY_FETCHED", path=pdf)
        self.assertTrue(row["path"].startswith(os.path.join(self.tmp, "b1", "pdfs")))
        self.assertEqual(row["kind"], "pdf")
        row = fetch.mark("b1", self.tmp, "10.1/paywalled", "PROXY_FETCHED", path=html, note="viewer only")
        self.assertTrue(row["path"].startswith(os.path.join(self.tmp, "b1", "fulltext")))
        self.assertEqual(row["kind"], "fulltext")

    def test_a_page_saved_before_the_body_loaded_is_flagged(self):
        self.run_batch(["10.1/paywalled"])
        dl = os.path.join(self.tmp, "downloads")
        os.makedirs(dl)
        page = os.path.join(dl, "page.md")
        with open(page, "w") as fh:  # what a snapshot taken too early holds
            fh.write("heading Abstract ... heading Keywords ... heading Recommended articles")
        row = fetch.mark("b1", self.tmp, "10.1/paywalled", "PROXY_FETCHED", path=page)
        self.assertEqual(row["warning"], fetch.ABSTRACT_ONLY_WARNING)
        with open(page, "w") as fh:  # the same page once the body has loaded
            fh.write("heading 1. Introduction ... heading 3. Numerical algorithms ... heading References")
        row = fetch.mark("b1", self.tmp, "10.1/paywalled", "PROXY_FETCHED", path=page)
        self.assertNotIn("warning", row)
        pdf = os.path.join(dl, "p.pdf")
        with open(pdf, "wb") as fh:  # a PDF is the paper itself and is not checked
            fh.write(b"%PDF-1.4 y")
        self.assertNotIn("warning", fetch.mark("b1", self.tmp, "10.1/paywalled", "PROXY_FETCHED", path=pdf))

    def test_abstract_only_keeps_the_abstract(self):
        self.run_batch(["10.1/paywalled"])
        with mock.patch.object(fetch, "openalex_abstract", return_value="An abstract."):
            row = fetch.mark("b1", self.tmp, "10.1/paywalled", "ABSTRACT_ONLY", email="me@example.org")
        self.assertEqual(row["abstract"], "An abstract.")


class _Resp:
    """A stand-in HTTP response: JSON for the APIs, and the request URL as the final address."""
    def __init__(self, url):
        self.url = url

    def read(self):
        return b'{"results": []}'

    def geturl(self):
        return self.url

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Privacy(unittest.TestCase):
    """The contact email goes only to OpenAlex and Unpaywall, in the query parameter they ask
    for. Every other request (doi.org, open-access hosts) names the tool and nothing else."""

    def setUp(self):
        self.sent = []

        def fake_urlopen(req, timeout=None):
            self.sent.append((req.full_url, dict(req.header_items())))
            return _Resp(req.full_url)
        p = mock.patch("urllib.request.urlopen", side_effect=fake_urlopen)
        p.start()
        self.addCleanup(p.stop)
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)

    def test_email_reaches_only_the_two_apis_and_never_a_header(self):
        email = "someone@example.org"
        discover.search("q", email, limit=1)
        discover.refs_of("10.1/x", email)
        resolve.title_to_doi("a title", email)
        resolve.from_unpaywall("10.1/x", email)
        resolve.from_openalex("10.1/x", email)
        fetch.openalex_abstract("10.1/x", email)
        resolve.download("https://repo.example/x.pdf", self.tmp)
        proxify.landing_url("10.1/x")
        enc = urllib.parse.quote(email)
        for url, headers in self.sent:
            self.assertNotIn(email, " ".join(headers.values()), url)
            self.assertNotIn("@", headers.get("User-agent", ""), url)
            if email in url or enc in url:
                self.assertIn(urllib.parse.urlsplit(url).hostname, ("api.openalex.org", "api.unpaywall.org"), url)
        hosts = {urllib.parse.urlsplit(u).hostname for u, _ in self.sent}
        self.assertTrue({"repo.example", "doi.org", "api.openalex.org", "api.unpaywall.org"} <= hosts, hosts)

    def test_user_agent_names_the_tool_only(self):
        self.assertEqual(net.USER_AGENT, "lit-fetch-ladder/0.1.0")


class Settings(unittest.TestCase):
    def test_plugin_settings_are_read_user_then_project_then_local(self):
        home, cwd = tempfile.mkdtemp(), tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, home)
        self.addCleanup(shutil.rmtree, cwd)

        def write(d, name, options):
            os.makedirs(os.path.join(d, ".claude"), exist_ok=True)
            with open(os.path.join(d, ".claude", name), "w") as fh:
                json.dump({"pluginConfigs": {"lit-fetch-ladder@fetch-ladder": {"options": options},
                                             "other@x": {"options": {"proxy_suffix": "not.this"}}}}, fh)
        self.assertEqual(settings.plugin_options(cwd, home), {})
        write(home, "settings.json", {"contact_email": "me@example.org", "proxy_suffix": "proxy.one.edu"})
        write(cwd, "settings.local.json", {"proxy_suffix": "proxy.two.edu"})
        self.assertEqual(settings.plugin_options(cwd, home), {"contact_email": "me@example.org", "proxy_suffix": "proxy.two.edu"})


class Cli(unittest.TestCase):
    def test_fetch_without_suffix_in_proxy_mode_stops(self):
        with mock.patch.dict(os.environ, {"LFL_EMAIL": "me@example.org", "LFL_PROXY_SUFFIX": ""}):
            with self.assertRaises(SystemExit):
                cli.main(["fetch", "10.1/x", "--batch", "b", "--proxy-mode", "ezproxy-host"])

    def test_mode_follows_the_proxy_setting(self):
        seen = []
        with mock.patch.object(fetch, "run", side_effect=lambda ids, b, base, cfg, refresh=False: seen.append(cfg) or ({"batch": b, "items": []}, "m")), \
                mock.patch.object(fetch, "report", return_value=""):
            with mock.patch.dict(os.environ, {"LFL_EMAIL": "me@example.org", "LFL_PROXY_SUFFIX": ""}):
                cli.main(["fetch", "10.1/x", "--batch", "b"])
            with mock.patch.dict(os.environ, {"LFL_EMAIL": "me@example.org",
                                              "LFL_PROXY_SUFFIX": "https://login.proxy.example.edu/login?url=x"}):
                cli.main(["fetch", "10.1/x", "--batch", "b"])
        self.assertEqual([(c["mode"], c["suffix"]) for c in seen], [("none", None), ("ezproxy-host", SUFFIX)])


if __name__ == "__main__":
    unittest.main()
