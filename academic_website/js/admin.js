(() => {
  let data, busy = false;
  const el = id => document.getElementById(id);
  const node = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  const duration = seconds => { const n = Math.round(Number(seconds)); return `${Math.floor(n/60)} min ${n%60} s`; };
  const date = seconds => seconds ? new Date(Number(seconds)*1000).toLocaleString('de-DE') : 'Noch nicht abgerufen';
  const source = value => value || 'Direkt / unbekannt';
  const signed = n => n === null ? 'Nicht verfügbar' : `${n>0?'+':''}${n}`;
  function link(label, url) {
    try { if (new URL(url).protocol !== 'https:') return node('span',label); } catch (_) { return node('span',label); }
    const a = node('a',label); a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;
  }
  function table(container, headers, rows, empty='Noch keine Daten vorhanden.') {
    container.replaceChildren();
    if (!rows.length) { const p=node('p',empty);p.className='empty';container.append(p);return; }
    const t=node('table'),head=node('thead'),tr=node('tr'),body=node('tbody');
    for(const title of headers){const th=node('th',title);th.scope='col';tr.append(th);}head.append(tr);
    for(const values of rows){const row=node('tr');for(const value of values){const td=node('td');if(value instanceof Node)td.append(value);else td.textContent=value??'–';row.append(td);}body.append(row);}
    t.append(head,body);container.append(t);
  }
  function external(pub,kind){return data.external.find(r=>r.publication===pub&&r.kind===kind);}
  function metadata(container,row) {
    const p=node('p',row ? `Letzter Erfolg: ${date(row.success)} · Letzter Versuch: ${date(row.checked)}` : 'Noch nicht abgerufen.');p.className='external-meta';container.append(p);
    if(row?.error){const e=node('p',`Abruf fehlgeschlagen: ${row.error}. Vorhandene Werte stammen vom letzten erfolgreichen Abruf.`);e.className='error';container.append(e);}
  }
  function renderCitations() {
    const pub=el('publication-filter').value;
    const container=el('citations-content');container.replaceChildren();
    const row=external(pub,'citations');metadata(container,row);
    if(!row?.payload){container.append(node('p','Zitationsdaten noch nicht verfügbar. OpenAlex & Zenodo abrufen, um den ersten Stand zu speichern.'));return;}
    const p=row.payload;
    const title=node('h3',`${p.count} Zitationen laut OpenAlex`);container.append(title,link('Quelle in OpenAlex',p.url));
    const history=ResearchMetrics.citationMonths(data.snapshots,pub,ResearchMetrics.months());
    const chart=node('div');chart.className='table-wrap';container.append(node('h3','Entwicklung je Monat'),chart);
    table(chart,['Monat (UTC)','Letzter erfasster Stand','Zitationen gesamt','Nettoänderung zum Vormonatsstand'],history.filter(h=>h.count!==null).map(h=>[h.month,h.day,h.count,signed(h.delta)]));
    container.append(node('p','Die erste Messung ist der Ausgangsstand. „Neue Zitationen“ sind hier Änderungen der Datenbankzählung; Nachindexierung und Korrekturen können spätere Änderungen verursachen.'));
    const details=node('details'),summary=node('summary',`Wer zitiert diese Arbeit? ${p.citing.length} von ${p.listedTotal} erfassten Arbeiten`);details.append(summary);
    const list=node('div');list.className='table-wrap';details.append(list);container.append(details);
    table(list,['Titel','Jahr','DOI'],p.citing.map(w=>[link(w.title,w.url),w.year,w.doi?link(w.doi.replace(/^https?:\/\/doi.org\//,''),w.doi):'Keine DOI hinterlegt']), 'In dieser Quelle wurden keine zitierenden Arbeiten gefunden.');
    if(p.partial)details.append(node('p','Liste unvollständig: maximal 1.000 Arbeiten pro Abruf. Die Gesamtzahl stammt separat von OpenAlex.'));
  }
  function render() {
    const aggregate = data.mode === 'aggregate';
    for (const id of ['interest','reading','visitors','error-tracking']) el(id).hidden = aggregate;
    for (const id of ['interest','reading','visitors']) document.querySelector(`.admin-nav a[href="#${id}"]`).hidden = aggregate;
    for (const id of ['average','actions']) el(id).closest('.metric').hidden = aggregate;
    el('count').parentElement.firstChild.textContent = aggregate ? 'Seitenaufrufe · 30 Kalendertage (UTC)' : 'Besuche · 30 Tage';
    if (aggregate) el('mode-note').textContent = 'Serverseitige Aufrufzählung ohne gespeicherte IP-Adressen, Browserdaten oder Besucherkennungen. Gezählt werden Seitenabrufe, einschließlich möglicher Bots und wiederholter Abrufe. Keine Messung einzelner Besuche, Klicks oder Lesetiefe. Zitationen und Zenodo-Daten bleiben unabhängig davon verfügbar.';
    el('count').textContent=data.totals.visits;el('average').textContent=duration(data.totals.average);
    el('actions').textContent=data.engagement.reduce((n,r)=>n+Number(r.clicks),0);
    const available=data.publications.map(p=>external(p.citationKey,'citations')).filter(r=>r?.payload);
    el('citation-total').textContent=available.length?`${available.reduce((n,r)=>n+Number(r.payload.count),0)}${available.length<data.publications.length?' (teilweise)':''}`:'–';
    el('status').textContent=`Aktualisiert · Besuchsdetails: ${data.retentionDays} Tage · ${data.fullIp?'Vollständige':'Gekürzte'} IP-Adressen · Monatsaggregate: 24 Monate`;
    if (aggregate) el('status').textContent = 'Aktualisiert · Reine Aufrufzählung · Tageszahlen: 30 Kalendertage · Monatszahlen: 24 Monate';
    const rows=ResearchMetrics.monthly(data);const current=rows.at(-1),previous=rows.at(-2);
    const started=new Date(data.trackingStarted*1000).toISOString().slice(0,10);
    el('coverage').textContent=`Monatserfassung aktiviert am ${started}. Monate vor Beginn sind nicht vollständig erfasst. Der laufende Monat wird mit dem gesamten Vormonat verglichen; die Zeiträume sind unterschiedlich lang.`;
    table(el('comparison-table'),['Kennzahl',`${previous.month} · abgeschlossen`,`${current.month} · laufend`,'Differenz'],[
      [aggregate?'Seitenaufrufe':'Besuche',previous.visits??'Nicht erfasst',current.visits??'Nicht erfasst',previous.visits===null||current.visits===null?'Nicht verfügbar':signed(current.visits-previous.visits)],
      ...(!aggregate ? [['Publikationsaktionen',previous.clicks??'Nicht erfasst',current.clicks??'Nicht erfasst',previous.clicks===null||current.clicks===null?'Nicht verfügbar':signed(current.clicks-previous.clicks)]] : []),
      ['Zitations-Nettoänderung',signed(previous.citations),signed(current.citations),current.citations===null||previous.citations===null?'Nicht verfügbar':signed(current.citations-previous.citations)]
    ]);
    const chart=el('monthly-chart');chart.replaceChildren();const max=Math.max(1,...rows.flatMap(r=>[r.visits,r.clicks]));
    el('comparison').querySelector('h3').textContent = aggregate ? 'Seitenaufrufe nach Monat' : 'Besuche und Publikationsaktionen nach Monat';
    chart.append(node('p',aggregate?'Blau: Seitenaufrufe. Fehlende Erfassung ist keine tatsächliche Null.':'Blau: Besuche · Grün: Publikationsaktionen. Fehlende Erfassung kann nicht als tatsächliche Null interpretiert werden.'));
    for(const r of rows){const row=node('div');row.className='bar-row';row.append(node('span',r.month));const pair=node('div');pair.className='bar-pair';for(const [i,v]of(aggregate?[r.visits]:[r.visits,r.clicks]).entries()){const bar=node('span');bar.className=i?'bar secondary':'bar';bar.style.width=`${100*(v??0)/max}%`;pair.append(bar);}row.append(pair,node('span',aggregate?`${r.visits??'–'}`:`${r.visits??'–'} / ${r.clicks??'–'}`));chart.append(row);}
    const targets=['doi','fulltext','data','bibtex-copy','bibtex-download','other'];
    const grouped=data.publications.map(p=>{const counts=Object.fromEntries(targets.map(t=>[t,0]));for(const r of data.engagement.filter(r=>r.publication===p.citationKey)){const t=r.target;const group=t==='doi'?t:['publisher','igi','acm','ssrn','pdf','fulltext'].includes(t)?'fulltext':['zenodo','data','dataset'].includes(t)?'data':targets.includes(t)?t:'other';counts[group]+=Number(r.clicks);}return[p.title,...targets.map(t=>counts[t])];});
    table(el('interest-table'),['Publikation','DOI','Volltext / Verlag / Preprint','Datenpaket','BibTeX kopieren','BibTeX Download','Weitere Links'],grouped);
    table(el('conversion-table'),['Herkunft','Besuche','Mit Publikationsaktion','Aktionen','Quote'],data.conversion.map(r=>[source(r.source),r.visits,r.engaged,r.clicks,`${(100*r.engaged/Math.max(1,r.visits)).toFixed(1)} %`]));
    const select=el('publication-filter'),selected=select.value;select.replaceChildren();
    for(const p of data.publications){const option=node('option',p.title);option.value=p.citationKey;select.append(option);}if(data.publications.some(p=>p.citationKey===selected))select.value=selected;renderCitations();
    const datasets=el('zenodo-content');datasets.replaceChildren();
    for(const p of data.publications.filter(p=>p.links?.zenodo)){const row=external(p.citationKey,'zenodo');datasets.append(node('h3',p.title));metadata(datasets,row);if(row?.payload){const v=row.payload;datasets.append(node('p',`${v.views} Aufrufe · ${v.downloads} Downloads`),link('Datensatz bei Zenodo',v.url));}}
    if(!datasets.children.length)datasets.append(node('p','Keine Zenodo-Pakete hinterlegt.'));
    const labels={'short-bio':'Kurzbiografie',about:'Über mich',research:'Forschung',publications:'Publikationen',service:'Akademischer Service',news:'Neuigkeiten',contact:'Kontakt',i18n:'Sprachdaten'};
    const sections=['short-bio','about','research','publications','service','news','contact'];
    const reading=(kind,target)=>Number(data.reading.find(r=>r.kind===kind&&r.target===target)?.visits||0);
    table(el('sections-table'),['Bereich','Besuche'],sections.map(s=>[labels[s],reading('section',s)]));
    table(el('depth-table'),['Erreichte Tiefe','Besuche'],['25','50','75','100'].map(s=>[`${s} %`,reading('depth',s)]));
    table(el('errors-table'),['Datenquelle','Besuche mit Ladefehler'],['publications','i18n'].map(s=>[labels[s],reading('error',s)]));
    const linkRows=[];
    for(const p of data.publications){const row=external(p.citationKey,'links');if(!row?.payload){linkRows.push([p.title,'–','Noch nicht geprüft',row?.error||'–',date(row?.checked)]);continue;}for(const l of row.payload.links)linkRows.push([p.title,link(l.name.toUpperCase(),l.url),l.state,l.status||l.error||'–',date(row.success)]);}
    table(el('links-table'),['Publikation','Link','Zustand','HTTP / Hinweis','Geprüft'],linkRows);
    el('visits').replaceChildren();for(const v of data.visits){const tr=node('tr');for(const value of[date(v.started),v.path,duration(v.seconds),source(v.referrer),v.ip,v.browser])tr.append(node('td',value));el('visits').append(tr);}
  }
  async function load(){const r=await fetch('/analytics-api.php?action=stats',{cache:'no-store'});if(!r.ok)throw Error('Statistik nicht erreichbar. Anmeldung und PHP-Konfiguration prüfen.');data=await r.json();render();}
  function controls(disabled){for(const id of['refresh','sync-research','check-links'])el(id).disabled=disabled;}
  async function refresh(){if(busy)return;busy=true;controls(true);try{await load();}catch(e){el('status').textContent=e.message;}finally{busy=false;controls(false);}}
  async function sync(links=false){
    if(busy||!data)return;busy=true;controls(true);const status=el(links?'link-status':'sync-status');let errors=0,cached=0,running=0;
    const jobs=data.publications.flatMap(p=>links?[[p,'links']]:[[p,'citations'],...(p.links?.zenodo?[[p,'zenodo']]:[])]);
    try{for(const [i,[p,kind]]of jobs.entries()){
      status.textContent=`${i+1}/${jobs.length}: ${p.title} · ${kind} …`;
      try{const r=await fetch('/analytics-api.php?action=refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({publication:p.citationKey,kind})});if(!r.ok)throw Error();const result=await r.json();if(result.busy)running++;else if(result.cached)cached++;else if(!result.ok)errors++;}catch(_){errors++;}
    }await load();status.textContent=`Abruf abgeschlossen: ${errors} Fehler · ${cached} bereits innerhalb der letzten Stunde geprüft${running?` · ${running} Abrufe laufen bereits; Ansicht später aktualisieren`:''}. Details und letzte erfolgreiche Stände stehen bei den Quellen.`;
    }catch(e){status.textContent=e.message;}finally{busy=false;controls(false);}
  }
  el('refresh').onclick=refresh;el('sync-research').onclick=()=>sync();el('check-links').onclick=()=>sync(true);el('publication-filter').onchange=renderCitations;refresh();
})();
