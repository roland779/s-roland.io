<?php
declare(strict_types=1);

require_once __DIR__ . '/analytics-csv.php';

function analyticsMode(array $config): string {
    return ($config['analytics_mode'] ?? 'aggregate') === 'detailed' ? 'detailed' : 'aggregate';
}

function analyticsStorage(array $config): AnalyticsCsvStore {
    $dir = $config['data_dir'] ?? '';
    if (!is_string($dir) || $dir === '' || (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir))) throw new RuntimeException('Storage unavailable');
    $resolved = realpath($dir);
    if ($resolved === false || !is_writable($resolved)) throw new RuntimeException('Storage unavailable');
    $public = !empty($_SERVER['DOCUMENT_ROOT']) ? (realpath($_SERVER['DOCUMENT_ROOT']) ?: __DIR__) : __DIR__;
    foreach (array_unique([$public, __DIR__]) as $root) {
        $a = strtolower(str_replace('\\', '/', $resolved)); $b = strtolower(rtrim(str_replace('\\', '/', $root), '/'));
        if ($a === $b || str_starts_with($a . '/', $b . '/')) {
            // Explicit Apache-only option for hosts that deny writes above the website.
            $protected = realpath(__DIR__ . '/analytics-private');
            $guard = $resolved . '/.htaccess';
            $apache = stripos($_SERVER['SERVER_SOFTWARE'] ?? '', 'Apache') !== false;
            if (($config['protected_storage'] ?? false) !== true || $protected !== $resolved
                || (!$apache && PHP_SAPI !== 'cli') || !is_file($guard)
                || trim((string)file_get_contents($guard)) !== 'Require all denied') {
                throw new RuntimeException('Storage must be outside document root');
            }
        }
    }
    $store = new AnalyticsCsvStore($resolved);
    $store->update(static function (array &$t): void { cleanAnalytics($t); });
    return $store;
}

function cleanAnalytics(array &$t): void {
    $now = time();
    $day = gmdate('Y-m-d', $now - 29 * 86400);
    $month = (new DateTimeImmutable('first day of this month', new DateTimeZone('UTC')))->modify('-23 months')->format('Y-m');
    $t['pageviews_daily'] = array_filter($t['pageviews_daily'], static fn($r) => $r['day'] >= $day);
    $t['monthly'] = array_filter($t['monthly'], static fn($r) => $r['month'] >= $month);
    $t['visits'] = array_filter($t['visits'], static fn($r) => $r['started'] >= $now - 30 * 86400);
    $ids = array_column($t['visits'], 'id');
    $t['events'] = array_filter($t['events'], static fn($r) => $r['created'] >= $now - 30 * 86400 && in_array($r['visit'], $ids, true));
    $key = AnalyticsCsvStore::key(['monthly_start']);
    if (!isset($t['meta'][$key])) AnalyticsCsvStore::put($t, 'meta', ['key'=>'monthly_start','value'=>(string)$now]);
}

function incrementMonth(array &$t, string $kind, string $pub = '', string $target = '', string $source = '', ?int $when = null): void {
    $month = gmdate('Y-m', $when ?? time());
    $key = AnalyticsCsvStore::key([$month,$kind,$pub,$target,$source]);
    $count = (int)($t['monthly'][$key]['count'] ?? 0) + 1;
    AnalyticsCsvStore::put($t,'monthly',compact('month','kind','target','source','count')+['publication'=>$pub]);
}

function recordPageview(AnalyticsCsvStore $store): void {
    $store->update(static function(array &$t): void {
        $day = gmdate('Y-m-d'); $key = AnalyticsCsvStore::key([$day]);
        AnalyticsCsvStore::put($t,'pageviews_daily',['day'=>$day,'count'=>(int)($t['pageviews_daily'][$key]['count']??0)+1]);
        incrementMonth($t,'pageview');
        $key = AnalyticsCsvStore::key(['aggregate_start']);
        if (!isset($t['meta'][$key])) AnalyticsCsvStore::put($t,'meta',['key'=>'aggregate_start','value'=>(string)time()]);
    });
}

function publications(): array {
    $file = __DIR__ . '/academic_website/data/publications.json';
    if (!is_readable($file)) throw new RuntimeException('Publication data unavailable');
    $data = json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($data) || !is_array($data['publications'] ?? null)) throw new RuntimeException('Publication data unavailable');
    $result = [];
    foreach ($data['publications'] as $p) if (!empty($p['citationKey'])) $result[$p['citationKey']] = $p;
    return $result;
}

function recordVisit(AnalyticsCsvStore $store, array $config, array $input): array {
    return $store->update(static function(array &$t) use ($config,$input): array {
        $now = microtime(true);
        if (array_key_exists('id',$input)) {
            if (!is_string($input['id']) || !preg_match('/^[a-f0-9]{64}$/',$input['id']) || !is_numeric($input['seconds']??null)) return [400,[]];
            $key=AnalyticsCsvStore::key([$input['id']]);
            if (!isset($t['visits'][$key])) return [404,[]];
            $row=$t['visits'][$key];
            $row['seconds']+=max(0,min(20,(float)$input['seconds'],$now-$row['updated']));$row['updated']=$now;
            AnalyticsCsvStore::put($t,'visits',$row);return [200,['ok'=>true]];
        }
        if (!is_string($input['path']??null)) return [400,[]];
        $path=parse_url($input['path'],PHP_URL_PATH);
        if (!in_array($path,['/','/index.html','/index.php'],true)) return [400,[]];
        $address=$_SERVER['REMOTE_ADDR']??'';$packed=@inet_pton($address);
        if($packed===false)return [400,[]];
        $ip=$address;
        if(empty($config['full_ip'])){$keep=strlen($packed)===4?3:6;$ip=inet_ntop(substr($packed,0,$keep).str_repeat("\0",strlen($packed)-$keep)).(strlen($packed)===4?'/24':'/48');}
        $peer=hash_hmac('sha256',$address,$config['password_hash']);
        $recent=array_filter($t['visits'],static fn($r)=>$r['peer']===$peer&&$r['started']>$now-60);
        if(count($recent)>=20)return [429,[]];
        $ref=parse_url(is_string($input['referrer']??null)?substr($input['referrer'],0,1000):'');
        $referrer=in_array($ref['scheme']??'',['http','https'],true)?($ref['host']??''):'';
        $id=bin2hex(random_bytes(32));
        AnalyticsCsvStore::put($t,'visits',['id'=>$id,'started'=>$now,'updated'=>$now,'path'=>$path,'referrer'=>$referrer,'ip'=>$ip,'browser'=>substr($_SERVER['HTTP_USER_AGENT']??'',0,300),'seconds'=>0,'peer'=>$peer]);
        incrementMonth($t,'visit','','',$referrer);return [200,['id'=>$id]];
    });
}

function recordEvent(AnalyticsCsvStore $store, array $input): int {
    return $store->update(static function(array &$t) use($input): int {
        if(!is_string($input['id']??null)||strlen($input['id'])>100)return 400;
        $visit=$t['visits'][AnalyticsCsvStore::key([$input['id']])]??null;if(!$visit)return 404;
        $kind=$input['kind']??'';$pub=$input['publication']??'';$target=$input['target']??'';
        if(!is_string($kind)||!is_string($pub)||!is_string($target))return 400;
        if($kind==='click'){$pubs=publications();if(!isset($pubs[$pub])||!in_array($target,array_merge(array_keys($pubs[$pub]['links']??[]),['bibtex-copy','bibtex-download']),true))return 400;}
        elseif($kind==='section'){if($pub!==''||!in_array($target,['short-bio','about','research','publications','service','news','contact'],true))return 400;}
        elseif($kind==='depth'){if($pub!==''||!in_array($target,['25','50','75','100'],true))return 400;}
        elseif($kind==='error'){if($pub!==''||!in_array($target,['publications','i18n'],true))return 400;}
        else return 400;
        $events=array_filter($t['events'],static fn($r)=>$r['visit']===$input['id']);if(count($events)>=500)return 429;
        if($kind!=='click')foreach($events as $r)if($r['kind']===$kind&&$r['target']===$target)return 200;
        AnalyticsCsvStore::put($t,'events',['event_id'=>bin2hex(random_bytes(16)),'visit'=>$input['id'],'created'=>microtime(true),'kind'=>$kind,'publication'=>$pub,'target'=>$target,'source'=>$visit['referrer']]);
        incrementMonth($t,$kind,$pub,$target,$visit['referrer']);return 200;
    });
}

function analyticsStats(AnalyticsCsvStore $store, array $config): array {
    $pubs=array_values(publications());
    return $store->read(static function(array $t)use($config,$pubs):array{
        $mode=analyticsMode($config);$visits=AnalyticsCsvStore::rows($t,'visits');usort($visits,static fn($a,$b)=>$b['started']<=>$a['started']);
        $monthly=AnalyticsCsvStore::rows($t,'monthly');usort($monthly,static fn($a,$b)=>strcmp($a['month'],$b['month']));
        $snapshots=AnalyticsCsvStore::rows($t,'citation_snapshots');usort($snapshots,static fn($a,$b)=>strcmp($a['day'],$b['day']));
        $daily=AnalyticsCsvStore::rows($t,'pageviews_daily');usort($daily,static fn($a,$b)=>strcmp($a['day'],$b['day']));
        $engagement=[];$reading=[];$conversion=[];$engaged=[];
        foreach($visits as $v){$s=$v['referrer'];if(!isset($conversion[$s]))$conversion[$s]=['source'=>$s,'visits'=>0,'engaged'=>0,'clicks'=>0];$conversion[$s]['visits']++;}
        foreach($t['events'] as $e){
            if($e['kind']==='click'){$key=AnalyticsCsvStore::key([$e['publication'],$e['target']]);if(!isset($engagement[$key]))$engagement[$key]=['publication'=>$e['publication'],'target'=>$e['target'],'clicks'=>0];$engagement[$key]['clicks']++;$s=$e['source'];if(isset($conversion[$s])){$conversion[$s]['clicks']++;$engaged[$s][$e['visit']]=true;}}
            else{$key=AnalyticsCsvStore::key([$e['kind'],$e['target']]);if(!isset($reading[$key]))$reading[$key]=['kind'=>$e['kind'],'target'=>$e['target'],'visits'=>0];$reading[$key]['visits']++;}
        }
        foreach($conversion as $s=>&$r)$r['engaged']=count($engaged[$s]??[]);unset($r);
        $sum=array_sum(array_column($visits,'seconds'));
        $startKey=AnalyticsCsvStore::key([$mode==='aggregate'?'aggregate_start':'monthly_start']);
        return ['mode'=>$mode,'visits'=>$mode==='aggregate'?[]:array_slice($visits,0,1000),'totals'=>['visits'=>$mode==='aggregate'?array_sum(array_column($daily,'count')):count($visits),'average'=>$mode==='aggregate'?null:(count($visits)?$sum/count($visits):0),'total'=>$mode==='aggregate'?null:$sum],
            'retentionDays'=>30,'fullIp'=>$mode==='detailed'&&!empty($config['full_ip']),'publications'=>$pubs,'monthly'=>$mode==='aggregate'?array_values(array_filter($monthly,static fn($r)=>$r['kind']==='pageview')):$monthly,
            'trackingStarted'=>(int)($t['meta'][$startKey]['value']??time()),'daily'=>$daily,'external'=>AnalyticsCsvStore::rows($t,'external'),'snapshots'=>$snapshots,
            'engagement'=>$mode==='aggregate'?[]:array_values($engagement),'reading'=>$mode==='aggregate'?[]:array_values($reading),'conversion'=>$mode==='aggregate'?[]:array_values($conversion)];
    });
}

function resolveRedirect(string $base, string $location): string {
    if ($location === '' || preg_match('/[\x00-\x20\x7f]/', $location)) throw new RuntimeException('Ungültige Weiterleitung');
    if (str_starts_with($location, '//')) return 'https:' . $location;
    $next = parse_url($location);
    if ($next === false) throw new RuntimeException('Ungültige Weiterleitung');
    if (isset($next['scheme'])) {
        if (strtolower($next['scheme']) !== 'https') throw new RuntimeException('Unsichere Weiterleitung');
        return $location;
    }
    $parts = parse_url($base);
    $origin = 'https://' . $parts['host'];
    $path = $parts['path'] ?? '/';
    if (str_starts_with($location, '/')) return $origin . $location;
    if (str_starts_with($location, '?')) return $origin . $path . $location;
    if (str_starts_with($location, '#')) return $origin . $path . (isset($parts['query']) ? '?' . $parts['query'] : '') . $location;
    return $origin . rtrim(dirname($path), '/') . '/' . $location;
}

// Resolve and pin public IPv4 addresses, validate every redirect, never forward credentials.
function publicRequest(string $url, bool $head = false, array $headers = []): array {
    if (!function_exists('curl_init')) throw new RuntimeException('PHP-cURL fehlt');
    $deadline = microtime(true) + 6;
    for ($redirect = 0; $redirect < 5; $redirect++) {
        $parts = parse_url($url);
        if (($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || (isset($parts['port']) && $parts['port'] !== 443)) throw new RuntimeException('Unsicheres Linkziel');
        $host = $parts['host'];
        $ips = gethostbynamel($host) ?: [];
        if (!$ips) throw new RuntimeException('DNS nicht erreichbar');
        foreach ($ips as $ip) if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) throw new RuntimeException('Privates Linkziel gesperrt');
        $remaining = (int)(($deadline - microtime(true)) * 1000);
        if ($remaining <= 0) throw new RuntimeException('Zeitlimit für Linkabruf überschritten');
        $body = ''; $location = ''; $large = false;
        $curl = curl_init($url);
        curl_setopt_array($curl, [CURLOPT_CONNECTTIMEOUT_MS => min(3000, $remaining), CURLOPT_TIMEOUT_MS => $remaining, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_PROXY => '', CURLOPT_RESOLVE => [$host . ':443:' . $ips[0]],
            CURLOPT_NOBODY => $head, CURLOPT_USERAGENT => 'AcademicProfileMetrics/1.0', CURLOPT_HTTPHEADER => $headers,
            CURLOPT_WRITEFUNCTION => static function ($ch, $chunk) use (&$body, &$large) { if (strlen($body) + strlen($chunk) > 4000000) { $large = true; return 0; } $body .= $chunk; return strlen($chunk); },
            CURLOPT_HEADERFUNCTION => static function ($ch, $line) use (&$location) { if (stripos($line, 'Location:') === 0) $location = trim(substr($line, 9)); return strlen($line); },
        ]);
        $ok = curl_exec($curl); $code = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE); curl_close($curl);
        if ($ok === false) throw new RuntimeException($large ? 'Antwort zu groß' : 'Verbindung fehlgeschlagen (TLS/Netzwerk/Timeout)');
        if ($code >= 300 && $code < 400 && $location !== '') {
            $headers = [];
            $url = resolveRedirect($url, $location);
            continue;
        }
        return ['status' => $code, 'body' => $body];
    }
    throw new RuntimeException('Zu viele Weiterleitungen');
}

function fetchJson(string $url, array $headers = [], ?callable $request = null): array {
    $r = ($request ?? 'publicRequest')($url, false, $headers);
    if ($r['status'] !== 200) throw new RuntimeException('API HTTP ' . $r['status']);
    $data = json_decode($r['body'], true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($data)) throw new RuntimeException('Ungültige API-Antwort');
    return $data;
}

function metricCount(mixed $value): int {
    $count = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
    if ($count === false || is_bool($value)) throw new RuntimeException('Ungültiger Zählerstand der Datenquelle');
    return $count;
}

function fetchCitations(array $pub, array $config, ?callable $request = null): array {
    $headers = empty($config['openalex_api_key']) ? [] : ['Authorization: Bearer ' . $config['openalex_api_key']];
    $doi = preg_replace('~^https://doi.org/~i', '', $pub['links']['doi'] ?? '');
    if (!$doi) throw new RuntimeException('Keine DOI hinterlegt');
    $work = fetchJson('https://api.openalex.org/works/doi:' . rawurlencode($doi), $headers, $request);
    if (!isset($work['id'], $work['cited_by_count']) || !is_numeric($work['cited_by_count']) || strcasecmp(preg_replace('~^https?://doi.org/~i', '', $work['doi'] ?? ''), $doi) !== 0) throw new RuntimeException('OpenAlex-Werk nicht eindeutig zugeordnet');
    if (!is_string($work['id']) || !preg_match('~^https://openalex\.org/(W\d+)$~', $work['id'], $match)) throw new RuntimeException('Ungültige OpenAlex-ID');
    $workId = $match[1];
    $count = metricCount($work['cited_by_count']);
    $items = []; $total = 0;
    for ($page = 1; $page <= 10; $page++) {
        $url = 'https://api.openalex.org/works?' . http_build_query(['filter' => 'cites:' . $workId, 'per_page' => 100, 'page' => $page, 'select' => 'id,title,publication_year,doi', 'sort' => 'publication_date:desc']);
        $data = fetchJson($url, $headers, $request);
        if (!isset($data['results'], $data['meta']['count']) || !is_array($data['results'])) throw new RuntimeException('Ungültige Zitationsliste');
        $total = metricCount($data['meta']['count']);
        foreach ($data['results'] as $item) {
            if (!is_array($item) || !is_string($item['id'] ?? null) || !preg_match('~^https://openalex\.org/W\d+$~', $item['id'])) throw new RuntimeException('Ungültige zitierende Arbeit');
            $title = is_string($item['title'] ?? null) && trim($item['title']) !== '' ? $item['title'] : 'Titel nicht verfügbar';
            $year = is_int($item['publication_year'] ?? null) ? $item['publication_year'] : null;
            $doi = is_string($item['doi'] ?? null) && preg_match('~^https?://doi\.org/~i', $item['doi']) ? $item['doi'] : null;
            $items[$item['id']] = ['title' => $title, 'year' => $year, 'doi' => $doi, 'url' => $item['id']];
        }
        if ($page * 100 >= $total || !$data['results']) break;
    }
    return ['source' => 'OpenAlex', 'url' => $work['id'], 'count' => $count, 'citing' => array_values($items), 'listedTotal' => $total, 'partial' => count($items) < $total];
}

function fetchZenodo(array $pub, ?callable $request = null): array {
    $url = $pub['links']['zenodo'] ?? '';
    if (!preg_match('~(?:zenodo\.|zenodo.org/(?:records?|record)/)(\d+)~', $url, $match)) throw new RuntimeException('Kein Zenodo-Paket hinterlegt');
    $record = fetchJson('https://zenodo.org/api/records/' . $match[1], [], $request);
    $stats = $record['stats'] ?? [];
    // Zenodo serves both legacy and current record stats formats.
    $views = $stats['views'] ?? $stats['this_version']['views'] ?? null;
    $downloads = $stats['downloads'] ?? $stats['this_version']['downloads'] ?? null;
    if (!is_numeric($views) || !is_numeric($downloads)) throw new RuntimeException('Zenodo liefert keine Nutzungszahlen');
    return ['source' => 'Zenodo', 'url' => 'https://zenodo.org/records/' . $match[1], 'views' => metricCount($views), 'downloads' => metricCount($downloads), 'scope' => 'Diese Version; kumulierte Werte bei Zenodo'];
}

function checkPublicationLinks(array $pub, ?callable $request = null): array {
    $links = [];
    foreach ($pub['links'] ?? [] as $name => $url) {
        try {
            $r = ($request ?? 'publicRequest')($url, true, []);
            if (in_array($r['status'], [405,501], true)) $r = ($request ?? 'publicRequest')($url, false, []);
            $code = $r['status'];
            $state = in_array($code, [404,410], true) ? 'defekt' : (($code >= 200 && $code < 300) ? 'erreichbar' : 'unklar');
            $links[] = ['name' => $name, 'url' => $url, 'status' => $code, 'state' => $state];
        } catch (Throwable $e) { $links[] = ['name' => $name, 'url' => $url, 'status' => null, 'state' => 'unklar', 'error' => $e->getMessage()]; }
    }
    return ['source' => 'HTTP-Linkprüfung', 'links' => $links];
}

function refreshResearch(AnalyticsCsvStore $store, array $config, string $pubId, string $kind, ?callable $request = null, bool $force = false): array {
    $pubs=publications();
    if(!isset($pubs[$pubId])||!in_array($kind,['citations','zenodo','links'],true))throw new InvalidArgumentException('Unbekannte Publikation oder Datenquelle');
    $lock=@fopen($store->directory().'/source-'.hash('sha256',$pubId.':'.$kind).'.lock','c');
    if(!$lock)throw new RuntimeException('Storage unavailable');
    if(!flock($lock,LOCK_EX|LOCK_NB)){fclose($lock);return ['busy'=>true];}
    try {
        $key=AnalyticsCsvStore::key([$pubId,$kind]);
        $previous=$store->read(static fn($t)=>$t['external'][$key]??null);
        if(!$force&&!empty($previous['checked'])&&time()-$previous['checked']<3600)return ['cached'=>true];
        try {
            $payload=$kind==='citations'?fetchCitations($pubs[$pubId],$config,$request):($kind==='zenodo'?fetchZenodo($pubs[$pubId],$request):checkPublicationLinks($pubs[$pubId],$request));
            $now=time();
            $store->update(static function(array &$t)use($pubId,$kind,$payload,$now):void{
                AnalyticsCsvStore::put($t,'external',['publication'=>$pubId,'kind'=>$kind,'payload'=>$payload,'checked'=>$now,'success'=>$now,'error'=>null]);
                if($kind==='citations')AnalyticsCsvStore::put($t,'citation_snapshots',['publication'=>$pubId,'day'=>gmdate('Y-m-d',$now),'count'=>$payload['count']]);
            });
            return ['ok'=>true];
        } catch(Throwable $e) {
            $store->update(static function(array &$t)use($pubId,$kind,$key,$e):void{
                $row=$t['external'][$key]??['publication'=>$pubId,'kind'=>$kind,'payload'=>null,'success'=>null];
                $row['checked']=time();$row['error']=$e->getMessage();AnalyticsCsvStore::put($t,'external',$row);
            });
            return ['ok'=>false,'error'=>$e->getMessage()];
        }
    } finally {flock($lock,LOCK_UN);fclose($lock);}
}

// One short HTTP request per source. State survives closed tabs and is shared by all admins.
function dashboardRefresh(AnalyticsCsvStore $store, array $config, array $input, ?callable $request = null, ?int $now = null): array {
    $now=$now??time();$day=(new DateTimeImmutable('@'.$now))->setTimezone(new DateTimeZone('Europe/Berlin'))->format('Y-m-d');
    $operation=$input['operation']??'start';
    if(!in_array($operation,['start','step'],true)||($operation==='start'&&isset($input['manual'])&&!is_bool($input['manual'])))throw new InvalidArgumentException('Ungültige Aktualisierungsanfrage');
    $lock=@fopen($store->directory().'/dashboard-refresh.lock','c');if(!$lock)throw new RuntimeException('Storage unavailable');
    if(!flock($lock,LOCK_EX|LOCK_NB)){fclose($lock);return ['state'=>'busy'];}
    try {
        $key=AnalyticsCsvStore::key(['dashboard_refresh']);
        $state=$store->read(static fn($t)=>isset($t['meta'][$key])?json_decode($t['meta'][$key]['value'],true,512,JSON_THROW_ON_ERROR):null);
        if($operation==='start'){
            if(!empty($state['remaining'])&&$now-(int)$state['updated']<300)return ['state'=>'busy'];
            if(empty($input['manual'])&&($state['day']??null)===$day&&!empty($state['completed']))return ['state'=>'current','day'=>$day,'completed'=>$state['completed']];
            if(($state['day']??null)!==$day||empty($state['remaining'])){
                $jobs=[];foreach(publications()as$id=>$pub)foreach(['citations',...(!empty($pub['links']['zenodo'])?['zenodo']:[]),'links']as$kind)$jobs[]=['publication'=>$id,'kind'=>$kind];
                $state=['day'=>$day,'remaining'=>$jobs,'total'=>count($jobs),'errors'=>0,'cached'=>0,'completed'=>null];
            }
            $state['token']=bin2hex(random_bytes(24));$state['updated']=$now;
        } else {
            if(!is_string($input['token']??null)||!is_array($state)||!hash_equals($state['token']??'',$input['token'])||$input['token']==='')throw new InvalidArgumentException('Aktualisierung abgelaufen. Dashboard erneut öffnen.');
            if(!empty($state['completed']))return ['state'=>'complete','day'=>$state['day'],'errors'=>$state['errors'],'cached'=>$state['cached'],'total'=>$state['total']];
            $job=$state['remaining'][0]??null;
            if($job){
                $result=refreshResearch($store,$config,$job['publication'],$job['kind'],$request);
                if(!empty($result['busy']))return ['state'=>'busy'];
                array_shift($state['remaining']);
                if(!empty($result['cached']))$state['cached']++;
                elseif(empty($result['ok']))$state['errors']++;
            }
            $state['updated']=$now;
        }
        if(!$state['remaining'])$state['completed']=$now;
        $store->update(static function(array &$t)use($state):void{AnalyticsCsvStore::put($t,'meta',['key'=>'dashboard_refresh','value'=>json_encode($state,JSON_THROW_ON_ERROR)]);});
        return ['state'=>$state['completed']?'complete':'running','token'=>$state['token'],'day'=>$state['day'],'done'=>$state['total']-count($state['remaining']),'total'=>$state['total'],'errors'=>$state['errors'],'cached'=>$state['cached']];
    } finally {flock($lock,LOCK_UN);fclose($lock);}
}

function maintenanceStep(AnalyticsCsvStore $store, array $config, ?callable $request = null, ?int $now = null): array {
    if(($config['automatic_refresh']??true)===false)return ['state'=>'disabled'];
    $now=$now??time();
    $lock=@fopen($store->directory().'/sync.lock','c');if(!$lock)throw new RuntimeException('Storage unavailable');
    if(!flock($lock,LOCK_EX|LOCK_NB)){fclose($lock);return ['state'=>'busy'];}
    try {
        $pubs=publications();
        $job=$store->update(static function(array &$t)use($pubs,$now):array{
            $key=AnalyticsCsvStore::key(['maintenance_attempt']);$last=(int)($t['meta'][$key]['value']??0);
            if($last&&$now-$last<60)return ['state'=>'throttled'];
            $jobs=[];
            foreach(['citations','zenodo','links']as$kind)foreach($pubs as$id=>$pub){
                if($kind==='zenodo'&&empty($pub['links']['zenodo']))continue;
                $row=$t['external'][AnalyticsCsvStore::key([$id,$kind])]??null;
                $interval=!empty($row['error'])?3600:($kind==='links'?7*86400:86400);
                if(!$row||$now-(int)$row['checked']>=$interval)$jobs[]=['publication'=>$id,'kind'=>$kind,'checked'=>(int)($row['checked']??0),'order'=>count($jobs)];
            }
            AnalyticsCsvStore::put($t,'meta',['key'=>'maintenance_attempt','value'=>(string)$now]);
            if(!$jobs)return ['state'=>'current'];
            usort($jobs,static fn($a,$b)=>($a['checked']<=>$b['checked'])?:($a['order']<=>$b['order']));return $jobs[0];
        });
        if(isset($job['state']))return $job;
        refreshResearch($store,$config,$job['publication'],$job['kind'],$request);return ['state'=>'processed'];
    } finally {flock($lock,LOCK_UN);fclose($lock);}
}
