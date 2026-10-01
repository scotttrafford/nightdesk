/**
 * @module db
 * @description Shared PostgreSQL connection pool.
 *
 * Exports a single `pool` instance used by all services that need database
 * access (`routing.js`, etc.). Using one shared pool across the process
 * avoids connection exhaustion and allows pg to efficiently reuse connections.
 *
 * Connection parameters come from `config.database`, which reads:
 *   DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT
 *
 * For production deployments, consider setting pool size limits via the
 * `max` option on the Pool constructor (default is 10).
 */

import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

/** Shared connection pool — import this wherever a DB query is needed. */
export const pool = new Pool(config.database);
