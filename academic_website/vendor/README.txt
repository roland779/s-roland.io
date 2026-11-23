Local dashboard dependencies (no runtime CDN or font requests)

Tabler UI 1.7.5: tabler-1.7.5.min.css
https://www.npmjs.com/package/@tabler/core/v/1.7.5
Downloaded from the pinned jsDelivr npm distribution.
MIT license: tabler-LICENSE (official Tabler repository license).
Bootstrap is included in Tabler; do not load a second Bootstrap stylesheet.

Chart.js 4.6.2: chart-4.6.2.umd.js
https://www.npmjs.com/package/chart.js/v/4.6.2
Downloaded from the pinned jsDelivr npm distribution.
MIT license: chart-LICENSE.md (package license).

Both libraries are served from the website itself. No Node build or package
installation is required on the hosting server. admin.php adds content-based
cache versions to CSS/JS URLs, including these files.

When updating, replace the matching filenames in admin-template.html and the
browser tests, retain licenses, and run the dashboard browser test. A missing
Chart.js file leaves the accessible monthly data table available.
