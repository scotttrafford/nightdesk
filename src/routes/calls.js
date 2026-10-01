/**
 * @module calls
 * @description Twilio webhook handlers — the call-flow controller.
 *
 * Each handler receives a Twilio webhook, loads people/triggers/settings from the
 * database, asks the AI service for a routing decision when needed, and replies
 * with TwiML telling Twilio what to do next (speak, listen, transfer, hang up).
 *
 * ## Routes
 *
 * | Route                    | Trigger                                      |
 * |--------------------------|----------------------------------------------|
 * | POST /call/incoming      | New inbound call arrives                     |
 * | POST /call/gather        | Caller finishes speaking (speech transcribed)|
 * | POST /call/clarify-urgency | Second-stage urgency clarification          |
 * | POST /call/status        | Call lifecycle event (completed, failed, ...) |
 *
 * ## Design intent
 * This file is the orchestration layer — it should not contain business logic
 * beyond parsing requests, loading DB data, and delegating to services.
 * Routing decisions come from ai-service.js. State lives in session.js.
 * DB reads go through routing.js. Outbound SMS goes through notifications.js.
 */

import { Router } from 'express';
import twilio from 'twilio';
import { config } from '../config.js';
import { analyzeCallRouting, analyzeClarifyUrgency, buildSystemPrompt, buildClarifyPrompt } from '../services/ai-service.js';
import {
  addMessage, getMessages, deleteSession, incrementRetry, resetRetry,
  setWaitingForMessage, getWaitingForMessage, getWaitingForPersonId, clearWaitingForMessage,
  getDebugLog,
  setSoftUrgencyState, getSoftUrgencyState, clearSoftUrgencyState,
  setDirectTransferOffered, getDirectTransferOffered, clearDirectTransferOffered,
  setAmbiguousPersonState, getAmbiguousPersonState, clearAmbiguousPersonState,
  incrementOperatorBlock,
} from '../services/session.js';
import {
  loadPeople, loadActiveTriggers, checkBusinessHours,
  resolveOnCallPerson, getSystemConfig, incrementTriggerMatch,
  findPeople, findPerson, resolveAmbiguousPerson, personTemplateVars, logCall,
  routineHandling, acceptsTransfers, mainLineAvailable, wantsDirectTransfer, fullName,
  attachMessageToCallLog,
} from '../services/routing.js';
import { applyTemplate, logStep } from '../services/utils.js';
import { sendSMS, sendEmail } from '../services/notifications.js';
import { logger, STEP } from '../services/logger.js';

const router = Router();
const { VoiceResponse } = twilio.twiml;

/**
 * Reject webhooks whose X-Twilio-Signature doesn't match (when enabled).
 * Twilio signs the exact public URL, so behind a reverse proxy the proxy must
 * send X-Forwarded-Proto: https (see 'trust proxy' in server.js).
 */
function webhookAuth(req, res, next) {
  if (!config.validateTwilioSignature) return next();

  const twilioSignature = req.headers['x-twilio-signature'];
  const computedUrl = `${req.protocol}://${req.hostname}${req.originalUrl}`;

  const valid = twilio.validateRequest(
    config.twilioAuthToken,
    twilioSignature,
    computedUrl,
    req.body
  );

  if (!valid) {
    logger.warn(STEP.CALL_IN, null, `sig-check FAILED — url=${computedUrl}`);
    res.status(403).send('Forbidden');
    return;
  }

  next();
}

/** Format the conversation history for the call_logs.full_transcript column. */
function transcript(messages) {
  return messages.map(m => `${m.role}: ${m.content}`).join('\n');
}

/**
 * Notify people according to their notification_preference ('sms' | 'email' | 'both').
 * Email goes through sendEmail(), which is a stub until a provider is configured.
 *
 * @param {Array}  recipients - Person rows
 * @param {string} text       - Notification body
 * @param {string} from       - Twilio number to send SMS from (system_config: inbound_number)
 * @param {string} callSid
 */
async function notify(recipients, text, from, callSid) {
  await Promise.all(recipients.map(async (p) => {
    const pref = p.notification_preference || 'sms';
    if ((pref === 'email' || pref === 'both') && p.email) {
      await sendEmail(p.email, text.split('\n')[0].slice(0, 80), text);
    }
    if ((pref === 'sms' || pref === 'both') && p.cell_phone) {
      await sendSMS(p.cell_phone, text, from);
    }
  }));
}

/**
 * Route a routine (non-emergency) call for a known person according to their
 * routing_preference (see routineHandling in routing.js): connect now, offer
 * "transfer or message?", or ask for a message. If the caller then stays
 * silent, they're connected to the main line.
 *
 * @param {twilio.twiml.VoiceResponse} twiml
 * @param {Object} person - Person row
 * @param {Object} ctx
 * @param {string}  ctx.callSid
 * @param {boolean} ctx.isOpen
 * @param {string}  ctx.mainLine
 * @param {boolean} ctx.mainLineOk - From mainLineAvailable()
 * @param {number}  ctx.speechTimeout
 * @param {string}  ctx.verbose
 * @param {Object}  ctx.prompts - { connecting, transferOffer, messagePrompt, silenceTransfer, silenceGoodbye } from system_config
 * @param {Object}  ctx.logFields - call_logs fields used if the call is transferred now
 */
async function routeRoutineCall(twiml, person, ctx) {
  const { callSid, isOpen, mainLine, mainLineOk, speechTimeout, verbose, prompts, logFields } = ctx;
  const handling = routineHandling(person, isOpen);
  logStep(callSid, 'routing', `Routine call for ${person.name}: ${person.routing_preference || 'business_hours'} → ${handling}`, verbose);

  if (handling === 'transfer') {
    logger.info(STEP.CALL_TRANSFER, callSid, `ROUTINE → ${person.name} (${person.cell_phone}) always_direct`);
    await logCall({ ...logFields, detectedPerson: person.name, routedToNumber: person.cell_phone });
    const msg = prompts.connecting || 'Connecting you now.';
    logStep(callSid, 'say', `SpeechText: "${msg}"`, verbose);
    twiml.say({ voice: config.ttsVoice }, msg);
    twiml.dial(person.cell_phone);
    return;
  }

  if (handling === 'offer') {
    const msg = prompts.transferOffer || 'Would you like me to transfer you directly, or shall I take a message?';
    logStep(callSid, 'say', `SpeechText: "${msg}"`, verbose);
    twiml.gather({ input: 'speech', action: '/call/gather', method: 'POST', speechTimeout })
      .say({ voice: config.ttsVoice }, msg);
    setDirectTransferOffered(callSid, { personId: person.id, personName: fullName(person), phone: person.cell_phone });
  } else {
    const msg = prompts.messagePrompt || `Okay, what's your message for ${person.name}?`;
    logStep(callSid, 'say', `SpeechText: "${msg}"`, verbose);
    twiml.gather({ input: 'speech', action: '/call/gather', method: 'POST', speechTimeout, finishOnKey: '#' })
      .say({ voice: config.ttsVoice }, msg);
    setWaitingForMessage(callSid, fullName(person), person.id);
  }
  noAnswerFallback(twiml, mainLineOk, mainLine, prompts.silenceTransfer, prompts.silenceGoodbye);
}

/**
 * The caller didn't answer a prompt: connect them to the main line if it's
 * available, otherwise say goodbye and hang up.
 */
function noAnswerFallback(twiml, mainLineOk, mainLine, transferMsg, goodbyeMsg) {
  if (mainLineOk) {
    twiml.say({ voice: config.ttsVoice }, transferMsg || "I didn't hear anything. Let me connect you to the main line.");
    twiml.dial(mainLine);
  } else {
    twiml.say({ voice: config.ttsVoice }, goodbyeMsg || "I didn't hear anything. Goodbye.");
    twiml.hangup();
  }
}

/**
 * The caller asked for the operator / main line but it isn't available (none
 * configured, or after hours). First time: explain and ask who they'd like to
 * leave a message for. Second time: say goodbye and hang up. The attempt count
 * lives in session state so it survives the gather round-trip.
 *
 * @param {twilio.twiml.VoiceResponse} twiml
 * @param {string} callSid
 * @param {string} firstMsg      - e.g. after-hours greeting, or no_operator_message
 * @param {string} finalMsg      - spoken before hanging up on the second attempt
 * @param {number} speechTimeout
 * @param {string} verbose
 */
function handleNoMainLine(twiml, callSid, firstMsg, finalMsg, speechTimeout, verbose) {
  const count = incrementOperatorBlock(callSid);
  logStep(callSid, 'operator-blocked', `Operator/main-line request — main line unavailable (attempt ${count})`, verbose);
  if (count === 1) {
    logStep(callSid, 'say', `SpeechText: "${firstMsg}"`, verbose);
    twiml.gather({ input: 'speech', action: '/call/gather', method: 'POST', speechTimeout })
      .say({ voice: config.ttsVoice }, firstMsg);
    twiml.redirect('/call/gather');
  } else {
    logStep(callSid, 'say', `SpeechText: "${finalMsg}"`, verbose);
    twiml.say({ voice: config.ttsVoice }, finalMsg);
    logger.debug(STEP.CALL_END, callSid, 'hangup — main line unavailable (attempt 2)');
    twiml.hangup();
  }
}

/**
 * POST /call/incoming
 * Twilio calls this webhook when an inbound call arrives.
 * Responds with TwiML that greets the caller and opens a speech Gather.
 * Greeting and speech timeout are loaded from system_config.
 * Greeting varies based on current business hours.
 */
router.post('/incoming', webhookAuth, async (req, res) => {
  const { CallSid } = req.body;
  const twiml = new VoiceResponse();

  logger.info(STEP.CALL_IN, CallSid, `from=${req.body.From}`);

  try {
    const now = new Date();
    const [timezone, greeting, afterHoursGreeting, speechTimeoutRaw, verboseRaw] = await Promise.all([
      getSystemConfig('timezone'),
      getSystemConfig('greeting_business_hours'),
      getSystemConfig('greeting_after_hours'),
      getSystemConfig('speech_timeout'),
      getSystemConfig('verbose_logging'),
    ]);
    const verbose = verboseRaw || 'no';
    const isOpen = await checkBusinessHours(now, timezone || 'America/Toronto');

    logger.info(STEP.CALL_HOURS, CallSid, `${isOpen ? 'OPEN' : 'CLOSED'} (${timezone || 'America/Toronto'})`);
    logStep(CallSid, 'incoming', `Business hours: ${isOpen ? 'OPEN' : 'CLOSED'} (${timezone || 'America/Toronto'})`, verbose);

    const greetingText = isOpen
      ? (greeting || "Hello! How can I help you today?")
      : (afterHoursGreeting || "Hello! We're currently closed, but I can take a message. How can I help you?");

    logStep(CallSid, 'incoming', `Greeting: ${isOpen ? 'greeting_business_hours' : 'greeting_after_hours'}`, verbose);

    const speechTimeout = parseInt(speechTimeoutRaw ?? '2');
    logger.debug(STEP.CALL_IN, CallSid, `greeting="${greetingText.substring(0, 80)}${greetingText.length > 80 ? '…' : ''}" timeout=${speechTimeout}s`);

    const gather = twiml.gather({
      input: 'speech',
      action: '/call/gather',
      method: 'POST',
      speechTimeout,
      language: 'en-US',
    });
    logStep(CallSid, 'say', `SpeechText: "${greetingText}"`, verbose);
    gather.say({ voice: config.ttsVoice }, greetingText);
  } catch (err) {
    logger.error(STEP.DB_ERROR, CallSid, `loading incoming config: ${err.message}`);
    // Fallback greeting when DB is unreachable
    const gather = twiml.gather({
      input: 'speech',
      action: '/call/gather',
      method: 'POST',
      speechTimeout: 2,
      language: 'en-US',
    });
    gather.say({ voice: config.ttsVoice }, "Hello! How can I help you?");
  }

  // If gather times out with no speech, hand off to /call/gather which handles retries
  twiml.redirect('/call/gather');

  res.type('text/xml').send(twiml.toString());
});

/**
 * POST /call/gather
 *
 * Core routing handler. Twilio posts here every time the caller finishes speaking.
 * `SpeechResult` contains the transcribed text (may be empty on silence/timeout).
 *
 * All DB config is loaded in a single parallel Promise.all at the top of the handler
 * to minimize latency (Twilio webhooks time out after 15 seconds).
 *
 * ## Decision tree
 *
 * 1. **Empty speech** → increment retry counter
 *    - Below MAX_RETRIES: prompt to repeat → redirect back to /call/gather
 *    - At MAX_RETRIES: open hours → transfer to main line / after hours → hang up
 *
 * 2. **Direct transfer offer pending** (directTransferOffered in session)
 *    → caller answered "transfer directly or leave a message?"
 *    → yes: transfer to person's cell / no: prompt for message
 *
 * 3. **Waiting for voicemail** (waitingForMessageFor in session)
 *    → speech is the message body → log to DB → send SMS → hang up
 *    → emergency phrase detected mid-message → escalate immediately
 *
 * 4. **Operator/main-line keyword matched** (operator trigger type)
 *    → business hours: transfer to main line
 *    → main line unavailable (none configured, or after hours): see handleNoMainLine
 *
 * 5. **Ambiguous person pending** (ambiguousPerson in session)
 *    → use speech to resolve last name via resolveAmbiguousPerson()
 *    → resolved: continue with pending routing / unresolved: ask again
 *
 * 6. **AI routing** (all other cases)
 *    → buildSystemPrompt() + analyzeCallRouting() → JSON decision object
 *    → HARD (transfer):        transfer to person → on-call → main line → notify-all
 *    → SOFT (clarify_urgency): store state → ask "What seems to be the problem?" → /clarify-urgency
 *    → ROUTINE (take_message): prompt for voicemail (offer direct transfer if allowed)
 *    → ROUTINE (message_received): caller already gave message → log → SMS → hang up
 *    → ROUTINE (main_line):    transfer to main line (blocked after hours if configured)
 *    → ROUTINE (clarify):      ask who they want to reach
 */
router.post('/gather', webhookAuth, async (req, res) => {
  const { CallSid, SpeechResult } = req.body;
  const twiml = new VoiceResponse();
  logger.debug(STEP.GATHER_SPEECH, CallSid, `entry — SpeechResult=${SpeechResult ? `"${SpeechResult}"` : '(empty)'}`);

  // Load all DB config in parallel — single round-trip latency
  let people = [], hardTriggers = [], softTriggers = [], routineTriggers = [], operatorTriggers = [];
  let mainLine = null;
  let SPEECH_TIMEOUT = 2, MAX_RETRIES = 2;
  let isOpen = false;
  let emergencyTransferMessage = null, emergencyNoOnCallMessage = null,
      connectingMessage = null, messagePrompt = null;
  let messageReceivedTemplate = null, inboundNumber = null, notifyAll = 'no', verbose = 'no';
  let afterHoursNoResponseMessage = null;
  let retryMsg1 = null, retryMsg2 = null, silentFallbackMsg = null;
  let emergencyMsgConfirmation = null, unknownPersonMsg = null;
  let silenceGoodbyeMsg = null, silenceTransferMsg = null;
  let technicalErrorMsg = null, bHoursTransferPrompt = null, clarifyPersonMsg = null;
  let operatorBusinessHoursOnly = true;
  let noOperatorMsg = null;
  let afterHoursGreeting = null;

  try {
    const now = new Date();
    const [
      peopleRows,
      hardRows,
      softRows,
      routineRows,
      operatorRows,
      mainLineNumber,
      speechTimeoutRaw,
      maxRetriesRaw,
      timezone,
      emgTransfer,
      emgNoOnCall,
      connecting,
      msgPrompt,
      msgReceived,
      inboundNum,
      notifyAllRaw,
      verboseRaw,
      afterHoursNoResponseRaw,
      retryMsg1Raw,
      retryMsg2Raw,
      silentFallbackRaw,
      emgMsgConfirmRaw,
      unknownPersonRaw,
      silenceGoodbyeRaw,
      silenceTransferRaw,
      techErrorRaw,
      bHoursTransferRaw,
      clarifyPersonRaw,
      operatorBHoursOnlyRaw,
      afterHoursGreetingRaw,
      noOperatorRaw,
    ] = await Promise.all([
      loadPeople(),
      loadActiveTriggers('emergency'),
      loadActiveTriggers('needs_clarification'),
      loadActiveTriggers('routine'),
      loadActiveTriggers('operator'),
      getSystemConfig('main_line_number'),
      getSystemConfig('speech_timeout'),
      getSystemConfig('max_retries'),
      getSystemConfig('timezone'),
      getSystemConfig('emergency_transfer_message'),
      getSystemConfig('emergency_no_oncall_message'),
      getSystemConfig('connecting_message'),
      getSystemConfig('message_prompt'),
      getSystemConfig('message_received'),
      getSystemConfig('inbound_number'),
      getSystemConfig('emergency_notify_all'),
      getSystemConfig('verbose_logging'),
      getSystemConfig('after_hours_no_response_message'),
      getSystemConfig('retry_message_1'),
      getSystemConfig('retry_message_2'),
      getSystemConfig('silent_fallback_message'),
      getSystemConfig('emergency_message_confirmation'),
      getSystemConfig('unknown_person_message'),
      getSystemConfig('silence_goodbye_message'),
      getSystemConfig('silence_transfer_message'),
      getSystemConfig('technical_error_message'),
      getSystemConfig('business_hours_transfer_prompt'),
      getSystemConfig('clarify_person_message'),
      getSystemConfig('operator_business_hours_only'),
      getSystemConfig('greeting_after_hours'),
      getSystemConfig('no_operator_message'),
    ]);

    people = peopleRows;
    hardTriggers = hardRows;
    softTriggers = softRows;
    routineTriggers = routineRows;
    operatorTriggers = operatorRows;
    mainLine = mainLineNumber;
    SPEECH_TIMEOUT = parseInt(speechTimeoutRaw ?? '2');
    MAX_RETRIES = parseInt(maxRetriesRaw ?? '2');
    isOpen = await checkBusinessHours(now, timezone || 'America/Toronto');
    emergencyTransferMessage = emgTransfer;
    emergencyNoOnCallMessage = emgNoOnCall;
    connectingMessage = connecting;
    messagePrompt = msgPrompt;
    messageReceivedTemplate = msgReceived;
    inboundNumber = inboundNum;
    notifyAll = notifyAllRaw || 'no';
    verbose = verboseRaw || 'no';
    afterHoursNoResponseMessage = afterHoursNoResponseRaw;
    retryMsg1 = retryMsg1Raw;
    retryMsg2 = retryMsg2Raw;
    silentFallbackMsg = silentFallbackRaw;
    emergencyMsgConfirmation = emgMsgConfirmRaw;
    unknownPersonMsg = unknownPersonRaw;
    silenceGoodbyeMsg = silenceGoodbyeRaw;
    silenceTransferMsg = silenceTransferRaw;
    technicalErrorMsg = techErrorRaw;
    bHoursTransferPrompt = bHoursTransferRaw;
    clarifyPersonMsg = clarifyPersonRaw;
    const obhRaw = (operatorBHoursOnlyRaw || 'yes').toLowerCase();
    operatorBusinessHoursOnly = obhRaw !== 'no' && obhRaw !== 'false';
    afterHoursGreeting = afterHoursGreetingRaw;
    noOperatorMsg = noOperatorRaw;
  } catch (err) {
    logger.error(STEP.DB_ERROR, CallSid, `loading routing config: ${err.message}`);
  }

  const mainLineOk = mainLineAvailable(mainLine, isOpen, operatorBusinessHoursOnly);
  // Used when the operator/main line is requested but unavailable
  const noMainLine = () => isOpen
    ? handleNoMainLine(twiml, CallSid, noOperatorMsg || "I'm sorry, there's no operator available. Who would you like to leave a message for?",
        silenceGoodbyeMsg || "I didn't hear anything. Goodbye.", SPEECH_TIMEOUT, verbose)
    : handleNoMainLine(twiml, CallSid, afterHoursGreeting || "We are currently closed. Who would you like to leave a message for?",
        afterHoursNoResponseMessage || "We are currently closed. Please call back during business hours. Goodbye.", SPEECH_TIMEOUT, verbose);

  logger.debug(STEP.GATHER_SPEECH, CallSid, `DB loaded — people=${people.length} hard=${hardTriggers.length} soft=${softTriggers.length} routine=${routineTriggers.length} operator=${operatorTriggers.length} isOpen=${isOpen} maxRetries=${MAX_RETRIES} mainLine=${mainLineOk ? 'available' : 'unavailable'}`);
  logStep(CallSid, 'gather', `Business hours: ${isOpen ? 'OPEN' : 'CLOSED'}`, verbose);

  // Handle empty speech — retry up to MAX_RETRIES times, then connect to main line
  if (!SpeechResult?.trim()) {
    const retryCount = incrementRetry(CallSid);
    logger.debug(STEP.GATHER_RETRY, CallSid, `empty speech — retryCount=${retryCount} MAX_RETRIES=${MAX_RETRIES} isOpen=${isOpen}`);

    if (retryCount < MAX_RETRIES) {
      const gather = twiml.gather({
        input: 'speech',
        action: '/call/gather',
        method: 'POST',
        speechTimeout: SPEECH_TIMEOUT,
      });
      const retryMsg = retryCount < MAX_RETRIES - 1
        ? (retryMsg1 || "I'm sorry, I didn't catch that. Could you please repeat?")
        : (retryMsg2 || "I'm still having trouble hearing you. Let's try one more time.");
      logStep(CallSid, 'say', `SpeechText: "${retryMsg}"`, verbose);
      gather.say({ voice: config.ttsVoice }, retryMsg);
      // If this gather also times out, cycle back so the counter keeps incrementing
      twiml.redirect('/call/gather');
    } else {
      resetRetry(CallSid);
      logger.info(STEP.GATHER_SILENT, CallSid, `max retries hit — ${mainLineOk ? `transferring to main line ${mainLine}` : 'hanging up'}`);
      if (mainLineOk) {
        const fallbackMsg = silentFallbackMsg || "I apologize, I'm having trouble understanding you. Let me connect you.";
        logStep(CallSid, 'say', `SpeechText: "${fallbackMsg}"`, verbose);
        twiml.say({ voice: config.ttsVoice }, fallbackMsg);
        twiml.dial(mainLine);
      } else {
        const closedMsg = isOpen
          ? (silenceGoodbyeMsg || "I didn't hear anything. Goodbye.")
          : (afterHoursNoResponseMessage || "We're currently closed and unable to take your call. Please call back during business hours. Goodbye.");
        logStep(CallSid, 'say', `SpeechText: "${closedMsg}"`, verbose);
        twiml.say({ voice: config.ttsVoice }, closedMsg);
        logger.debug(STEP.CALL_END, CallSid, 'hangup — max retries, no main line');
        twiml.hangup();
      }
    }

    return res.type('text/xml').send(twiml.toString());
  }

  try {
    logStep(CallSid, 'gather', `SpeechResult: "${SpeechResult}"`, verbose);
    logger.debug(STEP.GATHER_SPEECH, CallSid, `"${SpeechResult}"`);
    const messages = addMessage(CallSid, 'user', SpeechResult);
    resetRetry(CallSid);

    const directTransfer = getDirectTransferOffered(CallSid);
    const waitingFor = getWaitingForMessage(CallSid);
    const ambiguousState = getAmbiguousPersonState(CallSid);
    logger.debug(STEP.GATHER_SPEECH, CallSid, `session — waitingFor=${waitingFor ?? 'null'} directTransfer=${directTransfer?.personName ?? 'null'} ambiguous=${ambiguousState?.firstName ?? 'null'}`);

    // ── Direct-transfer offer response ───────────────────────────────────────
    // Caller was asked "transfer directly or leave a message?" — handle their answer
    if (directTransfer) {
      clearDirectTransferOffered(CallSid);
      logStep(CallSid, 'direct_transfer', `Caller responded to transfer offer: "${SpeechResult}"`, verbose);
      const wantsTransfer = wantsDirectTransfer(SpeechResult);
      logger.debug(STEP.GATHER_DTRANSFER, CallSid, `offer for ${directTransfer.personName} — wantsTransfer=${wantsTransfer}`);

      if (wantsTransfer) {
        logStep(CallSid, 'direct_transfer', `Transferring directly to ${directTransfer.personName} (${directTransfer.phone})`, verbose);
        await logCall({
          callSid: CallSid, callerNumber: req.body.From,
          detectedPerson: directTransfer.personName, routedToNumber: directTransfer.phone,
          fullTranscript: transcript(messages),
          debugLog: getDebugLog(CallSid),
        });
        const directConnectMsg = connectingMessage || "Connecting you now.";
        logStep(CallSid, 'say', `SpeechText: "${directConnectMsg}"`, verbose);
        twiml.say({ voice: config.ttsVoice }, directConnectMsg);
        twiml.dial(directTransfer.phone);
      } else {
        logStep(CallSid, 'direct_transfer', `Taking message for ${directTransfer.personName}`, verbose);
        const gather = twiml.gather({
          input: 'speech',
          action: '/call/gather',
          method: 'POST',
          speechTimeout: SPEECH_TIMEOUT,
          finishOnKey: '#',
        });
        const dtMsgPrompt = messagePrompt || `Okay, what's your message for ${directTransfer.personName}?`;
        logStep(CallSid, 'say', `SpeechText: "${dtMsgPrompt}"`, verbose);
        gather.say({ voice: config.ttsVoice }, dtMsgPrompt);
        setWaitingForMessage(CallSid, directTransfer.personName, directTransfer.personId);
        noAnswerFallback(twiml, mainLineOk, mainLine, silenceTransferMsg, silenceGoodbyeMsg);
      }

      return res.type('text/xml').send(twiml.toString());
    }

    // ── Waiting for message ──────────────────────────────────────────────────
    // The previous turn asked for a message, so this speech is the message body
    if (waitingFor) {
      logger.debug(STEP.GATHER_WAITING, CallSid, `collecting message for: ${waitingFor}`);
      logStep(CallSid, 'gather', `Collecting message for: ${waitingFor}`, verbose);
      const isEmergencyMessage = waitingFor === '__emergency__';
      // Use the exact person chosen earlier in the call; fall back to the name only
      // when the caller named someone we don't have (no id)
      const waitingForId = getWaitingForPersonId(CallSid);
      const person = isEmergencyMessage ? null
        : waitingForId ? (people.find(p => p.id === waitingForId) ?? null)
        : findPerson(people, waitingFor);
      const logPersonName = isEmergencyMessage ? null : waitingFor;

      // Re-check urgency before saving — if the caller is describing an emergency, escalate
      const containsHardTrigger = !isEmergencyMessage && hardTriggers.some(t =>
        t.phrase && SpeechResult.toLowerCase().includes(t.phrase.toLowerCase())
      );
      if (containsHardTrigger) {
        clearWaitingForMessage(CallSid);
        logStep(CallSid, 'message_upgrade', `Emergency phrase detected in message for ${waitingFor} — escalating`, verbose);

        let escalatePerson = person && acceptsTransfers(person) ? person : null;
        if (!escalatePerson && !(isOpen && mainLine)) {
          escalatePerson = await resolveOnCallPerson(new Date());
          if (escalatePerson) logStep(CallSid, 'message_upgrade', `On-call: ${escalatePerson.name}`, verbose);
        }
        const escalateTo = escalatePerson?.cell_phone || (isOpen && mainLine ? mainLine : null);

        await logCall({
          callSid: CallSid, callerNumber: req.body.From,
          detectedPerson: escalatePerson?.name ?? null, emergencyDetected: true,
          routedToNumber: escalateTo,
          fullTranscript: transcript(messages),
          debugLog: getDebugLog(CallSid),
          aiInferred: true, aiReasoning: 'Emergency phrase detected during message collection',
          callerPhrase: SpeechResult,
        });

        if (escalateTo) {
          const escalateMsg = emergencyTransferMessage || "This sounds urgent, connecting you right away.";
          logStep(CallSid, 'say', `SpeechText: "${escalateMsg}"`, verbose);
          twiml.say({ voice: config.ttsVoice }, escalateMsg);
          twiml.dial(escalateTo);
        } else {
          // After hours, no on-call — notify all and hang up
          if (notifyAll.toLowerCase() === 'yes') {
            await notify(people, `EMERGENCY ALERT: Caller ${req.body.From} reported an emergency while leaving a message.`, inboundNumber, CallSid);
          }
          twiml.say({ voice: config.ttsVoice }, emergencyNoOnCallMessage || "This is an emergency but no one is available. Please call 911 if needed. Goodbye.");
          logger.debug(STEP.CALL_END, CallSid, 'hangup — emergency mid-message, no escalation target');
          twiml.hangup();
        }
        return res.type('text/xml').send(twiml.toString());
      }

      clearWaitingForMessage(CallSid);
      logger.info(STEP.CALL_MESSAGE, CallSid, isEmergencyMessage
        ? `emergency message from ${req.body.From}`
        : `message for ${waitingFor}${person ? ` → SMS ${person.cell_phone}` : ' (person not in DB)'}`);
      logStep(CallSid, 'message_saved', isEmergencyMessage
        ? `Saving emergency message from ${req.body.From}`
        : `Saving message for ${waitingFor}${person ? `, SMS to ${person.cell_phone}` : ' (person not in DB)'}`, verbose);

      // Log to database. An emergency was already logged when it was detected,
      // so its message is attached to that row instead.
      const attached = isEmergencyMessage
        && await attachMessageToCallLog(CallSid, SpeechResult, transcript(messages), getDebugLog(CallSid));
      if (!attached) {
        await logCall({
          callSid: CallSid, callerNumber: req.body.From,
          detectedPerson: logPersonName, emergencyDetected: isEmergencyMessage,
          routedToNumber: person?.cell_phone ?? null, messageLeft: SpeechResult,
          fullTranscript: transcript(messages),
          debugLog: getDebugLog(CallSid),
        });
      }

      if (isEmergencyMessage && notifyAll.toLowerCase() === 'yes') {
        await notify(people, `EMERGENCY MESSAGE from ${req.body.From}:\n\n${SpeechResult}`, inboundNumber, CallSid);
      } else if (person) {
        await notify([person], `Message from ${req.body.From}:\n\n${SpeechResult}`, inboundNumber, CallSid);
      }

      // Thank and hang up
      const waitingConfirmation = isEmergencyMessage
        ? (emergencyMsgConfirmation || "Your message has been recorded. We'll get back to you as soon as possible. Goodbye!")
        : (messageReceivedTemplate
          ? applyTemplate(messageReceivedTemplate, personTemplateVars(person, waitingFor))
          : `I'll make sure ${waitingFor} gets that. Goodbye!`);
      logStep(CallSid, 'say', `SpeechText: "${waitingConfirmation}"`, verbose);
      twiml.say({ voice: config.ttsVoice }, waitingConfirmation);
      logger.debug(STEP.CALL_END, CallSid, `hangup — message saved for ${isEmergencyMessage ? '__emergency__' : waitingFor}`);
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    // Track which triggers matched in the caller's speech (for analytics)
    const allTriggers = [...hardTriggers, ...softTriggers, ...routineTriggers, ...operatorTriggers];
    const matchedTriggers = allTriggers.filter(t =>
      t.phrase && SpeechResult.toLowerCase().includes(t.phrase.toLowerCase())
    );
    if (matchedTriggers.length > 0) {
      logStep(CallSid, 'gather', `Triggers matched: ${matchedTriggers.map(t => `${t.phrase} (${t.trigger_type})`).join(', ')}`, verbose);
      logger.debug(STEP.GATHER_TRIGGER, CallSid, matchedTriggers.map(t => `"${t.phrase}" (${t.trigger_type})`).join(', '));
      // Fire-and-forget — don't block the response on analytics
      Promise.all(matchedTriggers.map(t => incrementTriggerMatch(t.id)))
        .catch(err => logger.error(STEP.DB_ERROR, CallSid, `incrementTriggerMatch: ${err.message}`));
    } else {
      logStep(CallSid, 'gather', 'No triggers matched', verbose);
    }

    // Operator keyword match — route without consulting the AI
    const operatorTriggered = matchedTriggers.find(t => t.trigger_type === 'operator');
    if (operatorTriggered && !mainLineOk) {
      logger.info(STEP.CALL_OP_BLOCK, CallSid, `operator request, main line unavailable — phrase="${operatorTriggered.phrase}"`);
      noMainLine();
      return res.type('text/xml').send(twiml.toString());
    }
    if (operatorTriggered) {
      logger.info(STEP.GATHER_OPERATOR, CallSid, `phrase="${operatorTriggered.phrase}" → main line ${mainLine}`);
      logStep(CallSid, 'operator', `Operator keyword matched: "${operatorTriggered.phrase}" — routing to main line: ${mainLine}`, verbose);
      await logCall({
        callSid: CallSid, callerNumber: req.body.From,
        routedToNumber: mainLine,
        fullTranscript: transcript(messages),
        debugLog: getDebugLog(CallSid),
        callerPhrase: operatorTriggered.phrase,
      });
      const operatorConnectMsg = connectingMessage || "Connecting you to the main line now.";
      logStep(CallSid, 'say', `SpeechText: "${operatorConnectMsg}"`, verbose);
      twiml.say({ voice: config.ttsVoice }, operatorConnectMsg);
      twiml.dial(mainLine);
      return res.type('text/xml').send(twiml.toString());
    }

    // ── Ambiguous person disambiguation ──────────────────────────────────────
    // If the previous turn asked for a last name, try to resolve now
    let routing;
    if (ambiguousState) {
      logger.debug(STEP.GATHER_DISAMBIG, CallSid, `resolving firstName="${ambiguousState.firstName}" from speech="${SpeechResult}"`);
      clearAmbiguousPersonState(CallSid);
      const resolved = resolveAmbiguousPerson(people, ambiguousState.firstName, SpeechResult);
      if (resolved) {
        const resolvedFullName = resolved.last_name ? `${resolved.name} ${resolved.last_name}` : resolved.name;
        logStep(CallSid, 'disambiguate', `Resolved "${ambiguousState.firstName}" → ${resolvedFullName}`, verbose);
        routing = { ...ambiguousState.pendingRouting, person: resolvedFullName };
      } else {
        logStep(CallSid, 'disambiguate', `Could not resolve "${SpeechResult}" for first name "${ambiguousState.firstName}"`, verbose);
        const unresolvedMsg = unknownPersonMsg || "I don't recognize that name. Who would you like to speak with?";
        logStep(CallSid, 'say', `SpeechText: "${unresolvedMsg}"`, verbose);
        const gather = twiml.gather({ input: 'speech', action: '/call/gather', method: 'POST', speechTimeout: SPEECH_TIMEOUT });
        gather.say({ voice: config.ttsVoice }, unresolvedMsg);
        twiml.redirect('/call/gather');
        return res.type('text/xml').send(twiml.toString());
      }
    } else {
      // Build the prompt from current DB data and ask the AI for a routing decision
      logger.debug(STEP.AI_REQUEST, CallSid, `sending to AI — messages=${messages.length} people=${people.length} hard=${hardTriggers.length} soft=${softTriggers.length} routine=${routineTriggers.length} isOpen=${isOpen}`);
      const systemPrompt = buildSystemPrompt(people, hardTriggers, softTriggers, routineTriggers, isOpen, mainLineOk);
      routing = await analyzeCallRouting(messages, systemPrompt);
      addMessage(CallSid, 'assistant', JSON.stringify(routing));
      logStep(CallSid, 'ai', `Response:\n${JSON.stringify(routing, null, 2)}`, verbose);
      logger.debug(STEP.AI_RESPONSE, CallSid, `action=${routing.action} urgency=${routing.urgency} person=${routing.person ?? 'null'} inferred=${routing.inferred}`);

      // If the AI identified a first name that matches multiple people, try to resolve
      // from the original speech before asking the caller for clarification
      if (routing.person) {
        const matches = findPeople(people, routing.person);
        if (matches.length > 1) {
          // Check if the caller already said a last name that uniquely identifies one person
          const speechResolved = resolveAmbiguousPerson(matches, routing.person, SpeechResult);
          if (speechResolved) {
            const resolvedFullName = speechResolved.last_name
              ? `${speechResolved.name} ${speechResolved.last_name}`
              : speechResolved.name;
            logStep(CallSid, 'disambiguate', `"${routing.person}" matched ${matches.length} people — resolved from speech to ${resolvedFullName}`, verbose);
            routing = { ...routing, person: resolvedFullName };
          } else {
            setAmbiguousPersonState(CallSid, { firstName: routing.person, pendingRouting: routing });
            const clarifyMsg = applyTemplate(
              clarifyPersonMsg || "I found more than one {first_name}. Could you please provide their last name?",
              { first_name: routing.person }
            );
            logStep(CallSid, 'disambiguate', `"${routing.person}" matched ${matches.length} people`, verbose);
            logStep(CallSid, 'say', `SpeechText: "${clarifyMsg}"`, verbose);
            const gather = twiml.gather({ input: 'speech', action: '/call/gather', method: 'POST', speechTimeout: SPEECH_TIMEOUT });
            gather.say({ voice: config.ttsVoice }, clarifyMsg);
            twiml.redirect('/call/gather');
            return res.type('text/xml').send(twiml.toString());
          }
        }
      }
    }

    logStep(CallSid, 'routing', `action=${routing.action}, person=${routing.person ?? 'null'}, urgency=${routing.urgency ?? 'n/a'}`, verbose);
    logStep(CallSid, 'routing', `inferred=${!!routing.inferred}, reasoning="${routing.reasoning ?? ''}"`, verbose);
    let my_action = routing.action?.trim().toLowerCase();

    const isEmergency = routing.urgency === 'HARD';

    // A routine "put me through" request only transfers if the person's routing
    // preference allows it right now; otherwise it becomes a message.
    const namedPerson = findPerson(people, routing.person);
    if (!isEmergency && my_action === 'transfer' && namedPerson && routineHandling(namedPerson, isOpen) === 'message') {
      logStep(CallSid, 'routing', `${namedPerson.name} takes messages only right now — taking a message instead`, verbose);
      my_action = 'take_message';
    }

    // AI analysis fields recorded with every call_logs row from this point on
    const inference = {
      aiInferred: routing.inferred || false,
      aiReasoning: routing.reasoning || null,
      callerPhrase: routing.caller_phrase || null,
      similarToTrigger: routing.similar_to || null,
    };

    logger.debug(STEP.AI_RESPONSE, CallSid, `routing branch — action=${my_action} urgency=${routing.urgency} person=${routing.person ?? 'null'} isEmergency=${isEmergency}`);

    // ── HARD EMERGENCY — transfer immediately ────────────────────────────────
    if (my_action === 'transfer' && (routing.person || isEmergency)) {
      let person = namedPerson;

      // Message-only people never receive transferred calls, emergencies included
      if (person && isEmergency && !acceptsTransfers(person)) {
        logStep(CallSid, 'transfer', `${person.name} is message-only — routing emergency elsewhere`, verbose);
        person = null;
      }

      // Emergency with no named person, after hours or with no main line → on-call person
      if (!person && isEmergency && !(isOpen && mainLine)) {
        person = await resolveOnCallPerson(new Date());
        if (person) {
          logger.info(STEP.CALL_ONCALL, CallSid, `emergency → on-call: ${person.name} (${person.cell_phone})`);
          logStep(CallSid, 'transfer', `Emergency — on-call: ${person.name} (${person.cell_phone})`, verbose);
        }
      }

      // Business-hours emergency with no named person → route to main line (staffed when open)
      if (!person && isEmergency && isOpen && mainLine) {
        logger.info(STEP.CALL_TRANSFER, CallSid, `HARD BH emergency — no person named → main line ${mainLine}`);
        logStep(CallSid, 'transfer', `Business-hours emergency — no person named, routing to main line: ${mainLine}`, verbose);
        const emgMainMsg = emergencyTransferMessage || routing.message;
        logStep(CallSid, 'say', `SpeechText: "${emgMainMsg}"`, verbose);
        await logCall({
          callSid: CallSid, callerNumber: req.body.From,
          emergencyDetected: true, routedToNumber: mainLine,
          fullTranscript: transcript(messages),
          debugLog: getDebugLog(CallSid),
          ...inference,
        });
        twiml.say({ voice: config.ttsVoice }, emgMainMsg);
        twiml.dial(mainLine);
        return res.type('text/xml').send(twiml.toString());
      }

      if (person) {
        logger.info(STEP.CALL_TRANSFER, CallSid, `${isEmergency ? 'HARD' : 'ROUTINE'} → ${person.name} (${person.cell_phone}) inferred=${inference.aiInferred}`);
        logStep(CallSid, 'transfer', `Transferring to ${person.name} (${person.cell_phone})`, verbose);
        const emgPersonMsg = (isEmergency ? emergencyTransferMessage : connectingMessage) || routing.message;
        logStep(CallSid, 'say', `SpeechText: "${emgPersonMsg}"`, verbose);
        await logCall({
          callSid: CallSid, callerNumber: req.body.From,
          detectedPerson: person.name, emergencyDetected: isEmergency, routedToNumber: person.cell_phone,
          fullTranscript: transcript(messages),
          debugLog: getDebugLog(CallSid),
          ...inference,
        });
        twiml.say({ voice: config.ttsVoice }, emgPersonMsg);
        twiml.dial(person.cell_phone);
      } else if (isEmergency) {
        // Emergency but no person found and no one on-call
        logger.info(STEP.CALL_EMERGENCY, CallSid, `emergency — no person named, no on-call — notifyAll=${notifyAll}`);
        logStep(CallSid, 'transfer', `Emergency - no person, no on-call. notifyAll=${notifyAll}`, verbose);
        const emgNoOnCallMsg = emergencyNoOnCallMessage || "This is an emergency but no one is available. Please leave a detailed message after the tone.";
        logStep(CallSid, 'say', `SpeechText: "${emgNoOnCallMsg}"`, verbose);
        twiml.say({ voice: config.ttsVoice }, emgNoOnCallMsg);

        if (notifyAll.toLowerCase() === 'yes') {
          await notify(people, `EMERGENCY ALERT: Caller ${req.body.From} reported an emergency. No on-call person is scheduled.`, inboundNumber, CallSid);
        }

        // Prompt caller to leave a message and collect it via gather
        const emergencyMsgGather = twiml.gather({
          input: 'speech',
          action: '/call/gather',
          method: 'POST',
          speechTimeout: SPEECH_TIMEOUT,
          finishOnKey: '#',
        });
        const emgMsgPrompt = messagePrompt || "Please leave your message after the tone.";
        logStep(CallSid, 'say', `SpeechText: "${emgMsgPrompt}"`, verbose);
        emergencyMsgGather.say({ voice: config.ttsVoice }, emgMsgPrompt);
        setWaitingForMessage(CallSid, '__emergency__');

        // Record the emergency now, so it's logged (with the AI's reasoning) even if
        // the caller hangs up; their message is attached when it arrives
        await logCall({
          callSid: CallSid, callerNumber: req.body.From,
          detectedPerson: routing.person ?? null, emergencyDetected: true,
          fullTranscript: transcript(messages), debugLog: getDebugLog(CallSid),
          ...inference,
        });

        // Fallback if gather times out
        twiml.say({ voice: config.ttsVoice }, silenceGoodbyeMsg || "I didn't hear anything. Goodbye.");
        logger.debug(STEP.CALL_END, CallSid, 'hangup — emergency gather timeout fallback (gather)');
        twiml.hangup();
      } else {
        // Named person not found — ask again
        logger.warn(STEP.CALL_TRANSFER, CallSid, `person "${routing.person}" not found in DB — asking again`);
        logStep(CallSid, 'routing', `Named person not found: ${routing.person}`, verbose);
        const notFoundMsg = unknownPersonMsg || "I don't recognize that name. Who would you like to speak with?";
        logStep(CallSid, 'say', `SpeechText: "${notFoundMsg}"`, verbose);
        const gather = twiml.gather({
          input: 'speech',
          action: '/call/gather',
          method: 'POST',
          speechTimeout: SPEECH_TIMEOUT,
        });
        gather.say({ voice: config.ttsVoice }, notFoundMsg);
      }

    // ── SOFT URGENCY — ask clarifying question ───────────────────────────────
    } else if (my_action === 'clarify_urgency') {
      logger.debug(STEP.CALL_CLARIFY, CallSid, `SOFT urgency — person=${routing.person ?? 'null'} phrase="${routing.caller_phrase}"`);
      logStep(CallSid, 'gather', `Soft urgency detected for ${routing.person ?? 'unknown'}: "${routing.caller_phrase}"`, verbose);
      setSoftUrgencyState(CallSid, {
        person: routing.person,
        transcript: SpeechResult,
        reasoning: routing.reasoning,
        callerPhrase: routing.caller_phrase,
      });

      const clarifyMsg = routing.message || "What seems to be the problem?";
      logStep(CallSid, 'say', `SpeechText: "${clarifyMsg}"`, verbose);
      const gather = twiml.gather({
        input: 'speech',
        action: '/call/clarify-urgency',
        method: 'POST',
        speechTimeout: SPEECH_TIMEOUT,
      });
      gather.say({ voice: config.ttsVoice }, clarifyMsg);

      // No answer: main line if available, otherwise goodbye
      noAnswerFallback(twiml, mainLineOk, mainLine, silenceTransferMsg, silenceGoodbyeMsg);

    // ── ROUTINE: take_message — ask for their message ────────────────────────
    } else if (my_action === 'take_message') {
      logger.debug(STEP.GATHER_WAITING, CallSid, `take_message — person=${routing.person ?? 'null'}`);
      const person = namedPerson;

      if (person) {
        await routeRoutineCall(twiml, person, {
          callSid: CallSid, isOpen, mainLine, mainLineOk, speechTimeout: SPEECH_TIMEOUT, verbose,
          prompts: { connecting: connectingMessage, transferOffer: bHoursTransferPrompt, messagePrompt, silenceTransfer: silenceTransferMsg, silenceGoodbye: silenceGoodbyeMsg },
          logFields: { callSid: CallSid, callerNumber: req.body.From, fullTranscript: transcript(messages), debugLog: getDebugLog(CallSid), ...inference },
        });
      } else {
        // Named someone we don't have — record the message under the name given
        logStep(CallSid, 'take_message', `Asking for message for unknown person: ${routing.person}`, verbose);
        const msgPromptText = messagePrompt || routing.message;
        logStep(CallSid, 'say', `SpeechText: "${msgPromptText}"`, verbose);
        twiml.gather({ input: 'speech', action: '/call/gather', method: 'POST', speechTimeout: SPEECH_TIMEOUT, finishOnKey: '#' })
          .say({ voice: config.ttsVoice }, msgPromptText);
        setWaitingForMessage(CallSid, routing.person);
        noAnswerFallback(twiml, mainLineOk, mainLine, silenceTransferMsg, silenceGoodbyeMsg);
      }

    // ── ROUTINE: message_received — log and send SMS ─────────────────────────
    } else if (my_action === 'message_received') {
      logger.info(STEP.CALL_MESSAGE, CallSid, `message_received — person=${routing.person ?? 'null'} text="${(routing.message_text ?? '').substring(0, 80)}"`);
      logStep(CallSid, 'message_received', `Message for ${routing.person}: "${(routing.message_text ?? '').substring(0, 100)}"`, verbose);
      const person = findPerson(people, routing.person);

      // Log to database
      await logCall({
        callSid: CallSid, callerNumber: req.body.From,
        detectedPerson: routing.person, messageLeft: routing.message_text,
        fullTranscript: transcript(messages),
        debugLog: getDebugLog(CallSid),
        ...inference,
      });

      if (person) {
        await notify([person], `Message from ${req.body.From}:\n\n${routing.message_text}`, inboundNumber, CallSid);
      } else {
        logger.warn(STEP.SMS_SKIP, CallSid, `message_received: person "${routing.person}" not found in DB — SMS not sent`);
      }

      // Thank them and hang up
      const receivedConfirmation = messageReceivedTemplate
        ? applyTemplate(messageReceivedTemplate, personTemplateVars(person, routing.person))
        : routing.message;
      logStep(CallSid, 'say', `SpeechText: "${receivedConfirmation}"`, verbose);
      twiml.say({ voice: config.ttsVoice }, receivedConfirmation);
      logger.debug(STEP.CALL_END, CallSid, `hangup — message_received for ${routing.person ?? 'null'}`);
      twiml.hangup();

    // ── FALLBACK: main_line — transfer to main line ─────────────────────────
    } else if (my_action === 'main_line') {
      if (!mainLineOk) {
        noMainLine();
        return res.type('text/xml').send(twiml.toString());
      }
      logger.info(STEP.CALL_MAIN, CallSid, `main_line → ${mainLine}`);
      logStep(CallSid, 'main_line', `Routing to main line: ${mainLine}`, verbose);
      await logCall({
        callSid: CallSid, callerNumber: req.body.From,
        routedToNumber: mainLine,
        fullTranscript: transcript(messages),
        debugLog: getDebugLog(CallSid),
        ...inference,
      });

      const mainLineMsg = connectingMessage || routing.message;
      logStep(CallSid, 'say', `SpeechText: "${mainLineMsg}"`, verbose);
      twiml.say({ voice: config.ttsVoice }, mainLineMsg);
      twiml.dial(mainLine);

    // ── CONTINUE CONVERSATION — clarify or other ─────────────────────────────
    } else {
      logger.debug(STEP.CALL_CLARIFY, CallSid, `action=${my_action} — continuing conversation`);
      logStep(CallSid, 'say', `SpeechText: "${routing.message}"`, verbose);
      const gather = twiml.gather({
        input: 'speech',
        action: '/call/gather',
        method: 'POST',
        speechTimeout: SPEECH_TIMEOUT,
      });
      gather.say({ voice: config.ttsVoice }, routing.message);

      // No answer: main line if available, otherwise goodbye
      noAnswerFallback(twiml, mainLineOk, mainLine, silenceTransferMsg, silenceGoodbyeMsg);
    }

  } catch (err) {
    logger.error(STEP.AI_RESPONSE, CallSid, `AI routing failed: ${err.message}`);
    const techErrGatherMsg = technicalErrorMsg || "I'm sorry, I'm having technical difficulties. Please try again shortly.";
    logStep(CallSid, 'say', `SpeechText: "${techErrGatherMsg}"`, verbose);
    twiml.say({ voice: config.ttsVoice }, techErrGatherMsg);
    logger.debug(STEP.CALL_END, CallSid, 'hangup — AI routing error');
    twiml.hangup();
  }

  res.type('text/xml').send(twiml.toString());
});

/**
 * POST /call/clarify-urgency
 *
 * Second-stage urgency analysis. Called after a SOFT urgency trigger was detected
 * in /call/gather and the caller was asked "What seems to be the problem?".
 *
 * The soft-urgency state (original transcript, person, first-stage reasoning) was
 * stored in session by /call/gather and is retrieved here to give the second
 * AI analysis full context.
 *
 * ## Decision tree
 *
 * 1. **Missing session state** (e.g. session expired, misconfigured webhook):
 *    → redirect to /call/gather to start fresh
 *
 * 2. **Empty clarification speech**:
 *    → treat as ROUTINE — take message for stored person or route to main line
 *
 * 3. **Second-stage AI analysis** (buildClarifyPrompt + analyzeClarifyUrgency):
 *    - **HARD**: emergency confirmed — transfer priority:
 *        named person → on-call (after hours) → main line (business hours) → notify-all + record
 *    - **ROUTINE**: downgraded — prompt for voicemail for the stored person, or main line if no person
 *
 * ## caller_phrase logging
 * For two-stage calls, the `caller_phrase` stored in call_logs combines both stages:
 * `"Initial: '<original phrase>' | Clarification: '<clarification phrase>'"`
 */
router.post('/clarify-urgency', webhookAuth, async (req, res) => {
  const { CallSid, SpeechResult } = req.body;
  const twiml = new VoiceResponse();

  logger.debug(STEP.AI_CLARIFY_REQ, CallSid, `entry — clarification="${SpeechResult ? `"${SpeechResult}"` : '(empty)'}"`);

  // Retrieve the soft-urgency state stored by /call/gather
  const softState = getSoftUrgencyState(CallSid);
  if (!softState) {
    // State missing (e.g. session expired) — fall through to gather
    logger.warn(STEP.AI_CLARIFY_REQ, CallSid, 'no softUrgency session state — redirecting to /gather');
    twiml.redirect('/call/gather');
    return res.type('text/xml').send(twiml.toString());
  }
  clearSoftUrgencyState(CallSid);
  logger.debug(STEP.AI_CLARIFY_REQ, CallSid, `softState — person=${softState.person ?? 'null'} transcript="${softState.transcript?.substring(0, 60)}"`);

  // Reload config in parallel
  let people = [], hardTriggers = [], mainLine = null;
  let SPEECH_TIMEOUT = 2, isOpen = false;
  let emergencyTransferMessage = null, emergencyNoOnCallMessage = null;
  let connectingMessage = null, messagePrompt = null, messageReceivedTemplate = null;
  let inboundNumber = null, notifyAll = 'no', verbose = 'no';
  let silenceGoodbyeMsg = null, silenceTransferMsg = null, technicalErrorTransferMsg = null;
  let bHoursTransferPrompt = null;
  let operatorBusinessHoursOnly = true, noOperatorMsg = null, afterHoursGreeting = null;
  let afterHoursNoResponseMessage = null, technicalErrorMsg = null;

  try {
    const now = new Date();
    const [
      peopleRows, hardRows, mainLineRaw,
      speechTimeoutRaw, timezone,
      emgTransfer, emgNoOnCall, connecting,
      msgPrompt, msgReceived, inboundNum, notifyAllRaw, verboseRaw,
      silenceGoodbyeRaw, silenceTransferRaw, techErrorTransferRaw, bHoursTransferRaw,
      operatorBHoursOnlyRaw, noOperatorRaw, afterHoursGreetingRaw, afterHoursNoResponseRaw, techErrorRaw,
    ] = await Promise.all([
      loadPeople(),
      loadActiveTriggers('emergency'),
      getSystemConfig('main_line_number'),
      getSystemConfig('speech_timeout'),
      getSystemConfig('timezone'),
      getSystemConfig('emergency_transfer_message'),
      getSystemConfig('emergency_no_oncall_message'),
      getSystemConfig('connecting_message'),
      getSystemConfig('message_prompt'),
      getSystemConfig('message_received'),
      getSystemConfig('inbound_number'),
      getSystemConfig('emergency_notify_all'),
      getSystemConfig('verbose_logging'),
      getSystemConfig('silence_goodbye_message'),
      getSystemConfig('silence_transfer_message'),
      getSystemConfig('technical_error_transfer_message'),
      getSystemConfig('business_hours_transfer_prompt'),
      getSystemConfig('operator_business_hours_only'),
      getSystemConfig('no_operator_message'),
      getSystemConfig('greeting_after_hours'),
      getSystemConfig('after_hours_no_response_message'),
      getSystemConfig('technical_error_message'),
    ]);

    people = peopleRows;
    hardTriggers = hardRows;
    mainLine = mainLineRaw;
    SPEECH_TIMEOUT = parseInt(speechTimeoutRaw ?? '2');
    isOpen = await checkBusinessHours(now, timezone || 'America/Toronto');
    emergencyTransferMessage = emgTransfer;
    emergencyNoOnCallMessage = emgNoOnCall;
    connectingMessage = connecting;
    messagePrompt = msgPrompt;
    messageReceivedTemplate = msgReceived;
    inboundNumber = inboundNum;
    notifyAll = notifyAllRaw || 'no';
    verbose = verboseRaw || 'no';
    silenceGoodbyeMsg = silenceGoodbyeRaw;
    silenceTransferMsg = silenceTransferRaw;
    technicalErrorTransferMsg = techErrorTransferRaw;
    bHoursTransferPrompt = bHoursTransferRaw;
    const obhRaw = (operatorBHoursOnlyRaw || 'yes').toLowerCase();
    operatorBusinessHoursOnly = obhRaw !== 'no' && obhRaw !== 'false';
    noOperatorMsg = noOperatorRaw;
    afterHoursGreeting = afterHoursGreetingRaw;
    afterHoursNoResponseMessage = afterHoursNoResponseRaw;
    technicalErrorMsg = techErrorRaw;
  } catch (err) {
    logger.error(STEP.DB_ERROR, CallSid, `loading clarify-urgency config: ${err.message}`);
  }

  const mainLineOk = mainLineAvailable(mainLine, isOpen, operatorBusinessHoursOnly);
  // Used when the caller should reach the main line but it's unavailable
  const noMainLine = () => isOpen
    ? handleNoMainLine(twiml, CallSid, noOperatorMsg || "I'm sorry, there's no operator available. Who would you like to leave a message for?",
        silenceGoodbyeMsg || "I didn't hear anything. Goodbye.", SPEECH_TIMEOUT, verbose)
    : handleNoMainLine(twiml, CallSid, afterHoursGreeting || "We are currently closed. Who would you like to leave a message for?",
        afterHoursNoResponseMessage || "We are currently closed. Please call back during business hours. Goodbye.", SPEECH_TIMEOUT, verbose);

  logger.debug(STEP.AI_CLARIFY_REQ, CallSid, `DB loaded — people=${people.length} hard=${hardTriggers.length} isOpen=${isOpen}`);
  logStep(CallSid, 'clarify-urgency', `Initial: "${softState.transcript}" | Clarification: "${SpeechResult}"`, verbose);

  // Handle empty clarification — fall back to routine routing
  if (!SpeechResult?.trim()) {
    logger.debug(STEP.AI_CLARIFY_REQ, CallSid, `empty clarification — falling back to ROUTINE for person=${softState.person ?? 'null'}`);
    logStep(CallSid, 'clarify-urgency', 'No clarification received — treating as ROUTINE', verbose);
    const person = findPerson(people, softState.person);
    if (person) {
      await routeRoutineCall(twiml, person, {
        callSid: CallSid, isOpen, mainLine, mainLineOk, speechTimeout: SPEECH_TIMEOUT, verbose,
        prompts: { connecting: connectingMessage, transferOffer: bHoursTransferPrompt, messagePrompt, silenceTransfer: silenceTransferMsg, silenceGoodbye: silenceGoodbyeMsg },
        logFields: { callSid: CallSid, callerNumber: req.body.From, fullTranscript: transcript(getMessages(CallSid)), debugLog: getDebugLog(CallSid) },
      });
    } else if (!mainLineOk) {
      noMainLine();
    } else {
      const noClariConnectMsg = connectingMessage || "Let me connect you to the main line.";
      logStep(CallSid, 'say', `SpeechText: "${noClariConnectMsg}"`, verbose);
      twiml.say({ voice: config.ttsVoice }, noClariConnectMsg);
      twiml.dial(mainLine);
    }
    return res.type('text/xml').send(twiml.toString());
  }

  try {
    // Second-stage AI analysis
    const clarifySystemPrompt = buildClarifyPrompt(
      softState.transcript, hardTriggers, softState.reasoning
    );
    const clarifyMessages = [{
      role: 'user',
      content: `Initial message: "${softState.transcript}"\nClarification: "${SpeechResult}"`,
    }];
    logger.debug(STEP.AI_CLARIFY_REQ, CallSid, `sending second-stage AI — initialTranscript="${softState.transcript?.substring(0, 60)}" clarification="${SpeechResult?.substring(0, 60)}"`);
    const result = await analyzeClarifyUrgency(clarifyMessages, clarifySystemPrompt);
    logger.debug(STEP.AI_CLARIFY_RESP, CallSid, `urgency=${result.urgency} action=${result.action} person=${result.person ?? 'null'} inferred=${result.inferred}`);
    logStep(CallSid, 'clarify-urgency', `AI second-stage: ${JSON.stringify(result)}`, verbose);

    logStep(CallSid, 'clarify-urgency', `Final urgency: ${result.urgency}, reasoning: "${result.reasoning}"`, verbose);

    // Combined two-stage analysis, recorded in call_logs if this escalates to HARD
    const inference = {
      aiInferred: true,
      aiReasoning: `SOFT→HARD after clarification: ${result.reasoning}`,
      callerPhrase: `Initial: "${softState.callerPhrase || softState.transcript}" | Clarification: "${result.caller_phrase || SpeechResult}"`,
      similarToTrigger: result.similar_to || null,
    };

    const messages = addMessage(CallSid, 'user', `[clarification] ${SpeechResult}`);

    if (result.urgency === 'HARD') {
      // Escalated to emergency — route immediately
      logger.info(STEP.CALL_ESCALATE, CallSid, `SOFT→HARD — person=${softState.person ?? 'null'} phrase="${result.caller_phrase ?? SpeechResult?.substring(0, 60)}"`);
      logStep(CallSid, 'clarify-urgency', `Escalated to HARD. Routing as emergency.`, verbose);
      let person = findPerson(people, softState.person);
      if (person && !acceptsTransfers(person)) {
        logStep(CallSid, 'clarify-urgency', `${person.name} is message-only — routing emergency elsewhere`, verbose);
        person = null;
      }

      if (!person && !(isOpen && mainLine)) {
        person = await resolveOnCallPerson(new Date());
        if (person) {
          logger.info(STEP.CALL_ONCALL, CallSid, `clarify-urgency HARD → on-call: ${person.name} (${person.cell_phone})`);
          logStep(CallSid, 'clarify-urgency', `On-call: ${person.name}`, verbose);
        }
      }

      // Business-hours emergency with no named person → route to main line (staffed when open)
      if (!person && isOpen && mainLine) {
        logger.info(STEP.CALL_TRANSFER, CallSid, `HARD (clarify) BH emergency — no person → main line ${mainLine}`);
        logStep(CallSid, 'clarify-urgency', `Business-hours emergency escalation — no person named, routing to main line: ${mainLine}`, verbose);
        const clariEmgMainMsg = emergencyTransferMessage || "This sounds urgent, connecting you right away.";
        logStep(CallSid, 'say', `SpeechText: "${clariEmgMainMsg}"`, verbose);
        await logCall({
          callSid: CallSid, callerNumber: req.body.From,
          emergencyDetected: true, routedToNumber: mainLine,
          fullTranscript: transcript(messages),
          debugLog: getDebugLog(CallSid),
          ...inference,
        });
        twiml.say({ voice: config.ttsVoice }, clariEmgMainMsg);
        twiml.dial(mainLine);
        return res.type('text/xml').send(twiml.toString());
      }

      if (person) {
        logger.info(STEP.CALL_TRANSFER, CallSid, `HARD (clarify) → ${person.name} (${person.cell_phone})`);
        const clariEmgPersonMsg = emergencyTransferMessage || "This sounds urgent, connecting you right away.";
        logStep(CallSid, 'say', `SpeechText: "${clariEmgPersonMsg}"`, verbose);
        await logCall({
          callSid: CallSid, callerNumber: req.body.From,
          detectedPerson: person.name, emergencyDetected: true, routedToNumber: person.cell_phone,
          fullTranscript: transcript(messages),
          debugLog: getDebugLog(CallSid),
          ...inference,
        });
        twiml.say({ voice: config.ttsVoice }, clariEmgPersonMsg);
        twiml.dial(person.cell_phone);
      } else {
        // No person, no on-call
        logger.info(STEP.CALL_EMERGENCY, CallSid, `HARD (clarify) — no person, no on-call — notifyAll=${notifyAll}`);
        logStep(CallSid, 'clarify-urgency', `Emergency escalation — no person, no on-call. notifyAll=${notifyAll}`, verbose);
        const clariEmgNoOnCallMsg = emergencyNoOnCallMessage || "This is an emergency but no one is available. Please leave a detailed message after the tone.";
        logStep(CallSid, 'say', `SpeechText: "${clariEmgNoOnCallMsg}"`, verbose);
        twiml.say({ voice: config.ttsVoice }, clariEmgNoOnCallMsg);

        if (notifyAll.toLowerCase() === 'yes') {
          await notify(people, `EMERGENCY ALERT: Caller ${req.body.From} reported an emergency. No on-call person is scheduled.`, inboundNumber, CallSid);
        }

        // Prompt caller to leave a message and collect it via gather
        const emergencyMsgGather = twiml.gather({
          input: 'speech',
          action: '/call/gather',
          method: 'POST',
          speechTimeout: SPEECH_TIMEOUT,
          finishOnKey: '#',
        });
        const clariEmgMsgPrompt = messagePrompt || "Please leave your message after the tone.";
        logStep(CallSid, 'say', `SpeechText: "${clariEmgMsgPrompt}"`, verbose);
        emergencyMsgGather.say({ voice: config.ttsVoice }, clariEmgMsgPrompt);
        setWaitingForMessage(CallSid, '__emergency__');

        // Record the emergency now (see the matching block in /gather)
        await logCall({
          callSid: CallSid, callerNumber: req.body.From,
          detectedPerson: softState.person ?? null, emergencyDetected: true,
          fullTranscript: transcript(messages), debugLog: getDebugLog(CallSid),
          ...inference,
        });

        // Fallback if gather times out
        twiml.say({ voice: config.ttsVoice }, silenceGoodbyeMsg || "I didn't hear anything. Goodbye.");
        logger.debug(STEP.CALL_END, CallSid, 'hangup — emergency gather timeout fallback (clarify-urgency)');
        twiml.hangup();
      }

    } else {
      // ROUTINE after clarification — route by the person's preference
      logger.info(STEP.CALL_CLARIFY, CallSid, `SOFT→ROUTINE — person=${softState.person ?? 'null'}`);
      logStep(CallSid, 'clarify-urgency', `Downgraded to ROUTINE for ${softState.person ?? 'unknown'}.`, verbose);
      const person = findPerson(people, softState.person);

      if (person) {
        await routeRoutineCall(twiml, person, {
          callSid: CallSid, isOpen, mainLine, mainLineOk, speechTimeout: SPEECH_TIMEOUT, verbose,
          prompts: { connecting: connectingMessage, transferOffer: bHoursTransferPrompt, messagePrompt, silenceTransfer: silenceTransferMsg, silenceGoodbye: silenceGoodbyeMsg },
          logFields: { callSid: CallSid, callerNumber: req.body.From, fullTranscript: transcript(messages), debugLog: getDebugLog(CallSid) },
        });
      } else if (!mainLineOk) {
        noMainLine();
      } else {
        const routineConnectMsg = connectingMessage || "Let me connect you to the main line.";
        logStep(CallSid, 'say', `SpeechText: "${routineConnectMsg}"`, verbose);
        twiml.say({ voice: config.ttsVoice }, routineConnectMsg);
        twiml.dial(mainLine);
      }
    }

  } catch (err) {
    logger.error(STEP.AI_CLARIFY_RESP, CallSid, `clarify-urgency analysis failed: ${err.message}`);
    if (mainLineOk) {
      const techErrMsg = technicalErrorTransferMsg || "I'm sorry, I'm having technical difficulties. Let me connect you to the main line.";
      logStep(CallSid, 'say', `SpeechText: "${techErrMsg}"`, verbose);
      twiml.say({ voice: config.ttsVoice }, techErrMsg);
      twiml.dial(mainLine);
    } else {
      twiml.say({ voice: config.ttsVoice }, technicalErrorMsg || "I'm sorry, I'm having technical difficulties. Please try again shortly.");
      twiml.hangup();
    }
  }

  res.type('text/xml').send(twiml.toString());
});

/**
 * POST /call/status
 *
 * Twilio status callback — called when a call reaches a terminal state.
 * Cleans up the in-memory session to free memory.
 *
 * Configure in Twilio console under the phone number's "Call Status Changes" webhook:
 *   URL: https://<your-domain>/call/status  (POST)
 *
 * Terminal statuses that trigger session cleanup:
 *   completed, failed, busy, no-answer, canceled
 *
 * Non-terminal statuses (initiated, ringing, in-progress) are received but ignored.
 * Sessions also auto-expire after 1 hour via the interval in session.js as a safety net
 * in case this webhook is not configured or a delivery fails.
 *
 * Responds 204 No Content — Twilio does not use the response body for status callbacks.
 */
router.post('/status', webhookAuth, (req, res) => {
  const { CallSid, CallStatus } = req.body;
  const terminalStatuses = ['completed', 'failed', 'busy', 'no-answer', 'canceled'];
  if (terminalStatuses.includes(CallStatus)) {
    deleteSession(CallSid);
    logger.info(STEP.CALL_END, CallSid, `status=${CallStatus}`);
  }
  res.sendStatus(204);
});

export default router;
