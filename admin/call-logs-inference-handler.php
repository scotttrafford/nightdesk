<?php
require_once 'auth.php';
requirePermission('editor');

$inference_id = (int)$_POST['inference_id'];
$phrase       = $_POST['phrase'] ?? '';
$action       = $_POST['action'] ?? '';
if (!in_array($action, ['emergency', 'needs_clarification', 'routine', 'ignore'], true)) {
    http_response_code(400);
    exit('Unknown action');
}

if ($action === 'ignore') {
    // Mark as rejected (bad inference)
    pg_query_params($conn, 'UPDATE call_logs SET inference_validated = FALSE WHERE id = $1', [$inference_id]);
    logAudit('inference_rejected', 'call_logs', $inference_id, null, "Rejected inference: $phrase");
} else {
    // Two-stage calls store 'Initial: "…" | Clarification: "…"' — keep just the clarification
    $clean_phrase = $phrase;
    if (preg_match('/Clarification: "([^"]+)"/', $phrase, $matches)) {
        $clean_phrase = $matches[1];
    }

    // Save as a new trigger unless the phrase already exists
    $check = pg_query_params($conn, 'SELECT id FROM triggers WHERE phrase = $1', [$clean_phrase]);
    if (pg_num_rows($check) == 0) {
        pg_query_params($conn,
            "INSERT INTO triggers (trigger_type, phrase, priority, notes, added_by, learned_from_call_id)
             VALUES ($1, $2, 100, 'Learned from AI inference', 'ai_inference', $3)",
            [$action, $clean_phrase, $inference_id]);
    }

    // Mark inference as validated (approved)
    pg_query_params($conn, 'UPDATE call_logs SET inference_validated = TRUE WHERE id = $1', [$inference_id]);
    logAudit('inference_approved', 'call_logs', $inference_id, null, "Approved as $action trigger: $clean_phrase");
}

// Redirect back to call logs with success message
header("Location: call-logs.php?success=1&action=" . urlencode($action));
exit;
