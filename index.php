<?php
declare(strict_types=1);
require_once __DIR__ . '/analytics-lib.php';
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
$detailed = false;
try {
    $file = __DIR__ . '/analytics-config.php';
    $config = is_file($file) ? require $file : [];
    $detailed = is_array($config) && analyticsMode($config) === 'detailed';
    if (is_array($config) && !empty($config['password_hash']) && !$detailed
        && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET'
        && ($_SERVER['HTTP_DNT'] ?? '') !== '1' && ($_SERVER['HTTP_SEC_GPC'] ?? '') !== '1') {
        recordPageview(analyticsStorage($config));
    }
} catch (Throwable $e) { /* Statistics must never prevent the profile from loading. */ }
$html = file_get_contents(__DIR__ . '/index.html');
if ($detailed) $html = str_replace('</body>', '<script src="academic_website/js/analytics.js"></script></body>', $html);
echo $html;
