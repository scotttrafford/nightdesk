<?php
/**
 * Organization branding: name, logo and color scheme shown throughout the admin panel.
 *
 * Values come from system_config (set during first-run setup) and fall back to the
 * NightDesk defaults below. Pages call branding_head() inside <head> to apply the
 * colors, and read branding()['name'] / ['logo'] for text and images.
 */

require_once __DIR__ . '/config.php';

/** Product name, always shown alongside the organization's own branding. */
const PRODUCT_NAME = 'NightDesk';

const BRAND_DEFAULTS = [
    'name'    => 'NightDesk',
    'logo'    => 'images/nightdesk-logo.svg',
    'primary' => '#152035',   // sidebar, headings
    'accent'  => '#2e86c1',   // buttons, links, highlights
];

/** Preset colour schemes offered in setup and on the Branding page: [name, primary, accent]. */
const BRAND_SCHEMES = [
    ['Midnight', '#152035', '#2e86c1'],
    ['Forest',   '#1d3b2a', '#2f9e6b'],
    ['Plum',     '#2e1a3b', '#9b59b6'],
    ['Slate',    '#2b2f36', '#e67e22'],
    ['Ocean',    '#0f3d4c', '#17a2b8'],
];

// Uploaded logos. SVG is refused: it can carry scripts.
const LOGO_TYPES    = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'];
const LOGO_MAX_SIZE = 1024 * 1024;   // 1 MB
const LOGO_DIR      = 'images/uploads';

/** Current branding values (cached per request). */
function branding(): array {
    static $brand = null;
    if ($brand !== null) return $brand;

    $brand = BRAND_DEFAULTS;
    $keys  = ['brand_name' => 'name', 'brand_logo' => 'logo',
              'brand_primary_color' => 'primary', 'brand_accent_color' => 'accent'];
    $result = pg_query_params(db_connect(),
        'SELECT key, value FROM system_config WHERE key = ANY($1)',
        ['{' . implode(',', array_keys($keys)) . '}']);
    while ($result && ($row = pg_fetch_assoc($result))) {
        $field = $keys[$row['key']];
        $value = trim($row['value']);
        if ($value === '') continue;
        if (($field === 'primary' || $field === 'accent') && !preg_match('/^#[0-9a-fA-F]{6}$/', $value)) continue;
        $brand[$field] = $value;
    }
    return $brand;
}

/** HTML-escape a value for output. */
function h(?string $value): string {
    return htmlspecialchars($value ?? '', ENT_QUOTES, 'UTF-8');
}

/**
 * <head> tags that apply the brand colours and favicon. Defines the derived shades
 * too, so pages that don't load style.css (login, change password) can use them.
 */
function branding_head(): string {
    $b = branding();
    return '<style>:root{'
         . '--brand-primary:' . h($b['primary']) . ';'
         . '--brand-accent:' . h($b['accent']) . ';'
         . '--brand-primary-light:color-mix(in srgb,var(--brand-primary) 88%,white);'
         . '--brand-accent-dark:color-mix(in srgb,var(--brand-accent) 70%,black);'
         . '--brand-accent-soft:color-mix(in srgb,var(--brand-accent) 10%,white);'
         . '--brand-accent-border:color-mix(in srgb,var(--brand-accent) 35%,white);'
         . '}</style>'
         . '<link rel="icon" href="' . h($b['logo']) . '">';
}

/** True for a #rrggbb colour. */
function is_hex_color(?string $value): bool {
    return (bool)preg_match('/^#[0-9a-fA-F]{6}$/', $value ?? '');
}

/**
 * Validate and store an uploaded logo from $_FILES.
 *
 * @return array{0: ?string, 1: ?string} [saved path relative to admin/, error message].
 *         [null, null] when no file was chosen.
 */
function save_logo_upload(?array $upload): array {
    if (!$upload || $upload['error'] === UPLOAD_ERR_NO_FILE) return [null, null];
    if ($upload['error'] === UPLOAD_ERR_INI_SIZE || $upload['error'] === UPLOAD_ERR_FORM_SIZE || $upload['size'] > LOGO_MAX_SIZE) {
        return [null, 'Logo must be 1 MB or smaller.'];
    }
    if ($upload['error'] !== UPLOAD_ERR_OK) return [null, 'The logo upload failed. Please try again.'];
    $type = (new finfo(FILEINFO_MIME_TYPE))->file($upload['tmp_name']);
    if (!isset(LOGO_TYPES[$type]) || !getimagesize($upload['tmp_name'])) {
        return [null, 'Logo must be a PNG, JPEG or WebP image.'];
    }
    $dir = __DIR__ . '/' . LOGO_DIR;
    if (!is_dir($dir) || !is_writable($dir)) {
        return [null, 'The web server cannot write to admin/' . LOGO_DIR . '. Fix its permissions, or skip the logo.'];
    }
    $path = LOGO_DIR . '/logo-' . bin2hex(random_bytes(8)) . '.' . LOGO_TYPES[$type];
    if (!move_uploaded_file($upload['tmp_name'], __DIR__ . '/' . $path)) {
        return [null, 'Could not save the logo.'];
    }
    return [$path, null];
}

/** Delete an uploaded logo file. The bundled default logo is never touched. */
function delete_uploaded_logo(?string $path): void {
    if ($path && str_starts_with($path, LOGO_DIR . '/logo-') && !str_contains($path, '..')) {
        @unlink(__DIR__ . '/' . $path);
    }
}

/** Save the organization's branding to system_config. Returns false on a database error. */
function save_branding($conn, string $name, string $logo, string $primary, string $accent): bool {
    $settings = [
        // key => [value, display name, sort order]
        'brand_name'          => [$name,    'Organization Name', 10],
        'brand_logo'          => [$logo,    'Logo Path',         20],
        'brand_primary_color' => [$primary, 'Primary Colour',    30],
        'brand_accent_color'  => [$accent,  'Accent Colour',     40],
    ];
    foreach ($settings as $key => [$value, $label, $order]) {
        $ok = pg_query_params($conn,
            "INSERT INTO system_config (key, value, display_name, sort_order, group_name)
             VALUES ($1, $2, $3, $4, 'Branding')
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
            [$key, $value, $label, $order]);
        if (!$ok) return false;
    }
    return true;
}

/**
 * Colour-scheme picker: preset buttons, two colour inputs and a small live
 * preview. Needs brand-picker.css and brand-picker.js on the page.
 */
function brand_picker(string $primary, string $accent): string {
    $html = '<div class="bp-schemes">';
    foreach (BRAND_SCHEMES as [$name, $p, $a]) {
        $html .= '<button type="button" class="bp-scheme" data-primary="' . $p . '" data-accent="' . $a . '">'
               . '<span class="bp-swatch" style="background:' . $p . '"></span>'
               . '<span class="bp-swatch" style="background:' . $a . '"></span>' . $name . '</button>';
    }
    return $html . '</div>
        <div class="bp-colors">
            <label><input type="color" id="bp-primary" name="primary" value="' . h($primary) . '"> Primary</label>
            <label><input type="color" id="bp-accent" name="accent" value="' . h($accent) . '"> Accent</label>
        </div>
        <div class="bp-preview" aria-hidden="true">
            <div class="bp-side">Menu<span>People</span></div>
            <div class="bp-main"><b>Dashboard</b><br><span class="bp-btn">Save</span></div>
        </div>';
}
