/**
 * Render the bundled CMA crest (public/brand/logo-mark.svg) into the app icon
 * used by electron-builder. A single 1024px PNG is enough — electron-builder
 * derives the platform .ico / .icns from it.
 *
 *   node scripts/make-icons.mjs   ->  build/icon.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'build');
const source = path.join(root, 'public', 'brand', 'logo-mark.svg');

async function main() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.log('[icons] sharp not installed — skipping icon generation');
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const svg = fs.readFileSync(source);
  const iconPath = path.join(outDir, 'icon.png');
  await sharp(svg, { density: 300 }).resize(1024, 1024).png().toFile(iconPath);
  console.log('[icons] wrote ' + iconPath);
}

main().catch((err) => {
  console.error('[icons] failed:', err);
  process.exit(1);
});
