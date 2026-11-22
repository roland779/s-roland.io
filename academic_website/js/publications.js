/* publications.js — publication loader (all items, sorted newest-first)
   Authored for this template (no third-party code). */

(function () {
  const pubList = document.getElementById("pubList");
  const pubMeta = document.getElementById("pubMeta");

  if (!pubList || !pubMeta) return;

  let pubs = null;
  let loadError = false;

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
    const dict = typeof window.__getI18n === "function" ? window.__getI18n() : null;
    const lang = typeof window.__getLang === "function" ? window.__getLang() : "en";
    const map = dict && dict[lang] ? dict[lang] : null;
    if (loadError) {
      pubMeta.textContent = (map && map["pub.error"]) ||
        (lang === "de" ? "Publikationen konnten nicht geladen werden. Bitte versuchen Sie es später erneut." : "Could not load publications. Please try again later.");
      return;
    }
    if (!pubs) return;
    const count = pubs.length;
    const template = map && map["pub.meta.all"]
      ? map["pub.meta.all"]
      : (lang === "de" ? "Anzeige: alle Publikationen ({n})." : "Showing all publications ({n}).");
    pubMeta.textContent = template.replace("{n}", String(count));

    pubList.innerHTML = "";
    pubs.forEach(p => {
      const title = escapeHtml(p.title || "");
      const authors = Array.isArray(p.authors) ? escapeHtml(p.authors.join(", ")) : "";
      const venue = escapeHtml(p.venue || "");

      const links = p.links || {};
      const linkEntries = Object.entries(links)
        .filter(([, url]) => {
          try { return ["https:", "http:"].includes(new URL(url).protocol); }
          catch (_) { return false; }
        })
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
    if (!data || !Array.isArray(data.publications)) {
      throw new Error("Invalid publications data: expected a publications array");
    }
    if (data.publications.some(p => !p || typeof p !== "object" || typeof p.title !== "string")) {
      throw new Error("Invalid publication record");
    }
    pubs = data.publications;
    // treat missing 'selected' as visible; drop entries explicitly set to false
    pubs = pubs.filter(p => p.selected !== false);
    pubs.sort((a, b) => parseYear(b) - parseYear(a));
    render();
  }

  async function init() {
    try {
      if (window.location.protocol === "file:") {
        const el = document.getElementById("pubData");
        if (!el || !el.textContent.trim()) throw new Error("Embedded publication data is missing");
        setPubs(JSON.parse(el.textContent));
        return;
      }
      const res = await fetch("academic_website/data/publications.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPubs(data);
    } catch (e) {
      console.error("Could not load publications:", e);
      loadError = true;
      render();
    }
  }

  window.addEventListener("langchange", render);
  init();
})();