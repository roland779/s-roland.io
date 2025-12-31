# Research Profile (Static Website)

This is a minimal, dependency-light academic profile page (EN/DE).

## Quick start (local preview)

From the project folder:

- Python:
  - `python -m http.server 8000`
  - open `http://localhost:8000`

## Language switch (EN/DE)

Use the **EN/DE** buttons in the header. The selection is stored in your browser (localStorage).

Translations live in:
- `data/i18n.json`

## Publications

The website loads publications from:
- `data/publications.json`

### Sync from SSRN (semi-automatic)

Because SSRN/Google Scholar are not reliably fetchable from a static website (CORS / bot protection),
this repo includes a local sync script that *generates* `data/publications.json` from your SSRN author page.

1) Install requirements:
- `pip install requests beautifulsoup4`

2) Run:
- `python tools/sync_publications.py --ssrn "https://papers.ssrn.com/sol3/cf_dev/AbsByAuth.cfm?per_id=7334206" --out data/publications.json --merge`

Notes:
- SSRN's HTML may change; if parsing breaks, adjust the selectors in `tools/sync_publications.py`.
- For Google Scholar, the recommended approach is to export **BibTeX** from Scholar and import it locally (scraping Scholar is often blocked).

## Customize

- Update links/emails in `index.html`
- Add a profile picture at `assets/images/profile.jpg`
- Edit translations in `data/i18n.json`
- Edit publications in `data/publications.json`

## License

MIT-License