/**
 * @module server
 * @description Express application entry point.
 *
 * Responsibilities:
 * - Validate required environment variables at startup (fail fast)
 * - Configure Express middleware (body parsing, proxy trust)
 * - Mount all Twilio webhook routes under /call
 * - Expose a /health endpoint for uptime monitoring
 * - Resolve and log the public webhook URL via the tunnel service
 *
 * ## Proxy trust
 * `app.set('trust proxy', 1)` is required so that Express reads the
 * X-Forwarded-Proto header set by ngrok/Apache and reports req.protocol
 * as 'https'. Without this, Twilio webhook signature validation fails
 * because the computed URL would use 'http' instead of 'https'.
 *
 * ## Startup sequence
 * 1. Env var check → exit(1) if any required var is missing
 * 2. Express app configured
 * 3. Server starts listening on config.port
 * 4. startTunnel() resolves the public URL (ngrok or BASE_URL)
 * 5. Webhook URL is logged to console for easy copy/paste into Twilio console
 */

import express from 'express';
import { config } from './config.js';
import callRoutes from './routes/calls.js';
import { startTunnel } from './services/tunnel.js';
import { logger, STEP } from './services/logger.js';

/** Environment variables required for the application to function. */
const required = ['ANTHROPIC_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
                  'DB_USER', 'DB_NAME', 'DB_HOST', 'DB_PASSWORD'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');

// Trust the first proxy hop (ngrok / Apache reverse proxy) so that
// req.protocol is 'https' — required for Twilio webhook signature validation.
app.set('trust proxy', 1);

// Twilio sends webhook payloads as application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));

// All Twilio webhook handlers: /call/incoming, /call/gather, /call/clarify-urgency, /call/status
app.use('/call', callRoutes);

/**
 * GET /health
 * Simple liveness check. Returns 200 + JSON when the process is running.
 * Used by monitoring tools and systemd health checks.
 */
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(config.port, async () => {
  logger.info(STEP.SERVER_START, null, `listening on port ${config.port} | tunnel=${config.tunnelMode} | sig-validation=${config.validateTwilioSignature} | log-level=${config.logLevel}`);

  try {
    const publicUrl = await startTunnel();
    logger.info(STEP.SERVER_TUNNEL, null, `webhook URL: ${publicUrl}/call/incoming`);
  } catch (err) {
    logger.error(STEP.SERVER_TUNNEL, null, `tunnel startup failed: ${err.message}`);
  }
});
