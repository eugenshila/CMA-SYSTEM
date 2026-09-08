/**
 * One-command local development:
 *   1. starts the PGlite-backed local PostgreSQL server (scripts/local-db.mjs),
 *   2. runs migrations (plus the demo seed on first boot),
 *   3. starts the Next.js dev server.
 *
 * Usage:  npm run dev:all
 * Env:    SEED_DEMO_DATA=false   skip the demo seed on first boot
 *         PGLITE_DATA_DIR=<dir>  override the local data directory (.pgdata)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const children = new Set();
let shuttingDown = false;

// The app reads PGPOOL_MAX when building its connection pool — the bundled
// PGlite server is single-threaded WASM, so one connection avoids the
// client-side ECONNRESET bursts a wider pool would cause.
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5433/postgres';
process.env.PGPORT_LOCAL ||= '5433';
process.env.PGPOOL_MAX ||= '1';
process.env.PGHOST_LOCAL ||= '0.0.0.0';

function track(child) {
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

/** Run a command to completion, inheriting stdio. Rejects on non-zero exit. */
function execOnce(cmd, args, label) {
  return new Promise((resolve, reject) => {
    const child = track(spawn(cmd, args, { stdio: 'inherit', env: process.env, shell: isWin }));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`[dev-all] ${label} failed with exit code ${code}`)),
    );
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  // Give children a moment to flush (PGlite checkpoint) before exiting.
  setTimeout(() => process.exit(code), 400).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  const dataDir = path.resolve(process.env.PGLITE_DATA_DIR || '.pgdata');
  const firstBoot = !fs.existsSync(dataDir);

  console.log('[dev-all] starting local PostgreSQL (PGlite)…');
  const db = track(
    spawn(process.execPath, [path.join('scripts', 'local-db.mjs')], { env: process.env }),
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('[dev-all] timed out waiting for the local database to listen')),
      60_000,
    );
    db.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      if (/listening on/.test(String(chunk))) {
        clearTimeout(timer);
        resolve();
      }
    });
    db.stderr.on('data', (chunk) => process.stderr.write(chunk));
    db.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    db.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`[dev-all] local database exited before it was ready (code ${code})`));
    });
  });

  console.log(firstBoot ? '[dev-all] first boot — creating schema…' : '[dev-all] bringing schema up to date…');
  await execOnce(npm, ['run', 'db:migrate'], 'migration');

  if (firstBoot && (process.env.SEED_DEMO_DATA || 'true') !== 'false') {
    console.log('[dev-all] seeding reference + demo data (set SEED_DEMO_DATA=false to skip)…');
    await execOnce(npm, ['run', 'db:seed'], 'seed');
  }

  console.log('[dev-all] starting Next.js dev server…');
  const web = track(spawn(npm, ['run', 'dev'], { stdio: 'inherit', env: process.env, shell: isWin }));
  web.on('exit', (code) => shutdown(code ?? 0));
}

main().catch((err) => {
  console.error(err?.message || err);
  shutdown(1);
});
