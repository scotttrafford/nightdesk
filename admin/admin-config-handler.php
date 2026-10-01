<?php
require_once 'auth.php';
requirePermission('admin'); // Only admins can change system config

switch ($_POST['action']) {
    case 'update':
        // Only keys that already exist can be updated
        $existing = pg_query($conn, "SELECT key, value FROM system_config");
        $changes  = [];

        while ($row = pg_fetch_assoc($existing)) {
            $key = $row['key'];
            if (!isset($_POST[$key])) continue;
            $new_value = $_POST[$key];
            if ($new_value === $row['value']) continue;

            pg_query_params($conn, 'UPDATE system_config SET value = $1, updated_at = NOW() WHERE key = $2', [$new_value, $key]);

            $short = fn($v) => strlen($v) > 50 ? substr($v, 0, 47) . '...' : $v;
            $changes[] = "$key: {$short($row['value'])} → {$short($new_value)}";
        }

        if (!empty($changes)) {
            logAudit('config_updated', 'system_config', null, null, implode('; ', $changes));
        }
        break;
}
