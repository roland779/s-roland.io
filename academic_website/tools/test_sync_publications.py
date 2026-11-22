import contextlib
import io
import importlib.util
import json
import sys
import tempfile
from types import SimpleNamespace
import unittest
from pathlib import Path
from unittest.mock import patch

import sync_publications


class SyncPublicationsTests(unittest.TestCase):
    def test_merge_preserves_matching_and_unmatched_publications(self):
        existing = [
            {"title": "Matched", "authors": ["Author"], "venue": "Journal", "selected": False,
             "award": "Award", "links": {"doi": "https://example.com/doi"}},
            {"title": "Manual", "authors": ["Other"], "venue": "Journal", "links": {}},
        ]
        generated = [
            {"title": "Matched", "authors": [], "venue": "SSRN (2025)", "award": "",
             "links": {"ssrn": "https://example.com/ssrn"}},
            {"title": "New", "authors": [], "venue": "SSRN", "award": "", "links": {}},
        ]

        result = sync_publications.merge_existing(existing, generated)

        self.assertEqual([p["title"] for p in result], ["Matched", "New", "Manual"])
        self.assertFalse(result[0]["selected"])
        self.assertEqual(result[0]["authors"], ["Author"])
        self.assertEqual(result[0]["venue"], "Journal")
        self.assertEqual(result[0]["award"], "Award")
        self.assertEqual(set(result[0]["links"]), {"doi", "ssrn"})
        self.assertNotIn("selected", generated[0])

    def test_empty_link_does_not_hide_later_title(self):
        class Link:
            parent = None

            def __init__(self, title):
                self.title = title

            def get(self, key):
                return "/abstract?abstract_id=123"

            def get_text(self, *args, **kwargs):
                return self.title

            def find_parent(self, *args):
                return None

        response = SimpleNamespace(text="", raise_for_status=lambda: None)
        soup = SimpleNamespace(select=lambda selector: [Link(""), Link("Valid publication title")])
        modules = {
            "requests": SimpleNamespace(get=lambda *args, **kwargs: response),
            "bs4": SimpleNamespace(BeautifulSoup=lambda *args: soup),
        }
        with patch.dict(sys.modules, modules):
            result = sync_publications.parse_ssrn_author_page("https://papers.ssrn.com/")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["title"], "Valid publication title")

    @unittest.skipUnless(importlib.util.find_spec("bs4") and importlib.util.find_spec("requests"),
                         "Install requests and beautifulsoup4 for the HTML parser integration test")
    def test_real_html_parser_resolves_and_deduplicates_links(self):
        html = """
        <div>2026
          <a href="/sol3/papers.cfm?abstract_id=123"></a>
          <a href="/sol3/papers.cfm?abstract_id=123"> A valid publication title </a>
          <a href="/sol3/papers.cfm?abstract_id=123"> A valid publication title </a>
        </div>
        <div>2024<a href="/sol3/papers.cfm?abstract_id=456">Another publication title</a></div>
        """
        response = SimpleNamespace(text=html, raise_for_status=lambda: None)
        with patch("requests.get", return_value=response):
            result = sync_publications.parse_ssrn_author_page("https://papers.ssrn.com/author")
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["title"], "A valid publication title")
        self.assertEqual(result[0]["venue"], "SSRN (2026)")
        self.assertEqual(result[0]["links"]["ssrn"], "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=123")
        self.assertEqual(result[1]["venue"], "SSRN (2024)")

    def test_empty_scrape_never_overwrites_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "publications.json"
            original = json.dumps({"publications": [{"title": "Existing"}]})
            output.write_text(original, encoding="utf-8")
            args = ["sync_publications.py", "--ssrn", "https://example.com", "--out", str(output), "--merge"]
            with patch.object(sys, "argv", args), \
                 patch.object(sync_publications, "parse_ssrn_author_page", return_value=[]), \
                 contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as result:
                    sync_publications.main()
            self.assertNotEqual(result.exception.code, 0)
            self.assertEqual(output.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
