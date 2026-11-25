<?php
declare(strict_types=1);

/** One atomic CSV snapshot, guarded by a separate lock file across all PHP processes. */
final class AnalyticsCsvStore {
    public const SCHEMA = [
        'pageviews_daily' => ['day','count'],
        'monthly' => ['month','kind','publication','target','source','count'],
        'meta' => ['key','value'],
        'external' => ['publication','kind','payload','checked','success','error'],
        'citation_snapshots' => ['publication','day','count'],
        'zenodo_snapshots' => ['publication','day','payload'],
        'visits' => ['id','started','updated','path','referrer','ip','browser','seconds','peer'],
        'events' => ['event_id','visit','created','kind','publication','target','source'],
    ];
    private const PRIMARY = [
        'pageviews_daily'=>['day'], 'monthly'=>['month','kind','publication','target','source'],
        'meta'=>['key'], 'external'=>['publication','kind'], 'citation_snapshots'=>['publication','day'],
        'zenodo_snapshots'=>['publication','day'],
        'visits'=>['id'], 'events'=>['event_id'],
    ];
    private string $dir;
    public function __construct(string $dir) { $this->dir = $dir; }
    public function directory(): string { return $this->dir; }
    public static function key(array $values): string { return json_encode($values, JSON_THROW_ON_ERROR); }
    public static function put(array &$tables, string $table, array $row): void {
        $key = self::key(array_map(static fn($c) => $row[$c], self::PRIMARY[$table]));
        $tables[$table][$key] = $row;
    }
    public static function rows(array $tables, string $table): array { return array_values($tables[$table] ?? []); }
    public function read(callable $callback): mixed { return $this->access($callback, false); }
    public function update(callable $callback): mixed { return $this->access($callback, true); }
    private function access(callable $callback, bool $write): mixed {
        $lock = @fopen($this->dir . '/analytics.lock', 'c');
        if (!$lock) throw new RuntimeException('Storage unavailable');
        $deadline = microtime(true) + 30;
        try {
            while (!flock($lock, ($write ? LOCK_EX : LOCK_SH) | LOCK_NB)) {
                if (microtime(true) >= $deadline) throw new RuntimeException('CSV storage busy');
                usleep(random_int(10000, 30000));
            }
            $tables = $this->load();
            $result = $callback($tables);
            if ($write) $this->save($tables);
            return $result;
        } finally { flock($lock, LOCK_UN); fclose($lock); }
    }
    private static function columns(): array {
        return array_values(array_unique(array_merge(['table'], ...array_values(self::SCHEMA))));
    }
    private function load(): array {
        $tables = array_fill_keys(array_keys(self::SCHEMA), []);
        $file = $this->dir . '/analytics.csv';
        if (!is_file($file)) return $tables;
        $stream = @fopen($file, 'rb');
        if (!$stream) throw new RuntimeException('Storage unavailable');
        try {
            $columns = fgetcsv($stream, null, ',', '"', '');
            if ($columns !== self::columns()) throw new RuntimeException('CSV storage invalid');
            while (($cells = fgetcsv($stream, null, ',', '"', '')) !== false) {
                if (count($cells) !== count($columns)) throw new RuntimeException('CSV storage invalid');
                $cells = array_map(static fn($v) => str_starts_with((string)$v, "'") ? substr($v,1) : $v, $cells);
                $record = array_combine($columns, $cells);
                $table = $record['table'];
                if (!isset(self::SCHEMA[$table])) throw new RuntimeException('CSV storage invalid');
                $row = [];
                foreach (self::SCHEMA[$table] as $col) {
                    $v = $record[$col];
                    if ($col === 'payload') {
                        try {
                            $v = $v === '' ? null : json_decode($v, true, 512, JSON_THROW_ON_ERROR);
                        } catch (JsonException $e) {
                            throw new RuntimeException('CSV storage invalid', 0, $e);
                        }
                        if ($v !== null && !is_array($v)) throw new RuntimeException('CSV storage invalid');
                    } elseif (in_array($col, ['count','checked','success','started','updated','seconds','created'], true)) {
                        if ($v === '' && in_array($col, ['checked','success'], true)) $v = null;
                        elseif (!is_numeric($v) || !is_finite((float)$v)) throw new RuntimeException('CSV storage invalid');
                        else $v = $col === 'count' ? (int)$v : (float)$v;
                    } elseif ($col === 'error' && $v === '') $v = null;
                    $row[$col] = $v;
                }
                $before = count($tables[$table]);
                self::put($tables, $table, $row);
                if (count($tables[$table]) === $before) throw new RuntimeException('CSV storage invalid');
            }
            return $tables;
        } finally { fclose($stream); }
    }
    private function save(array $tables): void {
        $temp = @tempnam($this->dir, '.csv-');
        if ($temp === false) throw new RuntimeException('Storage unavailable');
        $stream = null;
        try {
            @chmod($temp, 0600);
            $stream = @fopen($temp, 'wb');
            if (!$stream) throw new RuntimeException('Storage unavailable');
            $columns = self::columns();
            if (fputcsv($stream, $columns, ',', '"', '') === false) throw new RuntimeException('Storage unavailable');
            foreach ($tables as $table => $rows) foreach ($rows as $row) {
                $record = array_fill_keys($columns, ''); $record['table'] = $table;
                foreach ($row as $col => $value) {
                    if (!in_array($col, self::SCHEMA[$table], true)) throw new RuntimeException('CSV storage invalid');
                    if ($col === 'payload' && $value !== null) $value = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                    $value = $value === null ? '' : (string)$value;
                    // Preserve raw values on read, but prevent formulas when opened in a spreadsheet.
                    if (preg_match('/^[=+\-@\t\r\']/', $value)) $value = "'" . $value;
                    $record[$col] = $value;
                }
                if (fputcsv($stream, array_values($record), ',', '"', '') === false) throw new RuntimeException('Storage unavailable');
            }
            if (!fflush($stream)) throw new RuntimeException('Storage unavailable');
            if (function_exists('fsync') && !fsync($stream)) throw new RuntimeException('Storage unavailable');
            fclose($stream); $stream = null;
            if (!@rename($temp, $this->dir . '/analytics.csv')) throw new RuntimeException('Storage unavailable');
        } finally {
            if (is_resource($stream)) fclose($stream);
            if (is_file($temp)) @unlink($temp);
        }
    }
}
