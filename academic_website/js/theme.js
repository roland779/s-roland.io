/* theme.js — light/dark mode toggle (no third-party code)
   - Default: OS preference (prefers-color-scheme)
   - User choice persisted in localStorage
*/

(function () {
  const KEY = "rrs_theme";

  const systemTheme = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  let choice = null;

  function apply(theme) {
    choice = theme;
    const effectiveTheme = theme || (systemTheme && systemTheme.matches ? "dark" : "light");
    const root = document.documentElement;
    if (theme === "dark") root.setAttribute("data-theme", "dark");
    else if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme"); // follow OS
    // Update button state
    document.querySelectorAll("[data-theme-btn]").forEach(b => {
      b.setAttribute("aria-pressed", b.getAttribute("data-theme-btn") === effectiveTheme ? "true" : "false");
    });
  }

  function init() {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (_) {}
    if (saved === "light" || saved === "dark") apply(saved);
    else apply(null);

    document.querySelectorAll("[data-theme-btn]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-theme-btn");
        if (v !== "light" && v !== "dark") return;
        try { localStorage.setItem(KEY, v); } catch (_) {}
        apply(v);
      });
    });

    if (systemTheme && systemTheme.addEventListener) {
      systemTheme.addEventListener("change", () => {
        if (choice === null) apply(null);
      });
    }

    const reset = document.getElementById("themeAuto");
    if (reset) {
      reset.addEventListener("click", () => {
        try { localStorage.removeItem(KEY); } catch (_) {}
        apply(null);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();