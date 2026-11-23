const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'apache-storage-'));
const publicDir=path.join(temp,'public');fs.mkdirSync(publicDir);
const php=process.env.PHP_BIN||'C:/xampp/php/php.exe';
const apache=process.env.APACHE_BIN||'C:/xampp/apache/bin/httpd.exe';
const apacheRoot=path.resolve(path.dirname(apache),'..').replaceAll('\\','/');
const phpRoot=path.dirname(php).replaceAll('\\','/');
const port=31000+Math.floor(Math.random()*5000),base=`http://127.0.0.1:${port}`;
let server,log='';
(async()=>{try{
 for(const file of ['index.php','index.html','admin.php','analytics-api.php','analytics-lib.php','analytics-csv.php','.htaccess'])fs.copyFileSync(path.join(root,file),path.join(publicDir,file));
 fs.cpSync(path.join(root,'academic_website'),path.join(publicDir,'academic_website'),{recursive:true});
 const data=path.join(publicDir,'analytics-private');fs.mkdirSync(data);
 fs.copyFileSync(path.join(root,'analytics-private/.htaccess'),path.join(data,'.htaccess'));
 const hash=spawnSync(php,['-r',`echo password_hash('test-apache-password', PASSWORD_DEFAULT);`],{encoding:'utf8'});assert.equal(hash.status,0,hash.stderr);
 const config=`<?php return ['password_hash'=>'${hash.stdout}','data_dir'=>__DIR__.'/analytics-private','protected_storage'=>true,'automatic_refresh'=>false];`;
 fs.writeFileSync(path.join(publicDir,'analytics-config.php'),config);
 const cfg=path.join(temp,'httpd.conf'),doc=publicDir.replaceAll('\\','/');
 fs.writeFileSync(cfg,`ServerRoot "${apacheRoot}"
Listen 127.0.0.1:${port}
ServerName 127.0.0.1
PidFile "${temp.replaceAll('\\','/')}/httpd.pid"
ErrorLog "${temp.replaceAll('\\','/')}/error.log"
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule dir_module modules/mod_dir.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule php_module "${phpRoot}/php8apache2_4.dll"
PHPIniDir "${phpRoot}"
DocumentRoot "${doc}"
<Directory "${doc}">
AllowOverride All
Require all granted
</Directory>
<FilesMatch "\\.php$">
SetHandler application/x-httpd-php
</FilesMatch>
`);
 server=spawn(apache,['-X','-f',cfg.replaceAll('\\','/')]);server.stderr.on('data',s=>log+=s);server.stdout.on('data',s=>log+=s);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/analytics-api.php?action=config')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,log+(fs.existsSync(path.join(temp,'error.log'))?fs.readFileSync(path.join(temp,'error.log'),'utf8'):''));
 assert.equal((await fetch(base+'/admin.php')).status,401);
 assert.equal((await fetch(base+'/')).status,200);
 const headers={Authorization:'Basic '+Buffer.from('admin:test-apache-password').toString('base64')};
 const stats=await fetch(base+'/analytics-api.php?action=stats',{headers});assert.equal(stats.status,200,await stats.clone().text());assert.equal((await stats.json()).totals.visits,1);
 assert.ok(fs.existsSync(path.join(data,'analytics.csv')));
 for(const file of ['.csv-probe','source-probe.lock'])fs.writeFileSync(path.join(data,file),'PRIVATE');
 for(const p of ['/analytics-private/','/analytics-private/analytics.csv','/analytics-private/.csv-probe','/analytics-private/source-probe.lock','/analytics-private/.htaccess'])assert.equal((await fetch(base+p)).status,403,p);
 // The directory guard must work even without the parent rewrite rule.
 fs.writeFileSync(path.join(publicDir,'.htaccess'),'DirectoryIndex index.php index.html\n');
 assert.equal((await fetch(base+'/analytics-private/analytics.csv')).status,403);
 // Missing or altered guards and absent opt-in must fail closed in PHP.
 for(const guard of ['', 'Require all granted']){
  fs.writeFileSync(path.join(data,'.htaccess'),guard);
  const r=await fetch(base+'/analytics-api.php?action=stats',{headers});assert.equal(r.status,503);assert.equal((await r.json()).code,'STORAGE_PUBLIC');
 }
 fs.copyFileSync(path.join(root,'analytics-private/.htaccess'),path.join(data,'.htaccess'));
 fs.writeFileSync(path.join(publicDir,'analytics-config.php'),config.replace("'protected_storage'=>true,",''));
 assert.equal((await fetch(base+'/analytics-api.php?action=stats',{headers})).status,503);
 fs.writeFileSync(path.join(publicDir,'analytics-config.php'),config);
 assert.equal((await fetch(base+'/analytics-api.php?action=stats',{headers})).status,200);
 console.log('Passed in real Apache/PHP: protected subfolder persistence, authenticated dashboard API, HTTP 403 for CSV/temporary/lock files, independent folder guard, rejected missing/modified protection and required opt-in.');
}finally{
 if(server){server.kill();await new Promise(r=>setTimeout(r,800));}
 fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}})().catch(e=>{console.error(e);process.exitCode=1;});
