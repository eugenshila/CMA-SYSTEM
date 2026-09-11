/**
 * Desktop startup smoke test.
 *
 * Boots the complete packaged-app stack — the embedded PostgreSQL (PGlite)
 * wire server, schema migrations, first-run admin provisioning and the built
 * Next.js standalone server — exactly the way `electron/main.cjs` does in
 * production, then verifies the app actually serves the login screen.
 *
 *   Part 0  static guards: production build present, asar-unpack packaging
 *           contract intact (standalone server AND top-level node_modules),
 *           the standalone tree carries no stray repository files,
 *           asar→unpacked path translation correct, desktop.log logger writes
 *           what the failure dialog points at.
 *   Part 1  full stack boot from a fresh data directory (plain `node` child):
 *           the demo dataset is seeded and the login screen renders.
 *   Part 2  full stack boot from a SIMULATED INSTALLED APP: app.asar archive
 *           on disk + real files only under app.asar.unpacked — reproducing
 *           the packaged layout that broke the v1.0.1 installers. The
 *           simulation is deliberately faithful: the unpacked standalone tree
 *           has NO nested node_modules (electron-builder does not ship them),
 *           so `next` can only resolve from the unpacked top-level
 *           node_modules — exactly as in the real installer.
 *   Part 3  demo seed disabled: the first-run ADMIN fallback still provisions
 *           an empty installation and writes first-run-credentials.txt.
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

const { startDesktop, stopDesktop, asarUnpackedPath, summarizeStderr } = require(
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
async function bootAndVerify({ dataDir, standaloneDir, seed }) {
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

  const handle = await startDesktop({ dataDir, standaloneDir, seed, logger });
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
    const pg = require('pg');
    const client = new pg.Client({ connectionString: handle.databaseUrl });
    await client.connect();
    const { rows } = await client.query(
      `SELECT (SELECT count(*) FROM users)::int AS users,
              (SELECT count(*) FROM members)::int AS members,
              (SELECT count(*) FROM schema_migrations)::int AS migrations,
              (SELECT count(*) FROM users WHERE login_id = 'ADMIN001')::int AS demo_admins,
              (SELECT count(*) FROM users WHERE login_id = 'ADMIN')::int AS first_run_admins`,
    );
    await client.end();

    if (seed === false) {
      // First-run fallback: a random-password ADMIN is provisioned and the
      // credentials file is written; no demo data exists.
      if (!fs.existsSync(credPath)) {
        throw new Error(`first-run admin credentials missing: ${credPath}`);
      }
      if (rows[0].first_run_admins !== 1 || rows[0].members !== 0) {
        throw new Error(`first-run provisioning wrong: ${JSON.stringify(rows[0])}`);
      }
    } else {
      // Demo mode: the dataset is seeded, the demo admin exists and the
      // random-password first-run flow stays out of the way.
      if (fs.existsSync(credPath)) {
        throw new Error(`demo seeding ran, yet a first-run credentials file exists: ${credPath}`);
      }
      if (rows[0].demo_admins !== 1 || rows[0].members < 60 || rows[0].migrations < 1) {
        throw new Error(`demo dataset incomplete: ${JSON.stringify(rows[0])}`);
      }
    }
    return { handle, lines };
  } finally {
    await stopDesktop(handle);
  }
}

/** Read the `asarUnpack:` entries from electron-builder.yml as plain patterns. */
function asarUnpackEntries() {
  const lines = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^asarUnpack:/.test(l));
  if (start === -1) return [];
  const entries = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (item) entries.push(item[1]);
    else if (line.trim() !== '') break;
  }
  return entries;
}

/**
 * Production dependency tree, resolved the way Node resolves it.
 *
 * electron-builder copies package.json `dependencies` (and their transitive
 * closure) into the app's top-level `node_modules`. Dev dependencies are
 * deliberately excluded — `npm ci --omit=dev` never installs them, so a
 * simulated package that included them would pass while a real installer
 * failed with MODULE_NOT_FOUND.
 */
function productionDependencies() {
  const requireFromRoot = createRequire(path.join(root, 'package.json'));
  const moduleDir = (name) => {
    try {
      return path.dirname(requireFromRoot.resolve(`${name}/package.json`));
    } catch {
      const fallback = path.join(root, 'node_modules', name);
      return fs.existsSync(path.join(fallback, 'package.json')) ? fallback : null;
    }
  };

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const queue = Object.keys(manifest.dependencies || {});
  const visited = new Set();
  const found = new Map();
  while (queue.length > 0) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    visited.add(name);
    const dir = moduleDir(name);
    if (!dir) continue;
    found.set(name, dir);
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(pkg[field] || {})) queue.push(dep);
    }
  }
  return found;
}

/** Symlink (or, without permission, copy) one package into a node_modules dir. */
function linkPackageInto(destNodeModules, name, realDir) {
  const target = path.join(destNodeModules, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.symlinkSync(realDir, target, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    fs.cpSync(realDir, target, { recursive: true });
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

  check(
    'demo seeder shipped with the desktop bundle (desktop/demo-seed.cjs)',
    fs.existsSync(path.join(root, 'desktop', 'demo-seed.cjs')),
    'electron-builder files already include desktop/** — keep the seeder there',
  );
  check(
    'bootstrap wires the demo seed into startup',
    fs.readFileSync(path.join(root, 'desktop', 'bootstrap.cjs'), 'utf8').includes('seedDemoData'),
    'startDesktop must call seedDemoData on first launch',
  );

  // The packaging contract: everything the spawned Node child reads must be
  // unpacked next to app.asar, or the installed app never starts (v1.0.1 bug).
  const entries = asarUnpackEntries();
  check(
    'electron-builder.yml unpacks .next/standalone (asarUnpack)',
    entries.some((e) => e.includes('.next/standalone')),
    'add `.next/standalone/**` to asarUnpack in electron-builder.yml',
  );
  // The standalone server's own node_modules is NOT shipped: app-builder-lib's
  // AppFileWalker skips every `*/node_modules` unless `includeSubNodeModules`
  // is enabled. The child therefore resolves `next` (and the
  // serverExternalPackages pg/pdfkit/exceljs/bcryptjs/qrcode) only from the
  // unpacked TOP-LEVEL node_modules, so that whole tree must be unpacked too.
  check(
    'electron-builder.yml unpacks the top-level node_modules (asarUnpack)',
    entries.some((e) => /^(node_modules\/\*\*|node_modules\/\*|\*\*)$/.test(e)),
    'add `node_modules/**` to asarUnpack in electron-builder.yml — a narrower ' +
      'entry (e.g. node_modules/@electric-sql/**) leaves `next` inside app.asar ' +
      "and the installed app dies with \"Cannot find module 'next'\"",
  );

  // Tracing guard: `path.resolve(process.cwd(), …)` in server code makes
  // Next's file tracer copy the whole working directory into
  // .next/standalone, which inflates every installer with the repository
  // (.git, the local PGlite database, sources). See src/lib/files.ts.
  const stray = ['.git', '.pgdata-test', 'src'].filter((d) =>
    fs.existsSync(path.join(standaloneDir, d)),
  );
  check(
    'standalone output contains no stray repository files',
    stray.length === 0,
    'the file tracer pulled the repository into .next/standalone: ' +
      stray.join(', ') + ' — avoid process.cwd() in traced server code',
  );

  // The startup-failure report must keep the CAUSE. Node prints the error line
  // first and a long require stack after it, so the old tail-only excerpt
  // showed the v1.0.1 dialog a stack trace with no "Cannot find module" line.
  const crash = [
    'node:internal/modules/cjs/loader:1235',
    '      throw err;',
    '      ^',
    '',
    "Error: Cannot find module 'next'",
    'Require stack:',
    '- C:\\Program Files\\CMA System\\resources\\app.asar.unpacked\\.next\\standalone\\server.js',
    ...Array.from(
      { length: 60 },
      (_, i) => `        at fakeFrame${i} (node:internal/modules/cjs/loader:1:1)`,
    ),
  ].join('\n');
  check(
    'startup failure report keeps the error line, not just the stack tail',
    summarizeStderr(crash).includes("Cannot find module 'next'"),
    'desktop/bootstrap.cjs must keep the head of the web server stderr too',
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
  console.log('[smoke] part 1: boot the desktop stack from the source tree (demo seed enabled)');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cma-smoke-src-'));
  console.log(`[smoke] data dir: ${dataDir}`);
  const { handle } = await bootAndVerify({ dataDir });
  console.log(
    `[smoke] login screen renders, demo dataset seeded, database ready (url=${handle.url})`,
  );
}

async function part3FirstRunFallback() {
  console.log('[smoke] part 3: demo seed disabled — first-run ADMIN fallback');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cma-smoke-firstrun-'));
  console.log(`[smoke] data dir: ${dataDir}`);
  const { handle } = await bootAndVerify({ dataDir, seed: false });
  console.log(
    `[smoke] login screen renders, first-run administrator provisioned (url=${handle.url})`,
  );
}

async function part2BootFromSimulatedPackage() {
  console.log('[smoke] part 2: boot from a simulated installed app (app.asar + app.asar.unpacked)');

  const standaloneDir = path.join(root, '.next', 'standalone');
  const pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cma-smoke-pkg-'));

  // The archive: a single real file, exactly like the installed app — paths
  // inside it do not exist on the filesystem (for a plain Node child).
  fs.writeFileSync(path.join(pkgRoot, 'app.asar'), '');

  const unpackedRoot = path.join(pkgRoot, 'app.asar.unpacked');
  const unpackedStandalone = path.join(unpackedRoot, '.next', 'standalone');
  fs.mkdirSync(path.join(unpackedRoot, '.next'), { recursive: true });

  // The unpacked standalone tree — WITHOUT its nested node_modules, which is
  // how every real installer looks: app-builder-lib's AppFileWalker skips all
  // `*/node_modules` directories (includeSubNodeModules defaults to false), so
  // the traced `.next/standalone/node_modules` never ships. Copying it in here
  // anyway is what made this test pass while the installed app died with
  // `Cannot find module 'next'`.
  fs.cpSync(standaloneDir, unpackedStandalone, {
    recursive: true,
    filter: (src) => src !== path.join(standaloneDir, 'node_modules'),
  });
  check(
    'simulated package: unpacked standalone has no nested node_modules',
    !fs.existsSync(path.join(unpackedStandalone, 'node_modules')),
    'the simulation must mirror a real installer or it cannot catch a missing unpack',
  );
  check(
    'simulated package: server.js exists only under app.asar.unpacked',
    fs.existsSync(path.join(unpackedStandalone, 'server.js')),
  );

  // The unpacked production node_modules — what `asarUnpack: node_modules/**`
  // produces. `next` and the serverExternalPackages must resolve from here.
  const unpackedNodeModules = path.join(unpackedRoot, 'node_modules');
  const deps = productionDependencies();
  for (const [name, dir] of deps) linkPackageInto(unpackedNodeModules, name, dir);
  console.log(`[smoke] simulated production node_modules: ${deps.size} packages`);
  check(
    'simulated package: `next` resolves only from the unpacked top-level node_modules',
    fs.existsSync(path.join(unpackedNodeModules, 'next', 'package.json')),
    'electron-builder.yml must unpack node_modules/** (asarUnpack)',
  );

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
    await part3FirstRunFallback();
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
