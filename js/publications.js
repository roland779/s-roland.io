/* publications.js — publication loader (all items, sorted newest-first)
   Authored for this template (no third-party code). */

(function () {
  const pubList = document.getElementById("pubList");
  const pubMeta = document.getElementById("pubMeta");

  let pubs = [];

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
  }

  function parseYear(p) {
    const venue = (p && p.venue) ? String(p.venue) : "";
    const m = venue.match(/(19|20)\d{2}/);
    return m ? parseInt(m[0], 10) : 0;
  }

  function render() {
    const count = pubs.length;
    pubMeta.textContent = `Showing publications (${count}).`;

    pubList.innerHTML = "";
    pubs.forEach(p => {
      const title = escapeHtml(p.title || "");
      const authors = Array.isArray(p.authors) ? escapeHtml(p.authors.join(", ")) : "";
      const venue = escapeHtml(p.venue || "");

      const links = p.links || {};
      const linkEntries = Object.entries(links)
        .filter(([, url]) => !!url && url !== "#")
        .map(([k, url]) => ({ label: String(k).toUpperCase(), url: String(url) }));

      const el = document.createElement("article");
      el.className = "pub";
      el.innerHTML = `
        <p class="pub-title">${title}${p.award ? `<span class="badge">${escapeHtml(p.award)}</span>` : ""}</p>
        <p class="pub-authors">${authors}</p>
        <p class="pub-venue"><em>${venue}</em></p>
        ${linkEntries.length ? `
          <div class="pub-links">
            ${linkEntries.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join("")}
          </div>` : ""}
      `;
      pubList.appendChild(el);
    });
  }

  function setPubs(data) {
    pubs = Array.isArray(data && data.publications) ? data.publications : [];
    pubs.sort((a, b) => parseYear(b) - parseYear(a));
    render();
  }

  async function init() {
    try {
      const res = await fetch("data/publications.json", { cache: "no-store" });
      const data = await res.json();
      setPubs(data);
      return;
    } catch (e) {
      // Fallback for file:// usage: read embedded JSON from index.html
      try {
        const el = document.getElementById("pubData");
        if (el && (el.textContent || "").trim()) {
          const data = JSON.parse((el.textContent || "").trim());
          setPubs(data);
          return;
        }
      } catch (_) {}
      pubMeta.textContent = "Could not load publications. Please check data/publications.json.";
    }
  }

  init();
})();