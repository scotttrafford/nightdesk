#!/usr/bin/env node

/**
 * switch-mode.js — Deployment mode switching tool
 *
 * Switches NightDesk between ngrok and direct deployment modes.
 * Handles .env updates, Twilio webhook updates, service restarts,
 * health verification, and rollback on failure.
 *
 * Usage:
 *   node switch-mode.js status              — report current state, no changes
 *   node switch-mode.js direct              — switch to direct mode
 *   node switch-mode.js ngrok               — switch to ngrok mode
 *   node switch-mode.js direct --dry-run    — show what would happen, no changes
 *   node switch-mode.js ngrok  --dry-run    — show what would happen, no changes
 *
 * The Twilio phone number SID is resolved dynamically:
 *   1. Read active inbound number from system_config (key='inbound_number')
 *   2. Call Twilio API to find the matching IncomingPhoneNumber record
 *   3. Use that SID for all webhook operations
 *
 * No TWILIO_PHONE_NUMBER_SID in .env — it's always derived at runtime.
 *
 * Assumes the app and ngrok run as systemd services. Their unit names default to
 * 'nightdesk' and 'ngrok-tunnel' and can be overridden with SERVICE_NAME and
 * NGROK_SERVICE_NAME in .env. Restarting services uses sudo.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import twilio from 'twilio';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');

dotenv.config({ path: ENV_PATH });

const args = process.argv.slice(2);
const command = args[0];
const dryRun = args.includes('--dry-run');

const SERVICE = process.env.SERVICE_NAME || 'nightdesk';
const NGROK_SERVICE = process.env.NGROK_SERVICE_NAME || 'ngrok-tunnel';

// ─── Logging helpers ─────────────────────────────────────────────────────────

function log(msg)  { console.log(msg); }
function info(msg) { console.log(`  ℹ  ${msg}`); }
function ok(msg)   { console.log(`  ✓  ${msg}`); }
function warn(msg) { console.log(`  ⚠  ${msg}`); }
function fail(msg) { console.log(`  ✗  ${msg}`); }
function divider()  { console.log('─'.repeat(60)); }

// ─── .env helpers ────────────────────────────────────────────────────────────

/**
 * Read and parse .env file into a key/value object.
 * @returns {Record<string, string>}
 */
function readEnv() {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const result = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Write a single key/value change back to .env, preserving all comments and formatting.
 * Appends the key if not already present.
 * @param {string} key
 * @param {string} value
 */
function writeEnvKey(key, value) {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const lines = raw.split('\n');
  let found = false;
  const updated = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) return line;
    const eqIndex = trimmed.indexOf('=');
    const k = trimmed.slice(0, eqIndex).trim();
    if (k === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) updated.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, updated.join('\n'), 'utf8');
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

/**
 * Get the active Twilio inbound phone number from system_config.
 * Stored as key='inbound_number', value in E.164 format (e.g. +15555550123).
 * @param {Record<string, string>} env - Parsed .env values
 * @returns {Promise<string>} Phone number in E.164 format
 */
async function getPhoneNumberFromDb(env) {
  const pool = new pg.Pool({
    user: env.DB_USER,
    host: env.DB_HOST || 'localhost',
    database: env.DB_NAME,
    password: env.DB_PASSWORD,
    port: parseInt(env.DB_PORT || '5432'),
  });
  try {
    const result = await pool.query(
      `SELECT value FROM system_config WHERE key = 'inbound_number' LIMIT 1`
    );
    if (!result.rows.length) {
      throw new Error(
        "Inbound phone number not found in database.\n" +
        "Expected: system_config WHERE key = 'inbound_number'"
      );
    }
    return result.rows[0].value;
  } finally {
    await pool.end();
  }
}

// ─── Twilio helpers ──────────────────────────────────────────────────────────

/**
 * Find the Twilio IncomingPhoneNumber record matching the given phone number.
 * @param {twilio.Twilio} client
 * @param {string} phoneNumber - E.164 format
 * @returns {Promise<{sid: string, voiceUrl: string, statusCallback: string, phoneNumber: string}>}
 */
async function findTwilioNumber(client, phoneNumber) {
  const numbers = await client.incomingPhoneNumbers.list({ phoneNumber });
  if (!numbers.length) {
    throw new Error(
      `Phone number ${phoneNumber} not found in Twilio account.\n` +
      'Check the number stored in system_config matches a number in your Twilio account.'
    );
  }
  const n = numbers[0];
  return {
    sid: n.sid,
    voiceUrl: n.voiceUrl,
    statusCallback: n.statusCallback,
    phoneNumber: n.phoneNumber,
  };
}

/**
 * Update Twilio webhook URLs for the given phone number SID.
 * @param {twilio.Twilio} client
 * @param {string} sid
 * @param {string} baseUrl - Base URL without trailing slash
 */
async function setTwilioWebhooks(client, sid, baseUrl) {
  await client.incomingPhoneNumbers(sid).update({
    voiceUrl: `${baseUrl}/call/incoming`,
    voiceMethod: 'POST',
    statusCallback: `${baseUrl}/call/status`,
    statusCallbackMethod: 'POST',
  });
}

// ─── Infrastructure helpers ──────────────────────────────────────────────────

/**
 * Get the ngrok HTTPS tunnel URL from the local ngrok agent API.
 * @returns {Promise<string|null>}
 */
async function getNgrokUrl() {
  try {
    const res = await fetch('http://127.0.0.1:4040/api/tunnels');
    if (!res.ok) return null;
    const data = await res.json();
    const tunnel = data.tunnels?.find(t => t.proto === 'https');
    return tunnel?.public_url || null;
  } catch {
    return null;
  }
}

/**
 * Check if the /health endpoint is responding at the given base URL.
 * Returns { ok, status, error } so callers can show the actual result.
 * @param {string} baseUrl
 * @returns {Promise<{ok: boolean, status: number|null, error: string|null}>}
 */
async function checkHealth(baseUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return { ok: res.ok, status: res.status, error: null };
  } catch (e) {
    return { ok: false, status: null, error: e.name === 'AbortError' ? 'timed out (5s)' : e.message };
  }
}

/**
 * Check if the ngrok systemd service is running.
 * @returns {boolean}
 */
function isNgrokServiceRunning() {
  try {
    execSync(`systemctl is-active --quiet ${NGROK_SERVICE}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Restart the app's systemd service and wait for it to settle.
 */
function restartService() {
  execSync(`sudo systemctl restart ${SERVICE}`, { stdio: 'inherit' });
  execSync('sleep 3');
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdStatus() {
  divider();
  log('NIGHTDESK — DEPLOYMENT STATUS');
  divider();

  const env = readEnv();
  const mode = env.TUNNEL_MODE || 'direct';
  const port = env.PORT || '3000';

  info(`Current mode:          ${mode}`);
  info(`BASE_URL:              ${env.BASE_URL || '(not set)'}`);
  info(`NGROK_URL fallback:    ${env.NGROK_URL || '(not set)'}`);
  info(`Port:                  ${port}`);
  info(`Signature validation:  ${env.VALIDATE_TWILIO_SIGNATURE || 'false'}`);
  log('');

  // Phone number from DB
  let dbPhoneNumber = null;
  try {
    dbPhoneNumber = await getPhoneNumberFromDb(env);
    ok(`DB inbound number:     ${dbPhoneNumber}`);
  } catch (e) {
    warn(`DB inbound number:     ${e.message}`);
  }

  // ngrok status
  if (mode === 'ngrok') {
    const ngrokRunning = isNgrokServiceRunning();
    ngrokRunning
      ? ok('ngrok service:         running')
      : fail('ngrok service:         not running');
    const ngrokUrl = await getNgrokUrl();
    ngrokUrl
      ? ok(`ngrok tunnel URL:      ${ngrokUrl}`)
      : warn('ngrok tunnel URL:      unreachable (using NGROK_URL fallback if set)');
  }

  // Health check
  const healthBase = mode === 'ngrok'
    ? (await getNgrokUrl() || env.NGROK_URL || `http://localhost:${port}`)
    : env.BASE_URL;

  if (healthBase) {
    const health = await checkHealth(healthBase);
    if (health.ok) {
      ok(`Health endpoint:       ${healthBase}/health — HTTP ${health.status} OK`);
    } else if (health.error) {
      fail(`Health endpoint:       ${healthBase}/health — ${health.error}`);
    } else {
      fail(`Health endpoint:       ${healthBase}/health — HTTP ${health.status}`);
    }
  }

  // Twilio webhook URLs
  if (dbPhoneNumber) {
    try {
      const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
      const twilioNumber = await findTwilioNumber(client, dbPhoneNumber);
      log('');
      info(`Twilio voice URL:      ${twilioNumber.voiceUrl || '(not set)'}`);
      info(`Twilio status URL:     ${twilioNumber.statusCallback || '(not set)'}`);

      const expectedBase = mode === 'ngrok'
        ? (await getNgrokUrl() || env.NGROK_URL)
        : env.BASE_URL;

      if (expectedBase && twilioNumber.voiceUrl?.startsWith(expectedBase)) {
        ok('Twilio webhooks match current mode');
      } else {
        warn('Twilio webhooks do NOT match current mode — run switch-mode.js to fix');
      }
    } catch (e) {
      warn(`Could not check Twilio webhooks: ${e.message}`);
    }
  }

  divider();
}

async function cmdSwitch(targetMode) {
  divider();
  log(`SWITCHING TO: ${targetMode.toUpperCase()} MODE${dryRun ? ' (DRY RUN)' : ''}`);
  divider();

  const env = readEnv();
  const currentMode = env.TUNNEL_MODE || 'direct';

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    fail('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set in .env');
    process.exit(1);
  }

  info(`Current mode: ${currentMode}`);
  info(`Target mode:  ${targetMode}`);
  log('');

  // ── Get phone number from DB ───────────────────────────────────────────────

  let dbPhoneNumber;
  try {
    dbPhoneNumber = await getPhoneNumberFromDb(env);
    ok(`Phone number from DB: ${dbPhoneNumber}`);
  } catch (e) {
    fail(`Cannot read phone number from DB: ${e.message}`);
    process.exit(1);
  }

  // ── Validate number exists in Twilio and get SID ───────────────────────────

  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  let twilioNumber;
  try {
    twilioNumber = await findTwilioNumber(client, dbPhoneNumber);
    ok(`Found in Twilio: ${twilioNumber.phoneNumber} (SID: ${twilioNumber.sid})`);
    info(`Current voice URL:  ${twilioNumber.voiceUrl || '(not set)'}`);
    info(`Current status URL: ${twilioNumber.statusCallback || '(not set)'}`);
  } catch (e) {
    fail(`Cannot find phone number in Twilio: ${e.message}`);
    process.exit(1);
  }

  // ── Resolve target base URL ────────────────────────────────────────────────

  let targetUrl;

  if (targetMode === 'direct') {
    targetUrl = (env.BASE_URL || '').replace(/\/+$/, '').replace(/\/call\/.*$/, '');
    if (!targetUrl) {
      fail('BASE_URL not set in .env — required for direct mode');
      fail('Expected format: https://your-domain.com (no path)');
      process.exit(1);
    }
    if (targetUrl !== env.BASE_URL) {
      warn(`BASE_URL had trailing path — using: ${targetUrl}`);
    }
    info(`Target URL: ${targetUrl}`);
  } else {
    // ngrok mode — try agent API first, fall back to NGROK_URL, then try starting service
    targetUrl = await getNgrokUrl();

    if (targetUrl) {
      ok(`ngrok tunnel URL (agent API): ${targetUrl}`);
    } else if (env.NGROK_URL) {
      // Agent API unreachable but a known URL is configured — verify it's live
      info(`ngrok agent API unavailable — checking NGROK_URL fallback: ${env.NGROK_URL}`);
      const health = await checkHealth(env.NGROK_URL);
      if (health.ok) {
        targetUrl = env.NGROK_URL;
        ok(`NGROK_URL fallback is live (HTTP ${health.status}) — using it`);
      } else {
        warn(`NGROK_URL fallback not reachable — attempting to start ${NGROK_SERVICE} service`);
      }
    }

    if (!targetUrl) {
      // No live tunnel found — try starting the service
      if (!isNgrokServiceRunning()) {
        info(`Starting ${NGROK_SERVICE} service...`);
        try {
          execSync(`sudo systemctl start ${NGROK_SERVICE}`, { stdio: 'inherit' });
          await new Promise(r => setTimeout(r, 4000));
        } catch (e) {
          fail(`Failed to start ${NGROK_SERVICE}: ${e.message}`);
          process.exit(1);
        }
      }
      targetUrl = await getNgrokUrl();
      if (!targetUrl) {
        fail('ngrok tunnel URL not available — agent API at 127.0.0.1:4040 not responding');
        fail(`Check ngrok service logs: sudo journalctl -u ${NGROK_SERVICE} -n 50`);
        process.exit(1);
      }
      ok(`ngrok tunnel URL: ${targetUrl}`);
    }
  }

  log('');

  // ── Dry run ────────────────────────────────────────────────────────────────

  if (dryRun) {
    log('DRY RUN — testing readiness, no changes will be made');
    log('');

    // Test 1: target URL reachable?
    info(`Testing health at ${targetUrl}/health ...`);
    const health = await checkHealth(targetUrl);
    if (health.ok) {
      ok(`Target URL reachable — HTTP ${health.status}`);
    } else {
      const reason = health.error || `HTTP ${health.status}`;
      fail(`Target URL NOT reachable — ${reason}`);
      fail(`  ${targetUrl}/health must respond 200 before switching`);
    }

    log('');
    const sigValidation = 'true';
    log('Would make these changes:');
    log('');
    let step = 1;
    if (targetMode === 'ngrok' && !isNgrokServiceRunning() && !(await getNgrokUrl()) && !env.NGROK_URL) {
      info(`${step++}. Start ${NGROK_SERVICE} systemd service`);
    }
    info(`${step++}. Update .env: TUNNEL_MODE=${targetMode}`);
    info(`${step++}. Update .env: VALIDATE_TWILIO_SIGNATURE=${sigValidation}`);
    info(`${step++}. Set Twilio voice URL to:   ${targetUrl}/call/incoming`);
    info(`${step++}. Set Twilio status URL to:  ${targetUrl}/call/status`);
    info(`${step++}. Restart ${SERVICE} service`);
    info(`${step++}. Verify health again post-restart — rollback if it fails`);
    log('');

    if (health.ok) {
      ok('Readiness check PASSED — safe to run without --dry-run');
    } else {
      fail('Readiness check FAILED — fix the target URL before switching');
    }

    divider();
    return;
  }

  // ── Update .env ────────────────────────────────────────────────────────────

  // Signature validation stays on in both modes: Twilio signs the public URL, which
  // is stable in direct mode and with ngrok's fixed per-account domain.
  const sigValidation = 'true';

  writeEnvKey('TUNNEL_MODE', targetMode);
  ok(`.env updated: TUNNEL_MODE=${targetMode}`);
  writeEnvKey('VALIDATE_TWILIO_SIGNATURE', sigValidation);
  ok(`.env updated: VALIDATE_TWILIO_SIGNATURE=${sigValidation}`);

  // ── Update Twilio webhooks ─────────────────────────────────────────────────

  try {
    await setTwilioWebhooks(client, twilioNumber.sid, targetUrl);
    ok(`Twilio voice URL set to:  ${targetUrl}/call/incoming`);
    ok(`Twilio status URL set to: ${targetUrl}/call/status`);
  } catch (e) {
    fail(`Failed to update Twilio webhooks: ${e.message}`);
    fail('Rolling back .env changes');
    writeEnvKey('TUNNEL_MODE', currentMode);
    writeEnvKey('VALIDATE_TWILIO_SIGNATURE', env.VALIDATE_TWILIO_SIGNATURE || 'false');
    process.exit(1);
  }

  // ── Restart service ────────────────────────────────────────────────────────

  log('');
  info(`Restarting ${SERVICE} service...`);
  try {
    restartService();
    ok('Service restarted');
  } catch (e) {
    warn(`Service restart failed: ${e.message}`);
    warn(`Try manually: sudo systemctl restart ${SERVICE}`);
  }

  // ── Health check with retries ──────────────────────────────────────────────

  log('');
  info(`Checking health at ${targetUrl}/health ...`);
  let health = { ok: false };
  for (let i = 0; i < 3; i++) {
    health = await checkHealth(targetUrl);
    if (health.ok) break;
    if (i < 2) {
      const reason = health.error || `HTTP ${health.status}`;
      info(`Not responding yet (${reason}), retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  if (health.ok) {
    ok(`Health check: HTTP ${health.status} OK`);
    ok('Health check passed');
    log('');
    divider();
    ok(`Successfully switched to ${targetMode.toUpperCase()} mode`);
    log('');
    info(`Twilio webhook: ${targetUrl}/call/incoming`);
    divider();
  } else {
    const reason = health.error || `HTTP ${health.status}`;
    fail(`Health check FAILED — ${reason}`);
    log('');
    warn('Rolling back Twilio webhooks to previous URLs...');
    try {
      await client.incomingPhoneNumbers(twilioNumber.sid).update({
        voiceUrl: twilioNumber.voiceUrl,
        voiceMethod: 'POST',
        statusCallback: twilioNumber.statusCallback,
        statusCallbackMethod: 'POST',
      });
      ok('Twilio webhooks rolled back');
    } catch (e) {
      fail(`Rollback failed: ${e.message}`);
      fail('Manually restore Twilio webhooks in the Twilio console');
    }
    writeEnvKey('TUNNEL_MODE', currentMode);
    log('');
    fail('Switch FAILED. Check service logs:');
    fail(`  sudo journalctl -u ${SERVICE} -n 50`);
    process.exit(1);
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const validCommands = ['status', 'direct', 'ngrok'];

if (!command || !validCommands.includes(command)) {
  log('');
  log('Usage:');
  log('  node switch-mode.js status              — show current deployment state');
  log('  node switch-mode.js direct              — switch to direct mode');
  log('  node switch-mode.js ngrok               — switch to ngrok mode');
  log('  node switch-mode.js direct --dry-run    — preview changes only');
  log('  node switch-mode.js ngrok  --dry-run    — preview changes only');
  log('');
  process.exit(1);
}

if (command === 'status') {
  await cmdStatus();
} else {
  await cmdSwitch(command);
}
