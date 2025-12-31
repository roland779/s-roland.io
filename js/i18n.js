/* i18n.js — lightweight bilingual switch (EN/DE)
   Authored for this template (no third-party code). */

(function () {
  const STORE_KEY = "rrs_lang";
  let dict = null;
  let lang = (localStorage.getItem(STORE_KEY) || (navigator.language || "en")).toLowerCase().startsWith("de") ? "de" : "en";

  function applyTranslations() {
    if (!dict) return;
    const map = dict[lang] || dict.en;

    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      const val = map[key];
      if (typeof val === "string") {
        el.textContent = val;
      }
    });

    // Footer last updated (if present)
    const last = document.getElementById("lastUpdated");
    if (last && map["footer.last_updated"]) {
      const d = new Date();
      const opts = { year: "numeric", month: "long" };
      const ds = d.toLocaleDateString(undefined, opts);
      last.textContent = map["footer.last_updated"].replace("{d}", ds);
    }

    // Toggle button label (pubs.js will override after it loads; this sets initial state)
    const pubToggle = document.getElementById("pubToggle");
    if (pubToggle) {
      pubToggle.textContent = map["pub.toggle.show_all"] || pubToggle.textContent;
    }

    // Update active lang button
    document.querySelectorAll("[data-lang]").forEach(b => {
      b.setAttribute("aria-pressed", b.getAttribute("data-lang") === lang ? "true" : "false");
    });
  }

  async function init() {
    try {
      const res = await fetch("data/i18n.json", { cache: "no-store" });
      dict = await res.json();
    } catch (e) {
      // Fallback for file:// usage: read embedded JSON from index.html
      try {
        const el = document.getElementById("i18nData");
        if (el && el.textContent) {
          dict = JSON.parse((el.textContent || "").trim());
        } else {
          dict = null;
        }
      } catch (_) {
        dict = null;
      }
      if (!dict) return;
    }

    applyTranslations();

    document.querySelectorAll("[data-lang]").forEach(btn => {
      btn.addEventListener("click", () => {
        const next = btn.getAttribute("data-lang");
        if (!next) return;
        lang = next;
        localStorage.setItem(STORE_KEY, lang);
        applyTranslations();

        // Let publications module re-render with localized strings if available
        window.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
      });
    });
  }

  window.__getLang = () => lang;
  window.__getI18n = () => dict;

  
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();