# Research Profile — Static Academic Website

This repository contains a minimal, multilingual (EN/DE) static personal profile website intended for academic use.

**Repository contents**
- Main page: `index.html`
- Static assets: `academic_website/images/` and `academic_website/css/`
- Translations: `academic_website/data/i18n.json`
- Publications data: `academic_website/data/publications.json`
- Utility scripts: `academic_website/tools/` (e.g. `sync_publications.py`)

## PHP visitor statistics

The protected dashboard is at `/admin.php` (username `admin`). This feature uses PHP 8+ and PDO SQLite; no Python server is involved. Existing Python publication utilities are independent of analytics.

1. Copy `analytics-config.example.php` to `analytics-config.php`.
2. Generate a strong password hash using the command in that file and set `password_hash`. Keep the configured file out of Git.
3. Set `data_dir` to a PHP-writable directory **outside your public document root**. PHP creates the SQLite database there. Enable the `pdo_sqlite` PHP extension.
4. Serve the website through your PHP hosting with HTTPS. For local development use `php -S 127.0.0.1:8000` from this directory, then open `http://127.0.0.1:8000/admin.php`.

Tracking starts only after visitor consent. Referring domains (without URL query strings), browser user agent, truncated IP networks, approximate active tab duration, publication/BibTeX actions, visible sections, scroll milestones and known data-loading failures are collected. Each page load is a separate visit; this does not identify unique people. Browser privacy signals disable collection. Visitors can withdraw using the footer's statistics settings; withdrawal stops future collection. Consent was versioned for the expanded collection, so earlier consent does not silently opt visitors into the new event tracking. Visit/event details expire after 30 days and are deleted on subsequent analytics requests or scheduled sync. Monthly totals without visit identifiers or IPs are retained for 24 months. No geographic location is inferred. The dashboard displays up to 1,000 recent visit details; engagement, referral conversion and overall metrics use all retained records.

`full_ip` can explicitly enable full addresses; the consent text adjusts accordingly. The direct connection IP is used; behind a reverse proxy this may be the proxy address. Forwarded headers are not trusted automatically. Include the actual analytics setup in the site's privacy notice before enabling it publicly. Basic authentication requires HTTPS in production; close the private browser session to clear cached login credentials.

Run the PHP integration checks with `node academic_website/tools/test_analytics.cjs` (set `PHP_BIN` to the PHP executable if it is not on PATH). These use an isolated temporary database and test authentication, origin validation, recording, masking and duration limits.

### Research impact and dashboard

The dashboard includes publication actions (DOI, publisher/preprint/fulltext links, research data and BibTeX), referring-source conversion, viewed sections, scroll milestones, data-loading failures, external link checks and calendar-month comparisons. A BibTeX click records a requested action, not proof of a successful copy/download or a real scholarly citation. The existing publication JSON's `citationKey` is the stable identifier; do not rename it when editing titles.

Use **OpenAlex & Zenodo abrufen** in the dashboard to populate external data. Requests run on the PHP server, never in visitor browsers. OpenAlex works are matched by DOI and cited works include title, year and DOI where available. Up to 1,000 citing works are fetched across multiple pages; a larger result is explicitly marked incomplete. Zenodo statistics show cumulative views and downloads for the linked record version, including traffic outside this website. Optional `openalex_api_key` in the private config supports higher API budgets. PHP needs `curl`, outbound HTTPS access and working CA certificates in addition to PDO SQLite.

Each successful citation fetch saves a daily snapshot. Monthly net changes compare the last observed total in adjacent calendar months, not the actual date a paper was cited; negative corrections remain visible. Missing baselines and incomplete source coverage are shown as unavailable, never fabricated as zero. The first snapshot establishes the baseline; historical monthly counts cannot be reconstructed retrospectively from today's total. Monthly visitor/action charts show observed totals and label collection start and incomplete periods. Research snapshots contain public publication metadata and remain available independently of the 30-day visitor retention.

### Automatic refresh without cron

**No cronjob is required.** Website and admin page views now trigger an asynchronous maintenance request. While a tab remains visible it checks once per minute. Each request processes at most one due publication/source, with a global one-minute throttle and a shared nonblocking lock. Anonymous callers cannot choose targets or retrieve research diagnostics. These requests refresh public research metadata; they do not record visits or interactions and do not require analytics consent.

Citations and Zenodo are due after 24 hours; publication-link checks after seven days. Failed jobs are eligible for retry after one hour. The oldest due jobs run first, preserving successful cached data on errors. Initial population of all publications can take multiple page views/minutes; the manual dashboard buttons remain available to fetch all sources directly. Set `automatic_refresh` to `false` in the private config to disable this behavior.

**Without page views, there are no guaranteed daily snapshots.** Missing days/months are not invented or reconstructed. Open the admin page and use the refresh buttons to collect a new baseline when needed. After a background refresh, update the dashboard view to see the latest results. Outbound HTTPS access from PHP remains necessary.

If hosting later supports a scheduler, an **optional daily cronjob** can provide regular snapshots without page views (replace paths and PHP executable for your host):

```text
15 3 * * * /usr/bin/php /absolute/path/to/website/sync-analytics.php
```

This optionally creates daily citation snapshots and refreshes Zenodo. Optionally run `php /absolute/path/to/website/sync-analytics.php --links` weekly for link checks. The script is CLI-only, prevents overlapping scheduled runs and returns a nonzero exit code when a source fails. No hosting schedule is created automatically. Per-publication/source manual requests are cached for one hour; failures preserve the last successful data and expose attempt/success timestamps. Link checks treat 404/410 as broken; access restrictions, timeouts, and other ambiguous responses are labelled unknown. Checks restrict HTTPS requests to public DNS destinations, pin the resolved address and revalidate redirects.

Additional checks:

```text
php academic_website/tools/test_research.php
node academic_website/tools/test_admin_model.cjs
node academic_website/tools/test_tracker.cjs
node academic_website/tools/test_concurrency.cjs
node academic_website/tools/test_browser.cjs
```

Research tests use deterministic API fixtures for pagination, failure preservation, snapshots and Zenodo response formats. Browser tests use an isolated PHP server/database, mocked external research records and headless Chrome (`BROWSER_BIN` can select another Chromium executable). Set `QA_DIR` to an output directory to keep desktop/mobile screenshots. They do not access or alter the real analytics database or admin credentials. External live data depends on the hosting server's network/API access.

Concurrency tests start eight actual PHP processes against a temporary SQLite database, verify first-time migration and aggregate writes, and check that simultaneous refreshes for one research source result in a single fetch. Tracker tests include delayed requests, tab changes, privacy signals, withdrawal and storage clearing in another tab. Manual and automatic source refreshes share per-source locks; an ongoing fetch is reported separately from an API failure.

If analytics is not configured or the site is served as static files, the existing profile remains usable and no analytics collection starts. Hosting must execute PHP, never serve PHP source as text.

## Static preview
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

### BibTeX citations

Each publication with a `bibtex` entry provides a Cite/Zitieren panel with copy and `.bib` download actions. The `citationKey` determines the download filename. Citation metadata was checked against the DOI records at Crossref. Maintain these fields alongside the publication data and run the embedded-data sync after edits. The `--merge` import preserves both citation fields.

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
