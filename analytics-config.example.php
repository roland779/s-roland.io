<?php
// Copy to analytics-config.php. Never commit the configured file.
return [
    // Generate with: php -r "echo password_hash('YOUR-LONG-PASSWORD', PASSWORD_DEFAULT), PHP_EOL;"
    'password_hash' => '',
    // Default: server-side pageview totals, without visitor IDs or browser tracking.
    // 'detailed' restores individual metrics AND the opt-in dialog.
    'analytics_mode' => 'aggregate',
    // Must be outside the public document root and writable by PHP.
    'data_dir' => dirname(__DIR__) . '/analytics-private',
    // Apache alternative when parent directories are not writable:
    // upload analytics-private/.htaccess and verify HTTP access returns 403 first.
    // 'data_dir' => __DIR__ . '/analytics-private',
    // 'protected_storage' => true,
    'full_ip' => false,
    // Optional, server-only OpenAlex key for a higher API quota.
    'openalex_api_key' => '',
    // Refresh due research sources on page views; no cron required.
    'automatic_refresh' => true,
];
