<?php
require_once __DIR__ . '/auth.php';   // also opened directly: require login
$hours_result = pg_query($conn, "SELECT * FROM business_hours ORDER BY day_of_week");
$hours = [];
while ($row = pg_fetch_assoc($hours_result)) {
    $hours[$row['day_of_week']] = $row;
}

$days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

$tz_result = pg_query($conn, "SELECT value FROM system_config WHERE key = 'timezone'");
$timezone = pg_fetch_assoc($tz_result)['value'] ?? 'America/Toronto';

date_default_timezone_set($timezone);
$current_day  = (int)date('w');
$current_time = date('H:i:s');
$today        = $hours[$current_day];
$is_open      = !($today['is_closed'] === 't') &&
                $current_time >= $today['open_time'] &&
                $current_time <= $today['close_time'];
?>

<div class="page-header">
    <h1>
        <?php echo icon('business-hours', 'var(--brand-primary)', 28); ?>
        Business Hours
    </h1>
    <p>Configure when your business is open for calls</p>
</div>

<div class="card-status">
    <h3 style="margin-bottom:10px;">Current Status</h3>
    <?php if ($is_open): ?>
        <div class="status-open">✅ OPEN</div>
    <?php else: ?>
        <div class="status-closed">⛔ CLOSED</div>
    <?php endif; ?>
    <p class="text-muted" style="margin-top:5px;">
        <?php echo $days[$current_day] . ', ' . date('g:i A'); ?> (<?php echo $timezone; ?>)
    </p>
</div>

<div class="content-card">
    <h3>Weekly Schedule</h3>
    <form method="POST" style="margin-top:16px;">
        <?= csrf_field() ?>
        <input type="hidden" name="action"      value="update">
        <input type="hidden" name="target_page" value="hours">

        <table>
            <thead>
                <tr>
                    <th style="width:150px;">Day</th>
                    <th style="width:160px;">Status</th>
                    <th style="width:180px;">Open Time</th>
                    <th style="width:180px;">Close Time</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($days as $day_num => $day_name):
                    $day_hours = $hours[$day_num];
                    $closed    = $day_hours['is_closed'] === 't';
                ?>
                <tr>
                    <td><strong><?php echo $day_name; ?></strong></td>
                    <td>
                        <label style="display:flex; align-items:center; cursor:pointer; gap:8px; font-weight:normal;">
                            <input type="checkbox" name="is_closed_<?php echo $day_num; ?>"
                                <?php echo $closed ? 'checked' : ''; ?>
                                class="day-closed-toggle" data-day="<?php echo $day_num; ?>">
                            Closed
                        </label>
                    </td>
                    <td>
                        <input type="time"
                            id="open_time_<?php echo $day_num; ?>"
                            name="open_time_<?php echo $day_num; ?>"
                            value="<?php echo substr($day_hours['open_time'], 0, 5); ?>"
                            <?php echo $closed ? 'readonly' : ''; ?>
                            class="form-control"
                            style="width:auto; <?php echo $closed ? 'background:#f5f5f5; color:#999;' : ''; ?>">
                    </td>
                    <td>
                        <input type="time"
                            id="close_time_<?php echo $day_num; ?>"
                            name="close_time_<?php echo $day_num; ?>"
                            value="<?php echo substr($day_hours['close_time'], 0, 5); ?>"
                            <?php echo $closed ? 'readonly' : ''; ?>
                            class="form-control"
                            style="width:auto; <?php echo $closed ? 'background:#f5f5f5; color:#999;' : ''; ?>">
                    </td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>

        <div style="margin-top:20px;">
            <button type="submit" class="btn btn-success">✓ Save Business Hours</button>
        </div>
    </form>
</div>

