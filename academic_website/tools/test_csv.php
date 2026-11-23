<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__, 2) . '/analytics-csv.php';
function verify(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$dir=sys_get_temp_dir().'/csv-test-'.bin2hex(random_bytes(8));mkdir($dir);
$store=new AnalyticsCsvStore($dir);
try {
    $values=['normal',"comma, quote\" newline\nUnicode: äß 中文",'=1+1','+SUM(A1)', '-123', '@formula', "\tvalue", "\rvalue", "'apostrophe", "''two"];
    $store->update(static function(array &$t)use($values):void{
        foreach($values as $i=>$value)AnalyticsCsvStore::put($t,'meta',['key'=>(string)$i,'value'=>$value]);
        AnalyticsCsvStore::put($t,'external',['publication'=>'paper','kind'=>'citations','payload'=>['title'=>"quote\"\nUnicode ä",'count'=>0],'checked'=>123,'success'=>null,'error'=>null]);
    });
    for($pass=0;$pass<3;$pass++){
        $store=new AnalyticsCsvStore($dir);
        verify($store->read(static fn($t)=>array_column(AnalyticsCsvStore::rows($t,'meta'),'value'))===$values,'CSV must preserve special values across process-style reloads');
        verify($store->read(static fn($t)=>AnalyticsCsvStore::rows($t,'external')[0]['payload']['count'])===0,'JSON zero survives persistence');
        $store->update(static function(array &$t):void{});
    }
    $before=file_get_contents($dir.'/analytics.csv');
    try{$store->update(static function(array &$t):void{$t['meta']=[];throw new LogicException('rollback');});}catch(LogicException $e){}
    verify(file_get_contents($dir.'/analytics.csv')===$before,'Failed transactions leave CSV unchanged');
    foreach(["invalid,header\n", $before."meta,too,few\n"] as $invalid){
        file_put_contents($dir.'/analytics.csv',$invalid);$blocked=false;
        try{$store->update(static function(array &$t):void{});}catch(RuntimeException $e){$blocked=$e->getMessage()==='CSV storage invalid';}
        verify($blocked,'Corrupt files must be rejected');verify(file_get_contents($dir.'/analytics.csv')===$invalid,'Corrupt files remain untouched');
    }
    echo "Passed: CSV special characters, formula protection round trips, Unicode, JSON counters, reloads, transaction rollback and corrupt-file preservation.\n";
} finally {foreach(glob($dir.'/*') as $f)unlink($f);rmdir($dir);}
