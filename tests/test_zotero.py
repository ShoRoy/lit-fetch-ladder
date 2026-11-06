"""Offline tests for filing a batch into Zotero. zotero-cli is replaced by a script that logs
what it was asked and answers the way the real one does.

Run: python3 -m unittest discover -s tests
"""
import json
import os
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from lit_fetch_ladder import cli, fetch, zotero  # noqa: E402
from test_tools import Base  # noqa: E402

FAKE_CLI = r'''#!%s
import hashlib, json, os, sys
args = sys.argv[1:]
stdin = sys.stdin.read() if "-" in args else ""
with open(os.environ["FAKE_LOG"], "a") as f:
    f.write(json.dumps({"args": args, "stdin": stdin, "local": os.environ.get("ZOTERO_LOCAL"),
                        "webdav_timeout": os.environ.get("ZOTERO_WEBDAV_TIMEOUT")}) + "\n")
if os.environ.get("FAKE_NOWRITE"):
    print(json.dumps({"ok": False, "command": " ".join(args[1:3]), "schema": 1, "error": {
        "message": "Cannot perform write operations in local-only mode: no writable Zotero backend is configured.\n  - run `zotero-mcp authorize-local`", "code": "tool_error"}}))
    sys.exit(1)
cmd = args[1]
if cmd == "config":  # masked settings, as the real one prints them
    env = json.loads(os.environ.get("FAKE_CONFIG", "{}"))
    print(json.dumps({"ok": True, "command": "config", "schema": 1, "data": {"settings": env}}))
    sys.exit(0)
if os.environ.get("FAKE_QUOTA") and cmd == "attach":
    text = ("Error attaching file: \nCode: 413\nURL: https://api.zotero.org/users/1/items/%%s/file\n"
            "Method: POST\nResponse: File would exceed quota (4408 &gt; 300)") %% args[2]
elif cmd == "get" and args[2] == "children":  # one attachment when FAKE_HASFILE is set
    kids = [{"key": "ATT00001", "itemType": "attachment"}] if os.environ.get("FAKE_HASFILE") else []
    print(json.dumps({"ok": True, "command": "get children", "schema": 1,
                      "data": {"item_key": args[3], "count": len(kids), "items": kids}}))
    sys.exit(0)
elif cmd == "get":  # get metadata ATT: FAKE_HASFILE says what kind of attachment it is (a real file unless said)
    kind = os.environ.get("FAKE_HASFILE", "")
    rec = {"key": args[3], "itemType": "attachment",
           "linkMode": {"shell": "imported_url", "link": "linked_url", "snapshot": "imported_url"}.get(kind, "imported_file"),
           "contentType": "text/html" if kind == "snapshot" else "application/pdf",
           "md5": None if kind in ("shell", "link") else "ae878e7e7fc7159bf7e3bcc07d2916bb"}
    if kind == "deleted":  # a PDF in Zotero's trash
        rec["deleted"] = 1
    print(json.dumps({"ok": True, "command": "get metadata", "schema": 1, "data": {"key": args[3], "data": rec}}))
    sys.exit(0)
elif cmd == "notes" and args[2] == "list":  # the item's notes: FAKE_NOTE is the text of its one note
    notes = [{"key": "N0000001", "title": "CLI Note", "text": os.environ["FAKE_NOTE"]}] if os.environ.get("FAKE_NOTE") else []
    print(json.dumps({"ok": True, "command": "notes list", "schema": 1, "data": {"count": len(notes), "notes": notes}}))
    sys.exit(0)
elif cmd == "delete":  # delete item KEY; zotero-cli refuses a note (zotero-mcp's wording)
    text = ("Error: Item %%s is a note. Use zotero_manage_note(action='delete') for notes, or pass allow_note=True to override."
            if args[3].startswith("N")
            else "Successfully trashed item %%s (type=attachment, recoverable from Zotero's Trash)") %% args[3]
elif cmd == "add":
    key = "K" + hashlib.md5(args[3].encode()).hexdigest()[:7].upper()
    head = "Already in library" if args[3] in os.environ.get("FAKE_EXISTING", "").split(",") else "Successfully added"
    text = "%%s: **A paper**\n\nItem key: `%%s`\n" %% (head, key)
elif cmd == "attach":
    text = "File attached to `%%s`: %%s" %% (args[2], args[6])
    # FAKE_WARN: "1" every upload fails inside a success answer (a released zotero-mcp); "once" only the
    # first try per item; "error" / "error-once" the same, reported as an error answer (the WebDAV-first fix)
    warn = os.environ.get("FAKE_WARN", "")
    marker = os.environ["FAKE_LOG"] + ".warned." + args[2]
    if warn and (not warn.endswith("once") or not os.path.exists(marker)):
        open(marker, "w").close()
        fail = "(WARNING: WebDAV upload failed - 503 Service Unavailable; attachment shell ATT00002 was deleted)"
        text = "Error: upload of '%%s' to `%%s` failed: %%s" %% (args[6], args[2], fail) if warn.startswith("error") else text + " " + fail
else:
    text = "Note created."
if text.startswith(("Error", "Failed")):  # zotero-cli's --json turns a failure answer into ok:false, exit 1
    print(json.dumps({"ok": False, "command": cmd, "schema": 1, "error": {"message": text, "code": "tool_error"}}))
    sys.exit(1)
print(json.dumps({"ok": True, "command": cmd, "schema": 1, "data": {"text": text}}))
''' % sys.executable


@unittest.skipIf(os.name == "nt", "the fake zotero-cli is a shebang script")
class Zotero(Base):
    def setUp(self):
        super().setUp()
        self.cli = os.path.join(self.tmp, "zotero-cli")
        with open(self.cli, "w") as fh:
            fh.write(FAKE_CLI)
        os.chmod(self.cli, os.stat(self.cli).st_mode | stat.S_IXUSR)
        self.log = os.path.join(self.tmp, "calls.jsonl")
        os.environ["FAKE_LOG"] = self.log
        self.addCleanup(os.environ.pop, "FAKE_LOG", None)
        self.addCleanup(os.environ.pop, "FAKE_NOWRITE", None)
        self.addCleanup(os.environ.pop, "FAKE_QUOTA", None)
        self.addCleanup(os.environ.pop, "FAKE_EXISTING", None)
        self.addCleanup(os.environ.pop, "FAKE_HASFILE", None)
        self.addCleanup(os.environ.pop, "FAKE_CONFIG", None)
        self.addCleanup(os.environ.pop, "FAKE_WARN", None)
        self.addCleanup(os.environ.pop, "FAKE_NOTE", None)

    def calls(self):
        """The commands the fake saw, without the one `config` read that opens every run."""
        if not os.path.exists(self.log):
            return []
        with open(self.log) as fh:
            return [c for c in (json.loads(l) for l in fh) if c["args"][1] != "config"]

    def finished_batch(self, text_ext=".yml"):
        """A batch with one open PDF, one paper saved as page text through the library, one
        abstract-only, and one still staged."""
        self.run_batch(["10.1/open", "10.1/paywalled", "10.1/landing", "10.1/broken"])
        dl = os.path.join(self.tmp, "downloads")
        os.makedirs(dl)
        page = os.path.join(dl, "page-2026-10-08T20-31-24-464Z" + text_ext)
        with open(page, "w") as fh:
            fh.write("heading 1. Introduction ... heading References")
        fetch.mark("b1", self.tmp, "10.1/paywalled", "PROXY_FETCHED", path=page, note="viewer only; PDF is a manual export")
        fetch.mark("b1", self.tmp, "10.1/landing", "ABSTRACT_ONLY", note="the proxy returned an error page")

    def test_files_what_the_batch_got_and_notes_how(self):
        self.finished_batch()
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli, when="2026-10-21")
        self.assertTrue(ok)
        self.assertEqual(filed, 2)
        calls = self.calls()
        adds = [c["args"] for c in calls if c["args"][1] == "add"]
        self.assertEqual(len(adds), 2)
        for a in adds:
            self.assertEqual(a[:2], ["--json", "add"])
            self.assertEqual(a[4:], ["-c", "lit-fetch-ladder/b1", "--create-collections", "--tags", "lit-fetch-ladder", "--if-exists", "file", "--attach-mode", "none"])
        self.assertEqual({c["webdav_timeout"] for c in calls}, {"300"})  # room for a large PDF on a slow uplink
        attaches = {c["args"][6]: c["args"][4] for c in calls if c["args"][1] == "attach"}
        self.assertEqual(set(attaches), {"10.1_open.pdf", "10.1_paywalled.yml"})  # the abstract-only row has no file
        self.assertTrue(attaches["10.1_paywalled.yml"].endswith(".yml"))
        notes = [c for c in calls if c["args"][1] == "notes"]
        self.assertEqual(len(notes), 2)
        for c in notes:
            self.assertEqual(c["args"][5:7], ["--title", "lit-fetch-ladder: b1"])  # not zotero-cli's "CLI Note"
        by_doi = {c["args"][4]: c["stdin"] for c in notes}  # keyed by the item key the note went under
        rows = {i.get("doi") or i["input"]: i for i in fetch.load(fetch.paths(self.tmp, "b1")[1], "b1")["items"]}
        for doi, row in rows.items():
            if row["state"] in zotero.FILED:
                self.assertEqual(row["zotero"]["filed"], "2026-10-21")
                self.assertIn(row["zotero"]["key"], by_doi)
        self.assertIn("page text saved through the library login", by_doi[rows["10.1/paywalled"]["zotero"]["key"]])
        self.assertIn("viewer only", by_doi[rows["10.1/paywalled"]["zotero"]["key"]])
        self.assertNotIn("zotero", rows["10.1/landing"])  # no full text: never filed
        self.assertNotIn("zotero", rows["10.1/broken"])
        self.assertTrue(any(l.startswith("  skip  ABSTRACT_ONLY") for l in lines), lines)
        self.assertTrue(any(l.startswith("  skip  ERROR") for l in lines), lines)
        # attach only after the add that gave the key, note last
        order = [c["args"][1] for c in calls]
        self.assertEqual(order[:3], ["add", "attach", "notes"])

    def test_a_paper_already_in_the_library_keeps_its_file_and_gets_the_note(self):
        self.finished_batch()
        os.environ["FAKE_EXISTING"] = "10.1/open"
        os.environ["FAKE_HASFILE"] = "1"
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli)
        self.assertTrue(ok)
        self.assertEqual(filed, 2)
        calls = self.calls()
        rows = {i.get("doi") or i["input"]: i for i in fetch.load(fetch.paths(self.tmp, "b1")[1], "b1")["items"]}
        key = rows["10.1/open"]["zotero"]["key"]
        self.assertEqual([c["args"][6] for c in calls if c["args"][1] == "attach"], ["10.1_paywalled.yml"])
        self.assertEqual([c["args"][2:4] for c in calls if c["args"][1] == "get"],
                         [["children", key], ["metadata", "ATT00001"]])  # one children check, for the existing item only, then its attachment's record
        note = next(c["stdin"] for c in calls if c["args"][1] == "notes" and c["args"][4] == key)
        self.assertIn("left on disk at", note)
        self.assertIn("the item already has a file", note)
        self.assertTrue(rows["10.1/open"]["zotero"]["existing"])
        self.assertIsNone(rows["10.1/open"]["zotero"]["attachment"])
        self.assertFalse(rows["10.1/paywalled"]["zotero"]["existing"])
        self.assertIn("its file kept", "\n".join(lines))

    def test_a_paper_already_in_the_library_without_a_file_gets_ours(self):
        self.finished_batch()
        os.environ["FAKE_EXISTING"] = "10.1/open"
        zotero.file_batch("b1", self.tmp, cli=self.cli)
        calls = self.calls()
        self.assertEqual({c["args"][6] for c in calls if c["args"][1] == "attach"}, {"10.1_open.pdf", "10.1_paywalled.yml"})
        rows = {i.get("doi") or i["input"]: i for i in fetch.load(fetch.paths(self.tmp, "b1")[1], "b1")["items"]}
        self.assertEqual(rows["10.1/open"]["zotero"]["attachment"], "10.1_open.pdf")
        self.assertTrue(rows["10.1/open"]["zotero"]["existing"])

    def test_the_report_opens_with_where_files_will_go(self):
        self.finished_batch()
        webdav = {"ZOTERO_API_KEY": "xx**", "ZOTERO_LIBRARY_TYPE": "user", "ZOTERO_LOCAL": "false",
                  "ZOTERO_WEBDAV_URL": "http***", "ZOTERO_WEBDAV_USERNAME": "xx**", "ZOTERO_WEBDAV_PASSWORD": "xx**"}
        cases = [
            (webdav, "files go to WebDAV"),
            ({k: v for k, v in webdav.items() if k != "ZOTERO_WEBDAV_PASSWORD"},
             "WARNING, WebDAV is only partly configured (ZOTERO_WEBDAV_PASSWORD missing)"),
            ({"ZOTERO_API_KEY": "xx**", "ZOTERO_LIBRARY_TYPE": "user"}, "files go to Zotero Storage (the quota applies)"),
            (dict(webdav, ZOTERO_LIBRARY_TYPE="group"), "a group library cannot use WebDAV"),
            (dict(webdav, ZOTERO_LOCAL="true", ZOTERO_LOCAL_API_KEY="xx**"), "files go to the running Zotero desktop"),
        ]
        for env, expected in cases:
            os.environ["FAKE_CONFIG"] = json.dumps(env)
            lines, _, _ = zotero.file_batch("b1", self.tmp, cli=self.cli, dry_run=True)
            self.assertTrue(lines[0].startswith("  route: "), lines[0])
            self.assertIn(expected, lines[0])
        lines, _, _ = zotero.file_batch("b1", self.tmp, cli=os.path.join(self.tmp, "nope"), dry_run=True)
        self.assertIn("route: unknown", lines[0])

    def test_a_local_mode_configuration_with_web_writes_is_filed_through_the_web_api(self):
        self.finished_batch()
        hybrid = {"ZOTERO_LOCAL": "true", "ZOTERO_API_KEY": "xx**", "ZOTERO_LIBRARY_ID": "00**", "ZOTERO_LIBRARY_TYPE": "user",
                  "ZOTERO_WEBDAV_URL": "h**", "ZOTERO_WEBDAV_USERNAME": "s**", "ZOTERO_WEBDAV_PASSWORD": "q**"}
        os.environ["FAKE_CONFIG"] = json.dumps(hybrid)
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli)
        self.assertEqual(filed, 2)
        self.assertIn("filing uses the web API so the duplicate check sees your whole library", lines[0])
        self.assertIn("files go to WebDAV", lines[0])
        self.assertEqual({c["local"] for c in self.calls()}, {"false"})  # every add, attach and note
        os.remove(self.log)
        os.environ["FAKE_CONFIG"] = json.dumps(dict(hybrid, ZOTERO_LOCAL_API_KEY="xx**"))  # a local write: left alone
        lines, _, _ = zotero.file_batch("b1", self.tmp, cli=self.cli, refresh=True)
        self.assertNotIn("filing uses the web API", lines[0])
        self.assertEqual({c["local"] for c in self.calls()}, {None})

    def test_trash_moves_a_list_in_one_command_and_skips_bad_keys(self):
        lines, n, ok = zotero.trash(["ABCD1234", "nope", "EFGH5678", "N1234567", "WXYZ0000\n"], cli=self.cli)
        self.assertEqual((n, ok), (2, False))
        self.assertIn("skip  WXYZ0000\n: not an item key", "\n".join(lines))  # a trailing newline is not a key
        self.assertEqual([c["args"][1:] for c in self.calls()],
                         [["delete", "item", "ABCD1234"], ["delete", "item", "EFGH5678"], ["delete", "item", "N1234567"]])
        text = "\n".join(lines)
        self.assertIn("skip  nope: not an item key", text)
        self.assertIn("trashed ABCD1234: Successfully trashed item ABCD1234", text)
        self.assertIn("ERROR N1234567: Error: Item N1234567 is a note", text)
        lines, n, ok = zotero.trash(["ABCD1234"], cli=self.cli, dry_run=True)
        self.assertEqual((n, ok, len(self.calls())), (0, True, 3))
        self.assertIn("would zotero-cli delete item ABCD1234", lines[0])

    def test_the_cli_trashes_without_a_batch_and_needs_one_otherwise(self):
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = cli.main(["zotero", "--trash", "ABCD1234", "--zotero-cli", self.cli])
        self.assertEqual(rc, 0)
        self.assertIn("moved 1 item(s) to Zotero's trash", out.getvalue())
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            cli.main(["zotero", "--zotero-cli", self.cli])  # neither --batch nor --trash
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            cli.main(["zotero", "--batch", "b1", "--trash", "ABCD1234", "--zotero-cli", self.cli])  # not both
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            cli.main(["zotero", "--tr", "ABCD1234", "--zotero-cli", self.cli])  # no abbreviation past the guard's pattern
        self.assertEqual(len(self.calls()), 1)  # only the first, spelled-out trash ran

    def test_a_second_run_files_nothing_again(self):
        self.finished_batch()
        zotero.file_batch("b1", self.tmp, cli=self.cli)
        n = len(self.calls())
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli)
        self.assertEqual((filed, len(self.calls())), (0, n))
        self.assertEqual(sum("(already," in l for l in lines), 2)
        zotero.file_batch("b1", self.tmp, cli=self.cli, refresh=True)
        self.assertEqual(len([c for c in self.calls() if c["args"][1:3] != ["notes", "list"]]), 2 * n)  # refiled, after a look at each item's notes

    def attaches_ours_to_an_existing_item_with(self, kind):
        self.finished_batch()
        os.environ["FAKE_EXISTING"] = "10.1/open"
        os.environ["FAKE_HASFILE"] = kind
        zotero.file_batch("b1", self.tmp, cli=self.cli)
        calls = self.calls()
        self.assertIn("10.1_open.pdf", [c["args"][6] for c in calls if c["args"][1] == "attach"])
        rows = {i.get("doi") or i["input"]: i for i in fetch.load(fetch.paths(self.tmp, "b1")[1], "b1")["items"]}
        self.assertEqual(rows["10.1/open"]["zotero"]["attachment"], "10.1_open.pdf")
        self.assertTrue(rows["10.1/open"]["zotero"]["existing"])

    def test_an_empty_attachment_shell_does_not_count_as_a_file(self):
        self.attaches_ours_to_an_existing_item_with("shell")  # left by an upload Zotero refused

    def test_a_web_link_attachment_does_not_count_as_a_file(self):
        self.attaches_ours_to_an_existing_item_with("link")

    def test_a_saved_web_page_does_not_count_as_a_file(self):
        self.attaches_ours_to_an_existing_item_with("snapshot")  # a connector snapshot: imported, md5 set, text/html

    def test_an_attachment_in_zoteros_trash_does_not_count_as_a_file(self):
        self.attaches_ours_to_an_existing_item_with("deleted")

    def test_an_item_added_before_its_file_failed_is_recorded_as_ours_on_the_next_run(self):
        self.finished_batch()
        os.environ["FAKE_WARN"] = "error"  # the add succeeds, both upload tries fail
        lines, filed, _ = zotero.file_batch("b1", self.tmp, cli=self.cli)
        rows = {i.get("doi") or i["input"]: i for i in fetch.load(fetch.paths(self.tmp, "b1")[1], "b1")["items"]}
        key = rows["10.1/open"]["zotero_partial"]["key"]
        self.assertEqual(rows["10.1/open"]["zotero_partial"]["existing"], False)
        self.assertNotIn("zotero", rows["10.1/open"])
        self.assertIn("item %s was added; the next run retries its file, or --trash %s removes it" % (key, key), "\n".join(lines))
        os.environ.pop("FAKE_WARN")
        os.environ["FAKE_EXISTING"] = "10.1/open,10.1/paywalled"  # the rerun's add finds the item the first run made
        zotero.file_batch("b1", self.tmp, cli=self.cli)
        rows = {i.get("doi") or i["input"]: i for i in fetch.load(fetch.paths(self.tmp, "b1")[1], "b1")["items"]}
        self.assertEqual(rows["10.1/open"]["zotero"]["key"], key)
        self.assertFalse(rows["10.1/open"]["zotero"]["existing"])  # ours, not the user's
        self.assertEqual(rows["10.1/open"]["zotero"]["attachment"], "10.1_open.pdf")
        self.assertNotIn("zotero_partial", rows["10.1/open"])

    def test_the_cli_files_a_batch_and_says_how_many(self):
        import contextlib
        import io
        self.finished_batch()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = cli.main(["zotero", "--batch", "b1", "--base", self.tmp, "--zotero-cli", self.cli])
        self.assertEqual(rc, 0)
        self.assertIn("batch 'b1': filed 2 row(s) into Zotero", out.getvalue())

    def test_an_upload_reported_failed_inside_a_success_answer_is_an_error_and_retried_next_run(self):
        self.finished_batch()
        os.environ["FAKE_WARN"] = "1"
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli)
        self.assertTrue(ok)  # the run goes on: the next row's file may land
        self.assertEqual(filed, 0)  # the abstract-only row is never filed
        self.assertEqual(sum(l.startswith("  ERROR") for l in lines), 2)
        self.assertEqual(len([c for c in self.calls() if c["args"][1] == "attach"]), 4)  # one retry per file, then the error
        text = "\n".join(lines)
        self.assertIn("the file did not land, on two tries", text)
        self.assertIn("WebDAV upload failed", text)
        rows = {i.get("doi") or i["input"]: i for i in fetch.load(fetch.paths(self.tmp, "b1")[1], "b1")["items"]}
        self.assertNotIn("zotero", rows["10.1/open"])
        self.assertNotIn("zotero", rows["10.1/paywalled"])
        self.assertNotIn("zotero", rows["10.1/landing"])
        self.assertEqual(len([c for c in self.calls() if c["args"][1] == "notes"]), 0)  # no note on a row whose file did not land
        os.environ.pop("FAKE_WARN")
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli)
        self.assertEqual(filed, 2)

    def test_an_upload_that_fails_once_lands_on_the_retry(self):
        self.finished_batch()
        os.environ["FAKE_WARN"] = "once"
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli)
        self.assertEqual((filed, ok), (2, True))
        self.assertFalse(any(l.startswith("  ERROR") for l in lines), lines)
        calls = self.calls()
        self.assertEqual([c["args"][6] for c in calls if c["args"][1] == "attach"],
                         ["10.1_open.pdf", "10.1_open.pdf", "10.1_paywalled.yml", "10.1_paywalled.yml"])
        rows = {i.get("doi") or i["input"]: i for i in fetch.load(fetch.paths(self.tmp, "b1")[1], "b1")["items"]}
        self.assertEqual(rows["10.1/open"]["zotero"]["attachment"], "10.1_open.pdf")
        self.assertEqual(len([c for c in calls if c["args"][1] == "notes"]), 2)

    def test_an_upload_the_webdav_first_fix_reports_as_an_error_is_retried_once(self):
        self.finished_batch()
        os.environ["FAKE_WARN"] = "error-once"
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli)
        self.assertEqual((filed, ok), (2, True))
        self.assertFalse(any(l.startswith("  ERROR") for l in lines), lines)
        self.assertEqual(len([c for c in self.calls() if c["args"][1] == "attach"]), 4)

    def test_an_upload_the_webdav_first_fix_reports_as_an_error_twice_is_an_error(self):
        self.finished_batch()
        os.environ["FAKE_WARN"] = "error"
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli)
        self.assertEqual((filed, ok), (0, True))
        self.assertEqual(sum(l.startswith("  ERROR") for l in lines), 2)
        self.assertIn("WebDAV upload failed", "\n".join(lines))
        self.assertEqual(len([c for c in self.calls() if c["args"][1] == "attach"]), 4)  # two tries each, then the error

    def test_a_refresh_keeps_the_note_it_wrote_before(self):
        self.finished_batch()
        zotero.file_batch("b1", self.tmp, cli=self.cli, when="2026-10-21")
        os.remove(self.log)
        os.environ["FAKE_NOTE"] = 'CLI Note\n\nlit-fetch-ladder: batch "b1", filed 2026-10-21.\n\nHow: open-access PDF from x.'
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli, refresh=True)
        self.assertEqual(filed, 2)
        self.assertEqual([c["args"][2] for c in self.calls() if c["args"][1] == "notes"], ["list"] * 2)  # looked, never created
        self.assertEqual(sum("its note from this batch kept" in l for l in lines), 2)
        os.remove(self.log)
        os.environ["FAKE_NOTE"] = 'CLI Note\n\nlit-fetch-ladder: batch "b2", filed 2026-10-21.'  # another batch's note is not this one
        zotero.file_batch("b1", self.tmp, cli=self.cli, refresh=True)
        self.assertEqual([c["args"][2] for c in self.calls() if c["args"][1] == "notes"], ["list", "create"] * 2)

    def test_a_dry_run_leaves_the_manifest_untouched(self):
        self.finished_batch()
        mpath = fetch.paths(self.tmp, "b1")[1]
        with open(mpath, "rb") as fh:
            before = (fh.read(), os.stat(mpath).st_mtime_ns)
        zotero.file_batch("b1", self.tmp, cli=self.cli, dry_run=True)
        with open(mpath, "rb") as fh:
            self.assertEqual((fh.read(), os.stat(mpath).st_mtime_ns), before)

    def test_text_zotero_cannot_attach_stays_on_disk_and_the_note_says_so(self):
        self.finished_batch(text_ext=".html")
        zotero.file_batch("b1", self.tmp, cli=self.cli)
        calls = self.calls()
        self.assertEqual([c["args"][6] for c in calls if c["args"][1] == "attach"], ["10.1_open.pdf"])
        note = next(c["stdin"] for c in calls if c["args"][1] == "notes" and "viewer only" in c["stdin"])
        self.assertIn("left on disk at", note)

    def test_no_write_path_stops_at_once_with_the_fix(self):
        self.finished_batch()
        os.environ["FAKE_NOWRITE"] = "1"
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli)
        self.assertFalse(ok)
        self.assertEqual((filed, len(self.calls())), (0, 1))
        self.assertIn("authorize-local", "\n".join(lines))
        rows = fetch.load(fetch.paths(self.tmp, "b1")[1], "b1")["items"]
        self.assertFalse(any("zotero" in r for r in rows))

    def test_a_full_zotero_storage_quota_stops_the_run_with_the_whole_message(self):
        self.finished_batch()
        os.environ["FAKE_QUOTA"] = "1"
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli)
        self.assertFalse(ok)
        self.assertEqual(filed, 0)
        self.assertEqual([c["args"][1] for c in self.calls()], ["add", "attach"])  # stops at the first refusal
        text = "\n".join(lines)
        self.assertIn("Zotero Storage quota is full", text)
        self.assertIn("Response: File would exceed quota (4408 &gt; 300)", text)  # not just the blank first line
        rows = fetch.load(fetch.paths(self.tmp, "b1")[1], "b1")["items"]
        self.assertFalse(any("zotero" in r for r in rows))

    def test_dry_run_runs_nothing_and_lists_the_commands(self):
        self.finished_batch()
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=self.cli, dry_run=True, collection="Survey")
        self.assertEqual((filed, self.calls()), (0, []))
        text = "\n".join(lines)
        self.assertIn("zotero-cli add doi 10.1/paywalled -c Survey", text)
        self.assertIn("--filename 10.1_paywalled.yml", text)
        self.assertIn("notes create --item-key <key> --title lit-fetch-ladder: b1 --text -  <<< lit-fetch-ladder", text)

    def test_a_row_without_kind_is_read_from_its_extension(self):
        self.run_batch(["10.1/paywalled"])
        pdf = os.path.join(self.tmp, "p.pdf")
        with open(pdf, "wb") as fh:
            fh.write(b"%PDF-1.4 y")
        fetch.mark("b1", self.tmp, "10.1/paywalled", "PROXY_FETCHED", path=pdf)
        mpath = fetch.paths(self.tmp, "b1")[1]
        manifest = fetch.load(mpath, "b1")
        del manifest["items"][0]["kind"]  # a manifest written before `kind` existed
        fetch.write_json(mpath, manifest)
        lines, _, _ = zotero.file_batch("b1", self.tmp, cli=self.cli, dry_run=True)
        self.assertIn("How: PDF fetched through the library login", "\n".join(lines))

    def test_an_arxiv_doi_is_added_as_its_arxiv_page(self):
        self.run_batch(["10.1/open"])
        mpath = fetch.paths(self.tmp, "b1")[1]
        manifest = fetch.load(mpath, "b1")
        manifest["items"][0]["doi"] = "10.48550/arxiv.1706.03762"  # a DataCite DOI, which CrossRef does not know
        fetch.write_json(mpath, manifest)
        lines, _, _ = zotero.file_batch("b1", self.tmp, cli=self.cli, dry_run=True)
        self.assertIn("zotero-cli add url https://arxiv.org/abs/1706.03762 -c lit-fetch-ladder/b1", "\n".join(lines))

    def test_a_missing_cli_is_one_error_not_a_crash(self):
        self.finished_batch()
        lines, filed, ok = zotero.file_batch("b1", self.tmp, cli=os.path.join(self.tmp, "nope"))
        self.assertTrue(ok)
        self.assertEqual(filed, 0)
        self.assertEqual(sum(l.startswith("  ERROR") for l in lines), 2)


if __name__ == "__main__":
    unittest.main()
