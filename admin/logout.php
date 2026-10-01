<?php
require_once __DIR__ . '/config.php';
start_session();

// Log the logout if user is logged in
if (isset($_SESSION['user_id'])) {
    pg_query_params(db_connect(), "INSERT INTO audit_log (user_id, username, action, ip_address) VALUES ($1, $2, 'logout', $3)",
        [(int)$_SESSION['user_id'], $_SESSION['username'], $_SERVER['REMOTE_ADDR'] ?? 'unknown']);
}

// Destroy session
session_destroy();

// Redirect to login with logout message
header("Location: index.php?logout=1");
exit;
?>
