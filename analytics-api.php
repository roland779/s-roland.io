<?php
declare(strict_types=1);
require_once __DIR__ . '/analytics-lib.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
function respond(int $status, array $data): void {
    http_response_code($status);
    echo json_encode($data, JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
function analyticsConfig(): array {
    $file = __DIR__ . '/analytics-config.php';
    if (!is_file($file)) respond(503, ['error' => 'Analytics not configured']);
    $config = require $file;
    if (!is_array($config) || empty($config['password_hash'])) respond(503, ['error' => 'Admin password not configured']);
    return $config;
}
function requireAdmin(array $config): void {
    if (($_SERVER['PHP_AUTH_USER'] ?? '') !== 'admin' || !password_verify($_SERVER['PHP_AUTH_PW'] ?? '', $config['password_hash'])) {
        header('WWW-Authenticate: Basic realm="Besucherstatistik", charset="UTF-8"');
        respond(401, ['error' => 'Authentication required']);
    }
}
if (defined('ANALYTICS_ADMIN_PAGE')) return;
try {
    $config = analyticsConfig();
    $action = $_GET['action'] ?? '';
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $mode = analyticsMode($config);
    if ($action === 'config' && $method === 'GET') respond(200, ['enabled' => $mode === 'detailed', 'mode' => $mode, 'fullIp' => $mode === 'detailed' && !empty($config['full_ip'])]);
    if (($action === 'stats' && $method === 'GET') || ($action === 'refresh' && $method === 'POST')) requireAdmin($config);
    elseif (!in_array($action, ['visit','event','maintenance'], true) || $method !== 'POST') respond(404, []);
    if ($mode !== 'detailed' && in_array($action, ['visit','event'], true)) respond(410, ['error' => 'Individual tracking disabled']);
    if ($method === 'POST') {
        $origin = parse_url($_SERVER['HTTP_ORIGIN'] ?? '');
        $authority = ($origin['host'] ?? '') . (isset($origin['port']) ? ':' . $origin['port'] : '');
        if (!in_array($origin['scheme'] ?? '', ['http', 'https'], true) || strcasecmp($authority, $_SERVER['HTTP_HOST'] ?? '') !== 0) respond(403, []);
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 2048) respond(413, []);
        $raw = file_get_contents('php://input', false, null, 0, 2049);
        if (strlen($raw) > 2048) respond(413, []);
        $decoded = json_decode($raw);
        if (!$decoded instanceof stdClass) respond(400, []);
        $input = (array)$decoded;
    }
    $db = analyticsDatabase($config);
    $now = microtime(true);
    if ($action === 'maintenance') respond(200, maintenanceStep($db, $config));
    if ($action === 'stats') {
        // All cards and tables must describe the same database snapshot.
        $db->beginTransaction();
        $rows = $db->query('SELECT started, updated, path, referrer, ip, browser, seconds FROM visits ORDER BY started DESC LIMIT 1000')->fetchAll();
        $totals = $db->query('SELECT COUNT(*) visits, COALESCE(AVG(seconds),0) average, COALESCE(SUM(seconds),0) total FROM visits')->fetch();
        $payload = array_merge(['visits' => $rows, 'totals' => $totals, 'retentionDays' => 30, 'fullIp' => !empty($config['full_ip'])], researchStats($db));
        $payload['mode'] = $mode;
        if ($mode === 'aggregate') {
            $payload['visits'] = []; $payload['engagement'] = []; $payload['conversion'] = []; $payload['reading'] = [];
            $payload['totals'] = ['visits' => (int)$db->query('SELECT COALESCE(SUM(count),0) FROM pageviews_daily')->fetchColumn(), 'average' => null, 'total' => null];
            $payload['daily'] = $db->query('SELECT day,count FROM pageviews_daily ORDER BY day')->fetchAll();
            $payload['trackingStarted'] = (int)($db->query("SELECT value FROM meta WHERE key='aggregate_start'")->fetchColumn() ?: time());
            $payload['fullIp'] = false;
            $payload['monthly'] = array_values(array_filter($payload['monthly'], static fn($row) => $row['kind'] === 'pageview'));
        }
        $db->commit();
        respond(200, $payload);
    }
    if ($action === 'refresh') {
        if (!is_string($input['publication'] ?? null) || !is_string($input['kind'] ?? null)) respond(400, []);
        try { respond(200, refreshResearch($db, $config, $input['publication'], $input['kind'])); }
        catch (InvalidArgumentException $e) { respond(400, ['error' => $e->getMessage()]); }
    }
    // Serialize updates so duplicate heartbeats cannot inflate active duration.
    $db->exec('BEGIN IMMEDIATE');
    $now = microtime(true);
    if ($action === 'event') {
        $status = recordEvent($db, $input, $now);
        if ($status === 200) $db->exec('COMMIT'); else $db->exec('ROLLBACK');
        respond($status, ['ok' => $status === 200]);
    }
    if (array_key_exists('id', $input)) {
        if (!is_string($input['id']) || !preg_match('/^[a-f0-9]{64}$/', $input['id']) || !is_numeric($input['seconds'] ?? null)) respond(400, []);
        $query = $db->prepare('SELECT updated FROM visits WHERE id = ?'); $query->execute([$input['id']]);
        $row = $query->fetch();
        if (!$row) respond(404, []);
        $seconds = max(0, min(20, (float)$input['seconds'], $now - (float)$row['updated']));
        $query = $db->prepare('UPDATE visits SET seconds = seconds + ?, updated = ? WHERE id = ?'); $query->execute([$seconds, $now, $input['id']]);
        $db->exec('COMMIT'); respond(200, ['ok' => true]);
    }
    if (!is_string($input['path'] ?? null)) respond(400, []);
    $path = parse_url($input['path'], PHP_URL_PATH);
    if (!in_array($path, ['/', '/index.html', '/index.php'], true)) respond(400, []);
    $address = $_SERVER['REMOTE_ADDR'] ?? '';
    $packed = @inet_pton($address);
    if ($packed === false) respond(400, []);
    $ip = $address;
    if (empty($config['full_ip'])) {
        $keep = strlen($packed) === 4 ? 3 : 6;
        $ip = inet_ntop(substr($packed, 0, $keep) . str_repeat("\0", strlen($packed) - $keep)) . (strlen($packed) === 4 ? '/24' : '/48');
    }
    // Forwarded IP headers are deliberately not trusted.
    $peer = hash_hmac('sha256', $address, $config['password_hash']);
    $query = $db->prepare('SELECT COUNT(*) FROM visits WHERE peer = ? AND started > ?'); $query->execute([$peer, $now - 60]);
    if ((int)$query->fetchColumn() >= 20) respond(429, []);
    $ref = parse_url(is_string($input['referrer'] ?? null) ? substr($input['referrer'], 0, 1000) : '');
    $referrer = in_array($ref['scheme'] ?? '', ['http', 'https'], true) ? ($ref['host'] ?? '') : '';
    $id = bin2hex(random_bytes(32));
    $query = $db->prepare('INSERT INTO visits VALUES (?,?,?,?,?,?,?,?,?)');
    $query->execute([$id, $now, $now, $path, $referrer, $ip, substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 300), 0, $peer]);
    incrementMonth($db, 'visit', '', '', $referrer);
    $db->exec('COMMIT'); respond(200, ['id' => $id]);
} catch (Throwable $error) {
    respond(503, ['error' => 'Analytics storage unavailable']);
}
