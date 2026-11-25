<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__, 2) . '/analytics-lib.php';
function check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
$testDirs=[];
function testStore(): AnalyticsCsvStore {
    global $testDirs;
    $dir=sys_get_temp_dir().'/analytics-research-'.bin2hex(random_bytes(6));mkdir($dir);$testDirs[]=$dir;
    $store=new AnalyticsCsvStore($dir);$store->update(static function(array &$t):void{cleanAnalytics($t);});return $store;
}
register_shutdown_function(static function()use(&$testDirs):void{foreach($testDirs as $dir){foreach(glob($dir.'/*') as $f)unlink($f);rmdir($dir);}});
function rows(AnalyticsCsvStore $store,string $table):array{return $store->read(static fn($t)=>AnalyticsCsvStore::rows($t,$table));}
function total(AnalyticsCsvStore $store,string $kind):int{return array_sum(array_column(array_filter(rows($store,'monthly'),static fn($r)=>$r['kind']===$kind),'count'));}
$db=testStore();
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
check((int)rows($db,'citation_snapshots')[0]['count']===152,'Persist snapshot');
$fail=static fn()=>['status'=>429,'body'=>'{}'];
$result=refreshResearch($db,[],'SchreiberZylka2020','citations',$fail,true);check(!$result['ok'],'API failure is explicit');
$row=rows($db,'external')[0];check($row['payload']['count']===152&&!empty($row['error'])&&!empty($row['success']),'Keep last successful data on failure');
check(count(rows($db,'citation_snapshots'))===1,'API errors must not create zero snapshots');
check(refreshResearch($db,[],'SchreiberWieland2026','zenodo',$mock,true)['ok'],'Zenodo refresh succeeds');
check(rows($db,'zenodo_snapshots')[0]['payload']['downloads']===5,'Persist Zenodo history without changing CSV columns');
refreshResearch($db,[],'SchreiberWieland2026','zenodo',$modern,true);
check(count(rows($db,'zenodo_snapshots'))===1&&rows($db,'zenodo_snapshots')[0]['payload']['downloads']===3,'Replace same-day snapshot');
refreshResearch($db,[],'SchreiberWieland2026','zenodo',$fail,true);
check(rows($db,'zenodo_snapshots')[0]['payload']['downloads']===3,'Failure preserves Zenodo history');
$db->update(static function(array &$t):void{
    $old=(new DateTimeImmutable('first day of this month',new DateTimeZone('UTC')))->modify('-24 months')->format('Y-m-d');
    AnalyticsCsvStore::put($t,'zenodo_snapshots',['publication'=>'expired','day'=>$old,'payload'=>['views'=>1,'downloads'=>1]]);
    cleanAnalytics($t);
});
check(count(rows($db,'zenodo_snapshots'))===1,'Expire Zenodo snapshots outside the 24-month window');
check(!empty(refreshResearch($db,[],'SchreiberZylka2020','citations',$mock)['cached']),'Throttle refresh within an hour');
$badDoi=static fn()=>['status'=>200,'body'=>json_encode(['id'=>'https://openalex.org/W123','doi'=>'https://doi.org/wrong','cited_by_count'=>8])];
try { fetchCitations($pub,[],$badDoi);throw new LogicException('Wrong DOI accepted'); }catch(RuntimeException $e){}
foreach(['http://example.org','https://127.0.0.1','https://user:secret@example.org','https://example.org:8443'] as $url) {
    $blocked=false;try{publicRequest($url);}catch(RuntimeException $e){$blocked=true;}check($blocked,'Unsafe link must be blocked');
}
$db->update(static function(array &$t):void{incrementMonth($t,'visit');$t['visits']=[];});
check(total($db,'visit')===1,'Aggregate survives detail deletion');
check(resolveRedirect('https://example.org/a/paper?old=1','?new=2')==='https://example.org/a/paper?new=2','Query-only redirect keeps current path');
check(resolveRedirect('https://example.org/a/paper','next')==='https://example.org/a/next','Resolve relative redirects');
check(resolveRedirect('https://example.org/a/paper','/new')==='https://example.org/new','Resolve root-relative redirects');
check(resolveRedirect('https://example.org/a/paper','//other.example/new')==='https://other.example/new','Resolve protocol-relative redirects');
foreach(['http://example.org','javascript:alert(1)',"https://example.org/\r\nx: value"] as $location) {
    $blocked=false;try{resolveRedirect('https://example.org',$location);}catch(RuntimeException $e){$blocked=true;}check($blocked,'Reject unsafe redirects');
}
echo "Passed: CSV persistence, citation pagination, missing DOI, Zenodo formats, HTTP classifications, HEAD fallback, snapshots, failure preservation, cache throttling, DOI matching, public-target validation and aggregate retention.\n";

$limit=testStore();$token=str_repeat('a',64);
$limit->update(static function(array &$t)use($token):void{AnalyticsCsvStore::put($t,'visits',['id'=>$token,'started'=>time(),'updated'=>time(),'path'=>'/','referrer'=>'source.example','ip'=>'127.0.0.0/24','browser'=>'test','seconds'=>0,'peer'=>'peer']);});
for($i=0;$i<500;$i++)check(recordEvent($limit,['id'=>$token,'kind'=>'click','publication'=>'SchreiberZylka2020','target'=>'doi'],microtime(true))===200,'Allow bounded event budget');
check(recordEvent($limit,['id'=>$token,'kind'=>'click','publication'=>'SchreiberZylka2020','target'=>'doi'],microtime(true))===429,'Stop event flooding after budget');
check(total($limit,'click')===500,'Rejected events cannot inflate aggregate counts');
$expiredMonth=(new DateTimeImmutable('first day of this month',new DateTimeZone('UTC')))->modify('-24 months');
$limit->update(static function(array &$t)use($expiredMonth):void{incrementMonth($t,'visit','','','old.example',$expiredMonth->getTimestamp());cleanAnalytics($t);});
check(count(array_filter(rows($limit,'monthly'),static fn($r)=>$r['source']==='old.example'))===0,'Delete aggregate months outside the 24-month window');
echo "Passed: per-visit event budget, unchanged aggregates after rejected events and 24-month aggregate expiry.\n";
check(analyticsMode([])==='aggregate','Default must not enable individual tracking');
$pageviewsBefore=array_sum(array_column(rows($limit,'pageviews_daily'),'count'));
recordPageview($limit);recordPageview($limit);
check(array_sum(array_column(rows($limit,'pageviews_daily'),'count'))===$pageviewsBefore+2,'Server pageviews increment daily totals');
check(total($limit,'pageview')===2,'Server pageviews increment separate monthly totals');
check(count(rows($limit,'visits'))===1,'Server pageviews never create visitor records');
echo "Passed: aggregate default, daily/monthly server counters and no additional visitor records.\n";

$auto=testStore();
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
    check(count(rows($auto,'external'))===1,'Only one job per request');
    $before=$autoCalls;
    check(maintenanceStep($auto,$config,$autoMock,$now+1)['state']==='throttled'&&$before===$autoCalls,'Global throttle prevents anonymous refresh storms');
    $lock=fopen($auto->directory().'/sync.lock','c');flock($lock,LOCK_EX);
    check(maintenanceStep($auto,$config,$autoMock,$now+61)['state']==='busy','Concurrent run does not overlap');flock($lock,LOCK_UN);fclose($lock);
    for($i=1;$i<9;$i++) check(maintenanceStep($auto,$config,$autoMock,$now+$i*61)['state']==='processed','Remaining due jobs make progress');
    check(count(rows($auto,'external'))===9,'Refresh all four papers, one Zenodo record and four link groups');
    check(count(rows($auto,'citation_snapshots'))===4,'Save each paper snapshot');
    check(count(rows($auto,'visits'))===0,'Maintenance does not record visitors');
    check(maintenanceStep($auto,$config,$autoMock,$now+600)['state']==='current','Fresh daily/weekly jobs are not repeated');
    $auto->update(static function(array &$t):void{unset($t['meta'][AnalyticsCsvStore::key(['maintenance_attempt'])]);foreach($t['external'] as &$r)if($r['kind']==='citations')$r['checked']-=90000;});
    check(maintenanceStep($auto,$config,$autoMock,$now)['state']==='processed','Daily jobs become due again');
    check(maintenanceStep($auto,['data_dir'=>$temp,'automatic_refresh'=>false],$autoMock)['state']==='disabled','Can disable automatic requests');
    $sourceLock=fopen($auto->directory().'/source-'.hash('sha256','SchreiberZylka2020:citations').'.lock','c');flock($sourceLock,LOCK_EX);
    $before=$autoCalls;
    check(!empty(refreshResearch($auto,$config,'SchreiberZylka2020','citations',$autoMock,true)['busy'])&&$before===$autoCalls,'Manual and automatic requests cannot overlap for one source');
    flock($sourceLock,LOCK_UN);fclose($sourceLock);
    echo "Passed: cronless scheduling, single-job steps, global throttle, concurrent lock, complete job rotation, daily expiry, snapshots, no visitor recording and opt-out configuration.\n";
} finally { foreach (glob($temp.'/*.lock') as $file) unlink($file); rmdir($temp); }
