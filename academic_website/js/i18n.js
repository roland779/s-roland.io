/* i18n.js — lightweight bilingual switch (EN/DE)
   Authored for this template (no third-party code). */

(function () {
  const STORE_KEY = "rrs_lang";
  let dict = null;
  let savedLang = null;
  try { savedLang = localStorage.getItem(STORE_KEY); } catch (_) {}
  let lang = (savedLang || (navigator.language || "en")).toLowerCase().startsWith("de") ? "de" : "en";

  function validateDictionary(value) {
    if (!value || !["en", "de"].every(key =>
      value[key] && typeof value[key] === "object" && !Array.isArray(value[key])
    )) throw new Error("Invalid translation data");
    return value;
  }

  function applyTranslations() {
    if (!dict) return;
    const map = dict[lang] || dict.en;
    document.documentElement.lang = lang;

    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      const val = map[key];
      if (typeof val === "string") {
        el.textContent = val;
      }
    });

    document.querySelectorAll("[data-i18n-aria]").forEach(el => {
      const value = map[el.getAttribute("data-i18n-aria")];
      if (typeof value === "string") el.setAttribute("aria-label", value);
    });

    // Update active lang button
    document.querySelectorAll("[data-lang]").forEach(b => {
      b.setAttribute("aria-pressed", b.getAttribute("data-lang") === lang ? "true" : "false");
    });
  }

  async function init() {
    try {
      const res = await fetch("academic_website/data/i18n.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dict = validateDictionary(await res.json());
    } catch (e) {
      (window.__analyticsLoadFailures ||= []).push('i18n');
      // Fallback for file:// usage: read embedded JSON from index.html
      try {
        const el = document.getElementById("i18nData");
        if (el && el.textContent) {
          dict = validateDictionary(JSON.parse((el.textContent || "").trim()));
        } else {
          dict = null;
        }
      } catch (_) {
        dict = null;
      }
      if (!dict) return;
    }

    applyTranslations();
    window.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));

    document.querySelectorAll("[data-lang]").forEach(btn => {
      btn.addEventListener("click", () => {
        const next = btn.getAttribute("data-lang");
        if (next !== "en" && next !== "de") return;
        lang = next;
        try { localStorage.setItem(STORE_KEY, lang); } catch (_) {}
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
