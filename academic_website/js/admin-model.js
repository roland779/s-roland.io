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
  function sourceCoverage(data, kind, now = new Date()) {
    const groups = new Map(), fields = kind==='citations'?['count']:['views','downloads'];
    for(const pub of data.publications.filter(p=>kind==='citations'||p.links?.zenodo)){
      const row=data.external.find(r=>r.publication===pub.citationKey&&r.kind===kind);
      const url=pub.links?.zenodo||row?.payload?.url||'',record=url.match(/zenodo\.org\/records?\/(\d+)/i);
      const key=kind==='citations'?pub.citationKey:(record?'zenodo:'+record[1]:url);
      if(!groups.has(key))groups.set(key,[]);
      if(row)groups.get(key).push(row);
    }
    const result={expected:groups.size,available:0,missing:0,stale:0,errors:0,unknown:0,oldest:null,rows:[]};
    for(const entries of groups.values()){
      const valid=entries.filter(r=>r.payload&&fields.every(f=>typeof r.payload[f]==='number'&&Number.isFinite(r.payload[f])&&r.payload[f]>=0));
      const row=valid.sort((a,b)=>Number(b.success||0)-Number(a.success||0))[0];
      const lastAttempt=[...entries].sort((a,b)=>Number(b.checked||0)-Number(a.checked||0))[0];
      if(lastAttempt?.error)result.errors++;
      if(!row){result.missing++;continue;}
      result.available++;result.rows.push(row);
      const success=Number(row.success);
      if(!Number.isFinite(success)||success<=0||success>now.getTime()/1000){result.unknown++;continue;}
      result.oldest=result.oldest===null?success:Math.min(result.oldest,success);
      if(now.getTime()/1000-success>86400)result.stale++;
    }
    return result;
  }
  function monthCoverage(started, month) {
    const start=Date.parse(month+'-01T00:00:00Z'),[year,m]=month.split('-').map(Number);
    const end=Date.UTC(year,m,1),tracking=Number(started)*1000;
    return tracking>=end?'Nicht erfasst':tracking>start?'Teilweise erfasst':'Vollständiger Erfassungszeitraum';
  }
  const api = {months,citationMonths,monthly,daily,sourceCoverage,monthCoverage};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ResearchMetrics = api;
})(typeof window !== 'undefined' ? window : globalThis);
