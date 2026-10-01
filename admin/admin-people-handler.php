<?php
require_once 'auth.php';
requirePermission('editor');

// People page POST handler

const ROUTING_PREFERENCES      = ['business_hours', 'always_direct', 'always_screen', 'message_only'];
const NOTIFICATION_PREFERENCES = EMAIL_ENABLED ? ['sms', 'email', 'both'] : ['sms'];

/** Return $value if it's one of $allowed, otherwise $default. */
function one_of($value, array $allowed, string $default): string {
    return in_array($value, $allowed, true) ? $value : $default;
}

/** Person fields from the submitted form, ready to bind as query parameters. */
function person_from_post(): array {
    $alternates = array_values(array_filter(array_map('trim', explode(',', $_POST['alternate_names'] ?? ''))));
    return [
        'name'              => trim($_POST['name'] ?? ''),
        'last_name'         => trim($_POST['last_name'] ?? ''),
        'alternate_names'   => $alternates ? pg_text_array($alternates) : null,
        'cell_phone'        => trim($_POST['cell_phone'] ?? ''),
        'email'             => trim($_POST['email'] ?? ''),
        'routing'           => one_of($_POST['routing_preference'] ?? '', ROUTING_PREFERENCES, 'business_hours'),
        'notification'      => one_of($_POST['notification_preference'] ?? '', NOTIFICATION_PREFERENCES, 'sms'),
        'is_default_oncall' => isset($_POST['is_default_oncall']) ? 't' : 'f',
    ];
}

switch ($_POST['action']) {
    case 'add':
        $p = person_from_post();
        if ($p['is_default_oncall'] === 't') {
            pg_query($conn, "UPDATE people SET is_default_oncall = FALSE WHERE is_default_oncall = TRUE");
        }
        $result = pg_query_params($conn,
            "INSERT INTO people (name, last_name, alternate_names, cell_phone, email, routing_preference, notification_preference, is_default_oncall)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
            [$p['name'], $p['last_name'], $p['alternate_names'], $p['cell_phone'], $p['email'], $p['routing'], $p['notification'], $p['is_default_oncall']]);
        logAudit('person_created', 'people', pg_fetch_result($result, 0, 0), null, "Created person: {$p['name']}");
        break;

    case 'edit':
        $id  = (int)$_POST['id'];
        $old = pg_fetch_assoc(pg_query_params($conn, 'SELECT * FROM people WHERE id = $1', [$id]));
        $p   = person_from_post();
        if ($p['is_default_oncall'] === 't') {
            pg_query_params($conn, 'UPDATE people SET is_default_oncall = FALSE WHERE is_default_oncall = TRUE AND id != $1', [$id]);
        }
        pg_query_params($conn,
            "UPDATE people SET name = $1, last_name = $2, alternate_names = $3, cell_phone = $4, email = $5,
                    routing_preference = $6, notification_preference = $7, is_default_oncall = $8
             WHERE id = $9",
            [$p['name'], $p['last_name'], $p['alternate_names'], $p['cell_phone'], $p['email'], $p['routing'], $p['notification'], $p['is_default_oncall'], $id]);

        $changes = [];
        if ($old['name'] != $p['name'])                         $changes[] = "first name: {$old['name']} → {$p['name']}";
        if (($old['last_name'] ?? '') != $p['last_name'])       $changes[] = "last name: {$old['last_name']} → {$p['last_name']}";
        if ($old['cell_phone'] != $p['cell_phone'])             $changes[] = "cell: {$old['cell_phone']} → {$p['cell_phone']}";
        if ($old['email'] != $p['email'])                       $changes[] = "email: {$old['email']} → {$p['email']}";
        if ($old['routing_preference'] != $p['routing'])        $changes[] = "routing: {$old['routing_preference']} → {$p['routing']}";
        if (!empty($changes)) {
            logAudit('person_updated', 'people', $id, null, implode(', ', $changes));
        }
        break;

    case 'toggle':
        $id     = (int)$_POST['id'];
        $active = $_POST['current_active'] === 't' ? 'f' : 't';
        pg_query_params($conn, 'UPDATE people SET active = $1 WHERE id = $2', [$active, $id]);
        logAudit('person_toggled', 'people', $id, null, 'Person ' . ($active === 't' ? 'enabled' : 'disabled'));
        break;

    case 'delete':
        $id     = (int)$_POST['id'];
        $person = pg_fetch_assoc(pg_query_params($conn, 'SELECT name FROM people WHERE id = $1', [$id]));
        pg_query_params($conn, 'DELETE FROM people WHERE id = $1', [$id]);
        logAudit('person_deleted', 'people', $id, null, "Deleted person: {$person['name']}");
        break;
}
