<?php
require_once 'auth.php';
require_once 'icons.php';
date_default_timezone_set('America/Toronto');

$query  = "SELECT * FROM call_logs ORDER BY call_timestamp DESC LIMIT 50";
$result = pg_query($conn, $query);

function formatTranscript($transcript) {
    if (empty($transcript)) return '-';
    $formatted = '';
    $lines = explode("\n", $transcript);
    $i = 0;
    while ($i < count($lines)) {
        $line = trim($lines[$i]);
        if (strpos($line, 'user:') === 0) {
            $text = trim(substr($line, 5));
            $formatted .= '<div class="user-msg">Caller: ' . htmlspecialchars($text) . '</div>';
            $i++;
        } elseif (strpos($line, 'assistant:') === 0) {
            $assistantText = '';
            $inline = trim(substr($line, strlen('assistant:')));
            if ($inline !== '') $assistantText .= $inline . "\n";
            $i++;
            while ($i < count($lines) && strpos(trim($lines[$i]), 'user:') !== 0) {
                $assistantText .= trim($lines[$i]) . "\n";
                $i++;
            }
            $assistantText = trim($assistantText);
            $assistantText = preg_replace('/^```json\s*/', '', $assistantText);
            $assistantText = preg_replace('/\s*```$/', '', $assistantText);
            $assistantText = trim($assistantText);
            $decoded = json_decode($assistantText, true);
            if ($decoded && isset($decoded['message'])) {
                $formatted .= '<div class="assistant-msg">AI: ' . htmlspecialchars($decoded['message']) . '</div>';
            } else {
                $formatted .= '<div class="assistant-msg">AI: ' . htmlspecialchars($assistantText) . '</div>';
            }
        } else {
            $i++;
        }
    }
    return $formatted ?: '-';
}

function formatConversation($debug_log, $full_transcript) {
    if (!empty($debug_log)) {
        $formatted = '';
        $lines = explode("\n", $debug_log);
        foreach ($lines as $line) {
            if (preg_match('/\[say\]\s+SpeechText:\s*"?(.+?)"?\s*$/', $line, $m)) {
                $formatted .= '<div class="assistant-msg">System: ' . htmlspecialchars(trim($m[1], '"')) . '</div>';
            } elseif (preg_match('/\[gather\]\s+SpeechResult:\s*"(.+?)"/', $line, $m)) {
                $formatted .= '<div class="user-msg">Caller: ' . htmlspecialchars($m[1]) . '</div>';
            }
        }
        return $formatted ?: formatTranscript($full_transcript);
    }
    return formatTranscript($full_transcript);
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>Call Logs — <?= h(branding()['name']) ?></title>
    <link rel="stylesheet" href="style.css">
    <?= branding_head() ?>
    <meta name="csrf-token" content="<?= csrf_token() ?>">
</head>
<body class="call-logs-page">

    <div class="page-top">
        <div style="display:flex; align-items:center; gap:15px;">
            <img src="<?= h(branding()['logo']) ?>" alt="<?= h(branding()['name']) ?>" style="height:50px; width:auto;">
            <h1>
                <?php echo icon('call-logs', 'var(--brand-primary)', 26); ?>
                Call Logs — <?= h(branding()['name']) ?>
            </h1>
        </div>
        <div class="page-top-actions">
            <a href="index.php" class="btn btn-secondary">← Back to Main</a>
            <a href="admin.php" class="btn btn-secondary">← Back to Admin</a>
            <button id="btn-refresh" class="btn btn-dark">Refresh</button>
        </div>
    </div>

    <?php if (isset($_GET['success'])): ?>
    <div class="alert-success">
        <strong>Saved!</strong> The inference has been <?php echo ($_GET['action'] ?? '') === 'ignore' ? 'marked as rejected' : 'saved as a new trigger'; ?>.
    </div>
    <?php endif; ?>

    <table class="call-logs-table">
        <thead>
            <tr>
                <th style="width:50px;">ID</th>
                <th style="min-width:160px;">Time</th>
                <th style="width:130px;">Caller</th>
                <th style="width:100px;">Detected Person</th>
                <th style="width:90px;">Urgency</th>
                <th style="width:120px;">AI / Trigger</th>
                <th style="width:130px;">Routed To</th>
                <th style="width:200px;">Message</th>
                <th style="min-width:300px;">Conversation</th>
            </tr>
        </thead>
        <tbody>
        <?php while ($row = pg_fetch_assoc($result)): ?>
        <tr>
            <td><?php echo $row['id']; ?></td>
            <td><?php
                $dt = new DateTime($row['call_timestamp'], new DateTimeZone('UTC'));
                $dt->setTimezone(new DateTimeZone('America/Toronto'));
                echo $dt->format('M d, Y g:i A');
            ?></td>
            <td><span class="phone"><?php echo htmlspecialchars($row['caller_number']); ?></span></td>
            <td><strong><?php echo htmlspecialchars($row['detected_person'] ?? '-'); ?></strong></td>
            <td>
                <?php if ($row['emergency_detected'] == 't'): ?>
                    <span class="badge-emergency-pill">EMERGENCY</span>
                <?php else: ?>
                    <span class="text-normal">Normal</span>
                <?php endif; ?>
            </td>
            <td style="text-align:center;">
                <?php if ($row['ai_inferred'] === 't'): ?>
                    <?php
                    $inferenceData = htmlspecialchars(json_encode([
                        'id'           => $row['id'],
                        'caller_phrase'=> $row['caller_phrase'],
                        'ai_reasoning' => $row['ai_reasoning'],
                        'validated'    => $row['inference_validated']
                    ]), ENT_QUOTES);
                    if ($row['inference_validated'] === 't'):
                    ?>
                        <span class="badge badge-approved inference-badge" data-inference="<?php echo $inferenceData; ?>" title="Click to view">Approved</span>
                    <?php elseif ($row['inference_validated'] === 'f'): ?>
                        <span class="badge badge-rejected inference-badge" data-inference="<?php echo $inferenceData; ?>" title="Click to view">Rejected</span>
                    <?php else: ?>
                        <span class="badge badge-review inference-badge"   data-inference="<?php echo $inferenceData; ?>" title="Click to review">Review</span>
                    <?php endif; ?>
                <?php elseif (($matched = $row['caller_phrase'] ?: $row['similar_to_trigger']) !== null && $matched !== ''): ?>
                    <?php // Exact trigger match: show the caller's triggering words (nothing to review) ?>
                    <span class="badge badge-trigger-match" title="<?= h($row['ai_reasoning'] ?? '') ?>">Trigger: <?= h($matched) ?></span>
                <?php else: ?>
                    <span style="color:#ccc;">—</span>
                <?php endif; ?>
            </td>
            <td><span class="phone"><?php echo htmlspecialchars($row['routed_to_number'] ?? '-'); ?></span></td>
            <td>
                <?php echo htmlspecialchars(substr($row['message_left'] ?? '-', 0, 100)); ?>
                <?php if (!empty($row['debug_log'])): ?>
                <br>
                <button class="btn-log debug-log-btn"
                    data-log="<?php echo htmlspecialchars($row['debug_log'], ENT_QUOTES); ?>">
                    View Log
                </button>
                <?php endif; ?>
            </td>
            <td class="transcript"><?php echo formatConversation($row['debug_log'], $row['full_transcript']); ?></td>
        </tr>
        <?php endwhile; ?>
        </tbody>
    </table>

    <!-- AI Inference Modal -->
    <div id="inferenceModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>AI Inference Review</h2>
                <span class="close" id="close-inference-modal">&times;</span>
            </div>
            <div class="modal-body">
                <div class="inference-detail">
                    <strong>Caller's phrase:</strong>
                    <div class="value" id="modal-phrase"></div>
                </div>
                <div class="inference-detail">
                    <strong>AI's reasoning:</strong>
                    <div class="value" id="modal-reasoning"></div>
                </div>
                <div class="help-box">
                    <strong id="help-title">Action Required:</strong>
                    <p id="help-text">If the AI correctly identified this as urgent, save it as a trigger. Otherwise, mark it as a bad inference.</p>
                </div>
                <div class="action-buttons">
                    <button class="btn-act-emergency" data-action="emergency">Emergency<br><small>Immediate routing</small></button>
                    <button class="btn-act-soft"      data-action="needs_clarification">Soft/Urgent<br><small>Needs clarification</small></button>
                    <button class="btn-act-routine"   data-action="routine">Routine<br><small>Not urgent</small></button>
                    <button class="btn-act-ignore"    data-action="ignore">Ignore<br><small>Bad inference</small></button>
                </div>
            </div>
        </div>
    </div>

    <!-- Debug Log Modal -->
    <div id="debugModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>Verbose Debug Log</h2>
                <span class="close" id="close-debug-modal">&times;</span>
            </div>
            <div class="modal-body">
                <textarea id="debug-log-content"
                    style="width:100%; height:400px; font-family:monospace; font-size:11px; background:#1a1a1a; color:#00ff00; border:1px solid #444; resize:vertical; padding:10px;"
                    readonly></textarea>
            </div>
        </div>
    </div>

    <script src="call-logs.js"></script>
</body>
</html>
