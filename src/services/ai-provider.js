/**
 * @module ai-provider
 * @description AI provider adapter — the only module that talks to an LLM API.
 *
 * The current implementation uses the Anthropic Messages API. To use a different
 * provider (OpenAI, a local model, etc.), replace this file with one that exports
 * `getAIResponse(messages, systemPrompt)` with the same contract. Nothing else
 * needs to change.
 *
 * ## Contract
 * - `messages`     — conversation history: `[{ role: 'user'|'assistant', content: string }]`
 * - `systemPrompt` — a string, or an array of content blocks when prompt caching is enabled
 * - returns        — the raw assistant text (callers in ai-service.js parse the JSON)
 *
 * ## Timeout
 * Twilio abandons a webhook after 15 seconds, so each request is raced against
 * `config.aiTimeoutMs` (default 8s). On timeout the promise rejects and the
 * route handler plays its technical-error message.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger, STEP } from './logger.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

/**
 * Send a conversation to the model and return the assistant's text reply.
 *
 * @param {Array<{role: 'user'|'assistant', content: string}>} messages
 * @param {string|Array} [systemPrompt='']
 * @returns {Promise<string>} Raw response text
 * @throws {Error} If the request fails or exceeds config.aiTimeoutMs
 */
export async function getAIResponse(messages, systemPrompt = '') {
  // The API rejects empty content strings
  const filteredMessages = messages.filter(msg =>
    typeof msg.content === 'string' && msg.content.trim().length > 0
  );

  if (filteredMessages.length === 0) {
    return "I didn't hear anything. Could you please say that again?";
  }

  const request = async () => {
    logger.debug(STEP.AI_REQUEST, null, `model=${config.model} messages=${filteredMessages.length} promptLen=${JSON.stringify(systemPrompt).length}`);
    // Streaming avoids HTTP idle timeouts on slower responses
    const stream = client.messages.stream({
      model: config.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: filteredMessages,
    });
    const response = await stream.finalMessage();
    const textBlock = response.content.find((b) => b.type === 'text');
    logger.debug(STEP.AI_RESPONSE, null, `inputTokens=${response.usage?.input_tokens} outputTokens=${response.usage?.output_tokens}`);
    return textBlock?.text ?? "I'm sorry, I didn't catch that. Could you repeat?";
  };

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      logger.warn(STEP.AI_TIMEOUT, null, `no response within ${config.aiTimeoutMs}ms`);
      reject(new Error('AI response timeout'));
    }, config.aiTimeoutMs);
  });

  try {
    return await Promise.race([request(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
