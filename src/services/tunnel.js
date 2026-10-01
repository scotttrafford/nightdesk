/**
 * @module tunnel
 * @description Resolves the public base URL Twilio uses to reach this server.
 *
 * - direct mode: BASE_URL (behind your own reverse proxy / DNS)
 * - ngrok mode:  the HTTPS URL reported by a locally running ngrok agent,
 *                falling back to NGROK_URL if the agent API is unreachable
 *
 * The URL is only logged at startup; Twilio's webhook settings are updated
 * separately (manually, or with switch-mode.js).
 */

import { config } from '../config.js';
import { logger, STEP } from './logger.js';

/**
 * Resolve the public base URL for the configured TUNNEL_MODE.
 * Exits the process if no URL can be determined.
 *
 * @returns {Promise<string>} Public base URL (no trailing slash)
 */
export async function startTunnel() {
  const mode = config.tunnelMode;

  if (mode === 'ngrok') {
    return await resolveNgrokUrl();
  }

  // direct mode
  const url = config.baseUrl;
  if (!url) {
    logger.error(STEP.TUNNEL_DIRECT, null, 'TUNNEL_MODE=direct requires BASE_URL to be set in .env');
    process.exit(1);
  }
  logger.info(STEP.TUNNEL_DIRECT, null, `BASE_URL: ${url}`);
  return url;
}

/**
 * Query the local ngrok agent API to get the active HTTPS tunnel URL.
 * Requires ngrok to already be running (e.g. via systemd ngrok-tunnel service).
 * Falls back to NGROK_URL env var if the agent API is unreachable.
 *
 * @returns {Promise<string>} Public ngrok HTTPS URL
 */
async function resolveNgrokUrl() {
  try {
    const response = await fetch('http://127.0.0.1:4040/api/tunnels');
    if (!response.ok) throw new Error(`ngrok API returned ${response.status}`);
    const data = await response.json();
    const tunnel = data.tunnels?.find(t => t.proto === 'https');
    if (!tunnel?.public_url) throw new Error('No HTTPS tunnel found in ngrok API response');
    const url = tunnel.public_url.replace(/\/$/, '');
    logger.info(STEP.TUNNEL_NGROK, null, `discovered URL: ${url}`);
    return url;
  } catch (err) {
    // Fall back to NGROK_URL env var if agent API is unavailable
    const fallback = config.ngrokUrl;
    if (fallback) {
      logger.warn(STEP.TUNNEL_FALLBACK, null, `ngrok API unavailable (${err.message}) — using NGROK_URL: ${fallback}`);
      return fallback.replace(/\/$/, '');
    }
    logger.error(STEP.TUNNEL_NGROK, null, `ngrok API unavailable and NGROK_URL not set: ${err.message}`);
    process.exit(1);
  }
}
