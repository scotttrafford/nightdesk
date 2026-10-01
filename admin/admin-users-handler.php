<?php
require_once 'auth.php';
requirePermission('admin'); // Only admins can manage users

const USER_ROLES = ['viewer', 'editor', 'admin'];

switch ($_POST['action']) {
    case 'add':
        $username = trim($_POST['username'] ?? '');
        $role     = in_array($_POST['role'] ?? '', USER_ROLES, true) ? $_POST['role'] : 'viewer';

        $check = pg_query_params($conn, 'SELECT id FROM users WHERE username = $1', [$username]);
        if (pg_num_rows($check) > 0) {
            die("Username already exists");
        }

        // No strength check here: the admin sets a temporary password, and the
        // user is made to change it at first login.
        pg_query_params($conn,
            'INSERT INTO users (username, email, password_hash, full_name, role, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
            [$username, $_POST['email'] ?? '', password_hash($_POST['password'] ?? '', PASSWORD_DEFAULT),
             $_POST['full_name'] ?? '', $role, (int)$_SESSION['user_id']]);

        logAudit('user_created', 'users', null, null, "Created user: $username ($role)");
        break;

    case 'edit':
        $id        = (int)$_POST['id'];
        $full_name = $_POST['full_name'] ?? '';
        $email     = $_POST['email'] ?? '';
        $role      = in_array($_POST['role'] ?? '', USER_ROLES, true) ? $_POST['role'] : 'viewer';
        $old       = pg_fetch_assoc(pg_query_params($conn, 'SELECT * FROM users WHERE id = $1', [$id]));

        if (!empty($_POST['password'])) {
            // A new password set by an admin must meet the policy
            $pwd_errors = password_problems($_POST['password']);
            if (!empty($pwd_errors)) {
                die("Password does not meet requirements: " . implode(', ', $pwd_errors));
            }
            pg_query_params($conn,
                'UPDATE users SET full_name = $1, email = $2, role = $3, password_hash = $4 WHERE id = $5',
                [$full_name, $email, $role, password_hash($_POST['password'], PASSWORD_DEFAULT), $id]);
        } else {
            pg_query_params($conn,
                'UPDATE users SET full_name = $1, email = $2, role = $3 WHERE id = $4',
                [$full_name, $email, $role, $id]);
        }

        $changes = [];
        if ($old['full_name'] != $full_name) $changes[] = "name: {$old['full_name']} → $full_name";
        if ($old['email'] != $email)         $changes[] = "email: {$old['email']} → $email";
        if ($old['role'] != $role)           $changes[] = "role: {$old['role']} → $role";
        if (!empty($_POST['password']))      $changes[] = "password changed";
        logAudit('user_updated', 'users', $id, null, implode(', ', $changes));
        break;

    case 'toggle':
        $id     = (int)$_POST['id'];
        $active = $_POST['current_active'] === 't' ? 'f' : 't';

        // Don't allow users to disable themselves
        if ($id == $_SESSION['user_id']) {
            die("You cannot disable your own account");
        }

        pg_query_params($conn, 'UPDATE users SET active = $1 WHERE id = $2', [$active, $id]);
        logAudit('user_toggled', 'users', $id, null, 'User ' . ($active === 't' ? 'enabled' : 'disabled'));
        break;
}

header("Location: admin.php?page=users");
exit;
