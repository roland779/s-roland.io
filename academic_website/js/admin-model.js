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
    return months(now,24).map(month => {
      const rows = data.monthly.filter(r => r.month === month);
      const changes = data.publications.map(p => citationMonths(data.snapshots,p.citationKey,[month])[0].delta);
      const aggregate = data.mode === 'aggregate';
      const visitRows = rows.filter(r=>r.kind===(aggregate?'pageview':'visit'));
      return {month, visits: month < startMonth && !visitRows.length ? null : visitRows.reduce((n,r)=>n+Number(r.count),0), clicks: aggregate || month < startMonth ? null : rows.filter(r=>r.kind==='click').reduce((n,r)=>n+Number(r.count),0), citations: changes.length && changes.every(n=>n!==null) ? changes.reduce((a,b)=>a+b,0) : null};
    });
  }
  function daily(data, now = new Date(), length = 30) {
    const today = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
    const counts = new Map((data.daily || []).map(r=>[r.day,Number(r.count)]));
    const start = new Date((data.trackingStarted || 0)*1000).toISOString().slice(0,10);
    const rows = Array.from({length:30},(_,i)=>{
      const day = new Date(today-(29-i)*86400000).toISOString().slice(0,10);
      return {day,count:day<start ? null : (counts.get(day) ?? 0)};
    });
    return rows.map((r,i)=>{
      const window=rows.slice(Math.max(0,i-6),i+1);
      const completeStart = Date.parse(window[0].day+'T00:00:00Z') >= (data.trackingStarted || 0)*1000;
      return {...r,average:completeStart&&window.length===7&&window.every(v=>v.count!==null)?window.reduce((n,v)=>n+v.count,0)/7:null};
    }).slice(-length);
  }
  const api = {months,citationMonths,monthly,daily};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ResearchMetrics = api;
})(typeof window !== 'undefined' ? window : globalThis);
