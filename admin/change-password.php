<?php
require_once __DIR__ . '/branding.php';
start_session();

if (!isset($_SESSION['user_id'])) {
    header("Location: index.php");
    exit;
}

$conn = db_connect();

$user_id = (int)$_SESSION['user_id'];
$user = pg_fetch_assoc(pg_query_params($conn, 'SELECT * FROM users WHERE id = $1 AND active = TRUE', [$user_id]));

if (!$user) {
    session_destroy();
    header("Location: index.php");
    exit;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $new_password     = $_POST['new_password']     ?? '';
    $confirm_password = $_POST['confirm_password'] ?? '';

    if ($new_password !== $confirm_password) {
        $error = 'Passwords do not match.';
    } else {
        $validation_errors = password_problems($new_password);
        if (!empty($validation_errors)) {
            $error = 'Password does not meet requirements: ' . implode(', ', $validation_errors) . '.';
        } else {
            pg_query_params($conn, 'UPDATE users SET password_hash = $1 WHERE id = $2',
                [password_hash($new_password, PASSWORD_DEFAULT), $user_id]);
            unset($_SESSION['must_change_password']);
            pg_query_params($conn, "INSERT INTO audit_log (user_id, username, action, ip_address) VALUES ($1, $2, 'password_changed', $3)",
                [$user_id, $user['username'], $_SERVER['REMOTE_ADDR'] ?? 'unknown']);
            header("Location: dashboard.php");
            exit;
        }
    }
}

?>
<!DOCTYPE html>
<html>
<head>
    <title>Change Password — <?= h(branding()['name']) ?></title>
    <?= branding_head() ?>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-primary-light) 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.25);
            width: 440px;
            max-width: 90%;
        }
        .logo-container { text-align: center; margin-bottom: 24px; }
        .logo-container img { height: 70px; width: auto; }
        h1 { text-align: center; color: var(--brand-primary); margin-bottom: 6px; font-size: 22px; font-weight: 500; }
        .subtitle { text-align: center; color: #7f8c8d; margin-bottom: 24px; font-size: 13px; }
        .alert-warning {
            background: #fef9e7; color: #b7770d;
            padding: 12px 14px; border-radius: 4px;
            margin-bottom: 20px; border-left: 4px solid #ca6f1e;
            font-size: 13px;
        }
        .alert-error {
            background: #fdecea; color: #b03a2e;
            padding: 12px 14px; border-radius: 4px;
            margin-bottom: 20px; border-left: 4px solid #b03a2e;
            font-size: 13px;
        }
        .form-group { margin-bottom: 16px; }
        label { display: block; margin-bottom: 5px; color: var(--brand-primary); font-weight: 600; font-size: 13px; }
        input[type="password"] {
            width: 100%; padding: 10px 12px;
            border: 1px solid #dde2e8; border-radius: 4px; font-size: 14px;
            transition: border-color 0.15s;
        }
        input[type="password"]:focus {
            outline: none; border-color: var(--brand-accent);
            box-shadow: 0 0 0 3px rgba(46,134,193,0.1);
        }
        .requirements {
            background: #f8f9fa;
            border: 1px solid #e0e4ea;
            border-radius: 4px;
            padding: 12px 14px;
            margin-bottom: 20px;
            font-size: 12px;
        }
        .requirements p { font-weight: 600; color: var(--brand-primary); margin-bottom: 8px; font-size: 12px; }
        .req-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 3px 0;
            color: #7f8c8d;
            transition: color 0.15s;
        }
        .req-item.met { color: #1a7a4a; }
        .req-item .dot {
            width: 7px; height: 7px;
            border-radius: 50%;
            background: #ccc;
            flex-shrink: 0;
            transition: background 0.15s;
        }
        .req-item.met .dot { background: #1a7a4a; }
        button[type="submit"] {
            width: 100%; padding: 11px;
            background: var(--brand-primary); color: white;
            border: none; border-radius: 4px;
            font-size: 15px; font-weight: 600;
            cursor: pointer; transition: background 0.15s;
        }
        button[type="submit"]:hover { background: var(--brand-primary-light); }
    </style>
</head>
<body>
<div class="container">
    <div class="logo-container">
        <img src="<?= h(branding()['logo']) ?>" alt="<?= h(branding()['name']) ?>">
    </div>
    <h1>Change Your Password</h1>
    <p class="subtitle">You must set a new password before continuing</p>

    <div class="alert-warning">Your account requires a password change before you can access the system.</div>

    <?php if ($error): ?>
    <div class="alert-error"><?php echo htmlspecialchars($error); ?></div>
    <?php endif; ?>

    <form method="POST">
        <?= csrf_field() ?>
        <div class="form-group">
            <label>New Password</label>
            <input type="password" name="new_password" id="new_password" required autofocus
                   >
        </div>
        <div class="form-group">
            <label>Confirm New Password</label>
            <input type="password" name="confirm_password" required>
        </div>

        <div class="requirements">
            <p>Password must meet all of the following:</p>
            <div class="req-item" id="req-length">  <span class="dot"></span> At least 12 characters</div>
            <div class="req-item" id="req-upper">   <span class="dot"></span> At least one uppercase letter</div>
            <div class="req-item" id="req-lower">   <span class="dot"></span> At least one lowercase letter</div>
            <div class="req-item" id="req-number">  <span class="dot"></span> At least one number</div>
            <div class="req-item" id="req-special"> <span class="dot"></span> At least one special character (!@#$%^&*-_+=?)</div>
        </div>

        <button type="submit">Set New Password</button>
    </form>
</div>

    <script src="change-password.js"></script>
</body>
</html>
