<?php
require_once __DIR__ . '/auth.php';   // also opened directly: require login
$editing = null;
if (isset($_GET['edit'])) {
    $edit_id    = (int)$_GET['edit'];
    $edit_result = pg_query_params($conn, 'SELECT * FROM on_call_schedule WHERE id = $1', [$edit_id]);
    $editing    = pg_fetch_assoc($edit_result);
}

$people_result = pg_query($conn, "SELECT * FROM people WHERE active = TRUE ORDER BY name");

$now = date('Y-m-d H:i:s');
$current_result = pg_query_params($conn, "
    SELECT oc.*, p.name, p.cell_phone
    FROM on_call_schedule oc
    JOIN people p ON p.id = oc.person_id
    WHERE $1::timestamp BETWEEN oc.start_datetime AND oc.end_datetime
    LIMIT 1
", [$now]);
$current_oncall = pg_fetch_assoc($current_result);

// If no one is scheduled, fetch the single default on-call person
$default_oncall = null;
if (!$current_oncall) {
    $default_result = pg_query($conn, "
        SELECT name, cell_phone
        FROM people
        WHERE is_default_oncall = TRUE AND active = TRUE
        LIMIT 1
    ");
    $default_oncall = pg_fetch_assoc($default_result) ?: null;
}

$week_ago = date('Y-m-d H:i:s', strtotime('-7 days'));
$schedules_result = pg_query_params($conn, "
    SELECT oc.*, p.name, p.cell_phone
    FROM on_call_schedule oc
    JOIN people p ON p.id = oc.person_id
    WHERE oc.end_datetime >= $1
    ORDER BY oc.start_datetime ASC
", [$week_ago]);
?>

<div class="page-header">
    <h1>
        <?php echo icon('on-call', 'var(--brand-primary)', 28); ?>
        On-Call Schedule
    </h1>
    <p>Manage who is on call for emergency situations</p>
</div>

<div class="card-status">
    <h3 style="margin-bottom:10px;">Current On-Call</h3>
    <?php if ($current_oncall): ?>
        <div class="status-open"><?php echo icon('users', '#1a7a4a', 22); ?> <?php echo htmlspecialchars($current_oncall['name']); ?></div>
        <p class="text-muted" style="margin-top:5px;">
            <?php echo htmlspecialchars($current_oncall['cell_phone']); ?><br>
            Until <?php echo date('M d, Y g:i A', strtotime($current_oncall['end_datetime'])); ?>
        </p>
    <?php elseif ($default_oncall): ?>
        <div class="status-warning"><?php echo icon('warning', '#ca6f1e', 22); ?> No One Scheduled</div>
        <div style="margin-top:5px;">
            <div class="status-open" style="font-size:22px;"><?php echo icon('users', '#1a7a4a', 22); ?> <?php echo htmlspecialchars($default_oncall['name']); ?></div>
            <p class="text-muted" style="margin-top:5px;">
                <?php echo htmlspecialchars($default_oncall['cell_phone']); ?><br>
                <span class="badge badge-action-updated" style="margin-top:6px; display:inline-block;">Default — not scheduled</span>
            </p>
        </div>
    <?php else: ?>
        <div class="status-closed"><?php echo icon('warning', '#b03a2e', 22); ?> No One On Call</div>
        <p class="text-muted" style="margin-top:5px;">Emergency calls will take a message</p>
    <?php endif; ?>
</div>

<div class="content-card">
    <h3>
        <?php echo $editing ? 'Edit On-Call Shift' : 'Add On-Call Shift'; ?>
        <?php if ($editing): ?>
            <a href="?page=oncall" class="text-muted text-small" style="margin-left:10px; font-weight:normal;">Cancel</a>
        <?php endif; ?>
    </h3>
    <form method="POST" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; max-width: 800px; margin-top:6px;">
        <?= csrf_field() ?>
        <input type="hidden" name="action"      value="<?php echo $editing ? 'edit' : 'add'; ?>">
        <input type="hidden" name="target_page" value="oncall">
        <?php if ($editing): ?>
        <input type="hidden" name="id" value="<?php echo $editing['id']; ?>">
        <?php endif; ?>

        <div style="grid-column: 1 / -1;">
            <label class="form-label">Person *</label>
            <select name="person_id" required class="form-control">
                <option value="">Select person...</option>
                <?php
                pg_result_seek($people_result, 0);
                while ($person = pg_fetch_assoc($people_result)):
                ?>
                    <option value="<?php echo $person['id']; ?>"
                        <?php echo ($editing && $editing['person_id'] == $person['id']) ? 'selected' : ''; ?>>
                        <?php echo htmlspecialchars($person['name']); ?>
                        (<?php echo htmlspecialchars($person['cell_phone']); ?>)
                    </option>
                <?php endwhile; ?>
            </select>
        </div>
        <div>
            <label class="form-label">Start Date & Time *</label>
            <input type="datetime-local" name="start_datetime" required class="form-control"
                value="<?php echo $editing ? date('Y-m-d\TH:i', strtotime($editing['start_datetime'])) : ''; ?>">
        </div>
        <div>
            <label class="form-label">End Date & Time *</label>
            <input type="datetime-local" name="end_datetime" required class="form-control"
                value="<?php echo $editing ? date('Y-m-d\TH:i', strtotime($editing['end_datetime'])) : ''; ?>">
        </div>
        <div style="grid-column: 1 / -1;">
            <label class="form-label">Notes</label>
            <textarea name="notes" rows="2" class="form-control"
                placeholder="Optional notes about this shift"><?php echo $editing ? htmlspecialchars($editing['notes']) : ''; ?></textarea>
        </div>
        <div style="grid-column: 1 / -1;">
            <button type="submit" class="btn btn-success">
                <?php echo $editing ? '✓ Update Shift' : '✓ Add Shift'; ?>
            </button>
        </div>
    </form>
</div>

<div class="content-card mt-20">
    <h3>Scheduled Shifts</h3>
    <table>
        <thead>
            <tr>
                <th>Person</th><th>Start</th><th>End</th>
                <th>Duration</th><th>Status</th><th>Notes</th><th>Actions</th>
            </tr>
        </thead>
        <tbody>
            <?php
            $now_ts = time();
            while ($shift = pg_fetch_assoc($schedules_result)):
                $start_ts      = strtotime($shift['start_datetime']);
                $end_ts        = strtotime($shift['end_datetime']);
                $duration_hours = round(($end_ts - $start_ts) / 3600, 1);

                if ($now_ts < $start_ts)     $status_badge = '<span class="badge badge-upcoming">Upcoming</span>';
                elseif ($now_ts > $end_ts)   $status_badge = '<span class="badge badge-past">Past</span>';
                else                         $status_badge = '<span class="badge badge-success">Active Now</span>';
            ?>
            <tr>
                <td>
                    <strong><?php echo htmlspecialchars($shift['name']); ?></strong><br>
                    <small class="text-muted"><?php echo htmlspecialchars($shift['cell_phone']); ?></small>
                </td>
                <td><?php echo date('M d, Y g:i A', $start_ts); ?></td>
                <td><?php echo date('M d, Y g:i A', $end_ts); ?></td>
                <td><?php echo $duration_hours; ?> hrs</td>
                <td><?php echo $status_badge; ?></td>
                <td><?php echo htmlspecialchars($shift['notes'] ?? '-'); ?></td>
                <td>
                    <form method="GET" class="inline-form">
                        <input type="hidden" name="page" value="oncall">
                        <input type="hidden" name="edit" value="<?php echo $shift['id']; ?>">
                        <button type="submit" class="btn btn-primary" style="font-size:12px;">Edit</button>
                    </form>
                    <form method="POST" class="inline-form" style="margin-left:4px;"
                          data-confirm="Delete this shift?">
        <?= csrf_field() ?>
                        <input type="hidden" name="action"      value="delete">
                        <input type="hidden" name="target_page" value="oncall">
                        <input type="hidden" name="id"          value="<?php echo $shift['id']; ?>">
                        <button type="submit" class="btn btn-danger" style="font-size:12px;">Delete</button>
                    </form>
                </td>
            </tr>
            <?php endwhile; ?>
        </tbody>
    </table>
</div>
