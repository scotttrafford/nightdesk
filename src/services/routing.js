/**
 * @module routing
 * @description Database access for call routing: people, triggers, business hours,
 * on-call schedule, system_config, and call logging. Also contains the name-matching
 * helpers used to map a spoken name to a person row.
 */

import { pool } from './db.js';
import { logger, STEP } from './logger.js';

/**
 * Load all active people. `name` is the first name; `alternate_names` holds
 * nicknames or spellings the caller might use.
 * @returns {Promise<Array>} Person rows
 */
export async function loadPeople() {
  const result = await pool.query(
    `SELECT id, name, last_name, alternate_names, cell_phone, email,
            notification_preference, routing_preference
     FROM people
     WHERE active = true
     ORDER BY name`
  );
  return result.rows;
}

/**
 * Load active trigger phrases of one type.
 * @param {'emergency'|'needs_clarification'|'routine'|'operator'} triggerType
 * @returns {Promise<Array>} Trigger rows, highest priority first
 */
export async function loadActiveTriggers(triggerType) {
  const result = await pool.query(
    `SELECT id, phrase, trigger_type
     FROM triggers
     WHERE active = true AND trigger_type = $1
     ORDER BY priority DESC, id`,
    [triggerType]
  );
  return result.rows;
}

/**
 * Check whether a moment falls within business hours. Hours are stored in the
 * business's local time (business_hours.day_of_week: 0=Sunday … 6=Saturday).
 * @param {Date}   datetime - Moment to check
 * @param {string} timezone - IANA timezone of the business (system_config: timezone)
 * @returns {Promise<boolean>}
 */
export async function checkBusinessHours(datetime, timezone) {
  // Convert UTC datetime to the business's local timezone before comparing
  const localDate = new Date(datetime.toLocaleString('en-US', { timeZone: timezone }));
  const dayOfWeek = localDate.getDay();
  const timeStr = localDate.toTimeString().slice(0, 8); // HH:MM:SS

  const result = await pool.query(
    `SELECT 1 FROM business_hours
     WHERE day_of_week = $1
       AND is_closed IS NOT TRUE
       AND open_time <= $2::time
       AND close_time > $2::time
     LIMIT 1`,
    [dayOfWeek, timeStr]
  );
  return result.rows.length > 0;
}

/** Person scheduled in on_call_schedule at `datetime`, or null. Message-only people are skipped. */
async function getScheduledOnCallPerson(datetime) {
  const result = await pool.query(
    `SELECT p.id, p.name, p.last_name, p.cell_phone
     FROM on_call_schedule ocs
     JOIN people p ON p.id = ocs.person_id
     WHERE ocs.start_datetime <= $1
       AND ocs.end_datetime >= $1
       AND p.active = true
       AND p.routing_preference IS DISTINCT FROM 'message_only'
     ORDER BY ocs.start_datetime DESC
     LIMIT 1`,
    [datetime.toISOString()]
  );
  return result.rows[0] || null;
}

/** Person flagged is_default_oncall, used when nobody is scheduled, or null. Message-only people are skipped. */
async function getDefaultOnCallPerson() {
  const result = await pool.query(
    `SELECT id, name, last_name, cell_phone
     FROM people
     WHERE is_default_oncall = true AND active = true
       AND routing_preference IS DISTINCT FROM 'message_only'
     LIMIT 1`
  );
  return result.rows[0] || null;
}

/**
 * Resolve who is on call: the scheduled person first, then the default on-call person.
 * @param {Date} datetime
 * @returns {Promise<Object|null>} Person row, or null if nobody is available
 */
export async function resolveOnCallPerson(datetime) {
  return (await getScheduledOnCallPerson(datetime)) ?? getDefaultOnCallPerson();
}

/**
 * Read one value from system_config.
 * @param {string} key - e.g. 'main_line_number'
 * @returns {Promise<string|null>} The value, or null if the key is absent
 */
export async function getSystemConfig(key) {
  const result = await pool.query(
    'SELECT value FROM system_config WHERE key = $1',
    [key]
  );
  return result.rows[0]?.value ?? null;
}

/**
 * Insert a call_logs row. Never throws — a logging failure must not drop the call.
 * @param {Object}       fields
 * @param {string}       fields.callSid
 * @param {string}       fields.callerNumber
 * @param {string|null}  [fields.detectedPerson]
 * @param {boolean}      [fields.emergencyDetected]
 * @param {string|null}  [fields.routedToNumber]
 * @param {string|null}  [fields.messageLeft]
 * @param {string}       fields.fullTranscript
 * @param {string}       [fields.debugLog]
 * @param {boolean}      [fields.aiInferred]
 * @param {string|null}  [fields.aiReasoning]
 * @param {string|null}  [fields.callerPhrase]
 * @param {string|null}  [fields.similarToTrigger]
 */
export async function logCall({
  callSid,
  callerNumber,
  detectedPerson = null,
  emergencyDetected = false,
  routedToNumber = null,
  messageLeft = null,
  fullTranscript,
  debugLog = '',
  aiInferred = false,
  aiReasoning = null,
  callerPhrase = null,
  similarToTrigger = null,
}) {
  try {
    await pool.query(`
      INSERT INTO call_logs
        (call_sid, caller_number, detected_person, emergency_detected, routed_to_number, message_left,
         full_transcript, debug_log, ai_inferred, ai_reasoning, caller_phrase, similar_to_trigger)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      callSid, callerNumber, detectedPerson, emergencyDetected, routedToNumber, messageLeft,
      fullTranscript, debugLog, aiInferred, aiReasoning, callerPhrase, similarToTrigger,
    ]);
  } catch (err) {
    logger.error(STEP.DB_ERROR, null, `logCall failed: ${err.message}`);
  }
}

/**
 * Add the caller's message to the call's most recent call_logs row. Used for an
 * emergency with nobody available: the call is logged when the emergency is
 * detected (so it's recorded even if the caller hangs up), then the message is
 * attached here. Never throws.
 *
 * @returns {Promise<boolean>} false if the call had no log row to update
 */
export async function attachMessageToCallLog(callSid, messageLeft, fullTranscript, debugLog = '') {
  try {
    const result = await pool.query(
      `UPDATE call_logs SET message_left = $2, full_transcript = $3, debug_log = $4
       WHERE id = (SELECT max(id) FROM call_logs WHERE call_sid = $1)`,
      [callSid, messageLeft, fullTranscript, debugLog]
    );
    return result.rowCount > 0;
  } catch (err) {
    logger.error(STEP.DB_ERROR, callSid, `attachMessageToCallLog failed: ${err.message}`);
    return false;
  }
}

/**
 * Increment a trigger's times_matched counter (usage analytics for the admin panel).
 * @param {number} triggerId - The trigger's primary key
 */
export async function incrementTriggerMatch(triggerId) {
  await pool.query(
    'UPDATE triggers SET times_matched = COALESCE(times_matched, 0) + 1 WHERE id = $1',
    [triggerId]
  );
}

/**
 * How a routine (non-emergency) call for this person is handled right now,
 * based on people.routing_preference:
 *
 *                    open        closed
 *   business_hours   offer       message     (default)
 *   always_direct    transfer    transfer
 *   always_screen    offer       offer
 *   message_only     message     message
 *
 * 'offer' asks the caller "transfer directly, or take a message?".
 *
 * @param {Object}  person - Person row (needs routing_preference)
 * @param {boolean} isOpen - Within business hours
 * @returns {'transfer'|'offer'|'message'}
 */
export function routineHandling(person, isOpen) {
  switch (person.routing_preference) {
    case 'always_direct': return 'transfer';
    case 'always_screen': return 'offer';
    case 'message_only':  return 'message';
    default:              return isOpen ? 'offer' : 'message';
  }
}

/**
 * Whether calls can be sent to the main line right now. The main line is
 * optional: it's unavailable when no main_line_number is configured, and after
 * hours when operator_business_hours_only is on (the default).
 * Emergencies use the main line only while open (see the transfer branches).
 */
export function mainLineAvailable(mainLine, isOpen, businessHoursOnly) {
  return Boolean(mainLine) && (isOpen || !businessHoursOnly);
}

/**
 * Did the caller accept "transfer directly, or take a message?"
 * Refusals and message requests win ("don't transfer me, take a message"),
 * and anything unclear means a message, so nobody is rung by mistake.
 *
 * @param {string} speech - Caller's answer
 * @returns {boolean} true to transfer
 */
export function wantsDirectTransfer(speech) {
  const s = (speech || '').toLowerCase();
  if (/\b(no|nope|nah|not|don'?t|message|later)\b/.test(s)) return false;
  return /\b(yes|yeah|yep|sure|ok|okay|transfer|connect|directly|through)\b/.test(s);
}

/** "First Last" for a person row (just the first name if there's no last name). */
export function fullName(person) {
  return [person.name, person.last_name].filter(Boolean).join(' ');
}

/** Whether calls may be transferred to this person at all (emergencies included). */
export function acceptsTransfers(person) {
  return person.routing_preference !== 'message_only';
}

/**
 * Return all people matching a name: first name, full name (first + last), or alternate names.
 * @param {Array}  people - Active people rows from DB
 * @param {string} name   - Name to match (case-insensitive)
 * @returns {Array} All matching person rows
 */
export function findPeople(people, name) {
  if (!name) return [];
  const lower = name.toLowerCase().trim();
  return people.filter(p => {
    const firstName = p.name.toLowerCase();
    const lastName = (p.last_name || '').toLowerCase();
    const fullName = lastName ? `${firstName} ${lastName}` : firstName;
    return (
      firstName === lower ||
      fullName === lower ||
      (p.alternate_names || []).some(n => n.toLowerCase() === lower)
    );
  });
}

/**
 * Return the first person matching a name, or null if none found.
 * @param {Array}  people - Active people rows from DB
 * @param {string} name   - Name to match (case-insensitive)
 * @returns {Object|null} Matching person row or null
 */
export function findPerson(people, name) {
  return findPeople(people, name)[0] ?? null;
}

/** Edit distance between two strings, for tolerating speech-recognition errors. */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/**
 * Second-pass match after disambiguation: caller said last name only or full name.
 * Strips punctuation, checks each word, and falls back to fuzzy Levenshtein matching
 * for speech recognition errors (e.g. "Jonson" matching "Johnson"): 1 edit for last names
 * of up to 4 letters, 2 for longer ones, and the closest match wins.
 * @param {Array}  people    - Active people rows from DB
 * @param {string} firstName - First name already identified (used to narrow candidates)
 * @param {string} speech    - Raw speech result from the disambiguation turn
 * @returns {Object|null} Resolved person row or null if unresolvable
 */
export function resolveAmbiguousPerson(people, firstName, speech) {
  const cleaned = speech.replace(/[^a-z0-9\s]/gi, '').toLowerCase().trim();
  const fn = firstName.toLowerCase();

  // Exact match: full cleaned string or any individual word matches a last name
  const words = cleaned.split(/\s+/).filter(Boolean);
  const exactMatch = people.find(p => {
    const pFirst = p.name.toLowerCase();
    const pLast = (p.last_name || '').toLowerCase();
    if (pFirst !== fn || !pLast) return false;
    const fullName = `${pFirst} ${pLast}`;
    return pLast === cleaned || fullName === cleaned || words.includes(pLast);
  });
  if (exactMatch) return exactMatch;

  // Fuzzy match for speech-recognition errors: the closest last name wins.
  // Short names allow fewer edits, so everyday words ("the") don't match ("Lee").
  let best = null, bestDistance = Infinity;
  for (const word of words) {
    if (word.length < 3) continue;
    for (const p of people) {
      const pLast = (p.last_name || '').toLowerCase();
      if (p.name.toLowerCase() !== fn || !pLast) continue;
      const maxEdits = pLast.length <= 4 ? 1 : 2;
      const distance = levenshtein(word, pLast);
      if (distance <= maxEdits && distance < bestDistance) {
        best = p;
        bestDistance = distance;
      }
    }
  }
  if (best) return best;

  return null;
}

/**
 * Build template variable map for applyTemplate() from a person row.
 * @param {Object|null} person       - Person row from DB, or null
 * @param {string}      fallbackName - Name to use if person is null
 * @returns {{ first_name: string, last_name: string, full_name: string, person: string }}
 */
export function personTemplateVars(person, fallbackName) {
  const firstName = person?.name ?? fallbackName ?? '';
  const lastName = person?.last_name ?? '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  return { first_name: firstName, last_name: lastName, full_name: fullName, person: firstName };
}
