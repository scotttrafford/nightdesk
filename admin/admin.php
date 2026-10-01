<?php
require_once 'auth.php';
require_once 'icons.php';

// $conn comes from auth.php (database settings in .env — see config.php)

$page = $_GET['page'] ?? 'people';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    $target_page = $_POST['target_page'] ?? $page;

    if ($target_page === 'people')   include 'admin-people-handler.php';
    elseif ($target_page === 'triggers') include 'admin-triggers-handler.php';
    elseif ($target_page === 'hours')    include 'admin-hours-handler.php';
    elseif ($target_page === 'oncall')   include 'admin-oncall-handler.php';
    elseif ($target_page === 'config')   include 'admin-config-handler.php';
    elseif ($target_page === 'users')    include 'admin-users-handler.php';
    elseif ($target_page === 'branding') include 'admin-branding-handler.php';

    header("Location: ?page=" . urlencode($page));
    exit;
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>Admin — <?= h(branding()['name']) ?></title>
    <link rel="stylesheet" href="style.css">
    <?= branding_head() ?>
</head>
<body>
    <div class="container">
        <div class="sidebar">
            <div class="sidebar-header">
                <div class="sidebar-logo">
                    <img src="<?= h(branding()['logo']) ?>" alt="<?= h(branding()['name']) ?>">
                </div>
                <div>
                    <h2 class="sidebar-title"><?= h(branding()['name']) ?></h2>
                    <div class="sidebar-product"><?= PRODUCT_NAME ?></div>
                </div>
            </div>

            <div class="sidebar-user">
                <div class="user-label">Logged in as</div>
                <div class="user-name"><?php echo htmlspecialchars($_SESSION['full_name']); ?></div>
                <div class="user-role"><?php
                    $role_labels = ['admin' => 'Administrator', 'editor' => 'Editor', 'viewer' => 'Viewer'];
                    echo h($role_labels[$_SESSION['role']] ?? $_SESSION['role']);
                ?></div>
                <a href="logout.php" class="btn-logout">Logout</a>
            </div>

            <?php if (hasPermission('admin')): ?>
            <div class="nav-item <?php echo $page === 'users' ? 'active' : ''; ?>">
                <a href="?page=users">
                    <?php echo icon('users', $page === 'users' ? '#ffffff' : 'rgba(255,255,255,0.65)', 18); ?>
                    Users
                </a>
            </div>
            <div class="nav-item <?php echo $page === 'branding' ? 'active' : ''; ?>">
                <a href="?page=branding">
                    <?php echo icon('branding', $page === 'branding' ? '#ffffff' : 'rgba(255,255,255,0.65)', 18); ?>
                    Branding
                </a>
            </div>
            <div class="nav-item <?php echo $page === 'audit' ? 'active' : ''; ?>">
                <a href="?page=audit">
                    <?php echo icon('audit-log', $page === 'audit' ? '#ffffff' : 'rgba(255,255,255,0.65)', 18); ?>
                    Audit Log
                </a>
            </div>
            <div class="nav-divider"></div>
            <?php endif; ?>

            <div class="nav-item <?php echo $page === 'people' ? 'active' : ''; ?>">
                <a href="?page=people">
                    <?php echo icon('people', $page === 'people' ? '#ffffff' : 'rgba(255,255,255,0.65)', 18); ?>
                    People
                </a>
            </div>
            <div class="nav-item <?php echo $page === 'triggers' ? 'active' : ''; ?>">
                <a href="?page=triggers">
                    <?php echo icon('triggers', $page === 'triggers' ? '#ffffff' : 'rgba(255,255,255,0.65)', 18); ?>
                    Triggers
                </a>
            </div>
            <div class="nav-item <?php echo $page === 'hours' ? 'active' : ''; ?>">
                <a href="?page=hours">
                    <?php echo icon('business-hours', $page === 'hours' ? '#ffffff' : 'rgba(255,255,255,0.65)', 18); ?>
                    Business Hours
                </a>
            </div>
            <div class="nav-item <?php echo $page === 'oncall' ? 'active' : ''; ?>">
                <a href="?page=oncall">
                    <?php echo icon('on-call', $page === 'oncall' ? '#ffffff' : 'rgba(255,255,255,0.65)', 18); ?>
                    On-Call Schedule
                </a>
            </div>
            <div class="nav-item <?php echo $page === 'config' ? 'active' : ''; ?>">
                <a href="?page=config">
                    <?php echo icon('system-config', $page === 'config' ? '#ffffff' : 'rgba(255,255,255,0.65)', 18); ?>
                    System Config
                </a>
            </div>
            <div class="nav-item">
                <a href="call-logs.php">
                    <?php echo icon('call-logs', 'rgba(255,255,255,0.65)', 18); ?>
                    Call Logs
                </a>
            </div>

            <div class="nav-divider"></div>
            <div class="nav-item nav-back">
                <a href="dashboard.php">← Back to Dashboard</a>
            </div>
        </div>

        <div class="main-content">
            <?php
            switch($page) {
                case 'people':   include 'admin-people.php';   break;
                case 'triggers': include 'admin-triggers.php'; break;
                case 'hours':    include 'admin-hours.php';    break;
                case 'oncall':   include 'admin-oncall.php';   break;
                case 'config':   include 'admin-config.php';   break;
                case 'users':    include 'admin-users.php';    break;
                case 'audit':    include 'admin-audit.php';    break;
                case 'branding': include 'admin-branding.php'; break;
                default: echo '<div class="page-header"><h1>Welcome</h1></div>';
            }
            ?>
        </div>
    </div>
    <script src="admin.js"></script>
</body>
</html>
