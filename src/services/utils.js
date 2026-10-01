/**
 * @module utils
 * @description Shared utility helpers used across route handlers and services.
 */

import { appendDebugLog } from './session.js';

/**
 * Replace `{placeholder}` tokens in a template string with values from a map.
 *
 * Used to personalise system_config message templates at runtime.
 * If a placeholder key is not present in `vars`, the original `{key}` token
 * is left in place (rather than replaced with undefined/empty), making
 * missing substitutions visible in logs.
 *
 * @example
 * applyTemplate("I'll pass that to {person}. Goodbye!", { person: 'Alex' })
 * // → "I'll pass that to Alex. Goodbye!"
 *
 * @param {string} template - Template string containing `{key}` placeholders
 * @param {Object} vars     - Key/value map of substitutions
 * @returns {string} Template with all matching placeholders replaced
 */
export function applyTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

/**
 * Append a timestamped step entry to the call's in-memory debug log and
 * echo it to stdout. Only active when `verbose_logging=yes` in system_config.
 *
 * The collected log is saved to `call_logs.debug_log` whenever the call is logged.
 *
 * @param {string} callSid  - Twilio CallSid identifying the session
 * @param {string} step     - Short label for the step (e.g. 'gather', 'say', 'transfer')
 * @param {string} message  - Human-readable description of what happened
 * @param {string} verbose  - 'yes' to log; any other value is a no-op
 */
export function logStep(callSid, step, message, verbose) {
  if (verbose === 'yes') {
    appendDebugLog(callSid, step, message);
    console.log(`[${step}] ${message}`);
  }
}
