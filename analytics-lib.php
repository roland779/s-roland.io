<?php
declare(strict_types=1);

function analyticsDatabase(array $config): PDO {
    $dir = $config['data_dir'] ?? '';
    if (!$dir || (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir))) throw new RuntimeException('Storage unavailable');
    $resolved = realpath($dir);
    $public = !empty($_SERVER['DOCUMENT_ROOT']) ? (realpath($_SERVER['DOCUMENT_ROOT']) ?: __DIR__) : __DIR__;
    // Also protect CLI executions and deployments whose document root contains this checkout.
    foreach (array_unique([$public, __DIR__]) as $root) {
        $a = strtolower(str_replace('\\', '/', $resolved));
        $b = strtolower(rtrim(str_replace('\\', '/', $root), '/'));
        if ($a === $b || str_starts_with($a . '/', $b . '/')) throw new RuntimeException('Storage must be outside document root');
    }
    $db = new PDO('sqlite:' . $resolved . '/visits.sqlite3', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA busy_timeout = 5000');
    $db->exec('CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, started REAL, updated REAL, path TEXT, referrer TEXT, ip TEXT, browser TEXT, seconds REAL, peer TEXT)');
    $db->exec('CREATE INDEX IF NOT EXISTS visits_peer_time ON visits(peer, started)');
    analyticsSchema($db);
    $q = $db->prepare('DELETE FROM visits WHERE started < ?'); $q->execute([time() - 30 * 86400]);
    $db->exec('DELETE FROM events WHERE visit NOT IN (SELECT id FROM visits)');
    return $db;
}

function publications(): array {
    $data = json_decode(file_get_contents(__DIR__ . '/academic_website/data/publications.json'), true, 512, JSON_THROW_ON_ERROR);
    $result = [];
    foreach ($data['publications'] as $p) {
        if (!empty($p['citationKey'])) $result[$p['citationKey']] = $p;
    }
    return $result;
}

function analyticsSchema(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS events (visit TEXT, created REAL, kind TEXT, publication TEXT, target TEXT, source TEXT)');
    $db->exec('CREATE INDEX IF NOT EXISTS events_visit ON events(visit, kind, target)');
    $db->exec('CREATE TABLE IF NOT EXISTS monthly (month TEXT, kind TEXT, publication TEXT, target TEXT, source TEXT, count INTEGER, PRIMARY KEY(month,kind,publication,target,source))');
    $db->exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    $db->exec('CREATE TABLE IF NOT EXISTS external (publication TEXT, kind TEXT, payload TEXT, checked REAL, success REAL, error TEXT, PRIMARY KEY(publication,kind))');
    $db->exec('CREATE TABLE IF NOT EXISTS citation_snapshots (publication TEXT, day TEXT, count INTEGER, PRIMARY KEY(publication,day))');
    // Reserve the writer before reading the migration marker. Deferred transactions
    // can otherwise deadlock when two first requests both try to upgrade their read lock.
    $db->exec('BEGIN IMMEDIATE');
    try {
        if (!$db->query("SELECT value FROM meta WHERE key='monthly_start'")->fetchColumn()) {
            $db->exec("INSERT OR IGNORE INTO monthly SELECT strftime('%Y-%m',started,'unixepoch'), 'visit','','',referrer,COUNT(*) FROM visits GROUP BY 1,5");
            $q = $db->prepare("INSERT INTO meta VALUES ('monthly_start',?)"); $q->execute([(string)time()]);
        }
        $db->exec('COMMIT');
    } catch (Throwable $e) { $db->exec('ROLLBACK'); throw $e; }
    $q = $db->prepare('DELETE FROM events WHERE created < ?'); $q->execute([time() - 30 * 86400]);
    $db->exec("DELETE FROM monthly WHERE month < strftime('%Y-%m','now','start of month','-23 months')");
}

function incrementMonth(PDO $db, string $kind, string $pub = '', string $target = '', string $source = '', ?int $when = null): void {
    $q = $db->prepare('INSERT INTO monthly VALUES (?,?,?,?,?,1) ON CONFLICT(month,kind,publication,target,source) DO UPDATE SET count=count+1');
    $q->execute([gmdate('Y-m', $when ?? time()), $kind, $pub, $target, $source]);
}

function recordEvent(PDO $db, array $input, float $now): int {
    if (!is_string($input['id'] ?? null) || strlen($input['id']) > 100) return 400;
    $q = $db->prepare('SELECT referrer FROM visits WHERE id = ?'); $q->execute([$input['id']]);
    $visit = $q->fetch();
    if (!$visit) return 404;
    $kind = $input['kind'] ?? '';
    $pub = $input['publication'] ?? '';
    $target = $input['target'] ?? '';
    if (!is_string($kind) || !is_string($pub) || !is_string($target)) return 400;
    if ($kind === 'click') {
        $pubs = publications();
        if (!isset($pubs[$pub]) || !in_array($target, array_merge(array_keys($pubs[$pub]['links'] ?? []), ['bibtex-copy', 'bibtex-download']), true)) return 400;
    } elseif ($kind === 'section') {
        if ($pub !== '' || !in_array($target, ['short-bio','about','research','publications','service','news','contact'], true)) return 400;
    } elseif ($kind === 'depth') {
        if ($pub !== '' || !in_array($target, ['25','50','75','100'], true)) return 400;
    } elseif ($kind === 'error') {
        if ($pub !== '' || !in_array($target, ['publications','i18n'], true)) return 400;
    } else return 400;
    $q = $db->prepare('SELECT COUNT(*) FROM events WHERE visit=?'); $q->execute([$input['id']]);
    if ((int)$q->fetchColumn() >= 500) return 429;
    if ($kind !== 'click') {
        $q = $db->prepare('SELECT 1 FROM events WHERE visit=? AND kind=? AND target=?'); $q->execute([$input['id'], $kind, $target]);
        if ($q->fetchColumn()) return 200;
    }
    $q = $db->prepare('INSERT INTO events VALUES (?,?,?,?,?,?)');
    $q->execute([$input['id'], $now, $kind, $pub, $target, $visit['referrer']]);
    incrementMonth($db, $kind, $pub, $target, $visit['referrer']);
    return 200;
}

function researchStats(PDO $db): array {
    $external = $db->query('SELECT * FROM external')->fetchAll();
    foreach ($external as &$row) $row['payload'] = $row['payload'] ? json_decode($row['payload'], true) : null;
    return [
        'publications' => array_values(publications()),
        'monthly' => $db->query('SELECT * FROM monthly ORDER BY month')->fetchAll(),
        'trackingStarted' => (int)$db->query("SELECT value FROM meta WHERE key='monthly_start'")->fetchColumn(),
        'external' => $external,
        'snapshots' => $db->query('SELECT * FROM citation_snapshots ORDER BY day')->fetchAll(),
        'engagement' => $db->query("SELECT publication,target,COUNT(*) clicks FROM events WHERE kind='click' GROUP BY publication,target ORDER BY clicks DESC")->fetchAll(),
        'conversion' => $db->query("SELECT v.referrer source,COUNT(DISTINCT v.id) visits,COUNT(DISTINCT e.visit) engaged,COUNT(e.visit) clicks FROM visits v LEFT JOIN events e ON e.visit=v.id AND e.kind='click' GROUP BY v.referrer ORDER BY clicks DESC")->fetchAll(),
        'reading' => $db->query("SELECT kind,target,COUNT(*) visits FROM events WHERE kind IN ('section','depth','error') GROUP BY kind,target")->fetchAll(),
    ];
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

function refreshResearch(PDO $db, array $config, string $pubId, string $kind, ?callable $request = null, bool $force = false): array {
    $pubs = publications();
    if (!isset($pubs[$pubId]) || !in_array($kind, ['citations','zenodo','links'], true)) throw new InvalidArgumentException('Unbekannte Publikation oder Datenquelle');
    $lock = null;
    if (!empty($config['data_dir'])) {
        $lock = fopen($config['data_dir'] . '/source-' . hash('sha256', $pubId . ':' . $kind) . '.lock', 'c');
        if (!$lock) throw new RuntimeException('Source lock unavailable');
        if (!flock($lock, LOCK_EX | LOCK_NB)) { fclose($lock); return ['busy' => true]; }
    }
    try { return refreshResearchUnlocked($db, $config, $pubId, $kind, $request, $force); }
    finally { if ($lock) { flock($lock, LOCK_UN); fclose($lock); } }
}

function refreshResearchUnlocked(PDO $db, array $config, string $pubId, string $kind, ?callable $request, bool $force): array {
    $pubs = publications();
    $q = $db->prepare('SELECT checked FROM external WHERE publication=? AND kind=?'); $q->execute([$pubId,$kind]);
    $last = $q->fetchColumn();
    if (!$force && $last && time() - (float)$last < 3600) return ['cached' => true];
    try {
        $payload = $kind === 'citations' ? fetchCitations($pubs[$pubId], $config, $request) : ($kind === 'zenodo' ? fetchZenodo($pubs[$pubId], $request) : checkPublicationLinks($pubs[$pubId], $request));
        $now = time();
        $db->beginTransaction();
        $q = $db->prepare('INSERT INTO external VALUES (?,?,?,?,?,NULL) ON CONFLICT(publication,kind) DO UPDATE SET payload=excluded.payload,checked=excluded.checked,success=excluded.success,error=NULL');
        $q->execute([$pubId,$kind,json_encode($payload, JSON_THROW_ON_ERROR),$now,$now]);
        if ($kind === 'citations') {
            $q = $db->prepare('INSERT INTO citation_snapshots VALUES (?,?,?) ON CONFLICT(publication,day) DO UPDATE SET count=excluded.count');
            $q->execute([$pubId,gmdate('Y-m-d'),$payload['count']]);
        }
        $db->commit(); return ['ok' => true];
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        $q = $db->prepare('INSERT INTO external VALUES (?,?,NULL,?,NULL,?) ON CONFLICT(publication,kind) DO UPDATE SET checked=excluded.checked,error=excluded.error');
        $q->execute([$pubId,$kind,time(),$e->getMessage()]);
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

// Opportunistic maintenance: fixed jobs only, no visitor data and no client-selected targets.
function maintenanceStep(PDO $db, array $config, ?callable $request = null, ?int $now = null): array {
    if (($config['automatic_refresh'] ?? true) === false) return ['state' => 'disabled'];
    $now = $now ?? time();
    $lock = fopen($config['data_dir'] . '/sync.lock', 'c');
    if (!$lock) throw new RuntimeException('Maintenance lock unavailable');
    if (!flock($lock, LOCK_EX | LOCK_NB)) { fclose($lock); return ['state' => 'busy']; }
    try {
        $last = (int)$db->query("SELECT value FROM meta WHERE key='maintenance_attempt'")->fetchColumn();
        if ($last && $now - $last < 60) return ['state' => 'throttled'];
        $stored = [];
        foreach ($db->query('SELECT publication,kind,checked,error FROM external')->fetchAll() as $row) $stored[$row['publication'] . ':' . $row['kind']] = $row;
        $jobs = [];
        foreach (['citations','zenodo','links'] as $kind) foreach (publications() as $id => $pub) {
            if ($kind === 'zenodo' && empty($pub['links']['zenodo'])) continue;
            $row = $stored[$id . ':' . $kind] ?? null;
            $interval = !empty($row['error']) ? 3600 : ($kind === 'links' ? 7 * 86400 : 86400);
            if (!$row || $now - (int)$row['checked'] >= $interval) $jobs[] = ['publication' => $id, 'kind' => $kind, 'checked' => (int)($row['checked'] ?? 0), 'order' => count($jobs)];
        }
        $q = $db->prepare("INSERT INTO meta VALUES ('maintenance_attempt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"); $q->execute([(string)$now]);
        if (!$jobs) return ['state' => 'current'];
        usort($jobs, static fn($a, $b) => ($a['checked'] <=> $b['checked']) ?: ($a['order'] <=> $b['order']));
        $job = $jobs[0];
        refreshResearch($db, $config, $job['publication'], $job['kind'], $request);
        // Anonymous callers receive no private research/cache diagnostics.
        return ['state' => 'processed'];
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
