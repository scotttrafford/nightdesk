<?php require_once 'auth.php'; require_once 'icons.php'; ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= h(branding()['name']) ?></title>
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
            color: white;
        }
        .container { text-align: center; max-width: 900px; padding: 40px 20px; }
        .logo {
            margin-bottom: 40px;
            animation: fadeIn 0.8s ease-in;
            background: white;
            padding: 24px 40px;
            border-radius: 16px;
            display: inline-block;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }
        .logo img { display: block; max-width: min(500px, 75vw); max-height: 160px; width: auto; height: auto; }
        h1 {
            font-size: 32px; font-weight: 300;
            margin-bottom: 16px; color: #ecf0f1;
            animation: fadeIn 1s ease-in 0.2s both;
        }
        .subtitle {
            font-size: 18px; color: #bdc3c7;
            margin-bottom: 50px;
            animation: fadeIn 1s ease-in 0.4s both;
        }
        .user-bar {
            background: rgba(255,255,255,0.08);
            border-radius: 8px;
            padding: 13px 22px;
            margin-bottom: 36px;
            display: inline-flex;
            align-items: center;
            gap: 12px;
            font-size: 14px;
            animation: fadeIn 1s ease-in 0.4s both;
        }
        .user-bar .label   { color: rgba(255,255,255,0.6); }
        .user-bar .name    { font-weight: 600; }
        .user-bar .role    { color: rgba(255,255,255,0.55); font-size: 13px; }
        .user-bar .logout  { color: #f5b7b1; text-decoration: none; font-weight: 600; margin-left: 8px; }
        .user-bar .logout:hover { color: #f1948a; }
        .cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 28px;
            margin-top: 10px;
        }
        .card {
            background: rgba(255,255,255,0.08);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 40px 30px;
            text-decoration: none;
            color: white;
            transition: all 0.25s ease;
            border: 1px solid rgba(255,255,255,0.1);
            animation: fadeInUp 0.6s ease-in both;
        }
        .card:nth-child(1) { animation-delay: 0.5s; }
        .card:nth-child(2) { animation-delay: 0.65s; }
        .card:hover {
            transform: translateY(-6px);
            background: rgba(255,255,255,0.13);
            border-color: rgba(255,255,255,0.25);
            box-shadow: 0 16px 36px rgba(0,0,0,0.3);
        }
        .card-icon { display: block; margin-bottom: 18px; }
        .card h2 { font-size: 22px; margin-bottom: 10px; font-weight: 600; }
        .card p  { font-size: 15px; color: rgba(255,255,255,0.75); line-height: 1.6; }
        @keyframes fadeIn    { from { opacity: 0; }               to { opacity: 1; } }
        @keyframes fadeInUp  { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 600px) {
            h1 { font-size: 24px; }
            .subtitle { font-size: 16px; }
            .logo img { max-height: 110px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">
            <img src="<?= h(branding()['logo']) ?>" alt="<?= h(branding()['name']) ?>">
        </div>

        <h1><?= h(branding()['name']) ?></h1>
        <p class="subtitle"><?= PRODUCT_NAME ?> · AI call sorting and message management</p>

        <div class="user-bar">
            <span class="label">Logged in as</span>
            <span class="name"><?php echo htmlspecialchars($_SESSION['full_name']); ?></span>
            <span class="role">(<?php echo h(ucfirst($_SESSION['role'])); ?>)</span>
            <a href="logout.php" class="logout">Logout</a>
        </div>

        <div class="cards">
            <a href="call-logs.php" class="card">
                <span class="card-icon"><?php echo icon('call-logs', '#ffffff', 48); ?></span>
                <h2>Call Logs</h2>
                <p>View call history, transcripts, and messages received through the system</p>
            </a>
            <a href="admin.php" class="card">
                <span class="card-icon"><?php echo icon('system-config', '#ffffff', 48); ?></span>
                <h2>System Admin</h2>
                <p>Manage people, triggers, business hours, and system configuration</p>
            </a>
        </div>

    </div>
</body>
</html>
