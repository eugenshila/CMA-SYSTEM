/**
 * Prepare the Next.js standalone output for packaging.
 *
 * `next build` with output:'standalone' emits a self-contained server into
 * `.next/standalone`, but the static assets and the `public` directory must be
 * copied alongside it manually (Next only traces server dependencies).
 *
 *   node scripts/prepare-standalone.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(root, '.next', 'standalone');

function ensureIn(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
  console.log('[standalone] copied ' + src + ' -> ' + dest);
}

if (!fs.existsSync(standalone)) {
  console.error('[standalone] .next/standalone not found — run `npm run build` first');
  process.exit(1);
}

ensureIn(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'));
ensureIn(path.join(root, 'public'), path.join(standalone, 'public'));
console.log('[standalone] ready for packaging');
