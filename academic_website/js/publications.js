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

  function citationText(key) {
    const lang = typeof window.__getLang === "function" ? window.__getLang() : "en";
    const dict = typeof window.__getI18n === "function" ? window.__getI18n() : null;
    const fallback = {
      cite: ["Cite", "Zitieren"], label: ["BibTeX citation", "BibTeX-Literaturverweis"],
      copy: ["Copy BibTeX", "BibTeX kopieren"], download: ["Download .bib", ".bib herunterladen"],
      copied: ["BibTeX copied.", "BibTeX kopiert."],
      manual: ["Automatic copying is unavailable. The text is selected; copy it manually or download the .bib file.", "Automatisches Kopieren ist nicht verfügbar. Der Text ist markiert; bitte manuell kopieren oder die .bib-Datei herunterladen."]
    };
    return (dict && dict[lang] && dict[lang]["pub.cite." + key]) || fallback[key][lang === "de" ? 1 : 0];
  }

  pubList.addEventListener("click", async event => {
    const button = event.target.closest("[data-copy-citation]");
    if (!button) return;
    const panel = button.closest(".citation");
    const text = panel.querySelector("textarea");
    const status = panel.querySelector("[role=status]");
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text.value);
      status.textContent = citationText("copied");
    } catch (_) {
      text.focus();
      text.select();
      status.textContent = citationText("manual");
    }
  });

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
      el.setAttribute?.('data-publication', p.citationKey || '');
      el.innerHTML = `
        <p class="pub-title">${title}${p.award ? `<span class="badge">${escapeHtml(p.award)}</span>` : ""}</p>
        <p class="pub-authors">${authors}</p>
        <p class="pub-venue"><em>${venue}</em></p>
        ${linkEntries.length ? `
          <div class="pub-links">
            ${linkEntries.map(l => `<a href="${escapeHtml(l.url)}" data-stat-target="${escapeHtml(l.label.toLowerCase())}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join("")}
          </div>` : ""}
      `;
      if (typeof p.bibtex === "string" && p.bibtex.trim()) {
        const filename = String(p.citationKey || "citation").replace(/[^a-zA-Z0-9_-]/g, "_") + ".bib";
        el.innerHTML += `
          <details class="citation">
            <summary>${escapeHtml(citationText("cite"))}</summary>
            <label class="citation-label">${escapeHtml(citationText("label"))}
              <textarea readonly rows="12" spellcheck="false">${escapeHtml(p.bibtex)}</textarea>
            </label>
            <div class="citation-actions">
              <button class="btn" type="button" data-copy-citation data-stat-target="bibtex-copy">${escapeHtml(citationText("copy"))}</button>
              <a class="btn" data-stat-target="bibtex-download" download="${escapeHtml(filename)}" href="data:application/x-bibtex;charset=utf-8,${escapeHtml(encodeURIComponent(p.bibtex))}">${escapeHtml(citationText("download"))}</a>
            </div>
            <p class="citation-status" role="status"></p>
          </details>`;
      }
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
      (window.__analyticsLoadFailures ||= []).push('publications');
      console.error("Could not load publications:", e);
      loadError = true;
      render();
    }
  }

  window.addEventListener("langchange", render);
  init();
})();
