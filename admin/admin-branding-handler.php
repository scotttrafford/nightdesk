<?php
require_once 'auth.php';
requirePermission('admin'); // Only admins can change branding

// Branding page POST handler. Results are shown on the next page load.
$flash = function (bool $ok, string $message) {
    $_SESSION['branding_flash'] = ['ok' => $ok, 'message' => $message];
};

if (($_POST['action'] ?? '') === 'update') {
    $old     = branding();
    $name    = trim($_POST['brand_name'] ?? '');
    $primary = $_POST['primary'] ?? '';
    $accent  = $_POST['accent'] ?? '';

    if (!preg_match('/^.{1,100}$/us', $name)) {   // 1–100 characters (no mbstring needed)
        $flash(false, 'Please enter an organization name (up to 100 characters).');
    } elseif (!is_hex_color($primary) || !is_hex_color($accent)) {
        $flash(false, 'Please choose valid colours.');
    } else {
        [$new_logo, $logo_error] = save_logo_upload($_FILES['logo'] ?? null);
        if ($logo_error) {
            $flash(false, $logo_error);
        } else {
            $logo = $new_logo ?? (isset($_POST['reset_logo']) ? BRAND_DEFAULTS['logo'] : $old['logo']);
            if (save_branding($conn, $name, $logo, $primary, $accent)) {
                if ($logo !== $old['logo']) delete_uploaded_logo($old['logo']);
                $changes = [];
                if ($name !== $old['name'])       $changes[] = "name: {$old['name']} → $name";
                if ($logo !== $old['logo'])       $changes[] = $new_logo ? 'new logo uploaded' : 'logo reset to default';
                if ($primary !== $old['primary']) $changes[] = "primary: {$old['primary']} → $primary";
                if ($accent !== $old['accent'])   $changes[] = "accent: {$old['accent']} → $accent";
                if ($changes) logAudit('branding_updated', 'system_config', null, null, implode('; ', $changes));
                $flash(true, 'Branding saved.');
            } else {
                delete_uploaded_logo($new_logo);
                $flash(false, 'Branding could not be saved.');
            }
        }
    }
}
