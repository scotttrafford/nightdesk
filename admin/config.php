<?php
/**
 * Admin panel configuration and database connection.
 *
 * Database credentials are read from the same .env file the call server uses
 * (one directory above this web root by default), so there is a single place
 * to configure them. To keep .env elsewhere, set NIGHTDESK_ENV to its path,
 * e.g. in the Apache vhost:  SetEnv NIGHTDESK_ENV /etc/nightdesk/.env
 */

// Email notifications aren't implemented yet (see "To-do: email notifications" in
// the README). While false, the People page greys out the email options.
const EMAIL_ENABLED = false;

// Login rate limiting
define('LOGIN_MAX_ATTEMPTS', 5);   // failed attempts per IP before lockout
define('LOGIN_LOCKOUT_MINS', 60);  // lockout duration in minutes

// Don't advertise the PHP version
header_remove('X-Powered-By');

/**
 * Start the session with hardened cookie settings. Every page calls this
 * instead of session_start().
 */
function start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    ini_set('session.use_strict_mode', '1');   // reject session IDs the server didn't issue
    session_set_cookie_params([
        'httponly' => true,                     // not readable from JavaScript
        'secure'   => !empty($_SERVER['HTTPS']), // HTTPS-only when served over HTTPS
        'samesite' => 'Lax',
    ]);
    session_start();
}

/** Parse KEY=value lines from a .env file (comments and blank lines ignored). */
function load_env(string $path): array {
    $vars = [];
    $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) return $vars;
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) continue;
        [$key, $value] = array_map('trim', explode('=', $line, 2));
        $value = preg_replace('/\s+#.*$/', '', $value);   // strip trailing comment
        $vars[$key] = trim($value, "\"'");
    }
    return $vars;
}

/** Open (once) and return the PostgreSQL connection. Exits with a generic error on failure. */
function db_connect() {
    static $conn = null;
    if ($conn) return $conn;

    $env = load_env(getenv('NIGHTDESK_ENV') ?: dirname(__DIR__) . '/.env');
    $conn = @pg_connect(sprintf(
        "host=%s port=%s dbname=%s user=%s password=%s",
        $env['DB_HOST'] ?? 'localhost',
        $env['DB_PORT'] ?? '5432',
        $env['DB_NAME'] ?? '',
        $env['DB_USER'] ?? '',
        $env['DB_PASSWORD'] ?? ''
    ));
    if (!$conn) {
        error_log('NightDesk admin: database connection failed');
        http_response_code(500);
        exit('Database connection failed. Check DB_* settings in .env.');
    }
    return $conn;
}

/** Password policy for admin accounts. Returns the unmet rules (empty array = OK). */
function password_problems(string $password): array {
    $problems = [];
    if (strlen($password) < 12)                         $problems[] = 'At least 12 characters';
    if (!preg_match('/[A-Z]/', $password))              $problems[] = 'At least one uppercase letter';
    if (!preg_match('/[a-z]/', $password))              $problems[] = 'At least one lowercase letter';
    if (!preg_match('/[0-9]/', $password))              $problems[] = 'At least one number';
    if (!preg_match('/[!@#$%^&*\-_+=?]/', $password))  $problems[] = 'At least one special character (!@#$%^&*-_+=?)';
    return $problems;
}

/**
 * First-run setup is available only on a fresh install: no admin accounts exist
 * and setup has never been completed. Once setup.php succeeds it records
 * `setup_completed_at`, so setup can never run again — even if every user is
 * later deleted.
 */
function setup_available($conn): bool {
    $done  = pg_query_params($conn, "SELECT 1 FROM system_config WHERE key = 'setup_completed_at'", []);
    if (pg_num_rows($done) > 0) return false;
    $users = pg_query($conn, 'SELECT 1 FROM users LIMIT 1');
    return pg_num_rows($users) === 0;
}

/**
 * CSRF protection. Every POST form includes csrf_field(); handlers call
 * csrf_verify() (auth.php does this for all logged-in pages). The token is
 * per session, so it requires session_start() to have been called.
 */
function csrf_token(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}

function csrf_field(): string {
    return '<input type="hidden" name="csrf" value="' . csrf_token() . '">';
}

/** Stop with 403 unless the submitted token matches the session's. */
function csrf_verify(): void {
    if (!hash_equals(csrf_token(), (string)($_POST['csrf'] ?? ''))) {
        http_response_code(403);
        exit('This form has expired. Go back, refresh the page and try again.');
    }
}

/** Encode strings as a PostgreSQL text[] literal, for binding as a query parameter. */
function pg_text_array(array $values): string {
    return '{' . implode(',', array_map(fn($v) => '"' . addcslashes((string)$v, '"\\') . '"', $values)) . '}';
}

/** Decode a PostgreSQL text[] value (as returned by pg_fetch_assoc) into PHP strings. */
function pg_parse_text_array(?string $literal): array {
    if ($literal === null || strlen($literal) < 2) return [];
    $s = substr($literal, 1, -1);   // strip { }
    $out = [];
    $i = 0;
    $n = strlen($s);
    while ($i < $n) {
        if ($s[$i] === '"') {        // quoted element: backslash escapes the next character
            $value = '';
            for ($i++; $i < $n && $s[$i] !== '"'; $i++) {
                if ($s[$i] === '\\') $i++;
                $value .= $s[$i] ?? '';
            }
            $i++;                    // closing quote
            $out[] = $value;
        } else {                     // bare element runs to the next comma
            $end = strpos($s, ',', $i);
            if ($end === false) $end = $n;
            $value = substr($s, $i, $end - $i);
            if ($value !== 'NULL') $out[] = $value;
            $i = $end;
        }
        if ($i < $n && $s[$i] === ',') $i++;
    }
    return $out;
}
