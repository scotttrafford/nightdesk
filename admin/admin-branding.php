<?php
require_once __DIR__ . '/auth.php';   // also opened directly: require login
requirePermission('admin');

$brand = branding();
$is_default_logo = $brand['logo'] === BRAND_DEFAULTS['logo'];
$flash = $_SESSION['branding_flash'] ?? null;
unset($_SESSION['branding_flash']);
?>
<link rel="stylesheet" href="brand-picker.css">

<div class="page-header">
    <h1>
        <?php echo icon('branding', 'var(--brand-primary)', 28); ?>
        Branding
    </h1>
    <p>Your organization's name, logo and colours, shown throughout the admin panel</p>
</div>

<?php if ($flash): ?>
    <div class="alert <?= $flash['ok'] ? 'alert-success' : 'alert-error' ?>"><?= h($flash['message']) ?></div>
<?php endif; ?>

<div class="content-card">
    <form method="POST" action="?page=branding" enctype="multipart/form-data">
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="update">
        <input type="hidden" name="target_page" value="branding">

        <label class="form-label">Organization name</label>
        <input type="text" name="brand_name" class="form-control" value="<?= h($brand['name']) ?>" required maxlength="100" style="max-width: 420px;">

        <label class="form-label" style="margin-top: 20px;">Logo</label>
        <div style="display: flex; align-items: center; gap: 16px;">
            <img src="<?= h($brand['logo']) ?>" alt="Current logo" style="height: 64px; width: auto; border: 1px solid #dde2e8; border-radius: 6px; padding: 4px; background: white;">
            <div>
                <input type="file" name="logo" accept="image/png,image/jpeg,image/webp">
                <small class="form-hint">PNG, JPEG or WebP, up to 1 MB. A square image looks best.</small>
                <?php if (!$is_default_logo): ?>
                <label style="display: inline-flex; align-items: center; gap: 8px; font-weight: normal; margin-top: 6px;">
                    <input type="checkbox" name="reset_logo" value="1"> Use the default <?= PRODUCT_NAME ?> logo instead
                </label>
                <?php endif; ?>
            </div>
        </div>

        <label class="form-label" style="margin-top: 20px;">Colour scheme</label>
        <?= brand_picker($brand['primary'], $brand['accent']) ?>
        <small class="form-hint">The whole page previews your choice as you pick. Nothing changes for other users until you save.</small>

        <div style="margin-top: 24px;">
            <button type="submit" class="btn btn-primary">Save branding</button>
        </div>
    </form>
</div>

<script src="brand-picker.js"></script>
