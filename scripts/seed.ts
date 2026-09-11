/**
 * Realistic demonstration data for a parish CMA.
 *
 *   npm run db:seed            seed demo data (skipped when the DB is not empty)
 *   npm run db:seed -- --force wipe the demo tables and re-seed
 *
 * This is a thin wrapper around desktop/demo-seed.cjs, the single source of
 * truth for the demo dataset (also used by the packaged desktop app).
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { env } from '../src/lib/env';

const require = createRequire(import.meta.url);
const { seedDemoData } = require('../desktop/demo-seed.cjs');

seedDemoData({
  databaseUrl: process.env.DATABASE_URL || env.DATABASE_URL,
  force: process.argv.includes('--force'),
  uploadRoot: path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'storage/uploads'),
  encryptionKey: process.env.ENCRYPTION_KEY || env.ENCRYPTION_KEY,
  referenceSqlPath: path.resolve(process.cwd(), 'db', 'migrations', '002_reference_data.sql'),
  logger: console,
}).catch((e: any) => {
  console.error('[seed] FAILED:', e.message);
  if (e.position) console.error('[seed] near SQL position', e.position);
  process.exit(1);
});
