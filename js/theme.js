/* theme.js — light/dark mode toggle (no third-party code)
   - Default: OS preference (prefers-color-scheme)
   - User choice persisted in localStorage
*/

(function () {
  const KEY = "rrs_theme";

  function apply(theme) {
    const root = document.documentElement;
    if (theme === "dark") root.setAttribute("data-theme", "dark");
    else if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme"); // follow OS
    // Update button state
    document.querySelectorAll("[data-theme-btn]").forEach(b => {
      b.setAttribute("aria-pressed", b.getAttribute("data-theme-btn") === theme ? "true" : "false");
    });
  }

  function init() {
    const saved = localStorage.getItem(KEY); // "light" | "dark" | null
    if (saved === "light" || saved === "dark") apply(saved);
    else apply(null);

    document.querySelectorAll("[data-theme-btn]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-theme-btn");
        if (v !== "light" && v !== "dark") return;
        localStorage.setItem(KEY, v);
        apply(v);
      });
    });

    const reset = document.getElementById("themeAuto");
    if (reset) {
      reset.addEventListener("click", () => {
        localStorage.removeItem(KEY);
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