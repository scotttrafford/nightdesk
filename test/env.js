// Test environment. Imported first by every test file, before any app module,
// so these values are in place when src/config.js reads process.env.
// (dotenv never overrides variables that are already set.)
import os from 'node:os';
import path from 'node:path';

process.env.ANTHROPIC_API_KEY ??= 'test-key';   // the SDK client needs a value; no requests are made
process.env.LOG_LEVEL = 'error';
process.env.LOG_FILE = path.join(os.tmpdir(), 'nightdesk-test.log');
