<?php
require_once __DIR__ . '/branding.php';
start_session();

if (isset($_SESSION['user_id'])) {
    header("Location: dashboard.php");
    exit;
}

// Fresh install: send the first visitor to one-time setup
if (setup_available(db_connect())) {
    header("Location: setup.php");
    exit;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $conn = db_connect();

    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

    // Rate limiting: LOGIN_MAX_ATTEMPTS failures per IP within LOGIN_LOCKOUT_MINS
    $rate_check = pg_query_params($conn,
        "SELECT COUNT(*) AS attempts FROM audit_log
         WHERE action = 'login_failed' AND ip_address = $1
           AND created_at > NOW() - make_interval(mins => $2)",
        [$ip, LOGIN_LOCKOUT_MINS]);
    $rate_row = pg_fetch_assoc($rate_check);
    if ((int)$rate_row['attempts'] >= LOGIN_MAX_ATTEMPTS) {
        $error = 'Too many failed attempts. Please try again in ' . LOGIN_LOCKOUT_MINS . ' minutes.';
    } else {

    $username       = $_POST['username'] ?? '';
    $password_input = $_POST['password'] ?? '';

    $result    = pg_query_params($conn, 'SELECT * FROM users WHERE username = $1 AND active = TRUE', [$username]);
    $user_data = pg_fetch_assoc($result);

    if ($user_data && password_verify($password_input, $user_data['password_hash'])) {
        session_regenerate_id(true);   // new session ID at login (prevents session fixation)
        $_SESSION['user_id']       = $user_data['id'];
        $_SESSION['username']      = $user_data['username'];
        $_SESSION['full_name']     = $user_data['full_name'];
        $_SESSION['role']          = $user_data['role'];
        $_SESSION['last_activity'] = time();

        $user_id = (int)$user_data['id'];
        pg_query_params($conn, 'UPDATE users SET last_login = NOW() WHERE id = $1', [$user_id]);
        pg_query_params($conn, "INSERT INTO audit_log (user_id, username, action, ip_address) VALUES ($1, $2, 'login', $3)",
            [$user_id, $user_data['username'], $ip]);

        // A weak password must be changed before anything else (enforced in auth.php)
        $weak = !empty(password_problems($password_input));
        $_SESSION['must_change_password'] = $weak;
        header("Location: " . ($weak ? "change-password.php" : "dashboard.php"));
        exit;
    } else {
        $error = 'Invalid username or password';
        pg_query_params($conn, "INSERT INTO audit_log (username, action, ip_address) VALUES ($1, 'login_failed', $2)",
            [substr($username, 0, 50), $ip]);
    }

    } // end rate limit else
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>Login — <?= h(branding()['name']) ?></title>
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
        .login-container {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.25);
            width: 400px;
            max-width: 90%;
        }
        .logo-container { text-align: center; margin-bottom: 28px; }
        .logo-container img { height: 80px; width: auto; }
        h1 { text-align: center; color: var(--brand-primary); margin-bottom: 6px; font-size: 22px; font-weight: 500; }
        .subtitle { text-align: center; color: #7f8c8d; margin-bottom: 28px; font-size: 13px; }
        .alert-error {
            background: #fdecea; color: #b03a2e;
            padding: 12px; border-radius: 4px;
            margin-bottom: 18px; border-left: 4px solid #b03a2e;
            font-size: 13px;
        }
        .alert-warning {
            background: #fef9e7; color: #b7770d;
            padding: 12px; border-radius: 4px;
            margin-bottom: 18px; border-left: 4px solid #ca6f1e;
            font-size: 13px;
        }
        .form-group { margin-bottom: 18px; }
        label { display: block; margin-bottom: 5px; color: var(--brand-primary); font-weight: 600; font-size: 13px; }
        input[type="text"], input[type="password"] {
            width: 100%; padding: 10px 12px;
            border: 1px solid #dde2e8; border-radius: 4px; font-size: 14px;
            transition: border-color 0.15s;
        }
        input[type="text"]:focus, input[type="password"]:focus {
            outline: none; border-color: var(--brand-accent);
            box-shadow: 0 0 0 3px rgba(46,134,193,0.1);
        }
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
    <div class="login-container">
        <div class="logo-container">
            <img src="<?= h(branding()['logo']) ?>" alt="<?= h(branding()['name']) ?>">
        </div>
        <h1><?= h(branding()['name']) ?></h1>
        <p class="subtitle">Sign in to <?= PRODUCT_NAME ?></p>

        <?php if ($error): ?>
            <div class="alert-error"><?php echo htmlspecialchars($error); ?></div>
        <?php endif; ?>
        <?php if (isset($_GET['timeout'])): ?>
            <div class="alert-warning">Your session has expired. Please log in again.</div>
        <?php endif; ?>
        <?php if (isset($_GET['logout'])): ?>
            <div class="alert-warning">You have been logged out successfully.</div>
        <?php endif; ?>

        <form method="POST">
        <?= csrf_field() ?>
            <div class="form-group">
                <label>Username</label>
                <input type="text" name="username" required autofocus>
            </div>
            <div class="form-group">
                <label>Password</label>
                <input type="password" name="password" required>
            </div>
            <button type="submit">Sign In</button>
        </form>

    </div>
</body>
</html>
