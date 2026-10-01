<?php
require_once 'auth.php';
requirePermission('editor');

// Triggers page POST handler

const TRIGGER_TYPES = ['emergency', 'needs_clarification', 'routine', 'operator'];

/** Trigger fields from the submitted form. Unknown types fall back to 'routine'. */
function trigger_from_post(): array {
    return [
        'type'     => in_array($_POST['trigger_type'] ?? '', TRIGGER_TYPES, true) ? $_POST['trigger_type'] : 'routine',
        'phrase'   => trim($_POST['phrase'] ?? ''),
        'priority' => (int)($_POST['priority'] ?? 0),
        'notes'    => $_POST['notes'] ?? '',
    ];
}

switch ($_POST['action']) {
    case 'add':
        $t = trigger_from_post();
        $result = pg_query_params($conn,
            "INSERT INTO triggers (trigger_type, phrase, priority, notes, added_by) VALUES ($1, $2, $3, $4, 'manual') RETURNING id",
            [$t['type'], $t['phrase'], $t['priority'], $t['notes']]);
        logAudit('trigger_created', 'triggers', pg_fetch_result($result, 0, 0), null, "Created trigger: {$t['phrase']} ({$t['type']})");
        break;

    case 'edit':
        $id  = (int)$_POST['id'];
        $old = pg_fetch_assoc(pg_query_params($conn, 'SELECT * FROM triggers WHERE id = $1', [$id]));
        $t   = trigger_from_post();
        pg_query_params($conn,
            'UPDATE triggers SET trigger_type = $1, phrase = $2, priority = $3, notes = $4 WHERE id = $5',
            [$t['type'], $t['phrase'], $t['priority'], $t['notes'], $id]);

        $changes = [];
        if ($old['phrase'] != $t['phrase'])         $changes[] = "phrase: {$old['phrase']} → {$t['phrase']}";
        if ($old['trigger_type'] != $t['type'])     $changes[] = "type: {$old['trigger_type']} → {$t['type']}";
        if ($old['priority'] != $t['priority'])     $changes[] = "priority: {$old['priority']} → {$t['priority']}";
        if (!empty($changes)) {
            logAudit('trigger_updated', 'triggers', $id, null, implode(', ', $changes));
        }
        break;

    case 'toggle':
        $id     = (int)$_POST['id'];
        $active = $_POST['current_active'] === 't' ? 'f' : 't';
        pg_query_params($conn, 'UPDATE triggers SET active = $1 WHERE id = $2', [$active, $id]);
        logAudit('trigger_toggled', 'triggers', $id, null, 'Trigger ' . ($active === 't' ? 'enabled' : 'disabled'));
        break;

    case 'delete':
        $id      = (int)$_POST['id'];
        $trigger = pg_fetch_assoc(pg_query_params($conn, 'SELECT phrase, trigger_type FROM triggers WHERE id = $1', [$id]));
        pg_query_params($conn, 'DELETE FROM triggers WHERE id = $1', [$id]);
        logAudit('trigger_deleted', 'triggers', $id, null, "Deleted trigger: {$trigger['phrase']} ({$trigger['trigger_type']})");
        break;
}
