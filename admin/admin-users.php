<?php
require_once 'auth.php';
requirePermission('admin');

$editing = null;
if (isset($_GET['edit'])) {
    $edit_id = (int)$_GET['edit'];
    $editing = pg_fetch_assoc(pg_query_params($conn, 'SELECT * FROM users WHERE id = $1', [$edit_id]));
}

$users_result = pg_query($conn, "SELECT * FROM users ORDER BY created_at DESC");
?>

<div class="page-header">
    <h1>
        <?php echo icon('users', 'var(--brand-primary)', 28); ?>
        User Management
    </h1>
    <p>Manage system users and permissions</p>
</div>

<div class="content-card" style="margin-bottom: 20px;">
    <h3><?php echo $editing ? 'Edit User' : 'Add New User'; ?></h3>
    <form method="POST" action="admin-users-handler.php" style="margin-top: 15px;">
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="<?php echo $editing ? 'edit' : 'add'; ?>">
        <?php if ($editing): ?>
        <input type="hidden" name="id" value="<?php echo $editing['id']; ?>">
        <?php endif; ?>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 15px;">
            <div>
                <label class="form-label">Username</label>
                <input type="text" name="username" required
                    value="<?php echo $editing ? htmlspecialchars($editing['username']) : ''; ?>"
                    <?php echo $editing ? 'readonly' : ''; ?>
                    class="form-control">
            </div>
            <div>
                <label class="form-label">Full Name</label>
                <input type="text" name="full_name" required
                    value="<?php echo $editing ? htmlspecialchars($editing['full_name']) : ''; ?>"
                    class="form-control">
            </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 15px;">
            <div>
                <label class="form-label">Email</label>
                <input type="email" name="email"
                    value="<?php echo $editing ? htmlspecialchars($editing['email']) : ''; ?>"
                    class="form-control">
            </div>
            <div>
                <label class="form-label">Role</label>
                <select name="role" required class="form-control">
                    <option value="viewer" <?php echo ($editing && $editing['role'] === 'viewer') ? 'selected' : ''; ?>>Viewer (Read Only)</option>
                    <option value="editor" <?php echo ($editing && $editing['role'] === 'editor') ? 'selected' : ''; ?>>Editor (Can Edit)</option>
                    <option value="admin"  <?php echo ($editing && $editing['role'] === 'admin')  ? 'selected' : ''; ?>>Admin (Full Access)</option>
                </select>
            </div>
        </div>

        <div style="margin-bottom: 15px;">
            <label class="form-label"><?php echo $editing ? 'New Password (leave blank to keep current)' : 'Password'; ?></label>
            <input type="password" name="password" <?php echo !$editing ? 'required' : ''; ?> class="form-control">
            <small class="form-hint"><?php echo $editing ? 'Only fill this if you want to change the password' : 'Minimum 8 characters'; ?></small>
        </div>

        <div style="display: flex; gap: 10px;">
            <button type="submit" class="btn btn-success">
                <?php echo $editing ? 'Update User' : 'Add User'; ?>
            </button>
            <?php if ($editing): ?>
            <a href="?page=users" class="btn btn-secondary">Cancel</a>
            <?php endif; ?>
        </div>
    </form>
</div>

<div class="content-card">
    <h3>System Users</h3>
    <table>
        <thead>
            <tr>
                <th>Username</th>
                <th>Full Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            <?php while ($user = pg_fetch_assoc($users_result)): ?>
            <tr>
                <td><strong><?php echo htmlspecialchars($user['username']); ?></strong></td>
                <td><?php echo htmlspecialchars($user['full_name']); ?></td>
                <td><?php echo htmlspecialchars($user['email'] ?? '-'); ?></td>
                <td>
                    <span class="badge-role badge-role-<?php echo htmlspecialchars($user['role']); ?>">
                        <?php
                        $role_labels = ['admin' => 'Admin', 'editor' => 'Editor', 'viewer' => 'Viewer'];
                        echo h($role_labels[$user['role']] ?? $user['role']);
                        ?>
                    </span>
                </td>
                <td>
                    <?php if ($user['active'] === 't'): ?>
                        <span class="badge badge-success">Active</span>
                    <?php else: ?>
                        <span class="badge badge-inactive">Disabled</span>
                    <?php endif; ?>
                </td>
                <td class="text-muted text-small">
                    <?php echo $user['last_login'] ? date('M d, Y g:i A', strtotime($user['last_login'])) : 'Never'; ?>
                </td>
                <td>
                    <form method="GET" class="inline-form">
                        <input type="hidden" name="page" value="users">
                        <input type="hidden" name="edit" value="<?php echo $user['id']; ?>">
                        <button type="submit" class="btn btn-primary" style="font-size:12px;">Edit</button>
                    </form>

                    <?php if ($user['id'] != $_SESSION['user_id']): ?>
                    <form method="POST" action="admin-users-handler.php" class="inline-form" style="margin-left:4px;">
        <?= csrf_field() ?>
                        <input type="hidden" name="action"         value="toggle">
                        <input type="hidden" name="id"             value="<?php echo $user['id']; ?>">
                        <input type="hidden" name="current_active" value="<?php echo $user['active']; ?>">
                        <button type="submit" class="btn btn-secondary" style="font-size:12px;">
                            <?php echo $user['active'] === 't' ? 'Disable' : 'Enable'; ?>
                        </button>
                    </form>
                    <?php endif; ?>
                </td>
            </tr>
            <?php endwhile; ?>
        </tbody>
    </table>
</div>
