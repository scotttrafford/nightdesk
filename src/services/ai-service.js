/**
 * @module ai-service
 * @description Builds routing prompts and turns AI replies into routing decisions.
 *
 * Two analyses are used per call:
 * - `analyzeCallRouting`   — POST /call/gather: who does the caller want, and how urgent is it?
 * - `analyzeClarifyUrgency` — POST /call/clarify-urgency: after a SOFT urgency signal, does the
 *                             caller's explanation make it an emergency?
 *
 * Urgency tiers:
 * - HARD    — emergency; transfer immediately
 * - SOFT    — possibly urgent; ask "What seems to be the problem?" first
 * - ROUTINE — take a message or route normally
 *
 * Trigger phrases for each tier come from the `triggers` table and are embedded
 * in the prompt, so the model can match them exactly or by meaning.
 */

import { getAIResponse } from './ai-provider.js';
import { config } from '../config.js';
import { logger, STEP } from './logger.js';

/** Wrap the system prompt in a cacheable content block when caching is enabled. */
function applyCache(systemPrompt) {
  if (!config.useCaching) return systemPrompt;
  return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
}

/**
 * Extract a JSON object from a model reply. Handles bare JSON, markdown-fenced
 * JSON, and JSON surrounded by prose. Returns null if none can be parsed.
 */
export function extractJSON(raw) {
  try { return JSON.parse(raw.trim()); } catch {}
  const stripped = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

/**
 * Build the first-stage routing prompt.
 *
 * The prompt lists active people, the three trigger tiers, whether the business is
 * open, and worked examples using real names/triggers from the database so the
 * model's JSON output matches what calls.js expects.
 *
 * @param {Array}   people          - Active people rows from DB
 * @param {Array}   hardTriggers    - Trigger rows with trigger_type='emergency'
 * @param {Array}   softTriggers    - Trigger rows with trigger_type='needs_clarification'
 * @param {Array}   routineTriggers - Trigger rows with trigger_type='routine'
 * @param {boolean} isOpen          - Whether business is currently open
 * @param {boolean} hasMainLine     - Whether callers can be connected to a main line right now
 * @returns {string} Full system prompt
 */
export function buildSystemPrompt(people, hardTriggers, softTriggers, routineTriggers, isOpen = true, hasMainLine = true) {
  const peopleSection = people.map(p => {
    const alts = Array.isArray(p.alternate_names) && p.alternate_names.length > 0
      ? ` (also: ${p.alternate_names.join(', ')})`
      : '';
    return `- ${p.name}${alts}`;
  }).join('\n');

  const hardList = hardTriggers.length > 0
    ? hardTriggers.map(t => `- "${t.phrase}"`).join('\n')
    : '- "emergency"\n- "urgent"\n- "right away"\n- "asap"\n- "help"';

  const softList = softTriggers.length > 0
    ? softTriggers.map(t => `- "${t.phrase}"`).join('\n')
    : '- "I really need to"\n- "it\'s important"\n- "time-sensitive"';

  const routineList = routineTriggers.length > 0
    ? routineTriggers.map(t => `- "${t.phrase}"`).join('\n')
    : '- "I would like to"\n- "could I talk to"\n- "when you get a chance"';

  const peopleNames = [...new Set(people.map(p => p.name))].join(', ');
  const p1 = people[0]?.name ?? 'someone';
  const p2 = people[1]?.name ?? p1;
  const t1 = hardTriggers[0]?.phrase ?? 'emergency';
  const t2 = hardTriggers[1]?.phrase ?? 'urgent';
  const status = isOpen ? 'OPEN' : 'CLOSED';

  // Only mention the main line when callers can actually be connected to it
  const mainLineAction = hasMainLine
    ? '- main_line        → Route to main line (general inquiry, no person identified)'
    : '- (no main line)   → There is NO main line, operator or front desk right now. Never offer one. For general inquiries, use "clarify" and ask who they would like to leave a message for.';
  const mainLineExample = hasMainLine
    ? `ROUTINE — main line fallback:
{"person": null, "action": "main_line", "message": "Let me connect you to the main line", "urgency": "ROUTINE", "inferred": false, "reasoning": "General inquiry", "caller_phrase": null, "similar_to": null}

`
    : '';
  const offerList = hasMainLine
    ? `I can connect you to ${peopleNames}, or the main line.`
    : `I can take a message for ${peopleNames}.`;

  return `You are an intelligent call routing assistant analyzing caller urgency.

HARD EMERGENCY TRIGGERS (immediate action — these phrases indicate definite HIGH urgency):
${hardList}

Semantic equivalents that should also be treated as HARD even without the exact words:
- "my basement is flooding" → HARD (safety emergency)
- "server crashed, customers locked out" → HARD (business critical)
- "I'm locked out and it's freezing" → HARD (safety + time-sensitive)

SOFT URGENCY INDICATORS (need clarification before routing):
These suggest possible urgency but require more information:
${softList}

ROUTINE INDICATORS (explicitly NOT urgent — override other signals):
${routineList}

When a caller uses a ROUTINE phrase, classify as ROUTINE even if the sentence content sounds urgent.
Example: "I would like to speak to Alex about an emergency meeting" → ROUTINE (polite phrasing overrides content)

PEOPLE AVAILABLE:
${peopleSection}

CURRENT STATUS: ${status}

YOUR JOB:
1. Identify who the caller wants to reach (person field)
2. Classify urgency: HARD, SOFT, or ROUTINE
3. Choose the appropriate routing action
4. Set inferred=true if HARD urgency was detected WITHOUT the caller using an exact trigger phrase
5. CRITICAL: "message_text" must contain the EXACT verbatim words the caller said

ROUTING ACTIONS:
- transfer         → Route immediately (HARD urgency only, or on-hours direct-connect request)
- clarify_urgency  → Ask "What seems to be the problem?" (SOFT urgency only)
- take_message     → Ask caller for their message (ROUTINE, person identified)
- message_received → Caller already gave the message — log and hang up
${mainLineAction}
- clarify          → Ask who they want (no person identified, no urgency)

IMPORTANT:
- HARD urgency → always use action "transfer", even if no person named
- SOFT urgency → always use action "clarify_urgency"
- Never ask for clarification when HARD urgency is detected

RESPOND WITH JSON ONLY — include ALL fields:

HARD emergency, named person:
{"person": "${p1}", "action": "transfer", "message": "Connecting you to ${p1} right away", "urgency": "HARD", "inferred": false, "reasoning": "Caller used exact trigger '${t1}'", "caller_phrase": "${t1}", "similar_to": "${t1}"}

HARD emergency, no person named:
{"person": null, "action": "transfer", "message": "This sounds urgent, let me connect you right away", "urgency": "HARD", "inferred": false, "reasoning": "Caller used exact trigger '${t1}'", "caller_phrase": "${t1}", "similar_to": "${t1}"}

HARD emergency inferred (semantic match, no exact phrase):
{"person": null, "action": "transfer", "message": "This sounds urgent, let me connect you right away", "urgency": "HARD", "inferred": true, "reasoning": "Flooding is a safety emergency similar to '${t1}'", "caller_phrase": "my basement is flooding", "similar_to": "${t1}"}

SOFT urgency (needs clarification):
{"person": "${p1}", "action": "clarify_urgency", "message": "What seems to be the problem?", "urgency": "SOFT", "inferred": false, "reasoning": "Caller expressed urgency without stating the problem", "caller_phrase": "I really need to speak to ${p1}", "similar_to": null}

ROUTINE — first mention (ask for message):
{"person": "${p1}", "action": "take_message", "message": "Okay, what's your message for ${p1}?", "urgency": "ROUTINE", "inferred": false, "reasoning": "Routine call, no urgency", "caller_phrase": null, "similar_to": null}

ROUTINE — message already given (log and hang up):
{"person": "${p1}", "action": "message_received", "message": "I'll make sure ${p1} gets that. Goodbye!", "message_text": "EXACT verbatim quote", "urgency": "ROUTINE", "inferred": false, "reasoning": "Message delivered", "caller_phrase": null, "similar_to": null}

${mainLineExample}ROUTINE — clarify who they want:
{"person": null, "action": "clarify", "message": "Who would you like to speak with?", "urgency": "ROUTINE", "inferred": false, "reasoning": "No person identified, no urgency", "caller_phrase": null, "similar_to": null}

EXAMPLES:

Input: "I need ${p1}, it's a ${t1}"
Output: {"person": "${p1}", "action": "transfer", "message": "Connecting you to ${p1} right away", "urgency": "HARD", "inferred": false, "reasoning": "Caller used exact trigger '${t1}'", "caller_phrase": "${t1}", "similar_to": "${t1}"}

Input: "I have a ${t2}, I need help"
Output: {"person": null, "action": "transfer", "message": "This sounds urgent, let me connect you right away", "urgency": "HARD", "inferred": false, "reasoning": "Caller used exact trigger '${t2}'", "caller_phrase": "${t2}", "similar_to": "${t2}"}

Input: "My pipe just burst, water everywhere"
Output: {"person": null, "action": "transfer", "message": "This sounds urgent, let me connect you right away", "urgency": "HARD", "inferred": true, "reasoning": "Pipe burst causing flooding is a safety emergency similar to '${t1}'", "caller_phrase": "pipe just burst, water everywhere", "similar_to": "${t1}"}

Input: "I really need to speak to ${p1}"
Output: {"person": "${p1}", "action": "clarify_urgency", "message": "What seems to be the problem?", "urgency": "SOFT", "inferred": false, "reasoning": "Expressed urgency without stating the problem", "caller_phrase": "I really need to speak to ${p1}", "similar_to": null}

Input: "Can I talk to ${p2}?"
Output: {"person": "${p2}", "action": "take_message", "message": "Okay, what's your message for ${p2}?", "urgency": "ROUTINE", "inferred": false, "reasoning": "Routine call, no urgency", "caller_phrase": null, "similar_to": null}

Input: "Tell ${p2} I'll be late"
Output: {"person": "${p2}", "action": "message_received", "message": "I'll make sure ${p2} gets that. Goodbye!", "message_text": "Tell ${p2} I'll be late", "urgency": "ROUTINE", "inferred": false, "reasoning": "Message delivered", "caller_phrase": null, "similar_to": null}

Input: "Hello?"
Output: {"person": null, "action": "clarify", "message": "Hello! Who would you like to speak with? ${offerList}", "urgency": "ROUTINE", "inferred": false, "reasoning": "No information provided", "caller_phrase": null, "similar_to": null}

Always respond with ONLY the JSON object, nothing else.`;
}

/**
 * Build the second-stage clarification analysis prompt.
 * Used by /call/clarify-urgency to re-evaluate urgency after the caller explains their problem.
 *
 * @param {string} initialTranscript - What the caller originally said
 * @param {Array}  hardTriggers      - Trigger rows with trigger_type='emergency'
 * @param {string} initialReasoning  - Reasoning from the first-stage analysis
 * @returns {string} System prompt for the second analysis
 */
export function buildClarifyPrompt(initialTranscript, hardTriggers, initialReasoning) {
  const triggerList = hardTriggers.length > 0
    ? hardTriggers.map(t => `- "${t.phrase}"`).join('\n')
    : '- "emergency"\n- "urgent"\n- "right away"\n- "asap"\n- "help"';

  const t1 = hardTriggers[0]?.phrase ?? 'emergency';

  return `You are analyzing a CLARIFICATION response after detecting soft urgency in a phone call.

CONTEXT:
- The caller initially said: "${initialTranscript}"
- Initial analysis: ${initialReasoning}
- The caller was asked "What seems to be the problem?" and gave a clarification

HARD EMERGENCY TRIGGERS:
${triggerList}

Semantic equivalents that indicate HARD urgency:
- "my basement is flooding" → HARD (safety emergency)
- "server crashed, customers locked out" → HARD (business critical)
- "the pipes burst" → HARD (safety + property damage)
- "I'm locked out in the cold" → HARD (safety risk)

ROUTINE examples (not emergency):
- "about the meeting next week" → ROUTINE
- "to discuss the contract" → ROUTINE
- "I want to reschedule" → ROUTINE
- "just to check in" → ROUTINE

Determine: Does the clarification reveal a HARD emergency, or is this ROUTINE?

EXAMPLES:
- Initial: "I really need to talk to Alex" → Clarification: "the pipes burst" → HARD
- Initial: "I really need to talk to Alex" → Clarification: "about the meeting next week" → ROUTINE
- Initial: "It's important I reach Jordan" → Clarification: "our server is down" → HARD
- Initial: "It's important I reach Jordan" → Clarification: "to discuss the invoice" → ROUTINE

Respond with JSON only:
{"urgency": "HARD" or "ROUTINE", "inferred": true/false, "reasoning": "why this is or isn't an emergency", "caller_phrase": "phrase from clarification indicating urgency, or null", "similar_to": "which trigger this matches, or null"}

Always respond with ONLY the JSON object, nothing else.`;
}

/**
 * Analyze a caller's speech and return a routing decision. Used by POST /call/gather.
 *
 * Expected reply shape:
 * ```json
 * {
 *   "person":              "name | null",
 *   "action":              "transfer | clarify_urgency | take_message | message_received | main_line | clarify",
 *   "message":             "text to speak to the caller",
 *   "message_text":        "caller's verbatim message (message_received only)",
 *   "urgency":             "HARD | SOFT | ROUTINE",
 *   "inferred":            false,   // true when HARD was inferred without an exact trigger phrase
 *   "reasoning":           "why this decision was made",
 *   "caller_phrase":       "phrase that drove the decision, or null",
 *   "similar_to":          "trigger phrase it resembles, or null"
 * }
 * ```
 *
 * @param {Array}         messages     - Full conversation history (role/content pairs)
 * @param {string}        systemPrompt - Built by buildSystemPrompt()
 * @returns {Promise<Object>} Parsed routing object. If the reply isn't JSON, it is
 *   spoken back to the caller as a `clarify` turn.
 */
export async function analyzeCallRouting(messages, systemPrompt) {
  const raw = await getAIResponse(messages, applyCache(systemPrompt));
  const parsed = extractJSON(raw);
  if (!parsed) {
    logger.warn(STEP.AI_PARSE_ERR, null, `non-JSON reply: "${raw.substring(0, 80)}"`);
    return {
      action: 'clarify',
      urgency: 'ROUTINE',
      message: raw,
      person: null,
      inferred: false,
      reasoning: 'Non-JSON response from AI',
      caller_phrase: null,
      similar_to: null,
    };
  }
  return parsed;
}

/**
 * Second-stage urgency analysis after a SOFT trigger. Used by POST /call/clarify-urgency.
 *
 * @param {Array}         messages     - Single user turn containing both the original
 *                                       statement and the clarification
 * @param {string}        systemPrompt - Built by buildClarifyPrompt()
 * @returns {Promise<Object>} `{ urgency: 'HARD'|'ROUTINE', inferred, reasoning, caller_phrase, similar_to }`.
 *   Defaults to ROUTINE if the reply can't be parsed.
 */
export async function analyzeClarifyUrgency(messages, systemPrompt) {
  const raw = await getAIResponse(messages, applyCache(systemPrompt));
  return extractJSON(raw) ?? { urgency: 'ROUTINE' };
}
