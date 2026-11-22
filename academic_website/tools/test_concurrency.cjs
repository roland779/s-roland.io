const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const php=process.env.PHP_BIN||'php',root=path.resolve(__dirname,'../..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'analytics-concurrency-'));
const worker=path.join(temp,'worker.php'),database=path.join(temp,'visits.sqlite3');
const env={...process.env,AUDIT_ROOT:root,AUDIT_DATABASE:database,AUDIT_BARRIER:path.join(temp,'start')};
const setup=spawnSync(php,[],{env,encoding:'utf8',input:`<?php
$db=new PDO('sqlite:'.getenv('AUDIT_DATABASE'));$db->exec('CREATE TABLE visits (id TEXT PRIMARY KEY, started REAL, updated REAL, path TEXT, referrer TEXT, ip TEXT, browser TEXT, seconds REAL, peer TEXT)');
$db->exec("INSERT INTO visits VALUES ('legacy',strftime('%s','now'),strftime('%s','now'),'/','source.example','127.0.0.0/24','test',1,'peer')");
`});assert.equal(setup.status,0,setup.stderr);
fs.writeFileSync(worker,`<?php
require getenv('AUDIT_ROOT').'/analytics-lib.php';
class AuditPDO extends PDO {
 public function query(string $query, ?int $fetchMode=null, mixed ...$args): PDOStatement|false {
  $r=parent::query($query);
  // Widen the real migration read/write race; no production behavior is mocked.
  if(str_contains($query,"key='monthly_start'"))usleep(150000);
  return $r;
 }
}
while(!file_exists(getenv('AUDIT_BARRIER')))usleep(1000);
$db=new AuditPDO('sqlite:'.getenv('AUDIT_DATABASE'),null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$db->exec('PRAGMA busy_timeout=5000');
analyticsSchema($db);
for($i=0;$i<20;$i++){$db->exec('BEGIN IMMEDIATE');incrementMonth($db,'click','paper','doi','source.example');$db->exec('COMMIT');}
echo 'OK';
`);
(async()=>{try{
 const workers=Array.from({length:8},()=>new Promise(resolve=>{const p=spawn(php,[worker],{env});let stdout='',stderr='';p.stdout.on('data',s=>stdout+=s);p.stderr.on('data',s=>stderr+=s);p.on('exit',code=>resolve({code,stdout,stderr}));}));
 fs.writeFileSync(env.AUDIT_BARRIER,'start');const results=await Promise.all(workers);
 for(const r of results)assert.equal(r.code,0,r.stderr||r.stdout);
 const totals=spawnSync(php,[],{env,encoding:'utf8',input:`<?php
$db=new PDO('sqlite:'.getenv('AUDIT_DATABASE'));echo json_encode(['visits'=>(int)$db->query("SELECT SUM(count) FROM monthly WHERE kind='visit'")->fetchColumn(),'clicks'=>(int)$db->query("SELECT SUM(count) FROM monthly WHERE kind='click'")->fetchColumn()]);
`});assert.equal(totals.status,0,totals.stderr);assert.deepEqual(JSON.parse(totals.stdout),{visits:1,clicks:160});
 // Run actual simultaneous source refreshes against a deterministic HTTP fixture.
 fs.writeFileSync(worker,`<?php
 require getenv('AUDIT_ROOT').'/analytics-lib.php';
 file_put_contents(getenv('AUDIT_BARRIER').'.ready.'.$argv[1],'ready');
 while(!file_exists(getenv('AUDIT_BARRIER').'.source'))usleep(1000);
 $db=new PDO('sqlite:'.getenv('AUDIT_DATABASE'),null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$db->exec('PRAGMA busy_timeout=5000');
 $mock=static function($url){file_put_contents(getenv('AUDIT_BARRIER').'.requests',"request\\n",FILE_APPEND|LOCK_EX);if(str_contains($url,'/works/doi:')){usleep(500000);return ['status'=>200,'body'=>json_encode(['id'=>'https://openalex.org/W123','doi'=>'https://doi.org/10.1142/S021819402050014X','cited_by_count'=>0])];}return ['status'=>200,'body'=>'{"meta":{"count":0},"results":[]}'];};
 echo json_encode(refreshResearch($db,['data_dir'=>dirname(getenv('AUDIT_DATABASE'))],'SchreiberZylka2020','citations',$mock,true));
 `);
 const sources=Array.from({length:8},(_,i)=>new Promise(resolve=>{const p=spawn(php,[worker,String(i)],{env});let stdout='',stderr='';p.stdout.on('data',s=>stdout+=s);p.stderr.on('data',s=>stderr+=s);p.on('exit',code=>resolve({code,stdout,stderr}));}));
 let ready=false;for(let i=0;i<100;i++){if(fs.readdirSync(temp).filter(f=>f.includes('.ready.')).length===8){ready=true;break;}await new Promise(r=>setTimeout(r,50));}
 fs.writeFileSync(env.AUDIT_BARRIER+'.source','start');const sourceResults=await Promise.all(sources);assert.ok(ready,'All source workers must reach the barrier');
 for(const r of sourceResults)assert.equal(r.code,0,r.stderr||r.stdout);
 assert.equal(sourceResults.filter(r=>JSON.parse(r.stdout).ok).length,1,'Exactly one source request may refresh');
 assert.equal(sourceResults.filter(r=>JSON.parse(r.stdout).busy).length,7,'Other workers must report the ongoing refresh');
 assert.equal(fs.readFileSync(env.AUDIT_BARRIER+'.requests','utf8').trim().split('\n').length,2,'One work lookup plus one citing-list request');
 console.log('Passed: eight concurrent PHP processes, first schema migration, exactly-once legacy totals, 160 atomic monthly increments and single-source refresh locking across eight processes.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
