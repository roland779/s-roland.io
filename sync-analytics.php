<?php
declare(strict_types=1);
// Run daily from your hosting scheduler. This entry point is never callable over HTTP.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
define('ANALYTICS_ADMIN_PAGE', true);
require __DIR__ . '/analytics-api.php';
$config = analyticsConfig();
$db = analyticsDatabase($config);
$lock = fopen($config['data_dir'] . '/sync.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) exit(0);
$failed = false;
foreach (publications() as $id => $pub) {
    $kinds = ['citations'];
    if (!empty($pub['links']['zenodo'])) $kinds[] = 'zenodo';
    // Optional weekly link checks: php sync-analytics.php --links
    if (in_array('--links', $argv, true)) $kinds[] = 'links';
    foreach ($kinds as $kind) {
        $result = refreshResearch($db, $config, $id, $kind);
        $failed = $failed || isset($result['error']);
        echo $id . ' / ' . $kind . ': ' . (isset($result['error']) ? $result['error'] : (isset($result['busy']) ? 'already running' : (isset($result['cached']) ? 'cached' : 'OK'))) . PHP_EOL;
    }
}
flock($lock, LOCK_UN); fclose($lock);
exit($failed ? 1 : 0);
