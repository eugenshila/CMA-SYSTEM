/**
 * Desktop startup smoke test.
 *
 * Boots the complete packaged-app stack — the embedded PostgreSQL (PGlite)
 * wire server, schema migrations, first-run admin provisioning and the built
 * Next.js standalone server — exactly the way `electron/main.cjs` does in
 * production, then verifies the app actually serves the login screen.
 *
 *   Part 0  static guards: production build present, asar-unpack packaging
 *           contract intact, asar→unpacked path translation correct,
 *           desktop.log logger writes what the failure dialog points at.
 *   Part 1  full stack boot from the source tree (plain `node` child).
 *   Part 2  full stack boot from a SIMULATED INSTALLED APP: app.asar archive
 *           on disk + real files only under app.asar.unpacked — reproducing
 *           the packaged layout that broke the v1.0.1 installers (a child
 *           Node process cannot read inside app.asar) and proving the server
 *           is spawned from the unpacked path.
 *
 * Usage:
 *
 *   npm ci && npm run build && npm run desktop:smoke
 *
 * Prints PASS on success; any failure exits non-zero with the cause.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { startDesktop, stopDesktop, asarUnpackedPath } = require(
  path.join(root, 'desktop', 'bootstrap.cjs'),
);
const { createDesktopLogger } = require(path.join(root, 'desktop', 'log.cjs'));

const failures = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`[smoke] ✓ ${name}`);
  } else {
    console.error(`[smoke] ✗ ${name}${detail ? ' — ' + detail : ''}`);
    failures.push(name);
  }
}

function get(url, { maxRedirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const location = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && location && maxRedirects > 0) {
          get(new URL(location, url).toString(), { maxRedirects: maxRedirects - 1 })
            .then(resolve)
            .catch(reject);
          return;
        }
        resolve({ status: res.statusCode, location, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('timeout')));
  });
}

/** Boot the full desktop stack against `dataDir` and verify the login screen. */
async function bootAndVerify({ dataDir, standaloneDir }) {
  const lines = [];
  const logger = {
    log: (m) => {
      console.log(m);
      lines.push(String(m));
    },
    error: (m) => {
      console.error(m);
      lines.push(String(m));
    },
  };

  const handle = await startDesktop({ dataDir, standaloneDir, logger });
  try {
    const rootRes = await get(handle.url).catch((e) => {
      throw new Error(`GET / failed: ${e.message}`);
    });
    if (rootRes.status !== 200) {
      throw new Error(`GET / ended on HTTP ${rootRes.status} (expected 200 after redirects)`);
    }

    const loginRes = await get(`${handle.url}/login`).catch((e) => {
      throw new Error(`GET /login failed: ${e.message}`);
    });
    if (loginRes.status !== 200) {
      throw new Error(`GET /login returned HTTP ${loginRes.status}`);
    }
    if (!/method="post"|sign in|password/i.test(loginRes.body)) {
      throw new Error('GET /login rendered but no sign-in form was found in the HTML');
    }

    const credPath = path.join(dataDir, 'first-run-credentials.txt');
    if (!fs.existsSync(credPath)) {
      throw new Error(`first-run admin credentials missing: ${credPath}`);
    }

    const pg = require('pg');
    const client = new pg.Client({ connectionString: handle.databaseUrl });
    await client.connect();
    const { rows } = await client.query(
      'SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM schema_migrations)::int AS migrations',
    );
    await client.end();
    if (rows[0].users < 1 || rows[0].migrations < 1) {
      throw new Error(`database unexpectedly empty: ${JSON.stringify(rows[0])}`);
    }
    return { handle, lines };
  } finally {
    await stopDesktop(handle);
  }
}

async function part0StaticGuards() {
  console.log('[smoke] part 0: static packaging guards');

  const standaloneDir = path.join(root, '.next', 'standalone');
  check(
    'production build present (.next/standalone/server.js)',
    fs.existsSync(path.join(standaloneDir, 'server.js')),
    'run `npm run build` first',
  );

  // The packaging contract: electron-builder must unpack the standalone server
  // next to app.asar, or the spawned Node child cannot run it (v1.0.1 bug).
  const yml = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  const ymlLines = yml.split(/\r?\n/);
  const asarIdx = ymlLines.findIndex((l) => /^asarUnpack:/.test(l));
  const section = asarIdx === -1 ? [] : ymlLines.slice(asarIdx + 1, ymlLines.length);
  const collected = [];
  for (const line of section) {
    if (/^\s*-\s/.test(line)) collected.push(line);
    else if (line.trim() !== '') break;
  }
  check(
    'electron-builder.yml unpacks .next/standalone (asarUnpack)',
    collected.some((l) => l.includes('.next/standalone')),
    'add `.next/standalone/**` to asarUnpack in electron-builder.yml',
  );

  check(
    'asarUnpackedPath: POSIX in-archive path maps to app.asar.unpacked',
    asarUnpackedPath('/opt/app/resources/app.asar/.next/standalone/server.js') ===
      '/opt/app/resources/app.asar.unpacked/.next/standalone/server.js',
  );
  check(
    'asarUnpackedPath: Windows in-archive path maps to app.asar.unpacked',
    asarUnpackedPath('C:\\Users\\a\\AppData\\Local\\Programs\\cma\\resources\\app.asar\\.next\\standalone\\server.js') ===
      'C:\\Users\\a\\AppData\\Local\\Programs\\cma\\resources\\app.asar.unpacked\\.next\\standalone\\server.js',
  );
  check(
    'asarUnpackedPath: plain (unpacked/dev) path is returned unchanged',
    asarUnpackedPath('/home/user/CMA-SYSTEM/.next/standalone/server.js') ===
      '/home/user/CMA-SYSTEM/.next/standalone/server.js',
  );

  const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cma-smoke-log-')), 'desktop.log');
  const logger = createDesktopLogger({ logPath, echo: false });
  logger.log('[smoke] hello from the desktop logger');
  logger.error('[smoke] simulated failure line');
  const logged = fs.readFileSync(logPath, 'utf8');
  check(
    'desktop.log logger writes INFO and ERROR entries to disk',
    logged.includes('hello from the desktop logger') && logged.includes('simulated failure line'),
  );
}

async function part1BootFromSource() {
  console.log('[smoke] part 1: boot the desktop stack from the source tree');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cma-smoke-src-'));
  console.log(`[smoke] data dir: ${dataDir}`);
  const { handle } = await bootAndVerify({ dataDir });
  console.log(
    `[smoke] login screen renders, admin provisioned, database ready (users=1, url=${handle.url})`,
  );
}

async function part2BootFromSimulatedPackage() {
  console.log('[smoke] part 2: boot from a simulated installed app (app.asar + app.asar.unpacked)');

  const standaloneDir = path.join(root, '.next', 'standalone');
  const pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cma-smoke-pkg-'));

  // The archive: a single real file, exactly like the installed app — paths
  // inside it do not exist on the filesystem (for a plain Node child).
  fs.writeFileSync(path.join(pkgRoot, 'app.asar'), '');

  // The unpacked standalone tree: the only place server.js exists for real.
  fs.mkdirSync(path.join(pkgRoot, 'app.asar.unpacked', '.next'), { recursive: true });
  const unpackedStandalone = path.join(pkgRoot, 'app.asar.unpacked', '.next', 'standalone');
  try {
    fs.symlinkSync(standaloneDir, unpackedStandalone, 'dir');
  } catch {
    // No symlink permission (e.g. plain Windows without Developer Mode): a
    // full copy is equally valid for this test.
    fs.cpSync(standaloneDir, unpackedStandalone, { recursive: true });
  }

  const virtualStandalone = path.join(pkgRoot, 'app.asar', '.next', 'standalone');
  check(
    'simulated package: virtual in-archive path is NOT a real file',
    !fs.existsSync(path.join(virtualStandalone, 'server.js')),
    'the simulation is invalid — app.asar must be a file, not a directory',
  );

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cma-smoke-installed-'));
  console.log(`[smoke] package root: ${pkgRoot}`);
  console.log(`[smoke] data dir: ${dataDir}`);

  const { lines } = await bootAndVerify({ dataDir, standaloneDir: virtualStandalone });
  check(
    'simulated package: web server spawned from app.asar.unpacked',
    lines.some((l) => l.startsWith('[desktop] web server entry:') && l.includes('app.asar.unpacked')),
    'bootstrap must hand the spawned Node child the real unpacked path',
  );
}

async function main() {
  try {
    await part0StaticGuards();
    await part1BootFromSource();
    await part2BootFromSimulatedPackage();
  } catch (err) {
    console.error(`✗ ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log('PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
