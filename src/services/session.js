/**
 * @module session
 * @description In-memory call session store, keyed by Twilio CallSid.
 *
 * Each inbound call gets a session object that persists state across the
 * multiple HTTP webhook round-trips that make up a single call (incoming →
 * gather → clarify-urgency → gather → status). Without this store, each
 * webhook would arrive stateless and the system would lose context between turns.
 *
 * ## Session structure
 * ```js
 * {
 *   messages:             Array,   // Conversation history sent to AI (role/content pairs)
 *   createdAt:            number,  // Date.now() — used for automatic pruning
 *   retryCount:           number,  // Empty-speech retry counter
 *   waitingForMessageFor: string|null, // Person name while collecting a voicemail;
 *                                      // '__emergency__' sentinel for emergency with no on-call
 *   debugLog:             string[], // Timestamped step log (verbose_logging=yes only)
 *   softUrgency:          object|null, // Stored between /gather and /clarify-urgency
 *   directTransferOffered: object|null, // Stored while awaiting transfer-vs-message answer
 *   ambiguousPerson:      object|null, // Stored while awaiting last-name disambiguation
 *   operatorBlockCount:   number,  // After-hours operator block attempt counter
 * }
 * ```
 *
 * ## Multi-instance deployments
 * This store is local to the Node.js process. For deployments with multiple
 * server instances (load-balanced), replace this module with a Redis-backed
 * implementation that exposes the same exported function signatures.
 *
 * ## Session cleanup
 * Sessions are pruned automatically every 10 minutes if older than 1 hour.
 * The /call/status webhook also deletes the session explicitly when a call
 * reaches a terminal state (completed, failed, etc.).
 */

/** @type {Map<string, object>} CallSid → session state */
const sessions = new Map();

// ─── Conversation history ────────────────────────────────────────────────────

/**
 * Get (or create) the messages array for a call session.
 * Creating a session here ensures all other accessors can assume one exists.
 *
 * @param {string} callSid
 * @returns {Array<{role: string, content: string}>}
 */
export function getMessages(callSid) {
  if (!sessions.has(callSid)) {
    sessions.set(callSid, {
      messages: [],
      createdAt: Date.now(),
      retryCount: 0,
      waitingForMessageFor: null,
    });
  }
  return sessions.get(callSid).messages;
}

/**
 * Append a message to the conversation history and return the full history.
 *
 * @param {string} callSid
 * @param {'user'|'assistant'} role
 * @param {string} content
 * @returns {Array<{role: string, content: string}>} Updated messages array
 */
export function addMessage(callSid, role, content) {
  const messages = getMessages(callSid);
  messages.push({ role, content });
  return messages;
}

/**
 * Delete the entire session for a call. Called by POST /call/status on
 * terminal call states (completed, failed, busy, no-answer, canceled).
 *
 * @param {string} callSid
 */
export function deleteSession(callSid) {
  sessions.delete(callSid);
}

// ─── Empty-speech retry counter ──────────────────────────────────────────────

/**
 * Increment the empty-speech retry counter and return the new count.
 * Creates the session if it doesn't exist yet (caller was silent on the first gather).
 *
 * @param {string} callSid
 * @returns {number} New retry count (1-based)
 */
export function incrementRetry(callSid) {
  const session = sessions.get(callSid);
  if (!session) {
    sessions.set(callSid, { messages: [], createdAt: Date.now(), retryCount: 1 });
    return 1;
  }
  session.retryCount = (session.retryCount || 0) + 1;
  return session.retryCount;
}

/**
 * Reset the retry counter to zero after successful speech is received.
 * @param {string} callSid
 */
export function resetRetry(callSid) {
  const session = sessions.get(callSid);
  if (session) session.retryCount = 0;
}

// ─── Voicemail / message collection ──────────────────────────────────────────

/**
 * Mark the session as waiting for a voicemail for a named person.
 * On the next /call/gather hit, the speech will be treated as the message body.
 *
 * Special sentinel value: `'__emergency__'` — used when an emergency is
 * detected but no on-call person is available. The message is recorded and
 * all active people are notified via SMS.
 *
 * @param {string} callSid
 * @param {string} personName       - Name to record the message under, or '__emergency__'
 * @param {number|null} [personId]  - The exact person's id when known. Always pass it
 *   when you have it: several people can share a first name.
 */
export function setWaitingForMessage(callSid, personName, personId = null) {
  const session = sessions.get(callSid);
  if (!session) return;
  session.waitingForMessageFor = personName;
  session.waitingForPersonId = personId;
}

/**
 * @param {string} callSid
 * @returns {number|null} Id of the person the message is for, if known
 */
export function getWaitingForPersonId(callSid) {
  return sessions.get(callSid)?.waitingForPersonId ?? null;
}

/**
 * @param {string} callSid
 * @returns {string|null} Person name, '__emergency__', or null if not waiting
 */
export function getWaitingForMessage(callSid) {
  return sessions.get(callSid)?.waitingForMessageFor ?? null;
}

/** @param {string} callSid */
export function clearWaitingForMessage(callSid) {
  const session = sessions.get(callSid);
  if (!session) return;
  session.waitingForMessageFor = null;
  session.waitingForPersonId = null;
}

// ─── Debug log ────────────────────────────────────────────────────────────────

/**
 * Append a timestamped entry to the call's debug log array.
 * Only written when verbose_logging=yes in system_config.
 * The full log is persisted to call_logs.debug_log at end-of-call.
 *
 * @param {string} callSid
 * @param {string} step    - Step label (e.g. 'gather', 'transfer')
 * @param {string} message - Description of what happened
 */
export function appendDebugLog(callSid, step, message) {
  if (!sessions.has(callSid)) {
    sessions.set(callSid, { messages: [], createdAt: Date.now(), retryCount: 0, waitingForMessageFor: null, debugLog: [] });
  }
  const session = sessions.get(callSid);
  if (!session.debugLog) session.debugLog = [];
  const ts = new Date().toTimeString().slice(0, 8); // HH:MM:SS
  session.debugLog.push(`[${ts}] [${step}] ${message}`);
}

/**
 * @param {string} callSid
 * @returns {string} All debug log entries joined by newline, or empty string
 */
export function getDebugLog(callSid) {
  return sessions.get(callSid)?.debugLog?.join('\n') ?? '';
}

// ─── Soft-urgency state ───────────────────────────────────────────────────────

/**
 * Store the soft-urgency context between POST /call/gather and POST /call/clarify-urgency.
 * Set when the AI returns action='clarify_urgency'. Consumed and cleared by the
 * clarify-urgency route to run the second-stage analysis.
 *
 * @param {string} callSid
 * @param {{ person: string|null, transcript: string, reasoning: string, callerPhrase: string|null }} data
 */
export function setSoftUrgencyState(callSid, data) {
  const session = sessions.get(callSid);
  if (session) session.softUrgency = data;
}

/** @param {string} callSid @returns {object|null} */
export function getSoftUrgencyState(callSid) {
  return sessions.get(callSid)?.softUrgency ?? null;
}

/** @param {string} callSid */
export function clearSoftUrgencyState(callSid) {
  const session = sessions.get(callSid);
  if (session) session.softUrgency = null;
}

// ─── Direct-transfer offer state ─────────────────────────────────────────────

/**
 * Store the direct-transfer offer between the "transfer or message?" prompt
 * and the caller's response on the next /call/gather.
 * Offered for routine calls when the person's routing preference is "offer" (see routineHandling).
 *
 * @param {string} callSid
 * @param {{ personId: number, personName: string, phone: string }} data
 */
export function setDirectTransferOffered(callSid, data) {
  const session = sessions.get(callSid);
  if (session) session.directTransferOffered = data;
}

/** @param {string} callSid @returns {{ personName: string, phone: string }|null} */
export function getDirectTransferOffered(callSid) {
  return sessions.get(callSid)?.directTransferOffered ?? null;
}

/** @param {string} callSid */
export function clearDirectTransferOffered(callSid) {
  const session = sessions.get(callSid);
  if (session) session.directTransferOffered = null;
}

// ─── Ambiguous person state ───────────────────────────────────────────────────

/**
 * Store disambiguation state when a first name matches multiple people.
 * The caller is asked for the last name; the next /call/gather uses this
 * to resolve via resolveAmbiguousPerson() before continuing with routing.
 *
 * @param {string} callSid
 * @param {{ firstName: string, pendingRouting: object }} data
 *   `pendingRouting` is the AI routing decision that will be applied once the
 *   person is unambiguously identified.
 */
export function setAmbiguousPersonState(callSid, data) {
  const session = sessions.get(callSid);
  if (session) session.ambiguousPerson = data;
}

/** @param {string} callSid @returns {{ firstName: string, pendingRouting: object }|null} */
export function getAmbiguousPersonState(callSid) {
  return sessions.get(callSid)?.ambiguousPerson ?? null;
}

/** @param {string} callSid */
export function clearAmbiguousPersonState(callSid) {
  const session = sessions.get(callSid);
  if (session) session.ambiguousPerson = null;
}

// ─── After-hours operator block counter ──────────────────────────────────────

/**
 * Track how many times an after-hours operator/main-line request has been blocked.
 * Behaviour:
 *   count === 1 → replay the after-hours greeting and give the caller another chance
 *   count >= 2  → play the no-response message and hang up
 *
 * @param {string} callSid
 * @returns {number} New block count (1-based)
 */
export function incrementOperatorBlock(callSid) {
  const session = sessions.get(callSid);
  if (!session) return 1;
  session.operatorBlockCount = (session.operatorBlockCount ?? 0) + 1;
  return session.operatorBlockCount;
}

// ─── Automatic session pruning ────────────────────────────────────────────────

/**
 * Remove sessions older than 1 hour every 10 minutes.
 * Guards against memory leaks from calls that never hit the /call/status webhook
 * (e.g. dropped connections, Twilio errors, or misconfigured status callbacks).
 */
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [callSid, session] of sessions.entries()) {
    if (session.createdAt < cutoff) sessions.delete(callSid);
  }
}, 10 * 60 * 1000).unref();   // don't keep the process alive just for cleanup
