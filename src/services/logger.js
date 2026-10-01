/**
 * @module logger
 * @description Application-level structured logger.
 *
 * Writes timestamped, levelled log lines to stdout (captured by journald under
 * systemd) and to a log file that persists across restarts.
 *
 * ## This is NOT the per-call verbose debug log
 * The per-call `debug_log` stored in `call_logs` (controlled by `verbose_logging`
 * in system_config) is a separate concern — it captures call-specific step traces
 * for post-call review. This logger captures system-level events for operational
 * monitoring and troubleshooting.
 *
 * ## Configuration (set in .env)
 * - `LOG_LEVEL`  — error | warn | info | debug  (default: info)
 * - `LOG_FILE`   — path to log file              (default: ./logs/app.log)
 *
 * ## Log levels
 * - `error` — exceptions, DB failures, unrecoverable errors
 * - `warn`  — fallbacks used, skipped operations, non-fatal issues
 * - `info`  — call lifecycle events (new call, transfer, message saved, SMS sent)
 * - `debug` — full detail: speech text, AI request/response, routing decisions
 *
 * ## Log format
 * ```
 * [2026-03-13 14:23:01.442] [INFO ] [CALL-TRANSFER ] CA9a3f  HARD → Alex (+15555550100)
 * [2026-03-13 14:23:01.442] [DEBUG] [AI-RESPONSE   ] CA9a3f  action=transfer urgency=HARD person=Alex
 * [2026-03-13 14:23:01.442] [ERROR] [DB-ERROR      ] --      logCall failed: connection refused
 * ```
 *
 * Columns:
 * - Timestamp   — millisecond precision UTC
 * - Level       — fixed 5 chars (padded)
 * - Step code   — fixed 14 chars (padded) — use the STEP constants
 * - CallSid     — last 6 chars of Twilio CallSid, or '--' if not call-specific
 * - Message     — free-form text with key variable values
 *
 * ## Examples
 * ```bash
 * grep '\[ERROR\]' logs/app.log            # all errors
 * grep 'CA9a3f' logs/app.log               # one call (last 6 chars of CallSid)
 * grep '\[CALL-TRANSFER' logs/app.log      # all transfers
 * ```
 *
 * The file is appended synchronously and never reopened, so rotate it with
 * logrotate's `copytruncate` (see deploy/nightdesk.logrotate).
 */

import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

/** Numeric priority for each level (lower = more severe). */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/** Fixed-width display labels for each level. */
const LABELS = { 0: 'ERROR', 1: 'WARN ', 2: 'INFO ', 3: 'DEBUG' };

/**
 * Step code constants — fixed-width identifiers for each significant
 * operation in the system. Use these in logger calls for consistent,
 * grep-able log output.
 *
 * @enum {string}
 */
export const STEP = {
  // ── Server lifecycle ──────────────────────────────────────────────────────
  SERVER_START:    'SERVER-START',    // Express server started
  SERVER_TUNNEL:   'SERVER-TUNNEL',   // Public webhook URL resolved

  // ── Tunnel ────────────────────────────────────────────────────────────────
  TUNNEL_NGROK:    'TUNNEL-NGROK',    // ngrok URL discovered from agent API
  TUNNEL_DIRECT:   'TUNNEL-DIRECT',   // Direct mode, using BASE_URL
  TUNNEL_FALLBACK: 'TUNNEL-FALLBACK', // ngrok API failed, using NGROK_URL fallback

  // ── Inbound call ──────────────────────────────────────────────────────────
  CALL_IN:         'CALL-IN',         // New inbound call received
  CALL_HOURS:      'CALL-HOURS',      // Business hours check result

  // ── Gather / speech processing ────────────────────────────────────────────
  GATHER_SPEECH:   'GATHER-SPEECH',   // SpeechResult received from Twilio
  GATHER_RETRY:    'GATHER-RETRY',    // Empty speech, retrying
  GATHER_SILENT:   'GATHER-SILENT',   // Max retries hit, giving up
  GATHER_TRIGGER:  'GATHER-TRIGGER',  // Trigger phrase matched in speech
  GATHER_OPERATOR: 'GATHER-OPERATOR', // Operator keyword matched
  GATHER_DISAMBIG: 'GATHER-DISAMBIG', // Ambiguous person name, asking for last name
  GATHER_DTRANSFER:'GATHER-DTRANSFER',// Direct transfer offer response received
  GATHER_WAITING:  'GATHER-WAITING',  // Collecting voicemail speech

  // ── AI inference ──────────────────────────────────────────────────────────
  AI_REQUEST:      'AI-REQUEST',      // Sending messages to AI provider
  AI_RESPONSE:     'AI-RESPONSE',     // AI response received and parsed
  AI_PARSE_ERR:    'AI-PARSE-ERR',    // AI returned non-JSON response
  AI_TIMEOUT:      'AI-TIMEOUT',      // AI request timed out
  AI_CLARIFY_REQ:  'AI-CLARIFY-REQ',  // Second-stage clarify request sent
  AI_CLARIFY_RESP: 'AI-CLARIFY-RESP', // Second-stage clarify response received

  // ── Routing outcomes ──────────────────────────────────────────────────────
  CALL_TRANSFER:   'CALL-TRANSFER',   // Call transferred to a phone number
  CALL_MESSAGE:    'CALL-MESSAGE',    // Voicemail saved to DB
  CALL_MAIN:       'CALL-MAIN',       // Routed to main line
  CALL_CLARIFY:    'CALL-CLARIFY',    // Soft urgency → asking "what's the problem?"
  CALL_ESCALATE:   'CALL-ESCALATE',   // Soft→HARD escalation after clarification
  CALL_ONCALL:     'CALL-ONCALL',     // On-call person resolved
  CALL_EMERGENCY:  'CALL-EMERGENCY',  // Emergency detected, no on-call available
  CALL_END:        'CALL-END',        // Session cleaned up on call status callback
  CALL_OP_BLOCK:   'CALL-OP-BLOCK',   // After-hours operator request blocked

  // ── SMS notifications ─────────────────────────────────────────────────────
  SMS_SENT:        'SMS-SENT',        // SMS dispatched successfully
  SMS_SKIP:        'SMS-SKIP',        // SMS skipped (missing number/config)
  SMS_ERROR:       'SMS-ERROR',       // SMS send failed
  EMAIL_SKIP:      'EMAIL-SKIP',      // Email not sent (not configured)

  // ── Database ──────────────────────────────────────────────────────────────
  DB_ERROR:        'DB-ERROR',        // Database query failed
};

const level = LEVELS[config.logLevel] ?? LEVELS.info;
const logFile = config.logFile;

try {
  fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });
} catch (err) {
  process.stderr.write(`[logger] Cannot create log directory for ${logFile}: ${err.message}\n`);
}

/**
 * Format a single log line.
 *
 * @param {number} level    - Numeric level (0–3)
 * @param {string} stepCode - Step identifier from STEP constants
 * @param {string|null} callSid - Twilio CallSid (last 6 chars used), or null
 * @param {string} message  - Log message
 * @returns {string}
 */
function formatLine(level, stepCode, callSid, message) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23); // 2026-03-13 14:23:01.442
  const lvl = LABELS[level];
  const step = stepCode.padEnd(14);
  const sid = callSid ? callSid.slice(-6) : '--    ';
  return `[${ts}] [${lvl}] [${step}] ${sid}  ${message}`;
}

/**
 * Write a log entry if the configured level permits it.
 * Writes to stdout (journalctl) and appends to the log file.
 *
 * @param {number} lineLevel
 * @param {string} stepCode
 * @param {string|null} callSid
 * @param {string} message
 */
function write(lineLevel, stepCode, callSid, message) {
  if (lineLevel > level) return;

  const line = formatLine(lineLevel, stepCode, callSid, message);

  process.stdout.write(line + '\n');
  try {
    fs.appendFileSync(logFile, line + '\n', { mode: 0o640 });   // mode applies only when the file is created
  } catch (err) {
    // Don't crash the server if the log file can't be written;
    // stdout/journalctl is still capturing output
    process.stderr.write(`[logger] Failed to write to ${logFile}: ${err.message}\n`);
  }
}

/**
 * The application logger.
 *
 * Each method signature: `(stepCode, callSid, message)`
 * - `stepCode` — use a constant from the exported STEP object
 * - `callSid`  — Twilio CallSid string, or null for non-call-specific entries
 * - `message`  — descriptive string; include key variable values inline
 *
 * @example
 * import { logger, STEP } from './logger.js';
 *
 * logger.info(STEP.CALL_IN,       CallSid, `from=${From}`);
 * logger.debug(STEP.AI_RESPONSE,  CallSid, `action=${r.action} urgency=${r.urgency} person=${r.person}`);
 * logger.warn(STEP.SMS_SKIP,      CallSid, `missing from number — SMS not sent`);
 * logger.error(STEP.DB_ERROR,     null,    `logCall failed: ${err.message}`);
 */
export const logger = {
  /** Failures — logged at every LOG_LEVEL. */
  error: (stepCode, callSid, message) => write(LEVELS.error, stepCode, callSid, message),

  /** Non-fatal issues, fallbacks, skipped operations. */
  warn:  (stepCode, callSid, message) => write(LEVELS.warn,  stepCode, callSid, message),

  /** Normal call lifecycle events — recommended production level. */
  info:  (stepCode, callSid, message) => write(LEVELS.info,  stepCode, callSid, message),

  /** Full detail for troubleshooting — speech, AI I/O, routing decisions. */
  debug: (stepCode, callSid, message) => write(LEVELS.debug, stepCode, callSid, message),
};
