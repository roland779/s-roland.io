const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const php = process.env.PHP_BIN || 'php';
const root = path.resolve(__dirname, '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-test-'));
const publicDir = path.join(temp, 'public'); fs.mkdirSync(publicDir);
for (const file of ['admin.php', 'analytics-api.php', 'analytics-lib.php', 'analytics-csv.php', 'sync-analytics.php']) fs.copyFileSync(path.join(root,file), path.join(publicDir,file));
fs.mkdirSync(path.join(publicDir,'academic_website'));
fs.mkdirSync(path.join(publicDir,'academic_website/data'));
fs.copyFileSync(path.join(root,'academic_website/data/publications.json'),path.join(publicDir,'academic_website/data/publications.json'));
fs.copyFileSync(path.join(root,'academic_website/admin-template.html'),path.join(publicDir,'academic_website/admin-template.html'));
fs.mkdirSync(path.join(publicDir,'academic_website/tools'));
fs.copyFileSync(path.join(root,'academic_website/tools/test_research.php'),path.join(publicDir,'academic_website/tools/test_research.php'));
const password = 'test-only-long-password';
const hash = spawnSync(php,['-r', 'echo password_hash("test-only-long-password", PASSWORD_DEFAULT);'],{encoding:'utf8'});
if (hash.status !== 0) throw Error(hash.stderr || 'PHP unavailable');
fs.writeFileSync(path.join(publicDir,'analytics-config.php'), `<?php return ['password_hash'=>'${hash.stdout}', 'data_dir'=>__DIR__.'/../data', 'analytics_mode'=>'detailed', 'full_ip'=>false, 'automatic_refresh'=>false];`);
const port = 18000 + Math.floor(Math.random()*10000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(php,['-S',`127.0.0.1:${port}`,'-t',publicDir],{stdio:'ignore'});
const auth = 'Basic '+Buffer.from('admin:'+password).toString('base64');
async function post(data, origin=base) { return fetch(base+'/analytics-api.php?action=visit',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)}); }
(async()=>{
 try {
  let ready=false;for(let i=0;i<50;i++){try{await fetch(base+'/analytics-api.php?action=config');ready=true;break;}catch(_){await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
  assert.equal((await fetch(base+'/admin.php')).status,401);
  assert.equal((await fetch(base+'/admin.php',{method:'HEAD'})).status,401);
  assert.equal((await fetch(base+'/admin.php',{headers:{Authorization:'Basic '+Buffer.from('admin:wrong').toString('base64')}})).status,401);
  assert.equal((await fetch(base+'/analytics-api.php?action=stats')).status,401);
  assert.equal((await fetch(base+'/analytics-api.php?action=refresh',{method:'POST'})).status,401);
  assert.equal((await fetch(base+'/sync-analytics.php')).status,404);
  assert.equal((await fetch(base+'/academic_website/tools/test_research.php')).status,404);
  assert.equal((await fetch(base+'/analytics-api.php?action=maintenance',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'})).status,403);
  const maintenance=await fetch(base+'/analytics-api.php?action=maintenance',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'});
  assert.equal(maintenance.status,200);assert.deepEqual(await maintenance.json(),{state:'disabled'});
  assert.equal((await post({path:'/'},'https://other.example')).status,403);
  assert.equal((await fetch(base+'/admin.php',{headers:{Authorization:auth}})).status,200);
  const dashboard=await fetch(base+'/admin.php',{headers:{Authorization:auth}});assert.equal(dashboard.headers.get('cache-control'),'no-store');assert.equal(dashboard.headers.get('x-robots-tag'),'noindex, nofollow');
  const start=await post({path:'/',referrer:'https://example.org/private?secret=1'});assert.equal(start.status,200);const {id}=await start.json();assert.ok(id);
  await new Promise(r=>setTimeout(r,100));assert.equal((await post({id,seconds:999})).status,200);
  const event=async body=>fetch(base+'/analytics-api.php?action=event',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({id,...body})});
  assert.equal((await event({kind:'click',publication:'SchreiberZylka2020',target:'doi'})).status,200);
  assert.equal((await event({kind:'click',publication:'SchreiberZylka2020',target:'bibtex-copy'})).status,200);
  assert.equal((await event({kind:'section',target:'publications'})).status,200);
  assert.equal((await event({kind:'section',target:'publications'})).status,200);
  assert.equal((await event({kind:'depth',target:'75'})).status,200);
  assert.equal((await event({kind:'error',target:'i18n'})).status,200);
  assert.equal((await event({kind:'click',publication:'forged',target:'doi'})).status,400);
  assert.equal((await event({kind:'click',publication:'SchreiberZylka2020',target:'malicious'})).status,400);
  assert.equal((await event({kind:'depth',target:'999'})).status,400);
  assert.equal((await event({kind:'section',target:'admin'})).status,400);
  assert.equal((await event({id:'invalid',kind:'error',target:'i18n'})).status,404);
  const stats=await (await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:auth}})).json();
  assert.equal(stats.totals.visits,1);assert.equal(stats.visits[0].referrer,'example.org');assert.equal(stats.visits[0].ip,'127.0.0.0/24');assert.ok(stats.visits[0].seconds < 2);
  assert.equal(stats.engagement.length,2);assert.equal(stats.conversion[0].engaged,1);assert.equal(stats.conversion[0].clicks,2);assert.equal(stats.reading.find(r=>r.kind==='section').visits,1);
  assert.equal(stats.monthly.filter(r=>r.kind==='click').reduce((n,r)=>n+r.count,0),2);
  for(const privacy of [{DNT:'1'},{'Sec-GPC':'1'}]){
    for(const [action,body]of [['visit',{path:'/'}],['visit',{id,seconds:5}],['event',{id,kind:'click',publication:'SchreiberZylka2020',target:'doi'}]]){
      const blocked=await fetch(base+'/analytics-api.php?action='+action,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...privacy},body:JSON.stringify(body)});
      assert.equal(blocked.status,403,'Server must honor DNT/GPC even for direct or outdated tracker requests');
    }
  }
  const privateStats=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:auth}})).json();
  assert.equal(privateStats.totals.visits,1);assert.equal(privateStats.engagement.reduce((n,r)=>n+r.clicks,0),2,'Privacy signals cannot inflate statistics');
  const apiRefresh=await fetch(base+'/analytics-api.php?action=refresh',{method:'POST',headers:{Authorization:auth,Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify({publication:'SchreiberZylka2020',kind:'citations'})});assert.equal(apiRefresh.status,403);
  const invalidRefresh=await fetch(base+'/analytics-api.php?action=refresh',{method:'POST',headers:{Authorization:auth,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({publication:'forged',kind:'citations'})});assert.equal(invalidRefresh.status,400);
  assert.equal((await post({id:'a'.repeat(64),seconds:1})).status,404);
  for(const id of ['',null,0,[],{},'nonexistent'])assert.equal((await post({id,seconds:1})).status,400,'Invalid visit token must not create a visit');
  for(const body of [[],null,{},'bad',1])assert.equal((await post(body)).status,400,'Only a visit object with an explicit path is accepted');
  assert.equal((await fetch(base+'/analytics-api.php?action=visit',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{broken'})).status,400);
  assert.equal((await fetch(base+'/analytics-api.php?action=visit',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({path:'/',extra:'x'.repeat(3000)})})).status,413);
  const unchanged=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:auth}})).json();assert.equal(unchanged.totals.visits,1,'Rejected payloads do not change visit totals');
  const expired=spawnSync(php,[],{encoding:'utf8',env:{...process.env,ANALYTICS_TEST_ROOT:publicDir},input:`<?php
    require getenv('ANALYTICS_TEST_ROOT').'/analytics-lib.php';$config=require getenv('ANALYTICS_TEST_ROOT').'/analytics-config.php';$db=analyticsStorage($config);$old=time()-31*86400;
    $db->update(static function(array &$t)use($old):void{
      AnalyticsCsvStore::put($t,'visits',['id'=>'expired','started'=>$old,'updated'=>$old,'path'=>'/','referrer'=>'old.example','ip'=>'127.0.0.0/24','browser'=>'test','seconds'=>10,'peer'=>'test']);
      AnalyticsCsvStore::put($t,'events',['event_id'=>'expired-event','visit'=>'expired','created'=>$old,'kind'=>'section','publication'=>'','target'=>'research','source'=>'old.example']);incrementMonth($t,'visit','','','old.example',$old);
    });
  `});assert.equal(expired.status,0,expired.stderr||expired.stdout);
  const retained=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:auth}})).json();
  assert.equal(retained.totals.visits,1);assert.ok(!retained.reading.some(r=>r.kind==='section'&&r.target==='research'),'Expired details are deleted');assert.equal(retained.monthly.filter(r=>r.kind==='visit').reduce((n,r)=>n+r.count,0),2,'Monthly aggregate survives detail expiration');
  fs.writeFileSync(path.join(publicDir,'analytics-config.php'),`<?php return ['password_hash'=>'${hash.stdout}', 'data_dir'=>__DIR__.'/../data', 'analytics_mode'=>'detailed', 'full_ip'=>true, 'automatic_refresh'=>false];`);
  assert.equal((await post({path:'/'})).status,200);
  const full=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:auth}})).json();assert.equal(full.fullIp,true);assert.equal(full.visits[0].ip,'127.0.0.1','Explicit full-IP setting is honored');
  assert.equal((await post({path:'/admin.php'})).status,400);
  fs.writeFileSync(path.join(publicDir,'analytics-config.php'),`<?php return ['password_hash'=>'${hash.stdout}', 'data_dir'=>__DIR__.'/unsafe-public-data', 'analytics_mode'=>'detailed', 'full_ip'=>false, 'automatic_refresh'=>false];`);
  assert.equal((await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:auth}})).status,503,'Reject database storage in document root');
  const unsafe=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:auth}})).json();assert.equal(unsafe.code,'STORAGE_PUBLIC');assert.ok(!JSON.stringify(unsafe).includes(publicDir),'Diagnostics must not expose server paths');
  fs.writeFileSync(path.join(publicDir,'../data/not-a-directory'),'fixture');
  fs.writeFileSync(path.join(publicDir,'analytics-config.php'),`<?php return ['password_hash'=>'${hash.stdout}', 'data_dir'=>__DIR__.'/../data/not-a-directory'];`);
  const unwritable=await(await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:auth}})).json();assert.equal(unwritable.code,'STORAGE_NOT_WRITABLE');
  fs.writeFileSync(path.join(publicDir,'analytics-config.php'),`<?php return ['password_hash'=>'${hash.stdout}', 'data_dir'=>__DIR__.'/../data'];`);
  const noSqlite=spawn(php,['-n','-S',`127.0.0.1:${port+1}`,'-t',publicDir],{stdio:'ignore'});
  try {
    let result;
    for(let i=0;i<50;i++){try{result=await fetch(`http://127.0.0.1:${port+1}/analytics-api.php?action=stats`,{headers:{Authorization:auth}});break;}catch(_){await new Promise(r=>setTimeout(r,100));}}
    assert.ok(result);assert.equal(result.status,200);assert.equal((await result.json()).mode,'aggregate','CSV storage works without optional PHP extensions');
  } finally {noSqlite.kill();await new Promise(r=>noSqlite.once('exit',r));}
  const csvFile=path.join(temp,'data/analytics.csv'),original=fs.readFileSync(csvFile);
  try {
    // A malformed JSON payload belongs to CSV diagnostics, not publication JSON diagnostics.
    const corrupt=spawnSync(php,[],{encoding:'utf8',env:{...process.env,AUDIT_CSV:csvFile},input:`<?php
      $f=fopen(getenv('AUDIT_CSV'),'r');$header=fgetcsv($f,null,',','"','');fclose($f);
      $row=array_fill_keys($header,'');$row['table']='external';$row['publication']='paper';$row['kind']='citations';$row['payload']='{broken';$row['checked']='1';$row['success']='1';
      $f=fopen(getenv('AUDIT_CSV'),'w');fputcsv($f,$header,',','"','');fputcsv($f,array_values($row),',','"','');fclose($f);
    `});assert.equal(corrupt.status,0,corrupt.stderr);
    const damaged=fs.readFileSync(csvFile);
    const response=await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:auth}});
    assert.equal(response.status,503);assert.equal((await response.json()).code,'CSV_INVALID');
    assert.deepEqual(fs.readFileSync(csvFile),damaged,'Invalid CSV must never be overwritten');
  } finally {fs.writeFileSync(csvFile,original);}
  assert.equal((await fetch(base+'/analytics-api.php?action=stats',{headers:{Authorization:auth}})).status,200,'Restored CSV can be read again');
  console.log('Passed: authentication/HEAD/cache headers, CLI-only tools, origin checks, malformed payload rejection, CSV persistence without extensions, masked/full IP, bounded duration, attribution, monthly aggregates, section/depth/errors, detail expiry, private storage enforcement and corruption preservation/recovery.');
 } finally { server.kill(); await new Promise(r=>server.once('exit',r));fs.rmSync(temp,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
