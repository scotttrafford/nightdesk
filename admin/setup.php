<?php
/**
 * One-time first-run setup: creates the first admin account and sets the
 * organization's name, logo and colour scheme.
 *
 * Only reachable while setup_available() is true (no users, never completed).
 * On success it records system_config.setup_completed_at inside the same
 * transaction, so the page permanently refuses to run again.
 */
require_once __DIR__ . '/branding.php';
start_session();

$conn = db_connect();
if (!setup_available($conn)) {
    header('Location: index.php');
    exit;
}

$errors = [];
$form = [
    'org_name'  => trim($_POST['org_name']  ?? ''),
    'full_name' => trim($_POST['full_name'] ?? ''),
    'username'  => trim($_POST['username']  ?? ''),
    'email'     => trim($_POST['email']     ?? ''),
    'primary'   => $_POST['primary'] ?? BRAND_DEFAULTS['primary'],
    'accent'    => $_POST['accent']  ?? BRAND_DEFAULTS['accent'],
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    if ($form['org_name'] === '')  $errors[] = 'Organization name is required.';
    if ($form['full_name'] === '') $errors[] = 'Your name is required.';
    if (!preg_match('/^[A-Za-z0-9._-]{3,50}$/', $form['username'])) {
        $errors[] = 'Username must be 3–50 characters: letters, numbers, dot, dash or underscore.';
    }
    if ($form['email'] !== '' && !filter_var($form['email'], FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'Email address is not valid.';
    }
    $password = $_POST['password'] ?? '';
    if ($password !== ($_POST['confirm_password'] ?? '')) {
        $errors[] = 'Passwords do not match.';
    } elseif ($problems = password_problems($password)) {
        $errors[] = 'Password needs: ' . implode(', ', $problems) . '.';
    }
    if (!is_hex_color($form['primary']) || !is_hex_color($form['accent'])) $errors[] = 'Please choose valid colours.';

    // Optional logo (validated and stored by save_logo_upload in branding.php)
    $logo_path = null;
    if (!$errors) {
        [$logo_path, $logo_error] = save_logo_upload($_FILES['logo'] ?? null);
        if ($logo_error) $errors[] = $logo_error;
    }

    if (!$errors) {
        // Lock users so two simultaneous submissions can't both create an admin
        pg_query($conn, 'BEGIN');
        pg_query($conn, 'LOCK TABLE users IN EXCLUSIVE MODE');
        if (!setup_available($conn)) {
            pg_query($conn, 'ROLLBACK');
            header('Location: index.php');
            exit;
        }
        $user = pg_query_params($conn,
            "INSERT INTO users (username, email, password_hash, full_name, role)
             VALUES ($1, NULLIF($2, ''), $3, $4, 'admin') RETURNING id",
            [$form['username'], $form['email'], password_hash($password, PASSWORD_DEFAULT), $form['full_name']]);
        $user_id = (int)pg_fetch_result($user, 0, 0);

        $ok = save_branding($conn, $form['org_name'], $logo_path ?? BRAND_DEFAULTS['logo'], $form['primary'], $form['accent'])
            && pg_query_params($conn,
                "INSERT INTO system_config (key, value, display_name, sort_order, group_name)
                 VALUES ('setup_completed_at', $1, 'Setup Completed', 0, 'Branding')
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                [date('c')]);
        pg_query_params($conn,
            "INSERT INTO audit_log (user_id, username, action, ip_address) VALUES ($1, $2, 'setup_completed', $3)",
            [$user_id, $form['username'], $_SERVER['REMOTE_ADDR'] ?? 'unknown']);

        if ($user_id && $ok && pg_query($conn, 'COMMIT')) {
            session_regenerate_id(true);
            $_SESSION['user_id']       = $user_id;
            $_SESSION['username']      = $form['username'];
            $_SESSION['full_name']     = $form['full_name'];
            $_SESSION['role']          = 'admin';
            $_SESSION['last_activity'] = time();
            header('Location: dashboard.php');
            exit;
        }
        pg_query($conn, 'ROLLBACK');
        delete_uploaded_logo($logo_path);
        $errors[] = 'Setup could not be saved: ' . pg_last_error($conn);
    } else {
        delete_uploaded_logo($logo_path);
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Set up NightDesk</title>
    <link rel="stylesheet" href="brand-picker.css">
    <style>
        :root { --brand-primary: <?= is_hex_color($form['primary']) ? $form['primary'] : BRAND_DEFAULTS['primary'] ?>; --brand-accent: <?= is_hex_color($form['accent']) ? $form['accent'] : BRAND_DEFAULTS['accent'] ?>; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, var(--brand-primary) 0%, color-mix(in srgb, var(--brand-primary) 88%, white) 100%);
            min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 30px 16px;
            color: #2c3e50; font-size: 14px;
        }
        .card { background: white; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.25); width: 100%; max-width: 560px; padding: 36px; }
        .intro { text-align: center; margin-bottom: 26px; }
        .intro img { width: 56px; height: 56px; }
        h1 { color: var(--brand-primary); font-size: 22px; font-weight: 500; margin-top: 10px; }
        .intro p { color: #7f8c8d; margin-top: 6px; }
        fieldset { border: none; margin-bottom: 22px; }
        legend { font-weight: 600; color: var(--brand-primary); font-size: 15px; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 2px solid #ecf0f1; width: 100%; }
        label { display: block; font-weight: 600; font-size: 13px; margin: 12px 0 5px; color: var(--brand-primary); }
        label .opt { font-weight: 400; color: #7f8c8d; }
        input[type=text], input[type=email], input[type=password], input[type=file] {
            width: 100%; padding: 10px 12px; border: 2px solid #dde2e8; border-radius: 6px; font-size: 14px;
        }
        input:focus { outline: none; border-color: var(--brand-accent); }
        .row { display: flex; gap: 14px; }
        .row > div { flex: 1; }
        .hint { font-size: 12px; color: #7f8c8d; margin-top: 5px; }
        .errors { background: #fdecea; border-left: 4px solid #b03a2e; color: #b03a2e; padding: 12px 14px; border-radius: 4px; margin-bottom: 20px; }
        .errors li { margin-left: 16px; }
        button[type=submit] { width: 100%; padding: 12px; background: var(--brand-primary); color: white; border: none; border-radius: 6px; font-size: 15px; cursor: pointer; }
        button[type=submit]:hover { background: color-mix(in srgb, var(--brand-primary) 88%, white); }
    </style>
</head>
<body>
<div class="card">
    <div class="intro">
        <img src="<?= h(BRAND_DEFAULTS['logo']) ?>" alt="">
        <h1>Welcome to NightDesk</h1>
        <p>Create the administrator account and make it yours. This page only appears once.</p>
    </div>

    <?php if ($errors): ?>
        <div class="errors"><ul><?php foreach ($errors as $e): ?><li><?= h($e) ?></li><?php endforeach; ?></ul></div>
    <?php endif; ?>

    <form method="POST" enctype="multipart/form-data">
        <?= csrf_field() ?>

        <fieldset>
            <legend>Your organization</legend>
            <label for="org_name">Organization name</label>
            <input type="text" id="org_name" name="org_name" value="<?= h($form['org_name']) ?>" required autofocus>

            <label for="logo">Logo <span class="opt">(optional — PNG, JPEG or WebP, up to 1 MB)</span></label>
            <input type="file" id="logo" name="logo" accept="image/png,image/jpeg,image/webp">
            <p class="hint">Skip this to use the NightDesk logo. A square image looks best.</p>
        </fieldset>

        <fieldset>
            <legend>Colour scheme</legend>
            <?= brand_picker($form['primary'], $form['accent']) ?>
        </fieldset>

        <fieldset>
            <legend>Administrator account</legend>
            <div class="row">
                <div>
                    <label for="full_name">Your name</label>
                    <input type="text" id="full_name" name="full_name" value="<?= h($form['full_name']) ?>" required>
                </div>
                <div>
                    <label for="username">Username</label>
                    <input type="text" id="username" name="username" value="<?= h($form['username']) ?>" required pattern="[A-Za-z0-9._\-]{3,50}" autocomplete="username">
                </div>
            </div>
            <label for="email">Email <span class="opt">(optional)</span></label>
            <input type="email" id="email" name="email" value="<?= h($form['email']) ?>">
            <div class="row">
                <div>
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" required minlength="12" autocomplete="new-password">
                </div>
                <div>
                    <label for="confirm_password">Confirm password</label>
                    <input type="password" id="confirm_password" name="confirm_password" required autocomplete="new-password">
                </div>
            </div>
            <p class="hint">At least 12 characters with upper- and lowercase letters, a number and a symbol (!@#$%^&amp;*-_+=?).</p>
        </fieldset>

        <button type="submit">Finish setup</button>
    </form>
</div>
<script src="brand-picker.js"></script>
</body>
</html>
