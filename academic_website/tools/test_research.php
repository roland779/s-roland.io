<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__, 2) . '/analytics-lib.php';
function check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$db->exec('CREATE TABLE visits (id TEXT PRIMARY KEY, started REAL, updated REAL, path TEXT, referrer TEXT, ip TEXT, browser TEXT, seconds REAL, peer TEXT)');
$old = time()-40*86400;
$q=$db->prepare('INSERT INTO visits VALUES (?,?,?,?,?,?,?,?,?)');$q->execute(['legacy',$old,$old,'/','example.org','127.0.0.0/24','test',1,'peer']);
analyticsSchema($db);analyticsSchema($db);
check((int)$db->query("SELECT SUM(count) FROM monthly WHERE kind='visit'")->fetchColumn()===1,'Migration must not double count existing visits');
$calls=[];
$mock=static function(string $url, bool $head=false, array $headers=[]) use (&$calls):array {
    $calls[]=$url;
    if(str_contains($url,'/works/doi:')) return ['status'=>200,'body'=>json_encode(['id'=>'https://openalex.org/W123','doi'=>'https://doi.org/10.1142/S021819402050014X','cited_by_count'=>152])];
    parse_str(parse_url($url,PHP_URL_QUERY)??'', $params);
    if(str_contains($url,'api.openalex.org/works?')) {
        $page=(int)$params['page'];$items=[];
        for($i=($page-1)*100;$i<min(152,$page*100);$i++)$items[]=['id'=>'https://openalex.org/W'.(1000+$i),'title'=>'Citing <script>unsafe</script> '.$i,'publication_year'=>2025,'doi'=>$i===0?null:'https://doi.org/10.example/'.$i];
        return ['status'=>200,'body'=>json_encode(['meta'=>['count'=>152],'results'=>$items])];
    }
    if(str_contains($url,'zenodo.org/api/records/')) return ['status'=>200,'body'=>json_encode(['stats'=>['views'=>61,'downloads'=>5]])];
    return ['status'=>str_contains($url,'missing')?404:(str_contains($url,'blocked')?403:200),'body'=>''];
};
$pub=publications()['SchreiberZylka2020'];
$result=fetchCitations($pub,[], $mock);
check($result['count']===152 && count($result['citing'])===152 && !$result['partial'],'Citations must paginate');
check($result['citing'][0]['doi']===null,'Missing DOI is legitimate');
check(count($calls)===3,'Lookup and two citing pages expected');
check(metricCount(0)===0&&metricCount('12')===12,'Accept integer counters including zero');
foreach ([-1,1.5,true,'invalid',null,[]] as $invalid) {
    $rejected=false;try{metricCount($invalid);}catch(RuntimeException $e){$rejected=true;}check($rejected,'Reject invalid or negative counters');
}
$missingMetadata=static function($url,$head=false,$headers=[])use($mock){$r=$mock($url,$head,$headers);$d=json_decode($r['body'],true);if(!empty($d['results'])){$d['results'][0]['title']=null;$d['results'][0]['doi']=[];$r['body']=json_encode($d);}return $r;};
$normalized=fetchCitations($pub,[],$missingMetadata);
check($normalized['citing'][0]['title']==='Titel nicht verfügbar'&&$normalized['citing'][0]['doi']===null,'Missing citation metadata cannot break the dashboard');
$result=fetchZenodo(publications()['SchreiberWieland2026'],$mock);check($result['views']===61&&$result['downloads']===5,'Legacy Zenodo statistics');
$modern=static fn()=>['status'=>200,'body'=>json_encode(['stats'=>['this_version'=>['views'=>9,'downloads'=>3],'all_versions'=>['views'=>99,'downloads'=>33]]])];
$result=fetchZenodo(publications()['SchreiberWieland2026'],$modern);check($result['views']===9&&$result['downloads']===3,'Use this version, not all versions');
$result=checkPublicationLinks(['links'=>['missing'=>'https://example.org/missing','blocked'=>'https://example.org/blocked','ok'=>'https://example.org']],$mock);
check(array_column($result['links'],'state')===['defekt','unklar','erreichbar'],'Do not label 403 as broken');
$fallbackCalls=0;$fallback=static function($url,$head)use(&$fallbackCalls){$fallbackCalls++;return ['status'=>$head?405:200,'body'=>''];};
check(checkPublicationLinks(['links'=>['ok'=>'https://example.org']],$fallback)['links'][0]['state']==='erreichbar'&&$fallbackCalls===2,'HEAD rejection should fall back to GET');
check(refreshResearch($db,[],'SchreiberZylka2020','citations',$mock,true)['ok'],'First refresh succeeds');
check((int)$db->query('SELECT count FROM citation_snapshots')->fetchColumn()===152,'Persist snapshot');
$fail=static fn()=>['status'=>429,'body'=>'{}'];
$result=refreshResearch($db,[],'SchreiberZylka2020','citations',$fail,true);check(!$result['ok'],'API failure is explicit');
$row=$db->query('SELECT * FROM external')->fetch();check(json_decode($row['payload'],true)['count']===152&&!empty($row['error'])&&!empty($row['success']),'Keep last successful data on failure');
check((int)$db->query('SELECT COUNT(*) FROM citation_snapshots')->fetchColumn()===1,'API errors must not create zero snapshots');
check(!empty(refreshResearch($db,[],'SchreiberZylka2020','citations',$mock)['cached']),'Throttle refresh within an hour');
$badDoi=static fn()=>['status'=>200,'body'=>json_encode(['id'=>'https://openalex.org/W123','doi'=>'https://doi.org/wrong','cited_by_count'=>8])];
try { fetchCitations($pub,[],$badDoi);throw new LogicException('Wrong DOI accepted'); }catch(RuntimeException $e){}
foreach(['http://example.org','https://127.0.0.1','https://user:secret@example.org','https://example.org:8443'] as $url) {
    $blocked=false;try{publicRequest($url);}catch(RuntimeException $e){$blocked=true;}check($blocked,'Unsafe link must be blocked');
}
$db->exec("DELETE FROM visits WHERE id='legacy'");
check((int)$db->query("SELECT SUM(count) FROM monthly WHERE kind='visit'")->fetchColumn()===1,'Aggregate survives detail deletion');
check(resolveRedirect('https://example.org/a/paper?old=1','?new=2')==='https://example.org/a/paper?new=2','Query-only redirect keeps current path');
check(resolveRedirect('https://example.org/a/paper','next')==='https://example.org/a/next','Resolve relative redirects');
check(resolveRedirect('https://example.org/a/paper','/new')==='https://example.org/new','Resolve root-relative redirects');
check(resolveRedirect('https://example.org/a/paper','//other.example/new')==='https://other.example/new','Resolve protocol-relative redirects');
foreach(['http://example.org','javascript:alert(1)',"https://example.org/\r\nx: value"] as $location) {
    $blocked=false;try{resolveRedirect('https://example.org',$location);}catch(RuntimeException $e){$blocked=true;}check($blocked,'Reject unsafe redirects');
}
echo "Passed: legacy migration, citation pagination, missing DOI, Zenodo formats, HTTP classifications, HEAD fallback, snapshots, failure preservation, cache throttling, DOI matching, public-target validation and aggregate retention.\n";

$limit = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$limit->exec('CREATE TABLE visits (id TEXT PRIMARY KEY, started REAL, updated REAL, path TEXT, referrer TEXT, ip TEXT, browser TEXT, seconds REAL, peer TEXT)');analyticsSchema($limit);
$token=str_repeat('a',64);$q=$limit->prepare('INSERT INTO visits VALUES (?,?,?,?,?,?,?,?,?)');$q->execute([$token,time(),time(),'/','source.example','127.0.0.0/24','test',0,'peer']);
for($i=0;$i<500;$i++)check(recordEvent($limit,['id'=>$token,'kind'=>'click','publication'=>'SchreiberZylka2020','target'=>'doi'],microtime(true))===200,'Allow bounded event budget');
check(recordEvent($limit,['id'=>$token,'kind'=>'click','publication'=>'SchreiberZylka2020','target'=>'doi'],microtime(true))===429,'Stop event flooding after budget');
check((int)$limit->query("SELECT SUM(count) FROM monthly WHERE kind='click'")->fetchColumn()===500,'Rejected events cannot inflate aggregate counts');
$expiredMonth=(new DateTimeImmutable('first day of this month',new DateTimeZone('UTC')))->modify('-24 months');
incrementMonth($limit,'visit','','','old.example',$expiredMonth->getTimestamp());analyticsSchema($limit);
check((int)$limit->query("SELECT COUNT(*) FROM monthly WHERE source='old.example'")->fetchColumn()===0,'Delete aggregate months outside the 24-month window');
echo "Passed: per-visit event budget, unchanged aggregates after rejected events and 24-month aggregate expiry.\n";

$auto = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$auto->exec('CREATE TABLE visits (id TEXT PRIMARY KEY, started REAL, updated REAL, path TEXT, referrer TEXT, ip TEXT, browser TEXT, seconds REAL, peer TEXT)');
analyticsSchema($auto);
$temp = sys_get_temp_dir() . '/analytics-maintenance-' . bin2hex(random_bytes(6)); mkdir($temp);
$config = ['data_dir'=>$temp]; $autoCalls=0;
$autoMock=static function($url,$head=false) use (&$autoCalls): array {
    $autoCalls++;
    if (str_contains($url,'/works/doi:')) {
        $doi=rawurldecode(substr($url,strpos($url,'doi:')+4));
        return ['status'=>200,'body'=>json_encode(['id'=>'https://openalex.org/W123','doi'=>'https://doi.org/'.$doi,'cited_by_count'=>0])];
    }
    if(str_contains($url,'api.openalex.org/works?')) return ['status'=>200,'body'=>'{"meta":{"count":0},"results":[]}'];
    if(str_contains($url,'zenodo.org/api/records/')) return ['status'=>200,'body'=>'{"stats":{"views":10,"downloads":2}}'];
    return ['status'=>200,'body'=>''];
};
try {
    $now=time();
    check(maintenanceStep($auto,$config,$autoMock,$now)['state']==='processed','First pageview processes one due job');
    check((int)$auto->query('SELECT COUNT(*) FROM external')->fetchColumn()===1,'Only one job per request');
    $before=$autoCalls;
    check(maintenanceStep($auto,$config,$autoMock,$now+1)['state']==='throttled'&&$before===$autoCalls,'Global throttle prevents anonymous refresh storms');
    $lock=fopen($temp.'/sync.lock','c');flock($lock,LOCK_EX);
    check(maintenanceStep($auto,$config,$autoMock,$now+61)['state']==='busy','Concurrent run does not overlap');flock($lock,LOCK_UN);fclose($lock);
    for($i=1;$i<9;$i++) check(maintenanceStep($auto,$config,$autoMock,$now+$i*61)['state']==='processed','Remaining due jobs make progress');
    check((int)$auto->query('SELECT COUNT(*) FROM external')->fetchColumn()===9,'Refresh all four papers, one Zenodo record and four link groups');
    check((int)$auto->query('SELECT COUNT(*) FROM citation_snapshots')->fetchColumn()===4,'Save each paper snapshot');
    check((int)$auto->query('SELECT COUNT(*) FROM visits')->fetchColumn()===0,'Maintenance does not record visitors');
    check(maintenanceStep($auto,$config,$autoMock,$now+600)['state']==='current','Fresh daily/weekly jobs are not repeated');
    $auto->exec("DELETE FROM meta WHERE key='maintenance_attempt'");
    $auto->exec("UPDATE external SET checked=checked-90000 WHERE kind='citations'");
    check(maintenanceStep($auto,$config,$autoMock,$now)['state']==='processed','Daily jobs become due again');
    check(maintenanceStep($auto,['data_dir'=>$temp,'automatic_refresh'=>false],$autoMock)['state']==='disabled','Can disable automatic requests');
    $sourceLock=fopen($temp.'/source-'.hash('sha256','SchreiberZylka2020:citations').'.lock','c');flock($sourceLock,LOCK_EX);
    $before=$autoCalls;
    check(!empty(refreshResearch($auto,$config,'SchreiberZylka2020','citations',$autoMock,true)['busy'])&&$before===$autoCalls,'Manual and automatic requests cannot overlap for one source');
    flock($sourceLock,LOCK_UN);fclose($sourceLock);
    echo "Passed: cronless scheduling, single-job steps, global throttle, concurrent lock, complete job rotation, daily expiry, snapshots, no visitor recording and opt-out configuration.\n";
} finally { foreach (glob($temp.'/*.lock') as $file) unlink($file); rmdir($temp); }
