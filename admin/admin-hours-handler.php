<?php
require_once 'auth.php';
requirePermission('editor');

// Business Hours page POST handler
switch ($_POST['action']) {
    case 'update':
        $days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        $changes = [];
        
        // Update all days at once
        for ($day = 0; $day <= 6; $day++) {
            // Get old values first
            $old = pg_fetch_assoc(pg_query_params($conn, 'SELECT * FROM business_hours WHERE day_of_week = $1', [$day]));
            
            $is_closed  = isset($_POST["is_closed_$day"]) ? 'TRUE' : 'FALSE';
            $open_time  = $_POST["open_time_$day"] ?? '';
            $close_time = $_POST["close_time_$day"] ?? '';

            pg_query_params($conn,
                'UPDATE business_hours SET open_time = $1, close_time = $2, is_closed = $3 WHERE day_of_week = $4',
                [$open_time, $close_time, $is_closed === 'TRUE' ? 't' : 'f', $day]);

            // Track changes
            $old_closed = $old['is_closed'] === 't';
            $new_closed = $is_closed === 'TRUE';
            
            if ($old_closed != $new_closed) {
                $changes[] = "{$days[$day]}: " . ($new_closed ? 'closed' : 'open');
            } elseif (!$new_closed && ($old['open_time'] != $open_time || $old['close_time'] != $close_time)) {
                $changes[] = "{$days[$day]}: {$old['open_time']}-{$old['close_time']} → $open_time-$close_time";
            }
        }
        
        if (!empty($changes)) {
            logAudit('hours_updated', 'business_hours', null, null, implode('; ', $changes));
        }
        break;
}
