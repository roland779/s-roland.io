/* Refresh public research metadata without collecting visitor statistics. */
(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  let pending = false;
  async function tick() {
    if (pending || document.hidden) return;
    pending = true;
    try {
      await fetch('/analytics-api.php?action=maintenance', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'
      });
    } catch (_) { /* Cached data and the website remain usable when a source fails. */ }
    finally { pending = false; }
  }
  tick();
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
})();
