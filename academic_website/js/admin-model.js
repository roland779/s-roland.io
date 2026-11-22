/* Pure aggregation shared by the dashboard and its tests. */
(function (root) {
  function monthKey(date) { return date.toISOString().slice(0, 7); }
  function months(now = new Date(), length = 12) {
    return Array.from({length}, (_, i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - length + 1 + i, 1))));
  }
  function citationMonths(snapshots, publication, keys) {
    const latest = new Map();
    for (const s of snapshots.filter(s => s.publication === publication).sort((a,b) => a.day.localeCompare(b.day))) latest.set(s.day.slice(0,7), s);
    return keys.map(month => {
      const [y,m] = month.split('-').map(Number);
      const previous = monthKey(new Date(Date.UTC(y,m-2,1)));
      const row = latest.get(month), before = latest.get(previous);
      return {month, count: row ? Number(row.count) : null, day: row?.day || null, delta: row && before ? Number(row.count)-Number(before.count) : null};
    });
  }
  function monthly(data, now = new Date()) {
    const startMonth = monthKey(new Date((data.trackingStarted || 0) * 1000));
    return months(now).map(month => {
      const rows = data.monthly.filter(r => r.month === month);
      const changes = data.publications.map(p => citationMonths(data.snapshots,p.citationKey,[month])[0].delta);
      const visitRows = rows.filter(r=>r.kind==='visit');
      return {month, visits: month < startMonth && !visitRows.length ? null : visitRows.reduce((n,r)=>n+Number(r.count),0), clicks: month < startMonth ? null : rows.filter(r=>r.kind==='click').reduce((n,r)=>n+Number(r.count),0), citations: changes.length && changes.every(n=>n!==null) ? changes.reduce((a,b)=>a+b,0) : null};
    });
  }
  const api = {months,citationMonths,monthly};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ResearchMetrics = api;
})(typeof window !== 'undefined' ? window : globalThis);
