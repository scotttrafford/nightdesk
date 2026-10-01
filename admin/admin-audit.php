<?php
require_once 'auth.php';
requirePermission('admin');

$limit  = 50;
$offset = isset($_GET['offset']) ? (int)$_GET['offset'] : 0;

$count_result = pg_query($conn, "SELECT COUNT(*) FROM audit_log");
$total        = pg_fetch_result($count_result, 0);

$audit_result = pg_query_params($conn, 'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2', [$limit, max(0, $offset)]);
?>

<div class="page-header">
    <h1>
        <?php echo icon('audit-log', 'var(--brand-primary)', 28); ?>
        Audit Log
    </h1>
    <p>System activity and change history</p>
</div>

<div class="content-card">
    <h3>Recent Activity <span class="text-muted text-small" style="font-weight:normal;">(<?php echo number_format($total); ?> total events)</span></h3>

    <table>
        <thead>
            <tr>
                <th style="width:180px;">Timestamp</th>
                <th style="width:120px;">User</th>
                <th style="width:160px;">Action</th>
                <th style="width:100px;">Table</th>
                <th style="width:80px;">Record ID</th>
                <th>Details</th>
                <th style="width:120px;">IP Address</th>
            </tr>
        </thead>
        <tbody>
            <?php while ($log = pg_fetch_assoc($audit_result)):
                $action = $log['action'];
                if ($action === 'login')          $cls = 'badge-action badge-action-login';
                elseif ($action === 'logout')      $cls = 'badge-action badge-action-logout';
                elseif ($action === 'login_failed') $cls = 'badge-action badge-action-failed';
                elseif (str_ends_with($action, '_created') || str_ends_with($action, '_enabled')) $cls = 'badge-action badge-action-created';
                elseif (str_ends_with($action, '_deleted') || str_ends_with($action, '_disabled')) $cls = 'badge-action badge-action-deleted';
                elseif (str_ends_with($action, '_updated') || str_ends_with($action, '_toggled'))  $cls = 'badge-action badge-action-updated';
                else $cls = 'badge-action badge-action-default';
            ?>
            <tr>
                <td class="text-small"><?php echo date('M d, Y g:i:s A', strtotime($log['created_at'])); ?></td>
                <td><strong><?php echo htmlspecialchars($log['username']); ?></strong></td>
                <td><span class="<?php echo $cls; ?>"><?php echo htmlspecialchars($log['action']); ?></span></td>
                <td><?php echo htmlspecialchars($log['table_name'] ?? '-'); ?></td>
                <td><?php echo htmlspecialchars($log['record_id'] ?? '-'); ?></td>
                <td class="text-small">
                    <?php if ($log['new_value']): ?>
                        <?php echo htmlspecialchars(substr($log['new_value'], 0, 100)); ?>
                        <?php if (strlen($log['new_value']) > 100): ?>…<?php endif; ?>
                    <?php else: ?>-<?php endif; ?>
                </td>
                <td class="text-mono text-small"><?php echo htmlspecialchars($log['ip_address']); ?></td>
            </tr>
            <?php endwhile; ?>
        </tbody>
    </table>

    <div class="pagination">
        <div>
            <?php if ($offset > 0): ?>
                <a href="?page=audit&offset=<?php echo max(0, $offset - $limit); ?>" class="btn btn-primary">← Previous</a>
            <?php endif; ?>
        </div>
        <div class="page-info">
            Showing <?php echo number_format($offset + 1); ?> – <?php echo number_format(min($offset + $limit, $total)); ?> of <?php echo number_format($total); ?>
        </div>
        <div>
            <?php if ($offset + $limit < $total): ?>
                <a href="?page=audit&offset=<?php echo $offset + $limit; ?>" class="btn btn-primary">Next →</a>
            <?php endif; ?>
        </div>
    </div>
</div>
