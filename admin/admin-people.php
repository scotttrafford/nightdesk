<?php
require_once __DIR__ . '/auth.php';   // also opened directly: require login
$editing = null;
if (isset($_GET['edit'])) {
    $edit_id    = (int)$_GET['edit'];
    $edit_result = pg_query_params($conn, 'SELECT * FROM people WHERE id = $1', [$edit_id]);
    $editing    = pg_fetch_assoc($edit_result);
}

$people = pg_query($conn, "SELECT * FROM people ORDER BY name");
?>

<div class="page-header">
    <h1>
        <?php echo icon('people', 'var(--brand-primary)', 28); ?>
        People Management
    </h1>
    <p>Manage contacts and routing preferences</p>
</div>

<div class="content-card">
    <h3>
        <?php echo $editing ? 'Edit Person' : 'Add New Person'; ?>
        <?php if ($editing): ?>
            <a href="?page=people" class="text-muted text-small" style="margin-left:10px; font-weight:normal;">Cancel</a>
        <?php endif; ?>
    </h3>
    <form method="POST" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; max-width: 800px; margin-top: 6px;">
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="<?php echo $editing ? 'edit' : 'add'; ?>">
        <?php if ($editing): ?>
        <input type="hidden" name="id" value="<?php echo $editing['id']; ?>">
        <?php endif; ?>

        <div>
            <label class="form-label">First Name *</label>
            <input type="text" name="name" required class="form-control"
                value="<?php echo $editing ? htmlspecialchars($editing['name']) : ''; ?>">
        </div>
        <div>
            <label class="form-label">Last Name</label>
            <input type="text" name="last_name" class="form-control"
                value="<?php echo $editing ? htmlspecialchars($editing['last_name'] ?? '') : ''; ?>">
        </div>
        <div>
            <label class="form-label">Cell Phone</label>
            <input type="text" name="cell_phone" placeholder="+15555550100" class="form-control"
                value="<?php echo $editing ? htmlspecialchars($editing['cell_phone']) : ''; ?>">
        </div>
        <div>
            <label class="form-label">Email</label>
            <input type="email" name="email" class="form-control"
                value="<?php echo $editing ? htmlspecialchars($editing['email'] ?? '') : ''; ?>">
        </div>
        <div>
            <label class="form-label">Routing Preference</label>
            <select name="routing_preference" class="form-control">
                <option value="business_hours" <?php echo ($editing && $editing['routing_preference'] === 'business_hours') ? 'selected' : ''; ?>>Business Hours</option>
                <option value="always_direct"  <?php echo ($editing && $editing['routing_preference'] === 'always_direct')  ? 'selected' : ''; ?>>Always Direct</option>
                <option value="always_screen"  <?php echo ($editing && $editing['routing_preference'] === 'always_screen')  ? 'selected' : ''; ?>>Always Screen</option>
                <option value="message_only"   <?php echo ($editing && $editing['routing_preference'] === 'message_only')   ? 'selected' : ''; ?>>Message Only</option>
            </select>
            <small class="form-hint">
                How routine calls reach this person.
                <strong>Business Hours:</strong> offer to connect while open, take a message when closed.
                <strong>Always Direct:</strong> connect straight away, any time.
                <strong>Always Screen:</strong> always offer to connect or take a message.
                <strong>Message Only:</strong> never connect — not even emergencies, which go to the on-call person or main line.
            </small>
        </div>
        <div>
            <label class="form-label">Notification Preference</label>
            <?php $notif = EMAIL_ENABLED && $editing ? $editing['notification_preference'] : 'sms'; ?>
            <select name="notification_preference" class="form-control">
                <option value="sms" <?php echo $notif === 'sms' ? 'selected' : ''; ?>>SMS Only</option>
                <option value="email" <?php echo $notif === 'email' ? 'selected' : ''; ?> <?php echo EMAIL_ENABLED ? '' : 'disabled'; ?>>Email Only<?php echo EMAIL_ENABLED ? '' : ' (not available yet)'; ?></option>
                <option value="both" <?php echo $notif === 'both' ? 'selected' : ''; ?> <?php echo EMAIL_ENABLED ? '' : 'disabled'; ?>>SMS + Email<?php echo EMAIL_ENABLED ? '' : ' (not available yet)'; ?></option>
            </select>
            <small class="form-hint">How to notify for messages<?php echo EMAIL_ENABLED ? '' : ' — email isn\'t set up yet, so notifications go by SMS'; ?>.</small>
        </div>
        <div style="grid-column: 1 / -1; border-top: 1px solid #ecf0f1; padding-top: 15px;">
            <label class="form-label">Default On-Call Fallback</label>
            <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: normal;">
                <input type="checkbox" name="is_default_oncall" value="1"
                    <?php echo ($editing && $editing['is_default_oncall'] === 't') ? 'checked' : ''; ?>
                    style="width: 16px; height: 16px;">
                Use as default on-call when no one is scheduled
            </label>
            <small class="form-hint">Only one person can be the default. Selecting this will automatically remove the designation from anyone else.</small>
        </div>
        <div style="grid-column: 1 / -1;">
            <label class="form-label">Alternate Names (comma-separated)</label>
            <input type="text" name="alternate_names" class="form-control"
                placeholder="Nicknames or alternate ways callers may refer to this person"
                value="<?php
                    if ($editing && $editing['alternate_names']) {
                        echo htmlspecialchars(implode(', ', pg_parse_text_array($editing['alternate_names'])));
                    }
                ?>">
            <small class="form-hint">How else might callers refer to this person?</small>
        </div>
        <div style="grid-column: 1 / -1;">
            <button type="submit" class="btn btn-success">
                <?php echo $editing ? '✓ Update Person' : '✓ Add Person'; ?>
            </button>
        </div>
    </form>
</div>

<div class="content-card mt-20">
    <h3>Current People</h3>
    <table>
        <thead>
            <tr>
                <th>Name</th><th>Last Name</th><th>Alternate Names</th>
                <th>Cell Phone</th><th>Email</th><th>Routing</th>
                <th>Default On-Call</th><th>Status</th><th>Actions</th>
            </tr>
        </thead>
        <tbody>
            <?php while ($person = pg_fetch_assoc($people)): ?>
            <tr>
                <td><strong><?php echo htmlspecialchars($person['name']); ?></strong></td>
                <td><?php echo htmlspecialchars($person['last_name'] ?? '-'); ?></td>
                <td><?php echo $person['alternate_names'] ? htmlspecialchars(implode(', ', pg_parse_text_array($person['alternate_names']))) : '-'; ?></td>
                <td><?php echo htmlspecialchars($person['cell_phone'] ?? '-'); ?></td>
                <td><?php echo htmlspecialchars($person['email'] ?? '-'); ?></td>
                <td><?php
                    $prefs = ['business_hours'=>'Business Hours','always_direct'=>'Always Direct','always_screen'=>'Always Screen','message_only'=>'Message Only'];
                    echo h($prefs[$person['routing_preference']] ?? $person['routing_preference']);
                ?></td>
                <td style="text-align:center;"><?php echo $person['is_default_oncall'] === 't' ? '✓' : '—'; ?></td>
                <td>
                    <?php if ($person['active'] === 't'): ?>
                        <span class="badge badge-success">Active</span>
                    <?php else: ?>
                        <span class="badge badge-inactive">Inactive</span>
                    <?php endif; ?>
                </td>
                <td>
                    <form method="GET" class="inline-form">
                        <input type="hidden" name="page" value="people">
                        <input type="hidden" name="edit" value="<?php echo $person['id']; ?>">
                        <button type="submit" class="btn btn-primary" style="font-size:12px;">Edit</button>
                    </form>
                    <form method="POST" class="inline-form" style="margin-left:4px;">
        <?= csrf_field() ?>
                        <input type="hidden" name="action"         value="toggle">
                        <input type="hidden" name="id"             value="<?php echo $person['id']; ?>">
                        <input type="hidden" name="current_active" value="<?php echo $person['active']; ?>">
                        <button type="submit" class="btn btn-secondary" style="font-size:12px;">
                            <?php echo $person['active'] === 't' ? 'Disable' : 'Enable'; ?>
                        </button>
                    </form>
                    <form method="POST" class="inline-form" style="margin-left:4px;"
                          data-confirm="Delete this person?">
        <?= csrf_field() ?>
                        <input type="hidden" name="action" value="delete">
                        <input type="hidden" name="id"     value="<?php echo $person['id']; ?>">
                        <button type="submit" class="btn btn-danger" style="font-size:12px;">Delete</button>
                    </form>
                </td>
            </tr>
            <?php endwhile; ?>
        </tbody>
    </table>
</div>
