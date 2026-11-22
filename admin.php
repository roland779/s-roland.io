<?php
declare(strict_types=1);
define('ANALYTICS_ADMIN_PAGE', true);
require __DIR__ . '/analytics-api.php';
$config = analyticsConfig();
requireAdmin($config);
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
$script = $_SERVER['SCRIPT_NAME'] ?? '/admin.php';
$base = rtrim(str_replace('\\', '/', dirname($script)), '/.') . '/';
$requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
if (preg_match('~/admin/?$~', $requestPath)) $base = preg_replace('~/admin/?$~', '/', $requestPath);
$html = file_get_contents(__DIR__ . '/academic_website/admin-template.html');
$html = str_replace('<html lang="de">', '<html lang="de" data-analytics-mode="' . analyticsMode($config) . '">', $html);
$meta = '<meta name="analytics-base" content="' . htmlspecialchars($base, ENT_QUOTES, 'UTF-8') . '">';
$html = str_replace('<head>', '<head>' . $meta, $html);
// Paths remain correct for /admin, /admin/ and installations in subdirectories.
$html = str_replace('href="academic_website/', 'href="' . htmlspecialchars($base, ENT_QUOTES, 'UTF-8') . 'academic_website/', $html);
$html = str_replace('src="academic_website/', 'src="' . htmlspecialchars($base, ENT_QUOTES, 'UTF-8') . 'academic_website/', $html);
$html = str_replace('href="/"', 'href="' . htmlspecialchars($base, ENT_QUOTES, 'UTF-8') . '"', $html);
$html = preg_replace_callback('~((?:href|src)=")([^"]*academic_website/[^"]+\.(?:js|css))(")~', static function ($m) {
    $relative = substr($m[2], strpos($m[2], 'academic_website/'));
    $file = __DIR__ . '/' . $relative;
    $version = is_file($file) ? substr(hash_file('sha256', $file), 0, 12) : 'missing';
    return $m[1] . $m[2] . '?v=' . $version . $m[3];
}, $html);
echo $html;
