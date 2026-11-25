# Research Profile — Static Academic Website

This repository contains a minimal, multilingual (EN/DE) static personal profile website intended for academic use.

**Repository contents**
- PHP entry point: `index.php`; HTML template/static fallback: `index.html`
- Static assets: `academic_website/images/` and `academic_website/css/`
- Translations: `academic_website/data/i18n.json`
- Publications data: `academic_website/data/publications.json`
- Utility scripts: `academic_website/tools/` (e.g. `sync_publications.py`)

## PHP visitor statistics

The protected dashboard is at `/admin.php` (username `admin`). This feature uses PHP 8+ and an atomic CSV file; no database extension or Python server is required. Existing Python publication utilities are independent of analytics. GitHub Pages can serve the static profile but cannot execute the PHP statistics; use a PHP-capable host for analytics.

### Hosting diagnostics

On Apache, the supplied rewrite also supports `/admin` and `/admin/`. Admin asset/API URLs use a server-provided base path, including for installations in subdirectories. Admin JavaScript and CSS URLs carry content versions to prevent old cached assets after updates.

If the dashboard cannot load statistics, the API now returns a specific, authenticated error code. Inspect `/analytics-api.php?action=stats` after signing in (prepend the installation subdirectory if applicable):

| Code | Action |
| --- | --- |
| `CSV_INVALID` | Back up and inspect the statistics CSV. Invalid files are rejected without overwriting them. |
| `STORAGE_NOT_WRITABLE` | Set `data_dir` to an existing/writable private directory or grant PHP permission to create it. |
| `STORAGE_PUBLIC` | Move `data_dir` outside the server's actual DocumentRoot, not merely outside a website subfolder. |
| `CSV_BUSY` | Wait briefly and refresh. Storage waits up to 30 seconds for competing PHP processes. |
| `PUBLICATIONS_MISSING` / `PUBLICATIONS_INVALID` | Upload a readable, valid `academic_website/data/publications.json`. |
| `ANALYTICS_ERROR` | Check the PHP error log and ensure all application files, including analytics-csv.php, were uploaded in the same version. |

Diagnostics do not expose password hashes or absolute server paths. The PHP log records the diagnostic code. The generic message `Analytics storage unavailable` from an older API does not establish the underlying cause; upload the updated API and library to obtain the specific code. The aggregate dashboard hides disabled visitor metrics even when its API fails.

### Default: server-side pageview totals without a consent dialog

`analytics_mode` defaults to `aggregate`. The PHP entry point increments only a daily counter and a separate monthly counter. These counters contain no IP addresses, browser/user-agent data, referrers, visitor IDs, individual timestamps or event histories. There are no analytics cookies or analytics localStorage accesses, and the individual tracking JavaScript is not loaded. Google Fonts requests have been removed; fonts use local system fallbacks. Existing functional language/theme preferences are independent of statistics.

The profile displays no analytics consent dialog in this mode. Individual visit duration, click attribution, scroll depth and visitor details are disabled, including for old clients calling the API. The admin dashboard shows pageview totals, citations, Zenodo metrics and link checks. Counts include bots/reloads and do not represent unique people. HEAD requests and requests with `DNT: 1` or `Sec-GPC: 1` are excluded. Daily counters cover 30 UTC calendar dates, monthly counters 24 calendar months.

Use **`index.php` as the homepage**. The supplied Apache `.htaccess` prioritizes it and routes direct `index.html` requests through PHP when mod_rewrite is available. Other hosting servers must configure their default page/routing accordingly. Directly serving `index.html` as a static file displays the profile without tracking or pageview counting. The built-in PHP development server chooses `index.php` for `/`.

This is a technical data-minimization configuration, not a blanket legal approval. The site's privacy information and the host's separate access logs still need to reflect the actual deployment. The application does not configure or disable hosting access logs. Existing individual records from earlier opt-in operation expire under the existing retention policy; they are not exposed in the aggregate dashboard.

### Setup and optional detailed mode

Set `analytics_mode` to `detailed` only if you want to restore individual metrics together with the opt-in dialog. The following description of visitor-level collection applies to that optional mode.

1. Copy `analytics-config.example.php` to `analytics-config.php`.
2. Generate a strong password hash using the command in that file and set `password_hash`. Keep the configured file out of Git.
3. Set `data_dir` to a PHP-writable directory **outside your public document root**. PHP creates `analytics.csv` and its lock files there. Upload `analytics-csv.php` alongside `analytics-lib.php`.
4. Serve the website through your PHP hosting with HTTPS. For local development use `php -S 127.0.0.1:8000` from this directory, then open `http://127.0.0.1:8000/admin.php`.

### Protected storage subfolder on Apache (including restricted shared hosting)

When the host prevents writes above the website, use the supplied `analytics-private/` subfolder:

```php
'data_dir' => __DIR__ . '/analytics-private',
'protected_storage' => true,
```

Upload `analytics-private/.htaccess` (including the hidden file) and the updated root `.htaccess`, `analytics-lib.php` and `analytics-api.php`. The folder must be writable by PHP. Its `.htaccess` must contain `Require all denied`; the root rewrite also blocks this path. PHP accepts this exception only for the exact supplied folder with the unchanged guard, explicit opt-in and Apache hosting. Other public directories remain rejected. The built-in PHP development server does not support this mode.

Before using the folder on the host, verify that `/analytics-private/` and `/analytics-private/.htaccess` return HTTP 403. After the first successful dashboard refresh, `/analytics-private/analytics.csv` must also return 403. Apache must honor `.htaccess` (`AllowOverride`); file presence alone cannot prove the live server enforces it. If these checks fail, use an external private folder instead. Existing data in a previous folder is not moved automatically.

The real Apache/PHP integration test is `node academic_website/tools/test_apache_storage.cjs` (defaults to the Windows XAMPP paths; `APACHE_BIN` and `PHP_BIN` can override them).

Tracking starts only after visitor consent. Referring domains (without URL query strings), browser user agent, truncated IP networks, approximate active tab duration, publication/BibTeX actions, visible sections, scroll milestones and known data-loading failures are collected. Each page load is a separate visit; this does not identify unique people. Browser privacy signals disable collection. Visitors can withdraw using the footer's statistics settings; withdrawal stops future collection. Consent was versioned for the expanded collection, so earlier consent does not silently opt visitors into the new event tracking. Visit/event details expire after 30 days and are deleted on subsequent analytics requests or scheduled sync. Monthly totals without visit identifiers or IPs are retained for 24 months. No geographic location is inferred. The dashboard displays up to 1,000 recent visit details; engagement, referral conversion and overall metrics use all retained records.

`full_ip` can explicitly enable full addresses; the consent text adjusts accordingly. The direct connection IP is used; behind a reverse proxy this may be the proxy address. Forwarded headers are not trusted automatically. Include the actual analytics setup in the site's privacy notice before enabling it publicly. Basic authentication requires HTTPS in production; close the private browser session to clear cached login credentials.

Run the PHP integration checks with `node academic_website/tools/test_analytics.cjs` (set `PHP_BIN` to the PHP executable if it is not on PATH). These use an isolated temporary database and test authentication, origin validation, recording, masking and duration limits.

### Research impact and dashboard

The dashboard uses a responsive sidebar (collapsible menu on mobile), Tabler UI 1.7.5 and Chart.js 4.6.2. Both libraries and their licenses live in `academic_website/vendor/` and are served locally, without runtime CDN or external font requests. Upload that directory along with the admin template, CSS and JavaScript. The public profile keeps its own styles.

The overview displays pageviews, OpenAlex citations and Zenodo downloads/views. Missing or partial source coverage is labelled; linked Zenodo records are deduplicated when aggregating overview totals. The monthly chart supports 6/12-month ranges, tooltip inspection and legend toggles, with a data table as an accessible fallback. Missing citation baselines remain unavailable rather than zero. Each publication/source card shows freshness, last success/attempt, errors and an individual refresh action. Existing hourly caching and source locks remain in effect. Storage failures include corrective steps, and a failed dashboard refresh labels any retained display as the last successful view.

The dashboard includes publication actions (DOI, publisher/preprint/fulltext links, research data and BibTeX), referring-source conversion, viewed sections, scroll milestones, data-loading failures, external link checks and calendar-month comparisons. A BibTeX click records a requested action, not proof of a successful copy/download or a real scholarly citation. The existing publication JSON's `citationKey` is the stable identifier; do not rename it when editing titles.

Use **OpenAlex & Zenodo abrufen** in the dashboard to populate external data. Requests run on the PHP server, never in visitor browsers. OpenAlex works are matched by DOI and cited works include title, year and DOI where available. Up to 1,000 citing works are fetched across multiple pages; a larger result is explicitly marked incomplete. Zenodo statistics show cumulative views and downloads for the linked record version, including traffic outside this website. Optional `openalex_api_key` in the private config supports higher API budgets. PHP needs `curl`, outbound HTTPS access and working CA certificates.

Each successful citation fetch saves a daily snapshot. Monthly net changes compare the last observed total in adjacent calendar months, not the actual date a paper was cited; negative corrections remain visible. Missing baselines and incomplete source coverage are shown as unavailable, never fabricated as zero. The first snapshot establishes the baseline; historical monthly counts cannot be reconstructed retrospectively from today's total. Monthly visitor/action charts show observed totals and label collection start and incomplete periods. Research snapshots contain public publication metadata and remain available independently of the 30-day visitor retention.

### Automatic refresh without cron

The admin header provides **Dashboard aktualisieren** to check every publication's OpenAlex/Zenodo data and publication links, then reload the dashboard. **Nur Ansicht neu laden** reloads the stored figures without starting this batch. The first dashboard opening of each calendar day in `Europe/Berlin` starts the same batch automatically. The daily state is stored on the server and shared across browsers/devices. Each source runs as a separate authenticated request to avoid one long batch request. Existing hourly source caching still applies, including to manual repeats.

Overlapping batches are blocked. If a tab closes during a batch, a later dashboard opening can resume unfinished jobs after a five-minute lease expires. Each step and source refresh is locked; old lease tokens cannot advance a resumed run. Source failures preserve previous successful values and are reported at completion. Closing every admin tab can interrupt the batch: this feature requires an open dashboard and is not a background scheduler. The existing public maintenance requests remain independent of the daily admin batch.

Test daily starts, day rollover, locks, recovery and caching with `php academic_website/tools/test_dashboard_refresh.php`.

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
php academic_website/tools/test_csv.php
node academic_website/tools/test_admin_model.cjs
node academic_website/tools/test_tracker.cjs
node academic_website/tools/test_concurrency.cjs
node academic_website/tools/test_browser.cjs
```

Research tests use deterministic API fixtures for pagination, failure preservation, snapshots and Zenodo response formats. Browser tests use an isolated PHP server/database, mocked external research records and headless Chrome (`BROWSER_BIN` can select another Chromium executable). Set `QA_DIR` to an output directory to keep desktop/mobile screenshots. They do not access or alter the real analytics database or admin credentials. External live data depends on the hosting server's network/API access.

Concurrency tests start eight actual PHP processes against a temporary CSV store, verify first-time creation, 160 pageviews and 160 monthly event increments, and check that simultaneous refreshes for one research source result in a single fetch. CSV tests cover special characters, formula protection round trips, transaction rollback and corrupt-file preservation. Tracker tests include delayed requests, tab changes, privacy signals, withdrawal and storage clearing in another tab. Manual and automatic source refreshes share per-source locks; an ongoing fetch is reported separately from an API failure.

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

### Statistics history views

Metric cards display source coverage and the oldest successful timestamp used in each total. Citation coverage counts publications; Zenodo coverage counts distinct linked record versions and uses the newest valid cached value per shared record. Missing sources, values older than 24 hours, failed last attempts and unknown timestamps are labelled separately. Zero counts remain valid observations. A failed dashboard reload marks retained coverage as a previous view. Monthly coverage is based on the configured recording start; it does not establish server uptime or historical source availability. These indicators require no additional visitor data or storage changes.

The aggregate dashboard shows 7/30 UTC calendar days with an optional seven-day mean. Today is highlighted as incomplete and excluded from the mean. Daily data remains limited to the existing 30-day retention. Monthly traffic supports 6/12/24 months; the comparison table uses the two last completed calendar months. Citation totals and net changes have separate charts; missing monthly observations stay gaps.

Successful Zenodo refreshes now save one version-specific snapshot per publication and UTC date, retained for 24 calendar months. Failed refreshes preserve history. Older Zenodo history cannot be reconstructed. Existing CSV column headers remain unchanged, so existing stores load without migration. Upload analytics-csv.php, analytics-lib.php, the admin template and both admin JavaScript files together.
