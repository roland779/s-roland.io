const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const php=process.env.PHP_BIN||'php';
const browser=process.env.BROWSER_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=path.resolve(__dirname,'../..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'research-browser-'));
const publicDir=path.join(temp,'public');fs.mkdirSync(publicDir);
for(const f of ['admin.php','analytics-api.php','analytics-lib.php','analytics-csv.php','index.html','index.php'])fs.copyFileSync(path.join(root,f),path.join(publicDir,f));
fs.cpSync(path.join(root,'academic_website'),path.join(publicDir,'academic_website'),{recursive:true});
const password='browser-test-only-password';
const config=spawnSync(php,[],{input:`<?php echo "<?php return ['password_hash'=>" . var_export(password_hash('${password}', PASSWORD_DEFAULT),true) . ", 'data_dir'=>__DIR__.'/../data', 'analytics_mode'=>'detailed', 'full_ip'=>false];";`,encoding:'utf8'});
assert.equal(config.status,0,config.stderr);fs.writeFileSync(path.join(publicDir,'analytics-config.php'),config.stdout);
const port=22000+Math.floor(Math.random()*4000),debugPort=port+5000,base=`http://127.0.0.1:${port}`;
const router=path.join(temp,'router.php');
fs.writeFileSync(router,`<?php $path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);if(preg_match('~^(/nested)?/admin/?$~',$path,$m)){$_SERVER['SCRIPT_NAME']=($m[1]??'').'/admin.php';require __DIR__.'/public'.($m[1]??'').'/admin.php';return true;}return false;`);
const server=spawn(php,['-S',`127.0.0.1:${port}`,'-t',publicDir,router],{stdio:'ignore'});
let chrome,ws,next=1;const callbacks=new Map(),errors=[],requests=[];
async function retry(fn){for(let i=0;i<80;i++){try{const r=await fn();if(r)return r;}catch(_){}await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for browser/server');}
function command(method,params={}){return new Promise((resolve,reject)=>{const id=next++;const timer=setTimeout(()=>{callbacks.delete(id);reject(Error('CDP timeout '+method));},15000);callbacks.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+JSON.stringify(r.exceptionDetails.exception));return r.result?.value;}
async function waitFor(expression){return retry(async()=>await evaluate(expression));}
async function screenshot(name){if(!process.env.QA_DIR)return;await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');fs.mkdirSync(process.env.QA_DIR,{recursive:true});const r=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(process.env.QA_DIR,name+'.png'),Buffer.from(r.data,'base64'));}
async function accessibility(){if(!process.env.AXE_PATH)return;await evaluate(fs.readFileSync(process.env.AXE_PATH,'utf8'));const violations=await evaluate(`(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));})()`);assert.deepEqual(violations,[],'Dashboard accessibility');}
(async()=>{try{
 await retry(async()=>(await fetch(base+'/analytics-api.php?action=config')).ok);
 // Seed public research metadata only, using an isolated private database.
 const seed=spawnSync(php,[],{encoding:'utf8',env:{...process.env,ANALYTICS_TEST_ROOT:publicDir},input:`<?php
 require getenv('ANALYTICS_TEST_ROOT').'/analytics-lib.php';$config=require getenv('ANALYTICS_TEST_ROOT').'/analytics-config.php';$db=analyticsStorage($config);
 $db->update(static function(array &$t): void {
 // Retained monthly pageviews older than the daily window, for the aggregate chart.
 $start=(new DateTimeImmutable('first day of this month',new DateTimeZone('UTC')))->modify('-5 months');
 AnalyticsCsvStore::put($t,'meta',['key'=>'aggregate_start','value'=>(string)$start->getTimestamp()]);
 foreach([8,14,11,20,27] as $i=>$count)for($j=0;$j<$count;$j++)incrementMonth($t,'pageview','','','',$start->modify('+'.$i.' months')->getTimestamp());
 foreach(publications() as $id=>$pub){
  $payload=['source'=>'OpenAlex','url'=>'https://openalex.org/W123','count'=>3,'listedTotal'=>1,'partial'=>false,'citing'=>[['title'=>'Citing <script>window.bad=true</script> work','year'=>2026,'doi'=>'https://doi.org/10.example/test','url'=>'https://openalex.org/W999']]];
  AnalyticsCsvStore::put($t,'external',['publication'=>$id,'kind'=>'citations','payload'=>$payload,'checked'=>time(),'success'=>time(),'error'=>null]);
  $payload=['source'=>'HTTP-Linkprüfung','links'=>[['name'=>'doi','url'=>$pub['links']['doi'],'status'=>200,'state'=>'erreichbar']]];
  AnalyticsCsvStore::put($t,'external',['publication'=>$id,'kind'=>'links','payload'=>$payload,'checked'=>time(),'success'=>time(),'error'=>null]);
  if(isset($pub['links']['zenodo'])){AnalyticsCsvStore::put($t,'external',['publication'=>$id,'kind'=>'zenodo','payload'=>['source'=>'Zenodo','url'=>'https://zenodo.org/records/18086905','views'=>61,'downloads'=>5],'checked'=>time(),'success'=>time(),'error'=>null]);}
  AnalyticsCsvStore::put($t,'citation_snapshots',['publication'=>$id,'day'=>gmdate('Y-m-d'),'count'=>3]);
 }
 });
 `});assert.equal(seed.status,0,seed.stderr||seed.stdout);
 chrome=spawn(browser,['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${path.join(temp,'chrome')}`,'about:blank'],{stdio:'ignore'});
 const pages=await retry(async()=>{const r=await fetch(`http://127.0.0.1:${debugPort}/json/list`);const list=await r.json();return list.find(p=>p.type==='page');});
 ws=new WebSocket(pages.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const c=callbacks.get(m.id);if(c){callbacks.delete(m.id);m.error?c.reject(Error(m.error.message)):c.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));else if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);};
 await command('Page.enable');await command('Runtime.enable');await command('Network.enable');await command('Network.setBlockedURLs',{urls:['https://*']});
 await command('Network.setExtraHTTPHeaders',{headers:{Authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}});
 await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await command('Page.navigate',{url:base+'/admin.php'});await waitFor(`document.querySelector('#citation-total')?.textContent==='12'`);
 await waitFor(`document.querySelector('#dashboard-refresh-status').textContent.includes('Dashboard aktualisiert')&&!document.querySelector('#refresh-dashboard').disabled`);
 const dailyRequests=requests.filter(url=>url.includes('action=dashboard-refresh')).length;
 assert.equal(dailyRequests,10,'First daily dashboard open starts a batch and processes nine source steps');
 await evaluate(`document.querySelector('#refresh-dashboard').click()`);
 await waitFor(`document.querySelector('#dashboard-refresh-status').textContent.includes('Dashboard aktualisiert')&&!document.querySelector('#refresh-dashboard').disabled`);
 assert.equal(requests.filter(url=>url.includes('action=dashboard-refresh')).length,dailyRequests+10,'Dashboard button updates all sources again');
 await evaluate(`document.documentElement.style.scrollBehavior='auto'`);
 assert.equal(await evaluate(`document.querySelector('#count').textContent`),'0');
 assert.equal(await evaluate(`document.querySelector('#zenodo-downloads').textContent`),'5');
 assert.equal(await evaluate(`document.querySelector('#zenodo-views').textContent`),'61');
 assert.equal(await evaluate(`document.querySelectorAll('.source-card').length`),9,'One status card per publication/source');
 assert.ok(await evaluate(`document.querySelector('#chart-message').textContent.includes('Noch keine Daten erfasst')`),'No fabricated monthly history on first snapshot');
 await evaluate(`document.querySelector('[data-source-kind="citations"]').click()`);
 await waitFor(`document.querySelector('#source-status').textContent.includes('Gespeicherter Stand verwendet')`);
 assert.ok(requests.some(url=>url.includes('action=maintenance')),'Admin page triggers automatic maintenance');
 assert.equal(await evaluate(`window.bad===true`),false,'External titles must render as text');
 assert.ok(await evaluate(`document.querySelector('#citations-content').textContent.includes('<script>window.bad=true</script>')`));
 assert.ok(await evaluate(`document.querySelector('#zenodo-content').textContent.includes('61 Aufrufe')`));
 assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`),true,'Desktop must fit viewport');await screenshot('admin-desktop');
 await evaluate(`document.querySelector('#impact').scrollIntoView();document.querySelector('#publication-filter').value='SchreiberZylka2020';document.querySelector('#publication-filter').dispatchEvent(new Event('change'));document.querySelector('#citations-content details').open=true;`);await screenshot('admin-citations');
 await evaluate(`document.querySelector('#sync-research').click()`);await waitFor(`document.querySelector('#sync-status').textContent.includes('Abruf abgeschlossen')`);
 assert.ok(await evaluate(`document.querySelector('#sync-status').textContent.includes('0 Fehler')`));
 await evaluate(`document.querySelector('#check-links').click()`);await waitFor(`document.querySelector('#link-status').textContent.includes('Abruf abgeschlossen')`);
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await evaluate('window.scrollTo(0,0)');await screenshot('admin-mobile');
 await evaluate(`document.querySelector('#menu-toggle').click()`);
 assert.equal(await evaluate(`document.querySelector('#menu-toggle').getAttribute('aria-expanded')`),'true');
 await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
 assert.equal(await evaluate(`document.querySelector('#menu-toggle').getAttribute('aria-expanded')`),'false');
 assert.equal(await evaluate(`document.activeElement.id`),'menu-toggle');
 await evaluate(`document.querySelector('#menu-toggle').click();document.querySelector('.admin-nav a[href="#sources"]').click()`);
 assert.equal(await evaluate(`document.querySelector('#menu-toggle').getAttribute('aria-expanded')`),'false');
 assert.equal(await evaluate(`document.activeElement.id`),'sources');
 for(const width of[320,375,768,1024]){await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<800});assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'Dashboard fits width '+width);}
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 for(const section of ['comparison','interest','impact','datasets','reading','health','visitors']){
  await evaluate(`document.querySelector('#${section}').scrollIntoView()`);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`),true,'Mobile section must fit viewport: '+section);
 }
 assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`),true,'Mobile must fit viewport');
 await evaluate(`document.querySelector('#impact').scrollIntoView()`);await screenshot('admin-mobile-citations');
 await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const maintenanceBefore=requests.filter(url=>url.includes('action=maintenance')).length;
 await command('Page.navigate',{url:base+'/'});await waitFor(`document.querySelector('.analytics-consent button')&&document.querySelector('[data-publication]')`);
 assert.ok(requests.filter(url=>url.includes('action=maintenance')).length>maintenanceBefore,'Public page triggers maintenance independently of consent');
 let stats=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}})).json();assert.equal(stats.totals.visits,0,'Do not record before consent');
 await evaluate(`document.querySelector('.analytics-consent button').click()`);
 await retry(async()=>{stats=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}})).json();return stats.totals.visits===1;});
 await evaluate(`document.querySelector('[data-stat-target="doi"]').addEventListener('click',e=>e.preventDefault());document.querySelector('[data-stat-target="doi"]').click();window.scrollTo(0,document.documentElement.scrollHeight);`);
 await retry(async()=>{stats=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}})).json();return stats.engagement.length&&stats.reading.some(r=>r.kind==='depth'&&r.target==='100');});
 assert.equal(stats.conversion[0].engaged,1);assert.ok(stats.reading.some(r=>r.kind==='section'));
 const clicks=stats.engagement.reduce((n,r)=>n+r.clicks,0);
 await evaluate(`document.querySelector('.analytics-settings').click();document.querySelector('.analytics-consent button:last-child').click();document.querySelector('[data-stat-target="doi"]').click();`);
 await new Promise(r=>setTimeout(r,250));
 stats=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}})).json();assert.equal(stats.engagement.reduce((n,r)=>n+r.clicks,0),clicks,'Withdrawal stops events');
 await command('Network.setBlockedURLs',{urls:['https://*','*academic_website/data/*']});
 await command('Page.navigate',{url:base+'/'});await waitFor(`window.__analyticsLoadFailures?.length===2&&document.querySelector('.analytics-settings')`);
 await evaluate(`document.querySelector('.analytics-settings').click();document.querySelector('.analytics-consent button').click();`);
 await retry(async()=>{stats=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}})).json();return stats.reading.filter(r=>r.kind==='error').length===2;});
 assert.equal(stats.totals.visits,2,'Data failures are attached to a separately consented visit');
 fs.renameSync(path.join(publicDir,'analytics-config.php'),path.join(temp,'disabled-config.php'));
 await command('Network.setBlockedURLs',{urls:['https://*']});await command('Page.navigate',{url:base+'/'});await waitFor(`document.querySelectorAll('[data-publication]').length===4`);
 assert.equal(await evaluate(`document.querySelector('.analytics-consent')===null`),true,'Missing analytics configuration must not prevent the public profile from loading');
 assert.ok(await evaluate(`document.querySelector('#pubMeta').textContent.length>0`));
 const aggregateConfig=fs.readFileSync(path.join(temp,'disabled-config.php'),'utf8').replace("'analytics_mode'=>'detailed'","'analytics_mode'=>'aggregate'");
 fs.writeFileSync(path.join(publicDir,'analytics-config.php'),aggregateConfig);
 const requestStart=requests.length;
 await command('Page.navigate',{url:base+'/index.php'});await waitFor(`document.querySelectorAll('[data-publication]').length===4`);
 assert.equal(await evaluate(`document.querySelector('.analytics-consent')===null&&document.querySelector('.analytics-settings')===null`),true,'Aggregate mode has no consent UI');
 assert.equal(await evaluate(`!!document.querySelector('script[src$="/analytics.js"]')`),false,'Aggregate pages must not load the individual tracker');
 assert.equal(requests.slice(requestStart).some(u=>u.includes('action=visit')||u.includes('action=event')||u.includes('fonts.googleapis.com')||u.includes('fonts.gstatic.com')),false,'No individual tracking or Google font requests');
 stats=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}})).json();assert.equal(stats.mode,'aggregate');assert.equal(stats.totals.visits,1);assert.equal(stats.visits.length,0);assert.equal(stats.engagement.length,0);assert.equal(stats.daily.length,1);
 await fetch(base+'/index.php',{method:'HEAD'});await fetch(base+'/index.php',{headers:{DNT:'1'}});await fetch(base+'/index.php',{headers:{'Sec-GPC':'1'}});
 stats=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}})).json();assert.equal(stats.totals.visits,1,'HEAD and explicit privacy signals do not increase counts');
 const denied=await fetch(base+'/analytics-api.php?action=visit',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({path:'/'})});assert.equal(denied.status,410,'Old tracker clients cannot start visits in aggregate mode');
 await command('Page.navigate',{url:base+'/admin.php'});await waitFor(`document.querySelector('#count')?.textContent==='1'`);
 await waitFor(`document.querySelector('#dashboard-refresh-status').textContent.includes('bereits aktualisiert')&&!document.querySelector('#refresh-dashboard').disabled`);
 await waitFor(`!!Chart.getChart('monthly-canvas')`);
 assert.equal(await evaluate(`Chart.getChart('monthly-canvas').data.labels.length`),12);
 await evaluate(`document.querySelector('#chart-range').value='6';document.querySelector('#chart-range').dispatchEvent(new Event('change'))`);
 assert.equal(await evaluate(`Chart.getChart('monthly-canvas').data.labels.length`),6,'Range filter updates the actual chart');
 assert.equal(await evaluate(`Chart.getChart('monthly-canvas').data.datasets[0].data.at(-1)`),1);
 assert.equal(await evaluate(`Chart.getChart('monthly-canvas').data.datasets.at(-1).data.at(-1)`),null,'Missing citation baseline stays null');
 await evaluate(`document.querySelector('#comparison').scrollIntoView()`);
 await new Promise(r=>setTimeout(r,400));
 async function clickLegend(){const point=await evaluate(`(()=>{const chart=Chart.getChart('monthly-canvas'),hit=chart.legend.legendHitBoxes[0],rect=chart.canvas.getBoundingClientRect();return{x:rect.left+hit.left+hit.width/2,y:rect.top+hit.top+hit.height/2};})()`);await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});for(const type of['mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});}
 await clickLegend();
 await waitFor(`!Chart.getChart('monthly-canvas').isDatasetVisible(0)`);
 await clickLegend();
 await waitFor(`Chart.getChart('monthly-canvas').isDatasetVisible(0)`);await evaluate(`Chart.getChart('monthly-canvas').stop();Chart.getChart('monthly-canvas').update('none')`);
 await screenshot('admin-aggregate-chart');
 await accessibility();
 await evaluate(`window.scrollTo(0,0)`);await screenshot('admin-aggregate-desktop');
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await screenshot('admin-aggregate-mobile');
 await accessibility();
 await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 assert.equal(await evaluate(`document.querySelector('#interest').hidden&&document.querySelector('#reading').hidden&&document.querySelector('#visitors').hidden`),true,'Unsupported individual metrics are hidden');
 // Deliberately inject transport/API failures without changing real statistics.
 await evaluate(`(async()=>{window.__originalFetch=window.fetch;window.__baseline=await(await window.fetch(${JSON.stringify(base+'/analytics-api.php?action=stats')})).json();window.__replyStats=structuredClone(window.__baseline);window.fetch=async function(input,options){const url=String(input);if(url.includes('action=stats'))return new Response(JSON.stringify(window.__replyStats),{status:200,headers:{'Content-Type':'application/json'}});return window.__originalFetch(input,options);};})()`);
 await evaluate(`window.__replyStats={totals:{visits:99},publications:[],visits:[]};document.querySelector('#refresh').click()`);
 await waitFor(`document.querySelector('#status').textContent.includes('unvollständig')`);
 assert.equal(await evaluate(`document.querySelector('#count').textContent`),'1','Incomplete responses must not replace previously valid figures');
 assert.equal(await evaluate(`document.querySelector('#sync-research').disabled`),true);
 await evaluate(`window.__replyStats=structuredClone(window.__baseline);document.querySelector('#refresh').click()`);await waitFor(`!document.querySelector('#sync-research').disabled`);
 await evaluate(`window.__replyStats.mode='detailed';window.__replyStats.totals={visits:2,average:5,total:10};document.querySelector('#refresh').click()`);
 await waitFor(`document.querySelector('#count').textContent==='2'`);
 assert.ok(await evaluate(`document.querySelector('#mode-note').textContent.includes('zugestimmten')`),'Changing to detailed mode must restore the consent explanation');
 assert.equal(await evaluate(`document.querySelector('#interest').hidden`),false);
 await evaluate(`window.__replyStats=structuredClone(window.__baseline);document.querySelector('#refresh').click()`);await waitFor(`document.querySelector('#count').textContent==='1'`);
 await evaluate(`(()=>{const d=window.__replyStats;d.external.find(r=>r.kind==='citations').success=Date.now()/1000-172800;const failed=d.external.find(r=>r.kind==='links');failed.error='<img src=x onerror=window.bad=true>';const missing=d.external.filter(r=>r.kind==='citations')[1];d.external=d.external.filter(r=>r!==missing);const original=d.publications.find(p=>p.links?.zenodo),copy=structuredClone(original);copy.citationKey='duplicate-zenodo-test';copy.title='Another paper linking the same Zenodo record';d.publications.push(copy);const record=structuredClone(d.external.find(r=>r.publication===original.citationKey&&r.kind==='zenodo'));record.publication=copy.citationKey;d.external.push(record);document.querySelector('#refresh').click();})()`);
 await waitFor(`document.querySelector('.source-badge.stale')&&document.querySelector('.source-badge.failed')&&document.querySelector('.source-badge.pending')`);
 assert.equal(await evaluate(`document.querySelector('#zenodo-downloads').textContent`),'5','Shared Zenodo records must not be double-counted');
 assert.equal(await evaluate(`window.bad===true`),false,'Source error messages must be rendered as text');
 assert.ok(await evaluate(`document.querySelector('#sources-content').textContent.includes('<img src=x onerror=window.bad=true>')`));
 assert.ok(await evaluate(`document.querySelector('#citation-total').textContent.includes('teilweise')`),'Missing citation coverage is explicit');
 await evaluate(`window.__replyStats=structuredClone(window.__baseline);document.querySelector('#refresh').click()`);await waitFor(`!document.querySelector('.source-badge.failed')`);
 await evaluate(`window.fetch=async function(input,options){const url=String(input);if(url.includes('action=refresh'))return new Response('{"cached":true}',{status:200});if(url.includes('action=stats'))throw new TypeError('Simulated network failure');return window.__originalFetch(input,options);};document.querySelector('[data-source-kind="citations"]').click()`);
 await waitFor(`document.querySelector('#status').textContent.includes('letzten erfolgreichen Ansicht')`);
 assert.equal(await evaluate(`document.querySelector('#sync-research').disabled`),true,'Failed post-refresh reload disables source mutations and labels stale data');
 assert.equal(await evaluate(`document.querySelector('#count').textContent`),'1');
 await evaluate(`window.fetch=window.__originalFetch;document.querySelector('#refresh').click()`);await waitFor(`!document.querySelector('#sync-research').disabled`);
 const brokenConfig=aggregateConfig.replace("__DIR__.'/../data'","__DIR__.'/unsafe-public-data'");fs.writeFileSync(path.join(publicDir,'analytics-config.php'),brokenConfig);
 await command('Page.navigate',{url:base+'/admin/'});await waitFor(`document.querySelector('#status')?.textContent.includes('STORAGE_PUBLIC')`);
 assert.equal(await evaluate(`document.querySelector('#storage-help').hidden`),false,'Storage error has actionable help');
 assert.ok(await evaluate(`document.querySelector('#storage-help-steps').textContent.includes('HTTP 403')`));
 await screenshot('admin-storage-error');
 assert.equal(await evaluate(`document.querySelector('#interest').hidden&&document.querySelector('#visitors').hidden&&document.querySelector('#sync-research').disabled`),true,'Aggregate mode and disabled controls survive API failure');
 fs.writeFileSync(path.join(publicDir,'analytics-config.php'),aggregateConfig);await evaluate(`document.querySelector('#refresh').click()`);await waitFor(`document.querySelector('#count')?.textContent==='1'`);
 assert.equal(await evaluate(`document.querySelector('#storage-help').hidden`),true,'Recovery clears error help');
 await command('Network.setBlockedURLs',{urls:['https://*','*chart-4.6.2.umd.js*']});
 await command('Page.navigate',{url:base+'/admin.php'});await waitFor(`document.querySelector('#count')?.textContent==='1'`);
 assert.ok(await evaluate(`document.querySelector('#chart-message').textContent.includes('nicht verfügbar')`),'Local chart load failure keeps table fallback');
 assert.equal(await evaluate(`document.querySelectorAll('#monthly-data tbody tr').length`),12);
 await command('Network.setBlockedURLs',{urls:['https://*']});
 const nested=path.join(publicDir,'nested');fs.mkdirSync(nested);for(const f of['admin.php','analytics-api.php','analytics-lib.php','analytics-csv.php'])fs.copyFileSync(path.join(publicDir,f),path.join(nested,f));fs.cpSync(path.join(publicDir,'academic_website'),path.join(nested,'academic_website'),{recursive:true});
 fs.writeFileSync(path.join(nested,'analytics-config.php'),aggregateConfig.replace("__DIR__.'/../data'","dirname(__DIR__,2).'/data'"));
 for(const suffix of['/admin','/admin/','/nested/admin','/nested/admin/']){
  const before=requests.length;await command('Page.navigate',{url:base+suffix});await waitFor(`document.querySelector('#count')?.textContent==='1'`);
  const prefix=suffix.startsWith('/nested/')?'/nested/':'/';assert.ok(requests.slice(before).some(url=>url===base+prefix+'analytics-api.php?action=stats'),'Correct API base for '+suffix);
  assert.ok(await evaluate(`document.querySelector('script[src*="js/admin.js"]').src.includes('?v=')`),'Versioned admin assets bypass stale caches');
 }
 assert.deepEqual(errors,[],'No uncaught browser exceptions');
 console.log('Passed in headless Chrome: dashboard, desktop/mobile, opt-in/aggregate modes, page counts, API failure diagnostics/recovery, hidden inactive metrics, /admin and /admin/ aliases, subdirectory API paths and versioned assets.');
}finally{
 if(ws){try{await command('Browser.close');}catch(_){}ws.close();}
 if(chrome)chrome.kill();server.kill();
 await new Promise(r=>setTimeout(r,400));
 try{fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch(_){}
}})().catch(e=>{console.error(e);process.exitCode=1;});
