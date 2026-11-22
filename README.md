# Research Profile — Static Academic Website

This repository contains a minimal, multilingual (EN/DE) static personal profile website intended for academic use.

**Repository contents**
- Main page: `index.html`
- Static assets: `academic_website/images/` and `academic_website/css/`
- Translations: `academic_website/data/i18n.json`
- Publications data: `academic_website/data/publications.json`
- Utility scripts: `academic_website/tools/` (e.g. `sync_publications.py`)

## Local preview
To preview the site locally from the project folder, start a simple HTTP server. Example with Python:

```bash
python -m http.server 8000
# then open http://localhost:8000 in your browser
```

Open `index.html` in the browser or navigate to the desired subpath.
Direct file access uses embedded copies of the translation and publication data. After changing either JSON file, refresh those copies with Node.js:

```bash
node academic_website/tools/sync_embedded_data.js
```

## Language switching (EN/DE)
Use the EN/DE buttons in the header to switch languages. The selection is stored locally in your browser (`localStorage`). Translation strings are stored in `academic_website/data/i18n.json`.

## Publications
Publications are loaded from `academic_website/data/publications.json`.

### Syncing publications (semi-automatic)
This repository includes a helper script to semi-automatically generate or update `publications.json` from an external author page (for example SSRN). External services often employ CORS or bot protection; the script runs locally and scrapes the provided URL.

Steps:
1) Install required Python packages:

```bash
pip install requests beautifulsoup4
```

2) Run the sync script (example):

```bash
python academic_website/tools/sync_publications.py --ssrn "<SSRN-AUTHOR-URL>" --out academic_website/data/publications.json --merge
```

Notes:
- External site markup can change. If parsing fails, adapt the selectors inside `academic_website/tools/sync_publications.py`.
- The script stops without writing if no publications are found. With `--merge`, existing publications that are absent from SSRN remain in the output.
- For Google Scholar it is usually preferable to export BibTeX and import it locally instead of scraping.

## Customization
- Update links and contact information in `index.html`.
- Replace `academic_website/images/Roland_R_Schreiber.jpg`, or update the image path in `index.html`.
- Edit translation strings in `academic_website/data/i18n.json`.
- Maintain publications in `academic_website/data/publications.json` or update them with the sync script.

## Development
- Make changes locally and test with the simple HTTP server above.
- Optionally use a live-reload tool such as `live-server` for faster iteration.

## Checks

Run these checks from the repository root:

```bash
node academic_website/tools/test_frontend.cjs
python -m unittest discover -s academic_website/tools -p "test_*.py" -v
```

The tests are development tools and are not loaded by the website. Python cache files are ignored by Git. Install the scraping dependencies above to include the real HTML parser integration test; live SSRN access may be blocked with HTTP 403 and is not required to display the stored publications.

## License
This project is released under the MIT License — see `LICENSE`.

## Contact
If you have questions or find issues, please open an issue or contact the maintainer via the address provided in the project.
