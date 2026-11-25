(() => {
  let data, busy = false, apiAvailable = false, monthlyChart, dailyChart;
  let researchCharts=[];
  const el = id => document.getElementById(id);
  const apiBase = new URL(document.querySelector('meta[name="analytics-base"]')?.content || './', location.href);
  const apiUrl = action => new URL(`analytics-api.php?action=${action}`, apiBase).href;
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
    container.tabIndex=0;container.setAttribute('role','region');container.setAttribute('aria-label',`Tabelle: ${container.closest('section')?.querySelector('h2')?.textContent||headers[0]}`);
  }
  function external(pub,kind){return data.external.find(r=>r.publication===pub&&r.kind===kind);}
  function coverageCaption(id, summary, noun){
    const target=el(id);target.replaceChildren();
    const warning=summary.missing||summary.stale||summary.errors||summary.unknown;
    target.className=`metric-coverage${warning?' needs-attention':''}`;
    const unit=summary.expected===1?(noun==='Datensätze'?'Datensatz':'Publikation'):noun;
    const line=node('span',summary.expected?`${summary.available} von ${summary.expected} ${unit} erfasst`:`Keine ${noun} hinterlegt`);
    target.append(line);
    if(summary.expected){
      const notes=[];
      if(summary.missing)notes.push(`${summary.missing} fehlen`);
      if(summary.stale)notes.push(`${summary.stale} älter als 24 Stunden`);
      if(summary.errors)notes.push(`${summary.errors} mit Abruffehler`);
      if(summary.unknown)notes.push(`${summary.unknown} ohne gültigen Zeitstempel`);
      if(notes.length)target.append(node('span',notes.join(' · ')));
      if(summary.oldest!==null)target.append(node('span',`Ältester verwendeter Stand: ${new Date(summary.oldest*1000).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})}`));
      if(summary.errors&&summary.available)target.append(node('span','Vorhandene erfolgreiche Messstände bleiben berücksichtigt.'));
    }
    const details=node('a','Quellen prüfen');details.href='#sources';target.append(details);
  }
  function metadata(container,row) {
    const p=node('p',row ? `Letzter Erfolg: ${date(row.success)} · Letzter Versuch: ${date(row.checked)}` : 'Noch nicht abgerufen.');p.className='external-meta';container.append(p);
    if(row?.error){const e=node('p',`Abruf fehlgeschlagen: ${row.error}. Vorhandene Werte stammen vom letzten erfolgreichen Abruf.`);e.className='error';container.append(e);}
  }
  const kinds={citations:'OpenAlex',zenodo:'Zenodo',links:'Publikationslinks'};
  function renderSources(){
    const container=el('sources-content'),open=container.querySelector('details')?.open;
    container.replaceChildren();
    const attention=node('div'),healthy=node('div'),details=node('details'),summary=node('summary');
    attention.className=healthy.className='source-grid';details.className='data-details';details.open=!!open;
    let currentCount=0,attentionCount=0;
    for(const pub of data.publications)for(const kind of ['citations',...(pub.links?.zenodo?['zenodo']:[]),'links']){
      const row=external(pub.citationKey,kind),card=node('article'),head=node('div'),badge=node('span');
      card.className='source-card';head.className='source-head';
      const name=node('span',kinds[kind]);name.className='source-kind';
      const success=Number(row?.success),known=Number.isFinite(success)&&success>0&&success<=Date.now()/1000;
      const stale=known&&Date.now()/1000-success>(kind==='links'?7:1)*86400;
      badge.className=`source-badge ${row?.error?'failed':!known?'pending':stale?'stale':''}`;
      badge.textContent=row?.error?'Abruffehler':!known?(row?.payload?'Zeitstand unbekannt':'Noch kein Abruf'):stale?'Veraltet':'Aktuell';head.append(name,badge);
      card.append(head,node('h3',pub.title));metadata(card,row);
      const button=node('button','Quelle aktualisieren');button.type='button';button.dataset.sourcePublication=pub.citationKey;button.dataset.sourceKind=kind;
      button.setAttribute('aria-label',`${kinds[kind]} für ${pub.title} aktualisieren`);button.disabled=busy;card.append(button);
      if(known&&row.payload&&!row.error&&!stale){healthy.append(card);currentCount++;}
      else {attention.append(card);attentionCount++;}
    }
    if(attentionCount)container.append(node('p',`${attentionCount} Quellen benötigen Aufmerksamkeit.`),attention);
    if(currentCount){summary.textContent=`${currentCount} Quellen aktuell · Details anzeigen`;details.append(summary,healthy);container.append(details);}
    if(!currentCount&&!attentionCount){const p=node('p','Noch keine Publikationen hinterlegt.');p.className='empty';container.append(p);}
  }
  function renderMonthlyChart(){
    const aggregate=data.mode==='aggregate',all=ResearchMetrics.monthly(data),range=el('chart-range').value;
    const rows=range==='auto'?ResearchMetrics.recordedRange(all,['visits','clicks']):all.slice(-Number(range));
    table(el('monthly-data'),['Monat (UTC)',aggregate?'Seitenaufrufe':'Besuche',...(!aggregate?['Publikationsaktionen']:[]),'Zitations-Nettoänderung'],rows.map(r=>[r.month,r.visits??'Nicht erfasst',...(!aggregate?[r.clicks??'Nicht erfasst']:[]),signed(r.citations)]));
    monthlyChart?.destroy();monthlyChart=undefined;
    const any=rows.some(r=>r.visits!==null&&(r.visits>0||data.mode==='aggregate')||r.clicks>0);
    el('chart-message').textContent=any?'Serien über die Legende ein- und ausblenden. Details erscheinen beim Zeigen auf einen Messpunkt. Werte sind auch als Tabelle verfügbar.':'Noch keine Daten erfasst. Sobald Aufrufe vorliegen, erscheint hier der Monatsverlauf.';
    const observed=rows.filter(r=>r.visits!==null||r.clicks!==null);
    if(any&&observed.length===1){el('monthly-chart').hidden=true;el('chart-message').textContent=`Ausgangsstand: ${observed[0].visits??'–'} ${aggregate?'Seitenaufrufe':'Besuche'} im Monat ${observed[0].month}. Der Monatsverlauf entsteht mit weiteren erfassten Monaten. Werte stehen in der Tabelle.`;return;}
    if(!window.Chart){el('monthly-chart').hidden=true;el('chart-message').textContent='Das Diagramm ist nicht verfügbar. Alle Monatswerte stehen in der Tabelle darunter.';return;}
    el('monthly-chart').hidden=!any;if(!any)return;
    const datasets=[{label:aggregate?'Seitenaufrufe':'Besuche',data:rows.map(r=>r.visits),backgroundColor:'#3869cf',borderRadius:4,maxBarThickness:34}];
    if(!aggregate)datasets.push({label:'Publikationsaktionen',data:rows.map(r=>r.clicks),backgroundColor:'#27948a',borderRadius:4,maxBarThickness:34});
    const current=rows.at(-1).month;
    datasets[0].backgroundColor=rows.map(r=>r.month===current?'#a5bce9':'#3869cf');
    monthlyChart=new Chart(el('monthly-canvas'),{type:'bar',data:{labels:rows.map(r=>new Date(r.month+'-01T00:00:00Z').toLocaleDateString('de-DE',{month:'short',year:'numeric',timeZone:'UTC'})+(r.month===current?' · laufend':'')),datasets},options:chartOptions()});
  }
  function chartOptions(){return {responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom'},tooltip:{filter:i=>i.raw!==null}},scales:{x:{grid:{display:false},ticks:{maxRotation:0,maxTicksLimit:6}},y:{beginAtZero:true,ticks:{precision:0},grid:{color:'#edf0f5'}}}};}
  function renderDaily(){
    const aggregate=data.mode==='aggregate';el('daily-panel').hidden=!aggregate;
    dailyChart?.destroy();dailyChart=undefined;if(!aggregate)return;
    const all=ResearchMetrics.daily(data),range=el('daily-range').value;
    const rows=range==='auto'?ResearchMetrics.recordedRange(all,['count']):all.slice(-Number(range)),today=new Date().toISOString().slice(0,10);
    const averageAvailable=rows.some(r=>r.day!==today&&r.average!==null);
    el('daily-average').disabled=!averageAvailable;
    el('daily-average-note').textContent=averageAvailable?'':'Ab sieben vollständig erfassten Tagen verfügbar.';
    table(el('daily-data'),['Tag (UTC)','Seitenaufrufe','7-Tage-Mittel'],rows.map(r=>[r.day,r.count??'Nicht erfasst',r.day===today||r.average===null?'–':r.average.toLocaleString('de-DE',{maximumFractionDigits:1})]));
    const measured=rows.filter(r=>r.count!==null);
    el('daily-baseline').hidden=measured.length>1;
    if(measured.length<2){el('daily-chart').hidden=true;el('daily-baseline').textContent=measured.length?`Erster erfasster Tag: ${measured[0].count} Seitenaufrufe am ${measured[0].day}. Der Tagesverlauf entsteht mit weiteren erfassten Tagen.`:'Noch keine Tageswerte erfasst.';return;}
    el('daily-chart').hidden=!window.Chart;if(!window.Chart)return;
    const datasets=[{label:'Seitenaufrufe',data:rows.map(r=>r.count),backgroundColor:rows.map(r=>r.day===today?'#a5bce9':'#3869cf'),borderRadius:4,maxBarThickness:30}];
    if(averageAvailable&&el('daily-average').checked)datasets.push({type:'line',label:'7-Tage-Mittel',data:rows.map(r=>r.day===today?null:r.average),borderColor:'#167d76',backgroundColor:'#167d76',pointRadius:0,borderWidth:2,spanGaps:false});
    dailyChart=new Chart(el('daily-canvas'),{type:'bar',data:{labels:rows.map(r=>new Date(r.day+'T00:00:00Z').toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',timeZone:'UTC'})+(r.day===today?' · heute':'')),datasets},options:chartOptions()});
  }
  function historyChart(container,labels,datasets,description){
    container.append(node('p',description));
    const first=labels.findIndex((_,i)=>datasets.some(d=>d.data[i]!==null));
    if(first<0){const note=node('p','Noch keine vergleichbaren Messstände verfügbar.');note.className='note';container.append(note);return;}
    if(labels.filter((_,i)=>datasets.some(d=>d.data[i]!==null)).length===1){
      const note=node('p',`${datasets.some(d=>d.label==='Nettoänderung')?'Ein Vergleichswert erfasst':'Ausgangsstand gespeichert'}: ${datasets.filter(d=>d.data[first]!==null).map(d=>`${d.label}: ${d.data[first]}`).join(' · ')}. Der Verlauf entsteht mit weiteren Messungen.`);note.className='history-baseline';container.append(note);return;
    }
    if(!window.Chart)return;
    labels=labels.slice(first);datasets=datasets.map(d=>({...d,data:d.data.slice(first)}));
    labels=labels.map(value=>new Date(value+(value.length===7?'-01':'')+'T00:00:00Z').toLocaleDateString('de-DE',{...(value.length===7?{}:{day:'2-digit'}),month:'short',year:'numeric',timeZone:'UTC'}));
    const wrap=node('div'),canvas=node('canvas');wrap.className='chart-container';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',description+' Werte in der folgenden Tabelle.');wrap.append(canvas);container.append(wrap);
    researchCharts.push(new Chart(canvas,{type:'line',data:{labels,datasets:datasets.map(d=>({...d,backgroundColor:d.borderColor,pointRadius:3,stepped:true,spanGaps:false}))},options:chartOptions()}));
  }

  function showHelp(code){
    const help={
      STORAGE_NOT_WRITABLE:['PHP kann den Statistikordner nicht beschreiben.',['data_dir in analytics-config.php prüfen.','Für den Unterordner analytics-private: protected_storage aktivieren und dessen .htaccess mit hochladen.','Ordner und vorhandene CSV-/Sperrdateien müssen für den PHP-Benutzer beschreibbar sein.']],
      STORAGE_PUBLIC:['Der öffentliche Speicherordner ist nicht ausreichend geschützt.',['Den vorgesehenen Ordner analytics-private und seine unveränderte .htaccess verwenden.','protected_storage aktivieren; Apache muss die Zugriffssperre auswerten.','Direkter Aufruf von analytics-private/analytics.csv muss HTTP 403 liefern.']],
      CSV_INVALID:['Die Statistikdatei ist beschädigt. Sie wird nicht überschrieben.',['analytics.csv sichern.','Datei prüfen oder eine intakte Sicherung wiederherstellen.']],
      CSV_BUSY:['Ein anderer Prozess schreibt gerade Statistikdaten.',['Kurz warten und anschließend die Ansicht aktualisieren.','Bei wiederholtem Auftreten PHP-Protokoll und parallele Abrufe prüfen.']]
    };
    const entry=help[code];el('storage-help').hidden=!entry;if(!entry)return;
    el('storage-help-text').textContent=entry[0];el('storage-help-steps').replaceChildren(...entry[1].map(text=>node('li',text)));
  }
  function renderCitations() {
    const pub=el('publication-filter').value;
    const container=el('citations-content');for(const canvas of container.querySelectorAll('canvas')){const chart=window.Chart?.getChart(canvas);chart?.destroy();researchCharts=researchCharts.filter(c=>c!==chart);}container.replaceChildren();
    const row=external(pub,'citations');metadata(container,row);
    if(!row?.payload){const empty=node('p','Noch keine Daten erfasst. Über „Datenquellen“ OpenAlex für diese Publikation aktualisieren.');empty.className='empty';container.append(empty);return;}
    const p=row.payload;
    const title=node('h3',`${p.count} Zitationen laut OpenAlex`);container.append(title,link('Quelle in OpenAlex',p.url));
    const history=ResearchMetrics.citationMonths(data.snapshots,pub,ResearchMetrics.months(new Date(),24));
    historyChart(container,history.map(r=>r.month),[{label:'Zitationen gesamt',data:history.map(r=>r.count),borderColor:'#8060b0'}],'Zitationsstand · letzte 24 Monate');
    historyChart(container,history.map(r=>r.month),[{label:'Nettoänderung',data:history.map(r=>r.delta),borderColor:'#167d76'}],'Änderung gegenüber dem Vormonatsstand');
    const chart=node('div');chart.className='table-wrap';container.append(node('h3','Entwicklung je Monat'),chart);
    table(chart,['Monat (UTC)','Letzter erfasster Stand','Zitationen gesamt','Nettoänderung zum Vormonatsstand'],history.filter(h=>h.count!==null).map(h=>[h.month,h.day,h.count,signed(h.delta)]));
    container.append(node('p','Die erste Messung ist der Ausgangsstand. „Neue Zitationen“ sind hier Änderungen der Datenbankzählung; Nachindexierung und Korrekturen können spätere Änderungen verursachen.'));
    const details=node('details'),summary=node('summary',`Wer zitiert diese Arbeit? ${p.citing.length} von ${p.listedTotal} erfassten Arbeiten`);details.append(summary);
    const list=node('div');list.className='table-wrap';details.append(list);container.append(details);
    table(list,['Titel','Jahr','DOI'],p.citing.map(w=>[link(w.title,w.url),w.year,w.doi?link(w.doi.replace(/^https?:\/\/doi.org\//,''),w.doi):'Keine DOI hinterlegt']), 'In dieser Quelle wurden keine zitierenden Arbeiten gefunden.');
    if(p.partial)details.append(node('p','Liste unvollständig: maximal 1.000 Arbeiten pro Abruf. Die Gesamtzahl stammt separat von OpenAlex.'));
  }
  function applyMode(mode) {
    const aggregate = mode !== 'detailed';
    el('daily-panel').hidden=!aggregate;document.querySelector('.admin-nav a[href="#daily-panel"]').hidden=!aggregate;
    for (const id of ['interest','reading','visitors','error-tracking']) el(id).hidden = aggregate;
    for (const id of ['interest','reading','visitors']) document.querySelector(`.admin-nav a[href="#${id}"]`).hidden = aggregate;
    for (const id of ['average','actions']) el(id).closest('.metric').hidden = aggregate;
    el('count-label').textContent = aggregate ? 'Seitenaufrufe' : 'Besuche · 30 Tage';
    el('count').closest('.metric').querySelector('.metric-caption').textContent=aggregate?'Letzte 30 Kalendertage · UTC':'Letzte 30 Tage · nach Einwilligung';
    el('mode-badge').textContent=aggregate?'Aufrufzählung ohne Besucherkennungen':'Detailstatistik mit Einwilligung';
    el('mode-note').textContent = aggregate ? 'Serverseitige Aufrufzählung ohne gespeicherte IP-Adressen, Browserdaten oder Besucherkennungen. Gezählt werden Seitenabrufe, einschließlich möglicher Bots und wiederholter Abrufe. Keine Messung einzelner Besuche, Klicks oder Lesetiefe. Zitationen und Zenodo-Daten bleiben unabhängig davon verfügbar.' : 'Besuchsdaten stammen ausschließlich aus zugestimmten Erfassungen. Ein Besuch ist ein Seitenaufruf, keine eindeutige Person. Klicks zeigen Interesse; BibTeX-Aktionen belegen keine wissenschaftliche Zitation.';
  }
  function render() {
    researchCharts.forEach(c=>c.destroy());researchCharts=[];
    const aggregate = data.mode === 'aggregate';
    applyMode(data.mode);
    el('count').textContent=data.totals.visits;el('average').textContent=duration(data.totals.average);
    el('actions').textContent=data.engagement.reduce((n,r)=>n+Number(r.clicks),0);
    const citations=ResearchMetrics.sourceCoverage(data,'citations'),zenodoCoverage=ResearchMetrics.sourceCoverage(data,'zenodo');
    const available=citations.rows,zenodo=zenodoCoverage.rows;
    el('citation-total').textContent=available.length?`${available.reduce((n,r)=>n+Number(r.payload.count),0)}${citations.missing?' (teilweise)':''}`:'–';
    for(const [id,key]of [['zenodo-downloads','downloads'],['zenodo-views','views']])el(id).textContent=zenodo.length?`${zenodo.reduce((n,r)=>n+Number(r.payload[key]),0)}${zenodoCoverage.missing?' (teilweise)':''}`:'–';
    coverageCaption('citation-coverage',citations,'Publikationen');
    for(const id of ['zenodo-downloads-coverage','zenodo-views-coverage'])coverageCaption(id,zenodoCoverage,'Datensätze');
    el('count-coverage').textContent=`Erfassung ab ${new Date(data.trackingStarted*1000).toLocaleDateString('de-DE',{timeZone:'UTC'})}${aggregate?' · UTC · Heute unvollständig':' · Nur Besuche mit Einwilligung'}`;
    el('zenodo-downloads-note').textContent=zenodo.length?'Kumuliert · verlinkte Versionen':'Noch keine Daten erfasst';
    el('status').textContent=`Aktualisiert · Besuchsdetails: ${data.retentionDays} Tage · ${data.fullIp?'Vollständige':'Gekürzte'} IP-Adressen · Monatsaggregate: 24 Monate`;
    if (aggregate) el('status').textContent = 'Aktualisiert · Reine Aufrufzählung · Tageszahlen: 30 Kalendertage · Monatszahlen: 24 Monate';
    const rows=ResearchMetrics.monthly(data);const current=rows.at(-2),previous=rows.at(-3);
    const started=new Date(data.trackingStarted*1000).toISOString().slice(0,10);
    el('coverage').textContent=`Erfassung ab ${started} (UTC). ${previous.month}: ${ResearchMetrics.monthCoverage(data.trackingStarted,previous.month)}. ${current.month}: ${ResearchMetrics.monthCoverage(data.trackingStarted,current.month)}. Der laufende Monat ist im Diagramm heller markiert.`;
    table(el('comparison-table'),['Kennzahl',`${previous.month} · abgeschlossen`,`${current.month} · abgeschlossen`,'Differenz'],[
      [aggregate?'Seitenaufrufe':'Besuche',previous.visits??'Nicht erfasst',current.visits??'Nicht erfasst',previous.visits===null||current.visits===null?'Nicht verfügbar':signed(current.visits-previous.visits)],
      ...(!aggregate ? [['Publikationsaktionen',previous.clicks??'Nicht erfasst',current.clicks??'Nicht erfasst',previous.clicks===null||current.clicks===null?'Nicht verfügbar':signed(current.clicks-previous.clicks)]] : []),
      ['Zitations-Nettoänderung',signed(previous.citations),signed(current.citations),current.citations===null||previous.citations===null?'Nicht verfügbar':signed(current.citations-previous.citations)]
    ]);
    if(!['visits','clicks','citations'].some(key=>previous[key]!==null&&current[key]!==null))table(el('comparison-table'),[],[],'Ein Monatsvergleich ist verf\u00fcgbar, sobald vergleichbare Werte f\u00fcr zwei abgeschlossene Monate vorliegen.');
    el('comparison').querySelector('h3').textContent = aggregate ? 'Seitenaufrufe nach Monat' : 'Besuche und Publikationsaktionen nach Monat';
    renderMonthlyChart();renderDaily();renderSources();
    const targets=['doi','fulltext','data','bibtex-copy','bibtex-download','other'];
    const grouped=data.publications.map(p=>{const counts=Object.fromEntries(targets.map(t=>[t,0]));for(const r of data.engagement.filter(r=>r.publication===p.citationKey)){const t=r.target;const group=t==='doi'?t:['publisher','igi','acm','ssrn','pdf','fulltext'].includes(t)?'fulltext':['zenodo','data','dataset'].includes(t)?'data':targets.includes(t)?t:'other';counts[group]+=Number(r.clicks);}return[p.title,...targets.map(t=>counts[t])];});
    table(el('interest-table'),['Publikation','DOI','Volltext / Verlag / Preprint','Datenpaket','BibTeX kopieren','BibTeX Download','Weitere Links'],grouped);
    table(el('conversion-table'),['Herkunft','Besuche','Mit Publikationsaktion','Aktionen','Quote'],data.conversion.map(r=>[source(r.source),r.visits,r.engaged,r.clicks,`${(100*r.engaged/Math.max(1,r.visits)).toFixed(1)} %`]));
    const select=el('publication-filter'),selected=select.value;select.replaceChildren();
    for(const p of data.publications){const option=node('option',p.title);option.value=p.citationKey;select.append(option);}if(data.publications.some(p=>p.citationKey===selected))select.value=selected;renderCitations();
    const datasets=el('zenodo-content');datasets.replaceChildren();
    for(const p of data.publications.filter(p=>p.links?.zenodo)){const row=external(p.citationKey,'zenodo'),card=node('article');card.className='dataset-item';card.append(node('h3',p.title));metadata(card,row);if(row?.payload){const v=row.payload;card.append(node('p',`${v.views} Aufrufe · ${v.downloads} Downloads`),link('Datensatz bei Zenodo',v.url));}else{const empty=node('p','Noch keine Daten erfasst. Zenodo unter „Datenquellen“ aktualisieren.');empty.className='empty';card.append(empty);}const history=(data.zenodoSnapshots||[]).filter(r=>r.publication===p.citationKey).sort((a,b)=>a.day.localeCompare(b.day));
      const measured=new Map(history.map(r=>[r.day,r]));const days=[];if(history.length){for(let day=new Date(history[0].day+'T00:00:00Z');day<=new Date(history.at(-1).day+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+1))days.push(day.toISOString().slice(0,10));}
      historyChart(card,days,[{label:'Aufrufe',data:days.map(d=>measured.has(d)?Number(measured.get(d).payload.views):null),borderColor:'#3869cf'},{label:'Downloads',data:days.map(d=>measured.has(d)?Number(measured.get(d).payload.downloads):null),borderColor:'#167d76'}],'Gespeicherte Zenodo-Messstände · keine Rekonstruktion fehlender Tage');
      const historyDetails=node('details');historyDetails.className='data-details';historyDetails.append(node('summary','Zenodo-Messstände als Tabelle anzeigen'));const historyTable=node('div');historyTable.className='table-wrap';historyDetails.append(historyTable);card.append(historyDetails);table(historyTable,['Tag (UTC)','Aufrufe gesamt','Downloads gesamt'],history.map(r=>[r.day,r.payload.views,r.payload.downloads]),'Der Verlauf beginnt mit dem nächsten erfolgreichen Zenodo-Abruf.');datasets.append(card);}
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
    if(!data.visits.length){const row=node('tr'),cell=node('td','Noch keine Daten erfasst. Besuche erscheinen erst nach Einwilligung.');cell.colSpan=6;row.append(cell);el('visits').append(row);}
  }
  async function load(){
    let r;
    try { r=await fetch(apiUrl('stats'),{cache:'no-store',credentials:'same-origin'}); }
    catch (_) { throw Error('Die Statistik-API ist nicht erreichbar. Verbindung und Server prüfen.'); }
    let payload;
    try { payload=await r.json(); }
    catch (_) { throw Error(`Die Statistik-API liefert kein gültiges JSON (HTTP ${r.status}). API-Datei und PHP-Fehlerprotokoll prüfen.`); }
    if(!r.ok){
      if(r.status===401)throw Error('Die API-Anmeldung fehlt oder ist abgelaufen. Adminseite neu öffnen und erneut anmelden.');
      if(r.status===404)throw Error('Die Statistik-API wurde nicht gefunden. analytics-api.php zusammen mit admin.php in denselben Website-Ordner hochladen.');
      const detail=typeof payload.error==='string'?payload.error:'PHP-Konfiguration und Datenbank prüfen.';
      const code=typeof payload.code==='string'?` [${payload.code}]`:'';
      const error=Error(`Statistik nicht verfügbar (HTTP ${r.status})${code}: ${detail}`);error.code=payload.code;throw error;
    }
    const incomplete='Die Statistik-Antwort ist unvollständig. Alle Admin- und API-Dateien in derselben Version hochladen.';
    if(!payload?.totals||!Number.isFinite(payload.totals.visits)||payload.totals.visits<0
      ||!['aggregate','detailed'].includes(payload.mode)||!Number.isFinite(payload.trackingStarted)
      ||!Number.isFinite(new Date(payload.trackingStarted*1000).getTime())
      ||!['publications','visits','external','monthly','snapshots','engagement','conversion','reading','daily'].every(key=>Array.isArray(payload[key])))throw Error(incomplete);
    const previous=data;
    try{data=payload;render();}catch(_){data=previous;if(data)render();throw Error(incomplete);}
    apiAvailable=true;el('status').closest('.status-line').classList.remove('has-error');showHelp();
  }
  function controls(disabled){el('refresh').disabled=disabled;el('refresh-dashboard').disabled=disabled;el('chart-range').disabled=!data;el('daily-range').disabled=!data;el('daily-average').disabled=!data||!!el('daily-average-note').textContent;for(const id of['sync-research','check-links'])el(id).disabled=disabled||!apiAvailable;for(const button of document.querySelectorAll('[data-source-kind]'))button.disabled=disabled||!apiAvailable;}
  function loadError(error){
    apiAvailable=false;
    for(const id of ['count-coverage','citation-coverage','zenodo-downloads-coverage','zenodo-views-coverage']){
      const target=el(id);target.querySelector('.coverage-load-warning')?.remove();
      if(!data)target.textContent='Datenabdeckung nicht verfügbar.';
      else {const note=node('span','Ansicht konnte nicht aktualisiert werden.');note.className='coverage-load-warning';target.prepend(note);}
    }
    el('status').textContent=`${error.message}${data?' · Die angezeigten Werte stammen aus der letzten erfolgreichen Ansicht.':''}`;
    el('status').closest('.status-line').classList.add('has-error');showHelp(error.code);
    if(!data){
      applyMode(document.documentElement.dataset.analyticsMode||'aggregate');el('daily-panel').hidden=true;
      for(const id of['count','citation-total','zenodo-downloads','zenodo-views','average','actions'])el(id).textContent='–';
      monthlyChart?.destroy();monthlyChart=undefined;el('monthly-chart').hidden=true;
      el('chart-message').textContent='Der Monatsverlauf ist verfügbar, sobald die Statistik wieder geladen werden kann.';
      for(const id of['sources-content','citations-content','zenodo-content']){const p=node('p','Daten konnten nicht geladen werden. Bitte den Hinweis oben beachten.');p.className='empty';el(id).replaceChildren(p);}
    }
  }
  async function refresh(){if(busy)return;busy=true;controls(true);try{await load();}catch(e){loadError(e);}finally{busy=false;controls(false);}}
  async function refreshDashboard(manual=true){
    if(busy)return;busy=true;controls(true);const status=el('dashboard-refresh-status');
    status.textContent=manual?'Dashboard wird aktualisiert …':'Erster Dashboard-Aufruf des UTC-Tages wird geprüft …';
    async function request(body){
      const response=await fetch(apiUrl('dashboard-refresh'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok){const error=Error(result.error||`Aktualisierung fehlgeschlagen (HTTP ${response.status}).`);error.code=result.code;throw error;}
      if(!['running','complete','current','busy'].includes(result.state))throw Error('Ungültige Antwort auf die Dashboard-Aktualisierung. API- und Admin-Dateien gemeinsam aktualisieren.');
      return result;
    }
    try{
      let result=await request({operation:'start',manual});
      while(result.state==='running'){
        status.textContent=`${manual?'Dashboard':'Tägliche Aktualisierung'}: ${result.done}/${result.total} Quellen geprüft …`;
        result=await request({operation:'step',token:result.token});
      }
      await load();
      status.textContent=result.state==='current'?`Heute (${result.day}, Europe/Berlin) bereits aktualisiert. Für einen weiteren Abruf „Dashboard aktualisieren“ wählen.`:result.state==='busy'?'Eine Aktualisierung läuft bereits. Nach Abschluss die Ansicht neu laden.':`Dashboard aktualisiert: ${result.total} Quellen geprüft · ${result.errors} Fehler · ${result.cached} aus dem Stunden-Cache. Letzte erfolgreiche Daten bleiben bei Quellenfehlern erhalten.`;
    }catch(e){status.textContent=`Aktualisierung unterbrochen: ${e.message}`;loadError(e);}finally{busy=false;controls(false);}
  }
  async function syncSource(publication,kind){
    if(busy||!data)return;busy=true;controls(true);el('source-status').textContent=`${kinds[kind]} wird aktualisiert …`;
    try{
      const response=await fetch(apiUrl('refresh'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({publication,kind})});
      const result=await response.json();if(!response.ok){const error=Error(result.error||`Abruf fehlgeschlagen (HTTP ${response.status}).`);error.code=result.code;throw error;}
      await load();el('source-status').textContent=result.busy?'Diese Quelle wird bereits abgerufen. Ansicht später aktualisieren.':result.cached?'Gespeicherter Stand verwendet: Diese Quelle wurde innerhalb der letzten Stunde geprüft.':result.ok?'Quelle erfolgreich aktualisiert.':`Abruf fehlgeschlagen: ${result.error||'Quelle nicht erreichbar'}. Der letzte erfolgreiche Stand bleibt erhalten.`;
    }catch(e){el('source-status').textContent=e.message;loadError(e);}finally{busy=false;controls(false);}
  }
  async function sync(links=false){
    if(busy||!data)return;busy=true;controls(true);const status=el(links?'link-status':'sync-status');let errors=0,cached=0,running=0;
    const jobs=data.publications.flatMap(p=>links?[[p,'links']]:[[p,'citations'],...(p.links?.zenodo?[[p,'zenodo']]:[])]);
    try{for(const [i,[p,kind]]of jobs.entries()){
      status.textContent=`${i+1}/${jobs.length}: ${p.title} · ${kind} …`;
      try{const r=await fetch(apiUrl('refresh'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({publication:p.citationKey,kind})});if(!r.ok)throw Error();const result=await r.json();if(result.busy)running++;else if(result.cached)cached++;else if(!result.ok)errors++;}catch(_){errors++;}
    }await load();status.textContent=`Abruf abgeschlossen: ${errors} Fehler · ${cached} bereits innerhalb der letzten Stunde geprüft${running?` · ${running} Abrufe laufen bereits; Ansicht später aktualisieren`:''}. Details und letzte erfolgreiche Stände stehen bei den Quellen.`;
    }catch(e){status.textContent=e.message;loadError(e);}finally{busy=false;controls(false);}
  }
  el('refresh').onclick=refresh;el('sync-research').onclick=()=>sync();el('check-links').onclick=()=>sync(true);el('publication-filter').onchange=renderCitations;
  el('refresh-dashboard').onclick=()=>refreshDashboard(true);
  el('daily-range').onchange=()=>{if(data)renderDaily();};
  el('daily-average').onchange=()=>{if(data)renderDaily();};
  el('chart-range').onchange=()=>{if(data)renderMonthlyChart();};
  el('sources-content').onclick=event=>{const button=event.target.closest('[data-source-kind]');if(button)syncSource(button.dataset.sourcePublication,button.dataset.sourceKind);};
  const sidebar=document.querySelector('.admin-sidebar'),menu=el('menu-toggle');
  function closeMenu(){sidebar.classList.remove('menu-open');menu.setAttribute('aria-expanded','false');menu.textContent='Menü öffnen';}
  menu.onclick=()=>{const open=sidebar.classList.toggle('menu-open');menu.setAttribute('aria-expanded',String(open));menu.textContent=open?'Menü schließen':'Menü öffnen';};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sidebar.classList.contains('menu-open')){closeMenu();menu.focus();}});
  for(const anchor of document.querySelectorAll('.admin-nav a'))anchor.addEventListener('click',()=>{for(const other of document.querySelectorAll('.admin-nav a'))other.removeAttribute('aria-current');anchor.setAttribute('aria-current','location');closeMenu();const target=document.querySelector(anchor.getAttribute('href'));if(target){target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}});
  applyMode(document.documentElement.dataset.analyticsMode || 'aggregate');
  (async()=>{await refresh();if(apiAvailable)await refreshDashboard(false);})();
})();
