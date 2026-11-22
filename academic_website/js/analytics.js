(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  const STORE = 'visitor-statistics-v2';
  let id, last, timer, observer, starting = false, pending = false, generation = 0;
  let visible = !document.hidden;
  let accrued = 0;
  const seen = new Set();
  const de = () => document.documentElement.lang === 'de';
  const send = (action, data, keepalive = false) => fetch(`/analytics-api.php?action=${action}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data), keepalive
  });
  function event(kind, target, publication = '') {
    if (!id || document.hidden) return;
    const key = `${kind}:${target}`;
    if (kind !== 'click' && seen.has(key)) return;
    if (kind !== 'click') seen.add(key);
    send('event', {id, kind, target, publication}, true).catch(() => {});
  }
  function failures() {
    for (const target of window.__analyticsLoadFailures || []) event('error', target);
  }
  function depth() {
    if (!id) return;
    const height = document.documentElement.scrollHeight;
    if (!height) return;
    const percent = 100 * (window.scrollY + window.innerHeight) / height;
    for (const level of [25, 50, 75, 100]) if (percent >= level - 0.5) event('depth', String(level));
  }
  async function beat() {
    if (!id) return;
    const now = performance.now();
    if (visible) accrued = Math.min(20, accrued + Math.max(0, (now - last) / 1000));
    last = now;
    if (pending) return;
    const seconds = accrued;
    accrued = 0; pending = true;
    try { await send('visit', {id, seconds}, true); } catch (_) {} finally { pending = false; }
    failures();
  }
  function stop() {
    generation++; clearInterval(timer); observer?.disconnect(); id = null; seen.clear(); starting = false; accrued = 0;
  }
  async function start() {
    if (id || starting) return;
    starting = true;
    const current = ++generation;
    try {
      const response = await send('visit', {path: location.pathname, referrer: document.referrer});
      if (!response.ok) return;
      const visit = await response.json();
      if (current !== generation) return;
      id = visit.id; last = performance.now(); visible = !document.hidden; accrued = 0;
      timer = setInterval(beat, 15000);
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(entries => {
          for (const entry of entries) if (entry.isIntersecting && entry.intersectionRatio >= 0.1 && !document.hidden) event('section', entry.target.id);
        }, {threshold: 0.1});
        document.querySelectorAll('main section[id]').forEach(section => observer.observe(section));
      }
      depth(); failures();
    } catch (_) {} finally { if (current === generation) starting = false; }
  }
  document.addEventListener('click', e => {
    const target = e.target.closest?.('[data-stat-target]');
    const pub = target?.closest('[data-publication]');
    if (pub) event('click', target.dataset.statTarget, pub.dataset.publication);
  });
  document.addEventListener('auxclick', e => {
    if (e.button !== 1) return;
    const target = e.target.closest?.('a[data-stat-target]');
    const pub = target?.closest('[data-publication]');
    if (pub) event('click', target.dataset.statTarget, pub.dataset.publication);
  });
  window.addEventListener('scroll', depth, {passive: true});
  document.addEventListener('visibilitychange', () => {
    beat(); visible = !document.hidden; last = performance.now();
    if (visible) {
      depth(); failures();
      if (id && observer) {
        observer.disconnect();
        document.querySelectorAll('main section[id]').forEach(section => observer.observe(section));
      }
    }
  });
  window.addEventListener('pagehide', beat);
  window.addEventListener('pageshow', () => { last = performance.now(); visible = !document.hidden; });
  window.addEventListener('storage', e => { if (e.key === null || (e.key === STORE && e.newValue !== 'yes')) stop(); });
  async function setup() {
    let config;
    try { const r = await fetch('/analytics-api.php?action=config'); if (!r.ok) return; config = await r.json(); } catch (_) { return; }
    if (!config.enabled || navigator.globalPrivacyControl || navigator.doNotTrack === '1') return;
    let choice;
    try { choice = localStorage.getItem(STORE); } catch (_) {}
    const panel = document.createElement('aside');
    panel.className = 'analytics-consent'; panel.setAttribute('aria-label', de() ? 'Besucherstatistik' : 'Visitor statistics');
    const text = document.createElement('p');
    text.textContent = de()
      ? `Dürfen wir aktive Besuchsdauer, Herkunftswebsite, Browser, ${config.fullIp ? 'vollständige' : 'gekürzte'} IP-Adresse, Publikations- und BibTeX-Klicks, sichtbare Seitenbereiche, Scrolltiefe und Fehler beim Datenladen erfassen? Besuchsdetails werden 30 Tage gespeichert; zusammengefasste Monatszahlen ohne Besuchskennung und IP bleiben 24 Monate. Ohne externe Analysedienste. Ihre Auswahl wird in diesem Browser gespeichert. Ein Widerruf stoppt weitere Erfassung.`
      : `May we collect active visit duration, referring website, browser, ${config.fullIp ? 'full' : 'truncated'} IP address, publication and BibTeX clicks, visible sections, scroll depth and data loading failures? Visit details are retained for 30 days; monthly aggregates without visit IDs or IPs for 24 months. No external analytics services. Your choice is saved in this browser. Withdrawal stops further collection.`;
    const allow = document.createElement('button'); allow.textContent = de() ? 'Zustimmen' : 'Allow';
    const deny = document.createElement('button'); deny.textContent = de() ? 'Ablehnen / Widerrufen' : 'Decline / Withdraw';
    panel.append(text, allow, deny);
    function choose(value) {
      try { localStorage.setItem(STORE, value); } catch (_) {}
      panel.remove();
      if (value === 'yes') start(); else stop();
    }
    allow.onclick = () => choose('yes'); deny.onclick = () => choose('no');
    const settings = document.createElement('button'); settings.className = 'analytics-settings'; settings.textContent = de() ? 'Statistik-Einstellungen' : 'Statistics settings';
    settings.onclick = () => document.body.append(panel);
    document.querySelector('footer')?.append(settings);
    if (choice === 'yes') start(); else if (!choice) document.body.append(panel);
  }
  setup();
})();
