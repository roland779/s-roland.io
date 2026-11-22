<?php
declare(strict_types=1);
define('ANALYTICS_ADMIN_PAGE', true);
require __DIR__ . '/analytics-api.php';
requireAdmin(analyticsConfig());
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
readfile(__DIR__ . '/academic_website/admin-template.html');
