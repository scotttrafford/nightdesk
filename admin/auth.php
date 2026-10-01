<?php
// auth.php - Include at top of every admin page
require_once __DIR__ . '/branding.php';
start_session();
$conn = db_connect();

// Check if user is logged in
if (!isset($_SESSION['user_id'])) {
    header("Location: index.php");
    exit;
}

// Refresh session data from database (in case role changed)
$user_id = (int)$_SESSION['user_id'];
$result = pg_query_params($conn, 'SELECT * FROM users WHERE id = $1 AND active = TRUE', [$user_id]);
$current_user = pg_fetch_assoc($result);

if (!$current_user) {
    // User no longer exists or was deactivated
    session_destroy();
    header("Location: index.php");
    exit;
}

// A required password change can't be skipped by opening another page
if (!empty($_SESSION['must_change_password'])) {
    header("Location: change-password.php");
    exit;
}

// Reject cross-site form submissions on every logged-in page
if ($_SERVER['REQUEST_METHOD'] === 'POST') csrf_verify();

// Update session with latest role
$_SESSION['role'] = $current_user['role'];
$_SESSION['username'] = $current_user['username'];
$_SESSION['full_name'] = $current_user['full_name'];

// Permission checking functions
function hasPermission($required_role) {
    $roles = ['viewer' => 1, 'editor' => 2, 'admin' => 3];
    $user_level = $roles[$_SESSION['role']] ?? 0;
    $required_level = $roles[$required_role] ?? 999;
    return $user_level >= $required_level;
}

function requirePermission($required_role) {
    if (!hasPermission($required_role)) {
        die("Access Denied: You need '$required_role' permission to access this page.");
    }
}

/** Record an admin action in audit_log. Values are passed as query parameters. */
function logAudit($action, $table_name = null, $record_id = null, $old_value = null, $new_value = null) {
    global $conn;
    pg_query_params($conn,
        'INSERT INTO audit_log (user_id, username, action, table_name, record_id, old_value, new_value, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [(int)$_SESSION['user_id'], $_SESSION['username'], $action, $table_name,
         $record_id ? (int)$record_id : null, $old_value, $new_value, $_SERVER['REMOTE_ADDR'] ?? 'unknown']);
}

// Session timeout (4 hours)
$timeout = 4 * 60 * 60; // 4 hours in seconds
if (isset($_SESSION['last_activity']) && (time() - $_SESSION['last_activity'] > $timeout)) {
    session_destroy();
    header("Location: index.php?timeout=1");
    exit;
}
$_SESSION['last_activity'] = time();
?>
