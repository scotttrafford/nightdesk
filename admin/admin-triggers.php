<?php
require_once __DIR__ . '/auth.php';   // also opened directly: require login
$filter_type   = in_array($_GET['filter_type'] ?? '', ['emergency', 'needs_clarification', 'routine', 'operator'], true) ? $_GET['filter_type'] : 'all';
$filter_status = in_array($_GET['filter_status'] ?? '', ['active', 'disabled'], true) ? $_GET['filter_status'] : 'all';
$sort_by       = ($_GET['sort_by'] ?? '') === 'type' ? 'type' : 'priority';

// Filters are whitelisted above; the type is still passed as a parameter
$where_clauses = [];
$params = [];
if ($filter_type !== 'all') {
    $params[] = $filter_type;
    $where_clauses[] = 'trigger_type = $' . count($params);
}
if ($filter_status === 'active')   $where_clauses[] = "active = TRUE";
elseif ($filter_status === 'disabled') $where_clauses[] = "active = FALSE";

$where_sql = !empty($where_clauses) ? 'WHERE ' . implode(' AND ', $where_clauses) : '';
$order_sql  = $sort_by === 'type' ? 'ORDER BY trigger_type, priority DESC' : 'ORDER BY priority DESC, trigger_type';

$emergency_count = pg_fetch_result(pg_query($conn, "SELECT COUNT(*) FROM triggers WHERE trigger_type = 'emergency' AND active = TRUE"), 0);
$soft_count      = pg_fetch_result(pg_query($conn, "SELECT COUNT(*) FROM triggers WHERE trigger_type = 'needs_clarification' AND active = TRUE"), 0);
$routine_count   = pg_fetch_result(pg_query($conn, "SELECT COUNT(*) FROM triggers WHERE trigger_type = 'routine' AND active = TRUE"), 0);
$operator_count  = pg_fetch_result(pg_query($conn, "SELECT COUNT(*) FROM triggers WHERE trigger_type = 'operator' AND active = TRUE"), 0);
$total_active    = pg_fetch_result(pg_query($conn, "SELECT COUNT(*) FROM triggers WHERE active = TRUE"), 0);
$total_matches   = pg_fetch_result(pg_query($conn, "SELECT SUM(times_matched) FROM triggers"), 0) ?? 0;

$triggers_result = pg_query_params($conn, "SELECT * FROM triggers $where_sql $order_sql", $params);
$showing_count   = pg_num_rows($triggers_result);

$editing = null;
if (isset($_GET['edit'])) {
    $edit_id = (int)$_GET['edit'];
    $editing = pg_fetch_assoc(pg_query_params($conn, 'SELECT * FROM triggers WHERE id = $1', [$edit_id]));
}
?>

<div class="page-header">
    <h1>
        <?php echo icon('triggers', 'var(--brand-primary)', 28); ?>
        Triggers Management
    </h1>
    <p>Manage trigger phrases for call routing and emergency detection</p>
</div>

<!-- Stat Cards -->
<div class="stat-cards">
    <a href="?page=triggers&filter_type=emergency&filter_status=all&sort_by=<?php echo $sort_by; ?>"
       class="stat-card stat-card-emergency">
        <div class="stat-number"><?php echo $emergency_count; ?></div>
        <div class="stat-label">Emergency</div>
    </a>
    <a href="?page=triggers&filter_type=needs_clarification&filter_status=all&sort_by=<?php echo $sort_by; ?>"
       class="stat-card stat-card-soft">
        <div class="stat-number"><?php echo $soft_count; ?></div>
        <div class="stat-label">Soft/Urgent</div>
    </a>
    <a href="?page=triggers&filter_type=routine&filter_status=all&sort_by=<?php echo $sort_by; ?>"
       class="stat-card stat-card-routine">
        <div class="stat-number"><?php echo $routine_count; ?></div>
        <div class="stat-label">Routine</div>
    </a>
    <a href="?page=triggers&filter_type=operator&filter_status=all&sort_by=<?php echo $sort_by; ?>"
       class="stat-card stat-card-operator">
        <div class="stat-number"><?php echo $operator_count; ?></div>
        <div class="stat-label">Operator</div>
    </a>
    <a href="?page=triggers&filter_type=all&filter_status=active&sort_by=<?php echo $sort_by; ?>"
       class="stat-card stat-card-total">
        <div class="stat-number"><?php echo $total_active; ?></div>
        <div class="stat-label">Total Active</div>
    </a>
</div>

<!-- Filters -->
<div class="content-card mt-20" style="margin-bottom: 20px;">
    <form method="GET" style="display: flex; gap: 15px; align-items: flex-end;">
        <input type="hidden" name="page" value="triggers">
        <div style="flex: 1;">
            <label class="form-label">Filter by Type</label>
            <select name="filter_type" class="form-control">
                <option value="all"               <?php echo $filter_type === 'all'               ? 'selected' : ''; ?>>All Types</option>
                <option value="emergency"         <?php echo $filter_type === 'emergency'         ? 'selected' : ''; ?>>Emergency</option>
                <option value="needs_clarification" <?php echo $filter_type === 'needs_clarification' ? 'selected' : ''; ?>>Soft/Urgent</option>
                <option value="routine"           <?php echo $filter_type === 'routine'           ? 'selected' : ''; ?>>Routine</option>
                <option value="operator"          <?php echo $filter_type === 'operator'          ? 'selected' : ''; ?>>Operator</option>
            </select>
        </div>
        <div style="flex: 1;">
            <label class="form-label">Filter by Status</label>
            <select name="filter_status" class="form-control">
                <option value="all"      <?php echo $filter_status === 'all'      ? 'selected' : ''; ?>>All Statuses</option>
                <option value="active"   <?php echo $filter_status === 'active'   ? 'selected' : ''; ?>>Active Only</option>
                <option value="disabled" <?php echo $filter_status === 'disabled' ? 'selected' : ''; ?>>Disabled Only</option>
            </select>
        </div>
        <div style="flex: 1;">
            <label class="form-label">Sort By</label>
            <select name="sort_by" class="form-control">
                <option value="priority" <?php echo $sort_by === 'priority' ? 'selected' : ''; ?>>Priority (High to Low)</option>
                <option value="type"     <?php echo $sort_by === 'type'     ? 'selected' : ''; ?>>Type (then Priority)</option>
            </select>
        </div>
        <div>
            <button type="submit" class="btn btn-primary">Apply Filters</button>
        </div>
        <?php if ($filter_type !== 'all' || $filter_status !== 'all' || $sort_by !== 'priority'): ?>
        <div>
            <a href="?page=triggers" class="btn btn-secondary">Clear</a>
        </div>
        <?php endif; ?>
    </form>
</div>

<!-- Add / Edit Form -->
<div class="content-card" style="margin-bottom: 20px;">
    <h3><?php echo $editing ? 'Edit Trigger' : 'Add New Trigger'; ?></h3>
    <form method="POST" style="margin-top: 15px;">
        <?= csrf_field() ?>
        <input type="hidden" name="action"      value="<?php echo $editing ? 'edit' : 'add'; ?>">
        <input type="hidden" name="target_page" value="triggers">
        <?php if ($editing): ?>
        <input type="hidden" name="id" value="<?php echo $editing['id']; ?>">
        <?php endif; ?>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 15px;">
            <div>
                <label class="form-label">Trigger Type</label>
                <select name="trigger_type" required class="form-control">
                    <option value="emergency"         <?php echo ($editing && $editing['trigger_type'] === 'emergency') ? 'selected' : ''; ?>>Emergency (Immediate)</option>
                    <option value="needs_clarification" <?php echo ($editing && $editing['trigger_type'] === 'needs_clarification') ? 'selected' : ''; ?>>Soft/Urgent (Needs Clarification)</option>
                    <option value="routine"           <?php echo ($editing && $editing['trigger_type'] === 'routine') ? 'selected' : ''; ?>>Routine (Not Urgent)</option>
                    <option value="operator"          <?php echo ($editing && $editing['trigger_type'] === 'operator') ? 'selected' : ''; ?>>Operator (Direct Transfer)</option>
                </select>
            </div>
            <div>
                <label class="form-label">Priority (0-1000)</label>
                <input type="number" name="priority" min="0" max="1000" required
                    value="<?php echo $editing ? $editing['priority'] : '100'; ?>"
                    class="form-control">
            </div>
        </div>

        <div style="margin-bottom: 15px;">
            <label class="form-label">Phrase</label>
            <input type="text" name="phrase" required
                value="<?php echo $editing ? htmlspecialchars($editing['phrase']) : ''; ?>"
                placeholder="e.g., emergency, I really need to, I would like to"
                class="form-control">
        </div>

        <div style="margin-bottom: 15px;">
            <label class="form-label">Notes (Optional)</label>
            <textarea name="notes" rows="2" class="form-control"><?php echo $editing ? htmlspecialchars($editing['notes']) : ''; ?></textarea>
        </div>

        <div style="display: flex; gap: 10px;">
            <button type="submit" class="btn btn-success">
                <?php echo $editing ? '✓ Update Trigger' : '+ Add Trigger'; ?>
            </button>
            <?php if ($editing): ?>
            <a href="?page=triggers" class="btn btn-secondary">Cancel</a>
            <?php endif; ?>
        </div>
    </form>
</div>

<!-- Triggers List -->
<div class="content-card">
    <h3>Triggers List <span class="text-muted text-small" style="font-weight:normal;">(Showing <?php echo $showing_count; ?> triggers)</span></h3>
    <table>
        <thead>
            <tr>
                <th>Type</th>
                <th>Phrase</th>
                <th>Priority</th>
                <th>Matches <span class="text-muted text-small">(Total: <?php echo number_format($total_matches); ?>)</span></th>
                <th>Status</th>
                <th>Added</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            <?php
            $type_badge_class = [
                'emergency'          => 'badge-trigger badge-emergency',
                'needs_clarification'=> 'badge-trigger badge-soft',
                'routine'            => 'badge-trigger badge-routine',
                'operator'           => 'badge-trigger badge-operator',
            ];
            $type_labels = [
                'emergency'          => 'Emergency',
                'needs_clarification'=> 'Soft/Urgent',
                'routine'            => 'Routine',
                'operator'           => 'Operator',
            ];
            while ($trigger = pg_fetch_assoc($triggers_result)):
            ?>
            <tr>
                <td>
                    <span class="<?php echo $type_badge_class[$trigger['trigger_type']] ?? 'badge badge-inactive'; ?>">
                        <?php echo h($type_labels[$trigger['trigger_type']] ?? $trigger['trigger_type']); ?>
                    </span>
                </td>
                <td><strong><?php echo htmlspecialchars($trigger['phrase']); ?></strong></td>
                <td><?php echo $trigger['priority']; ?></td>
                <td>
                    <?php if ($trigger['times_matched'] > 0): ?>
                        <span style="color: #1a7a4a; font-weight: bold;"><?php echo $trigger['times_matched']; ?></span>
                    <?php else: ?>
                        <span class="text-muted">0</span>
                    <?php endif; ?>
                </td>
                <td>
                    <?php if ($trigger['active'] === 't'): ?>
                        <span class="badge badge-success">Active</span>
                    <?php else: ?>
                        <span class="badge badge-inactive">Disabled</span>
                    <?php endif; ?>
                </td>
                <td class="text-muted text-small">
                    <?php echo date('M d, Y', strtotime($trigger['added_at'])); ?><br>
                    by <?php echo htmlspecialchars($trigger['added_by']); ?>
                </td>
                <td>
                    <form method="GET" class="inline-form">
                        <input type="hidden" name="page"  value="triggers">
                        <input type="hidden" name="edit"  value="<?php echo $trigger['id']; ?>">
                        <button type="submit" class="btn btn-primary" style="font-size:12px;">Edit</button>
                    </form>

                    <form method="POST" class="inline-form" style="margin-left:4px;">
        <?= csrf_field() ?>
                        <input type="hidden" name="action"         value="toggle">
                        <input type="hidden" name="target_page"    value="triggers">
                        <input type="hidden" name="id"             value="<?php echo $trigger['id']; ?>">
                        <input type="hidden" name="current_active" value="<?php echo $trigger['active']; ?>">
                        <button type="submit" class="btn btn-secondary" style="font-size:12px;">
                            <?php echo $trigger['active'] === 't' ? 'Disable' : 'Enable'; ?>
                        </button>
                    </form>

                    <form method="POST" class="inline-form" style="margin-left:4px;"
                          data-confirm="Delete this trigger?">
        <?= csrf_field() ?>
                        <input type="hidden" name="action"      value="delete">
                        <input type="hidden" name="target_page" value="triggers">
                        <input type="hidden" name="id"          value="<?php echo $trigger['id']; ?>">
                        <button type="submit" class="btn btn-danger" style="font-size:12px;">Delete</button>
                    </form>
                </td>
            </tr>
            <?php endwhile; ?>
            <?php if ($showing_count === 0): ?>
            <tr>
                <td colspan="7" style="text-align: center; color: #7f8c8d; padding: 30px;">
                    No triggers found matching your filters.
                </td>
            </tr>
            <?php endif; ?>
        </tbody>
    </table>
</div>
