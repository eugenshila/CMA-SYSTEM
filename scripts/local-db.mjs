/**
 * Local development PostgreSQL server powered by PGlite (real PostgreSQL 18 engine
 * compiled to WebAssembly) exposing the standard Postgres wire protocol.
 *
 * The application itself always talks to PostgreSQL through the standard `pg`
 * driver and `DATABASE_URL`, so production (Railway PostgreSQL) and local
 * development share exactly the same code path.
 *
 * Usage:  node scripts/local-db.mjs   (defaults: 0.0.0.0:5432, data in .pgdata)
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import path from 'node:path';
import fs from 'node:fs';

const host = process.env.PGHOST_LOCAL || '0.0.0.0';
const port = parseInt(process.env.PGPORT_LOCAL || '5432', 10);
const maxConnections = parseInt(process.env.PG_MAX_CONNECTIONS || '10', 10);
const dataDir = process.env.PGLITE_DATA_DIR
  ? path.resolve(process.env.PGLITE_DATA_DIR)
  : path.resolve(process.cwd(), '.pgdata');

if (process.env.PGLITE_MEMORY === '1') {
  console.log('[local-db] using in-memory database (data will not persist)');
} else {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new PGlite(process.env.PGLITE_MEMORY === '1' ? 'memory://' : dataDir, {
  relaxedDurability: true,
});

await db.waitReady;

const version = await db.query('select version() as v');
console.log('[local-db]', version.rows[0].v.split(',')[0]);

const server = new PGLiteSocketServer({ db, host, port, maxConnections });

await server.start();
console.log(`[local-db] PostgreSQL wire protocol listening on ${host}:${port}`);
console.log(`[local-db] DATABASE_URL=postgresql://postgres:postgres@${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/postgres`);

const shutdown = async (code = 0) => {
  console.log('\n[local-db] shutting down…');
  try {
    await server.stop();
    await db.close();
  } catch (e) {
    console.error(e);
  }
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
