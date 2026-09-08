/**
 * Dependency-free SQL migration runner for the desktop build.
 *
 * Mirrors scripts/migrate.ts (which requires `tsx`, unavailable in the packaged
 * app) in plain CommonJS against the `pg` driver. Applied migrations are tracked
 * in the `schema_migrations` table, so restarts are cheap and idempotent.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'db', 'migrations');

async function runMigrations(databaseUrl, logger = console) {
  const client = new pg.Client({
    connectionString: databaseUrl,
    statement_timeout: 180000,
  });
  await client.connect();
  logger.log('[migrate] connected');

  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id BIGSERIAL PRIMARY KEY,
    filename VARCHAR(200) NOT NULL UNIQUE,
    checksum VARCHAR(64),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const applied = new Set(
    (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    logger.log(`[migrate] applying ${file} …`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1,$2)', [
        file,
        String(sql.length),
      ]);
      await client.query('COMMIT');
      count += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`[migrate] FAILED: ${file} — ${err.message}`);
      throw err;
    }
  }

  logger.log(`[migrate] done — ${count} applied, ${applied.size} already present`);
  await client.end();
}

module.exports = { runMigrations, MIGRATIONS_DIR };
