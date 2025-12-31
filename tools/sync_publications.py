#!/usr/bin/env python3
"""
sync_publications.py
--------------------
Generates/updates data/publications.json from your SSRN author page.

Why a local script?
- SSRN/Google Scholar do not provide a reliable, CORS-friendly API for direct client-side loading in a static site.
- A small local sync step keeps the website static while still letting you "automate" updates.

Usage (from project root):
  python tools/sync_publications.py --ssrn "https://papers.ssrn.com/sol3/cf_dev/AbsByAuth.cfm?per_id=7334206" --out data/publications.json

Optional: add --merge to keep existing manual fields (e.g., selected, award).

Requirements:
  pip install requests beautifulsoup4

Notes on Google Scholar:
- Scholar frequently blocks automated scraping.
- Recommended workflow: export BibTeX from Scholar and import it with a separate script, or maintain Scholar links per paper.
"""

import argparse
import json
import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


def normalize_whitespace(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def parse_ssrn_author_page(url: str):
    r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    # SSRN HTML can change. We therefore use robust heuristics:
    # - Find links to "abstract_id=" pages; treat surrounding text as a record.
    abs_links = soup.select('a[href*="abstract_id="]')
    seen = set()
    pubs = []

    for a in abs_links:
        href = a.get("href") or ""
        if "abstract_id=" not in href:
            continue
        abs_url = urljoin(url, href)
        if abs_url in seen:
            continue
        seen.add(abs_url)

        title = normalize_whitespace(a.get_text(" ", strip=True))
        if not title or len(title) < 6:
            continue

        # Attempt to infer year from nearby text
        year = ""
        block = a.find_parent(["div", "li", "tr"]) or a.parent
        block_text = normalize_whitespace(block.get_text(" ", strip=True)) if block else ""
        m = re.search(r"(19|20)\d{2}", block_text)
        if m:
            year = m.group(0)

        pubs.append({
            "title": title,
            "authors": [],
            "venue": f"SSRN ({year})" if year else "SSRN",
            "selected": False,
            "award": "",
            "links": {
                "ssrn": abs_url
            }
        })

    # De-duplicate by title
    unique = {}
    for p in pubs:
        key = p["title"].lower()
        unique[key] = p
    return list(unique.values())


def merge_existing(existing, generated):
    # Preserve selected/award and any non-empty links from existing
    by_title = { (p.get("title","").lower()): p for p in existing }
    out = []
    for g in generated:
        k = g.get("title","").lower()
        if k in by_title:
            e = by_title[k]
            g["selected"] = bool(e.get("selected", g["selected"]))
            g["award"] = e.get("award", g["award"]) or g["award"]
            # merge links (keep existing if not '#')
            links = dict(g.get("links", {}))
            for lk, lv in (e.get("links", {}) or {}).items():
                if lv and lv != "#":
                    links[lk] = lv
            g["links"] = links
            if e.get("authors"):
                g["authors"] = e["authors"]
            if e.get("venue") and e["venue"] != "SSRN":
                g["venue"] = e["venue"]
        out.append(g)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ssrn", required=True, help="SSRN author page URL")
    ap.add_argument("--out", default="data/publications.json", help="Output JSON path")
    ap.add_argument("--merge", action="store_true", help="Merge with existing output file")
    args = ap.parse_args()

    generated = parse_ssrn_author_page(args.ssrn)

    payload = {"publications": generated}

    if args.merge:
        try:
            with open(args.out, "r", encoding="utf-8") as f:
                existing = json.load(f).get("publications", [])
            payload["publications"] = merge_existing(existing, generated)
        except FileNotFoundError:
            pass

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(payload['publications'])} items to {args.out}")


if __name__ == "__main__":
    main()
