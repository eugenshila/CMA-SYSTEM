/**
 * Minimal, dependency-free SQL migration runner.
 *
 *   npm run db:migrate          -> applies every db/migrations/*.sql not yet applied
 *   npm run db:migrate -- fresh -> drops the public schema first (dev only)
 *
 * Applied migrations are tracked in the `schema_migrations` table.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5433/postgres';

const fresh = process.argv.includes('fresh');
const migrationsDir = path.resolve(process.cwd(), 'db/migrations');

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL, statement_timeout: 120000 });
  await client.connect();
  console.log('[migrate] connected to', DATABASE_URL.replace(/:[^:@/]*@/, ':****@'));

  if (fresh) {
    console.log('[migrate] DROPPING schema public (fresh install)…');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  }

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
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const started = Date.now();
    process.stdout.write(`[migrate] ${file} … `);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1,$2)',
        [file, String(sql.length)],
      );
      await client.query('COMMIT');
      console.log(`ok (${Date.now() - started}ms)`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('\n[migrate] FAILED', file);
      console.error(err.message);
      if (err.position) {
        const lines = sql.slice(0, Number(err.position)).split('\n');
        console.error(`  near line ${lines.length}: ${lines[lines.length - 1]}`);
      }
      process.exitCode = 1;
      break;
    }
  }

  console.log(`[migrate] done — ${count} migration(s) applied, ${applied.size} already present.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
