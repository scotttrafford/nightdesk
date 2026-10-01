/**
 * @module config
 * @description Central application configuration, read from environment variables.
 *
 * No other module should read `process.env` directly. Copy `.env.example` to
 * `.env` and fill in values before running; required variables are checked
 * at startup in server.js.
 *
 * Call-flow settings (greetings, prompts, timeouts, phone numbers) live in the
 * `system_config` database table instead, so they can be changed without a restart.
 */

import 'dotenv/config';

export const config = {
  /** TCP port for the HTTP server. */
  port: process.env.PORT || 3000,

  /** API key for the AI provider (see services/ai-provider.js). */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  /** Model ID used for all routing decisions. */
  model: process.env.AI_MODEL || 'claude-sonnet-4-5-20250929',

  /**
   * Maximum time to wait for the AI before giving up. Twilio webhooks time out
   * at 15s, so keep this well below that.
   */
  aiTimeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '8000', 10),

  /**
   * Mark the system prompt as cacheable. Worthwhile at higher call volumes
   * (roughly 10+ calls/hour) since the prompt is large and rarely changes.
   */
  useCaching: process.env.AI_USE_CACHING === 'true',

  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,

  /**
   * Verify the X-Twilio-Signature header on every webhook. Requires a stable
   * public URL — disable when using an ngrok URL that changes on restart.
   */
  validateTwilioSignature: process.env.VALIDATE_TWILIO_SIGNATURE === 'true',

  /**
   * How the public webhook URL is resolved at startup (see services/tunnel.js):
   * - 'direct' : use BASE_URL
   * - 'ngrok'  : query the local ngrok agent, falling back to NGROK_URL
   */
  tunnelMode: (process.env.TUNNEL_MODE || 'direct').toLowerCase(),
  baseUrl: process.env.BASE_URL,
  ngrokUrl: process.env.NGROK_URL,

  /** Amazon Polly voice for all <Say> output. */
  ttsVoice: process.env.TTS_VOICE || 'Polly.Joanna',

  /** error | warn | info | debug — see services/logger.js. */
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  logFile: process.env.LOG_FILE || './logs/app.log',

  database: {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
  },
};
