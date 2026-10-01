/**
 * @module notifications
 * @description Outbound notification service.
 *
 * Sends SMS via Twilio. Email is a stub: sendEmail() only logs a warning until
 * a provider is wired in (see "To-do: email notifications" in the README).
 *
 * ## When SMS is sent
 * - A caller leaves a message for a person (`waitingForMessageFor` fulfilled)
 * - A caller's message is captured in their first utterance (`message_received` action)
 * - An emergency occurs with no on-call person and `emergency_notify_all=yes`
 *
 * ## `from` number
 * Always pass `inbound_number` from system_config as the `from` argument.
 * Using any other number will cause Twilio to reject the send (the number
 * must be a Twilio-provisioned number on this account).
 */

import twilio from 'twilio';
import { config } from '../config.js';
import { logger, STEP } from './logger.js';

/** Twilio REST client — used only for outbound API calls (SMS). */
const twilioClient = twilio(config.twilioAccountSid, config.twilioAuthToken);

/**
 * Send an SMS message via Twilio.
 *
 * Skips (with a logged warning) if `to` or `from` is missing, and logs rather
 * than throws on API errors, so a failed SMS never interrupts a call.
 *
 * @param {string} to      - Recipient phone number in E.164 format (e.g. '+14165551234')
 * @param {string} message - SMS body text
 * @param {string} from    - Sender number — must be the inbound_number from system_config
 * @returns {Promise<void>}
 */
export async function sendSMS(to, message, from) {
  if (!to || !from) {
    logger.warn(STEP.SMS_SKIP, null, `missing ${!to ? 'to' : 'from'} number — SMS not sent (to=${to}, from=${from})`);
    return;
  }
  try {
    await twilioClient.messages.create({ body: message, to, from });
    logger.info(STEP.SMS_SENT, null, `to=${to}`);
  } catch (error) {
    logger.error(STEP.SMS_ERROR, null, `to=${to} — ${error.message}`);
  }
}

/**
 * Send an email notification.
 *
 * NOT IMPLEMENTED: this stub only logs a warning. To enable email, replace the
 * body with a real provider (SMTP via Nodemailer, SendGrid, Amazon SES, ...),
 * read its credentials from config.js, and, like sendSMS, log failures rather
 * than throw so a failed email never interrupts a call.
 *
 * @param {string} to      - Recipient email address
 * @param {string} subject - Subject line
 * @param {string} body    - Plain-text body
 * @returns {Promise<void>}
 */
export async function sendEmail(to, subject, body) {
  logger.warn(STEP.EMAIL_SKIP, null, `email not configured — not sent to ${to} ("${subject}")`);
}
