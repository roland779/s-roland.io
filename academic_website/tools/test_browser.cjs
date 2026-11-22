const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const php=process.env.PHP_BIN||'php';
const browser=process.env.BROWSER_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=path.resolve(__dirname,'../..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'research-browser-'));
const publicDir=path.join(temp,'public');fs.mkdirSync(publicDir);
for(const f of ['admin.php','analytics-api.php','analytics-lib.php','index.html','index.php'])fs.copyFileSync(path.join(root,f),path.join(publicDir,f));
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
(async()=>{try{
 await retry(async()=>(await fetch(base+'/analytics-api.php?action=config')).ok);
 // Seed public research metadata only, using an isolated private database.
 const seed=spawnSync(php,[],{encoding:'utf8',env:{...process.env,ANALYTICS_TEST_ROOT:publicDir},input:`<?php
 require getenv('ANALYTICS_TEST_ROOT').'/analytics-lib.php';$config=require getenv('ANALYTICS_TEST_ROOT').'/analytics-config.php';$db=analyticsDatabase($config);
 foreach(publications() as $id=>$pub){
  $payload=['source'=>'OpenAlex','url'=>'https://openalex.org/W123','count'=>3,'listedTotal'=>1,'partial'=>false,'citing'=>[['title'=>'Citing <script>window.bad=true</script> work','year'=>2026,'doi'=>'https://doi.org/10.example/test','url'=>'https://openalex.org/W999']]];
  $q=$db->prepare('INSERT INTO external VALUES (?,?,?,?,?,NULL)');$q->execute([$id,'citations',json_encode($payload),time(),time()]);
  $payload=['source'=>'HTTP-Linkprüfung','links'=>[['name'=>'doi','url'=>$pub['links']['doi'],'status'=>200,'state'=>'erreichbar']]];
  $q->execute([$id,'links',json_encode($payload),time(),time()]);
  if(isset($pub['links']['zenodo'])){$q->execute([$id,'zenodo',json_encode(['source'=>'Zenodo','url'=>'https://zenodo.org/records/18086905','views'=>61,'downloads'=>5]),time(),time()]);}
  $q=$db->prepare('INSERT INTO citation_snapshots VALUES (?,?,?)');$q->execute([$id,gmdate('Y-m-d'),3]);
 }
 `});assert.equal(seed.status,0,seed.stderr||seed.stdout);
 chrome=spawn(browser,['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${path.join(temp,'chrome')}`,'about:blank'],{stdio:'ignore'});
 const pages=await retry(async()=>{const r=await fetch(`http://127.0.0.1:${debugPort}/json/list`);const list=await r.json();return list.find(p=>p.type==='page');});
 ws=new WebSocket(pages.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const c=callbacks.get(m.id);if(c){callbacks.delete(m.id);m.error?c.reject(Error(m.error.message)):c.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));else if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);};
 await command('Page.enable');await command('Runtime.enable');await command('Network.enable');await command('Network.setBlockedURLs',{urls:['https://*']});
 await command('Network.setExtraHTTPHeaders',{headers:{Authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}});
 await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await command('Page.navigate',{url:base+'/admin.php'});await waitFor(`document.querySelector('#citation-total')?.textContent==='12'`);
 await evaluate(`document.documentElement.style.scrollBehavior='auto'`);
 assert.equal(await evaluate(`document.querySelector('#count').textContent`),'0');
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
 assert.equal(await evaluate(`document.querySelector('#interest').hidden&&document.querySelector('#reading').hidden&&document.querySelector('#visitors').hidden`),true,'Unsupported individual metrics are hidden');
 const brokenConfig=aggregateConfig.replace("__DIR__.'/../data'","__DIR__.'/unsafe-public-data'");fs.writeFileSync(path.join(publicDir,'analytics-config.php'),brokenConfig);
 await command('Page.navigate',{url:base+'/admin/'});await waitFor(`document.querySelector('#status')?.textContent.includes('STORAGE_PUBLIC')`);
 assert.equal(await evaluate(`document.querySelector('#interest').hidden&&document.querySelector('#visitors').hidden&&document.querySelector('#sync-research').disabled`),true,'Aggregate mode and disabled controls survive API failure');
 fs.writeFileSync(path.join(publicDir,'analytics-config.php'),aggregateConfig);await evaluate(`document.querySelector('#refresh').click()`);await waitFor(`document.querySelector('#count')?.textContent==='1'`);
 const nested=path.join(publicDir,'nested');fs.mkdirSync(nested);for(const f of['admin.php','analytics-api.php','analytics-lib.php'])fs.copyFileSync(path.join(publicDir,f),path.join(nested,f));fs.cpSync(path.join(publicDir,'academic_website'),path.join(nested,'academic_website'),{recursive:true});
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
