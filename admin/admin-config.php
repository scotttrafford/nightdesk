<?php
require_once __DIR__ . '/auth.php';   // also opened directly: require login
$config_result = pg_query($conn, "SELECT * FROM system_config WHERE group_name IS DISTINCT FROM 'Branding' ORDER BY group_name, sort_order, key");
$configs = [];
$groups  = [];
while ($row = pg_fetch_assoc($config_result)) {
    $configs[$row['key']] = $row;
    $group = $row['group_name'] ?: 'Other';
    if (!isset($groups[$group])) $groups[$group] = [];
    $groups[$group][] = $row;
}

$group_icons = [
    'Phone Numbers'      => 'phone-numbers',
    'Timing'             => 'timing',
    'Greetings'          => 'greetings',
    'Call Flow Messages' => 'call-flow-messages',
    'Emergency'          => 'emergency',
    'System'             => 'system-config',
    'Other'              => null,
];
?>

<div class="page-header">
    <h1>
        <?php echo icon('system-config', 'var(--brand-primary)', 28); ?>
        System Configuration
    </h1>
    <p>Configure system-wide settings and messages</p>
</div>

<div class="content-card">
    <form method="POST">
        <?= csrf_field() ?>
        <input type="hidden" name="action"      value="update">
        <input type="hidden" name="target_page" value="config">

        <?php foreach ($groups as $group_name => $fields): ?>
        <h3 style="margin: 30px 0 16px; padding-bottom: 10px; border-bottom: 2px solid #ecf0f1; display:flex; align-items:center; gap:10px;">
            <?php
            $icon_name = $group_icons[$group_name] ?? null;
            if ($icon_name) echo icon($icon_name, 'var(--brand-primary)', 20);
            echo htmlspecialchars($group_name);
            ?>
        </h3>

        <?php
        $use_grid = in_array($group_name, ['Phone Numbers', 'Timing']);
        if ($use_grid) echo '<div style="display:grid; grid-template-columns:repeat(2,1fr); gap:15px;">';
        ?>

        <?php foreach ($fields as $field):
            $key   = $field['key'];
            $value = $field['value'] ?? '';
            $label = $field['display_name'] ?: $key;
            $desc  = $field['description'] ?? '';
            $type  = $field['field_type'] ?: 'text';
        ?>
        <div style="margin-bottom:15px;">
            <label class="form-label"><?php echo htmlspecialchars($label); ?></label>

            <?php if ($type === 'textarea'): ?>
                <textarea name="<?php echo htmlspecialchars($key); ?>" rows="3"
                    class="form-control"><?php echo htmlspecialchars($value); ?></textarea>

            <?php elseif ($type === 'boolean'): ?>
                <select name="<?php echo htmlspecialchars($key); ?>" class="form-control">
                    <option value="yes" <?php echo $value === 'yes' ? 'selected' : ''; ?>>Yes</option>
                    <option value="no"  <?php echo $value === 'no'  ? 'selected' : ''; ?>>No</option>
                </select>

            <?php elseif ($key === 'timezone'): ?>
                <select name="timezone" class="form-control">
                    <?php
                    $timezones = [
                        'America/Toronto'     => 'America/Toronto (EST/EDT)',
                        'America/New_York'    => 'America/New_York (EST/EDT)',
                        'America/Los_Angeles' => 'America/Los_Angeles (PST/PDT)',
                        'America/Chicago'     => 'America/Chicago (CST/CDT)',
                        'America/Denver'      => 'America/Denver (MST/MDT)',
                        'UTC'                 => 'UTC',
                    ];
                    foreach ($timezones as $tz_val => $tz_label):
                    ?>
                    <option value="<?php echo $tz_val; ?>" <?php echo $value === $tz_val ? 'selected' : ''; ?>>
                        <?php echo $tz_label; ?>
                    </option>
                    <?php endforeach; ?>
                </select>

            <?php else: ?>
                <input type="text" name="<?php echo htmlspecialchars($key); ?>"
                    value="<?php echo htmlspecialchars($value); ?>"
                    class="form-control">
            <?php endif; ?>

            <?php if ($desc): ?>
                <small class="form-hint"><?php echo htmlspecialchars($desc); ?></small>
            <?php endif; ?>
        </div>
        <?php endforeach; ?>

        <?php if ($use_grid) echo '</div>'; ?>
        <?php endforeach; ?>

        <div style="padding-top:20px; border-top:2px solid #ecf0f1; margin-top:10px;">
            <button type="submit" class="btn btn-success">✓ Save Configuration</button>
        </div>
    </form>
</div>

<div class="content-card mt-20">
    <h3>Configuration Reference</h3>
    <table>
        <thead>
            <tr>
                <th>Key</th>
                <th>Current Value</th>
                <th>Last Updated</th>
                <th>Description</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($configs as $key => $config): ?>
            <tr>
                <td><code><?php echo htmlspecialchars($key); ?></code></td>
                <td><?php echo htmlspecialchars(strlen($config['value']) > 50 ? substr($config['value'], 0, 50) . '...' : $config['value']); ?></td>
                <td class="text-muted text-small">
                    <?php echo $config['updated_at'] ? date('M d, Y g:i A', strtotime($config['updated_at'])) : 'Never'; ?>
                </td>
                <td class="text-muted text-small"><?php echo htmlspecialchars($config['description'] ?? ''); ?></td>
            </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
</div>
