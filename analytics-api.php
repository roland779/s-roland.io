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
    $adminRequest = ($action === 'stats' && $method === 'GET') || ($action === 'refresh' && $method === 'POST');
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
    if (in_array($action, ['visit','event'], true)
        && (($_SERVER['HTTP_DNT'] ?? '') === '1' || ($_SERVER['HTTP_SEC_GPC'] ?? '') === '1')) {
        respond(403, ['error' => 'Individual tracking disabled by privacy signal']);
    }
    $store = analyticsStorage($config);
    if ($action === 'maintenance') respond(200, maintenanceStep($store, $config));
    if ($action === 'stats') respond(200, analyticsStats($store, $config));
    if ($action === 'refresh') {
        if (!is_string($input['publication'] ?? null) || !is_string($input['kind'] ?? null)) respond(400, []);
        try { respond(200, refreshResearch($store, $config, $input['publication'], $input['kind'])); }
        catch (InvalidArgumentException $e) { respond(400, ['error' => $e->getMessage()]); }
    }
    if ($action === 'event') { $status=recordEvent($store,$input); respond($status,['ok'=>$status===200]); }
    [$status,$result]=recordVisit($store,$config,$input);respond($status,$result);
} catch (Throwable $error) {
    if (!empty($adminRequest)) {
        $messages = [
            'CSV storage invalid' => ['CSV_INVALID', 'Die Statistik-CSV ist beschädigt. Datei sichern und prüfen; sie wird nicht überschrieben.'],
            'CSV storage busy' => ['CSV_BUSY', 'Die Statistikdatei wird gerade geschrieben. Kurz warten und erneut aktualisieren.'],
            'Storage unavailable' => ['STORAGE_NOT_WRITABLE', 'Der Statistikordner kann nicht angelegt oder beschrieben werden. data_dir und PHP-Schreibrechte prüfen.'],
            'Storage must be outside document root' => ['STORAGE_PUBLIC', 'data_dir liegt im öffentlichen Webverzeichnis. Einen privaten Ordner verwenden oder analytics-private mit protected_storage und der mitgelieferten Apache-Zugriffssperre einrichten.'],
            'Publication data unavailable' => ['PUBLICATIONS_MISSING', 'Die Datei academic_website/data/publications.json fehlt, ist nicht lesbar oder enthält keine gültige Publikationsliste.'],
        ];
        [$code, $message] = $messages[$error->getMessage()] ?? ['ANALYTICS_ERROR', 'Die Statistik konnte nicht geladen werden. PHP-Fehlerprotokoll, CSV-Datei und vollständig hochgeladene Dateien prüfen.'];
        if ($error instanceof JsonException) { $code = 'PUBLICATIONS_INVALID'; $message = 'Die Publikationsdatei enthält ungültiges JSON. academic_website/data/publications.json prüfen.'; }
        error_log('Analytics failure [' . $code . ']');
        respond(503, ['error' => $message, 'code' => $code]);
    }
    respond(503, ['error' => 'Analytics storage unavailable']);
}
