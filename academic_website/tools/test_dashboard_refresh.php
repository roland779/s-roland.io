<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require dirname(__DIR__,2).'/analytics-lib.php';
function verify(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
$dir=sys_get_temp_dir().'/dashboard-refresh-'.bin2hex(random_bytes(8));mkdir($dir);
$store=new AnalyticsCsvStore($dir);$config=['data_dir'=>$dir];$calls=0;$now=time();
$mock=static function($url)use(&$calls):array{
    $calls++;
    if(str_contains($url,'/works/doi:'))return ['status'=>200,'body'=>json_encode(['id'=>'https://openalex.org/W123','doi'=>'https://doi.org/'.rawurldecode(substr($url,strpos($url,'doi:')+4)),'cited_by_count'=>0])];
    if(str_contains($url,'api.openalex.org/works?'))return ['status'=>200,'body'=>'{"meta":{"count":0},"results":[]}'];
    if(str_contains($url,'zenodo.org/api/records/'))return ['status'=>200,'body'=>'{"stats":{"views":10,"downloads":2}}'];
    return ['status'=>200,'body'=>''];
};
function finish(AnalyticsCsvStore $store,array $config,array $state,callable $mock,int $now):array{
    for($i=0;$i<20&&$state['state']==='running';$i++)$state=dashboardRefresh($store,$config,['operation'=>'step','token'=>$state['token']],$mock,$now);
    verify($state['state']==='complete','All sources finish in bounded steps');return $state;
}
try{
    $state=dashboardRefresh($store,$config,[],$mock,$now);verify($state['state']==='running'&&$state['total']===9,'First daily open starts all sources');
    verify(dashboardRefresh($store,$config,[],$mock,$now)['state']==='busy','Another tab must not start the same batch');
    $firstToken=$state['token'];$state=dashboardRefresh($store,$config,['operation'=>'step','token'=>$firstToken],$mock,$now);
    verify($state['done']===1,'One source per HTTP request');
    $state=dashboardRefresh($store,$config,[],$mock,$now+301);verify($state['done']===1&&$state['token']!==$firstToken,'Interrupted batch resumes without repeating completed jobs');
    $blocked=false;try{dashboardRefresh($store,$config,['operation'=>'step','token'=>$firstToken],$mock,$now+301);}catch(InvalidArgumentException $e){$blocked=true;}verify($blocked,'Previous lease token cannot advance a resumed batch');
    $state=finish($store,$config,$state,$mock,$now+301);verify($state['errors']===0,'Fixture sources succeed');
    verify($store->read(static fn($t)=>count($t['external']))===9,'All publication/source pairs refreshed');
    $before=$calls;verify(dashboardRefresh($store,$config,[],$mock,$now+302)['state']==='current'&&$calls===$before,'Later opens on the same UTC day never repeat API calls');
    $state=finish($store,$config,dashboardRefresh($store,$config,['manual'=>true],$mock,$now+303),$mock,$now+303);
    verify($state['cached']===9&&$calls===$before,'Manual button works on the same day and preserves hourly source caching');
    $lock=fopen($dir.'/dashboard-refresh.lock','c');flock($lock,LOCK_EX);verify(dashboardRefresh($store,$config,['manual'=>true],$mock,$now+304)['state']==='busy','Real batch lock prevents overlapping steps');flock($lock,LOCK_UN);fclose($lock);
    $store->update(static function(array &$t):void{foreach($t['external']as&$row)$row['checked']-=90000;});
    $tomorrow=$now+86400;$state=dashboardRefresh($store,$config,[],$mock,$tomorrow);verify($state['state']==='running'&&$state['day']===(new DateTimeImmutable('@'.$tomorrow))->setTimezone(new DateTimeZone('Europe/Berlin'))->format('Y-m-d'),'New Berlin day starts a fresh batch');
    $fail=static fn()=>['status'=>429,'body'=>'{}'];$state=finish($store,$config,$state,$fail,$tomorrow);
    verify($state['errors']===5,'Citation/Zenodo failures are counted; ambiguous HTTP links remain classified as unknown');
    verify($store->read(static fn($t)=>count(array_filter($t['external'],static fn($r)=>$r['payload']!==null)))===9,'Failures preserve successful cached data');
    verify($store->read(static fn($t)=>count($t['visits']))===0,'Dashboard refresh never records visits');
    $midnight=strtotime('2026-11-23T23:00:00Z');
    $store->update(static function(array &$t):void{unset($t['meta'][AnalyticsCsvStore::key(['dashboard_refresh'])]);});
    $state=dashboardRefresh($store,$config,[],$mock,$midnight-1);verify($state['day']==='2026-11-23','Berlin day before local midnight');finish($store,$config,$state,$mock,$midnight-1);
    $state=dashboardRefresh($store,$config,[],$mock,$midnight);verify($state['state']==='running'&&$state['day']==='2026-11-24','Local midnight starts the next day even before UTC midnight');
    echo "Passed: first daily open, nine bounded source jobs, Berlin midnight, shared locks, interrupted-run recovery, token rotation, manual repeat, hourly caching, failure preservation and no visitor recording.\n";
}finally{foreach(glob($dir.'/*')as$file)unlink($file);rmdir($dir);}
