<?php
require_once 'auth.php';
requirePermission('editor');

// On-Call Schedule page POST handler

/** Name of a person, for audit messages. */
function person_name($conn, int $person_id): string {
    $result = pg_query_params($conn, 'SELECT name FROM people WHERE id = $1', [$person_id]);
    return (string)(pg_fetch_result($result, 0, 0) ?: "#$person_id");
}

switch ($_POST['action']) {
    case 'add':
        $person_id = (int)$_POST['person_id'];
        $start     = $_POST['start_datetime'] ?? '';
        $end       = $_POST['end_datetime'] ?? '';
        $result = pg_query_params($conn,
            'INSERT INTO on_call_schedule (person_id, start_datetime, end_datetime, notes) VALUES ($1, $2, $3, $4) RETURNING id',
            [$person_id, $start, $end, $_POST['notes'] ?? '']);
        if ($result) {
            logAudit('oncall_created', 'on_call_schedule', pg_fetch_result($result, 0, 0), null,
                'Created on-call: ' . person_name($conn, $person_id) . " ($start to $end)");
        }
        break;

    case 'edit':
        $id        = (int)$_POST['id'];
        $person_id = (int)$_POST['person_id'];
        $start     = $_POST['start_datetime'] ?? '';
        $end       = $_POST['end_datetime'] ?? '';
        pg_query_params($conn,
            'UPDATE on_call_schedule SET person_id = $1, start_datetime = $2, end_datetime = $3, notes = $4 WHERE id = $5',
            [$person_id, $start, $end, $_POST['notes'] ?? '', $id]);
        logAudit('oncall_updated', 'on_call_schedule', $id, null,
            'Updated on-call: ' . person_name($conn, $person_id) . " ($start to $end)");
        break;

    case 'delete':
        $id       = (int)$_POST['id'];
        $schedule = pg_fetch_assoc(pg_query_params($conn, 'SELECT * FROM on_call_schedule WHERE id = $1', [$id]));
        pg_query_params($conn, 'DELETE FROM on_call_schedule WHERE id = $1', [$id]);
        if ($schedule) {
            logAudit('oncall_deleted', 'on_call_schedule', $id, null,
                'Deleted on-call: ' . person_name($conn, (int)$schedule['person_id']) . " ({$schedule['start_datetime']} to {$schedule['end_datetime']})");
        }
        break;
}
