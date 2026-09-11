/**
 * Desktop runtime bootstrap.
 *
 * Node-only (no Electron imports) so it can be smoke-tested outside Electron and
 * reused by the Electron main process. It stands up the complete desktop stack:
 *
 *   1. an embedded PostgreSQL database (PGlite) with the standard wire protocol,
 *   2. the schema migrations (db/migrations/*.sql),
 *   3. a first-run Super Administrator account,
 *   4. the Next.js production server (`.next/standalone/server.js`).
 *
 * Everything the app needs to talk to Postgres is the ordinary `DATABASE_URL`
 * connection string, so desktop and Railway production share one code path.
 *
 * Packaging note: in the installed app this file runs from inside app.asar
 * (fine — the Electron main process reads asar natively), but the Next.js
 * server it spawns must be unpacked (asarUnpack: .next/standalone/**) and is
 * launched via its real app.asar.unpacked path, because the spawned plain
 * Node.js process cannot read inside the archive.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const http = require('node:http');

const { runMigrations } = require('./migrate.cjs');
const { ensureFirstAdmin } = require('./first-run.cjs');

const CONFIG_FILE = 'config.json';

/**
 * Persistent per-installation secrets. AUTH_SECRET signs the session cookie and
 * ENCRYPTION_KEY derives the AES key for encrypted member identifiers, so both
 * MUST survive restarts (regenerating them would invalidate sessions and make
 * encrypted columns unreadable).
 */
function loadOrCreateConfig(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, CONFIG_FILE);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const config = {
    authSecret: crypto.randomBytes(48).toString('base64url'),
    encryptionKey: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return config;
}

/**
 * Map a path inside the packaged app's app.asar archive to the matching real
 * file in the sibling app.asar.unpacked directory (electron-builder's
 * `asarUnpack` option).
 *
 * Why this is needed: asar archives are a *virtual* filesystem that only
 * Electron's patched `fs` can read (main/renderer processes). The Next.js
 * server is spawned as a plain Node.js child process (`ELECTRON_RUN_AS_NODE`),
 * which has no asar support at all — `node .../app.asar/.next/standalone/server.js`
 * fails with MODULE_NOT_FOUND. The child must be handed the real on-disk path.
 * Windows path separators are handled too (this runs on every platform).
 */
function asarUnpackedPath(p) {
  const m = /([\\/])app\.asar([\\/])/.exec(p);
  if (!m) return p;
  const archiveStart = m.index + m[1].length; // index of "app.asar" itself
  return p.slice(0, archiveStart) + 'app.asar.unpacked' + p.slice(archiveStart + 'app.asar'.length);
}

/**
 * Resolve the standalone server entry point that can be handed to the spawned
 * Node.js child process.
 *
 * Three cases:
 *  1. the (possibly unpacked) real file exists          → spawn it,
 *  2. only the in-archive virtual path exists (Electron)→ the package was
 *     built without unpacking `.next/standalone` — fail with the fix,
 *  3. nothing exists                                    → run `npm run build`.
 *
 * @param {string} standaloneDir
 * @returns {{ serverJs: string, serverJsReal: string }}
 */
function resolveServerEntry(standaloneDir) {
  const serverJs = path.join(standaloneDir, 'server.js');
  const serverJsReal = asarUnpackedPath(serverJs);

  if (fs.existsSync(serverJsReal)) {
    return { serverJs, serverJsReal };
  }
  if (fs.existsSync(serverJs)) {
    throw new Error(
      'The standalone web server is packed inside app.asar, where the spawned ' +
        'Node.js server cannot read it. Add `.next/standalone/**` to `asarUnpack` ' +
        'in electron-builder.yml and rebuild the installers. (' +
        serverJs +
        ')',
    );
  }
  throw new Error(
    'Standalone server not found at ' + serverJs + ' — run `npm run build` before packaging.',
  );
}

/** Reserve a free TCP port on loopback (the window is tiny for a desktop app). */
function getFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Poll an HTTP endpoint until it answers with any status below 500. */
function waitForHttp(url, timeoutMs = 60_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode < 500) return resolve();
        retry(new Error(`HTTP ${res.statusCode}`));
      });
      req.on('error', retry);
      req.setTimeout(2_000, () => req.destroy(new Error('timeout')));
    };
    const retry = (err) => {
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`Timed out waiting for ${url}: ${err && err.message}`));
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

/**
 * Shorten the web server's stderr for the failure dialog / desktop.log summary.
 *
 * Node prints the actual error first (`Error: Cannot find module 'next'`) and a
 * long require stack after it, so keeping only the tail — as this used to —
 * showed the user a stack with no cause. Keep both ends instead; the complete
 * output is always in `desktop.log`.
 *
 * @param {string} text
 * @returns {string}
 */
function summarizeStderr(text, { maxLines = 40, headLines = 12, tailLines = 15 } = {}) {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text.trim();
  const omitted = lines.length - headLines - tailLines;
  return [
    ...lines.slice(0, headLines),
    `… ${omitted} more lines (full output in desktop.log) …`,
    ...lines.slice(-tailLines),
  ]
    .join('\n')
    .trim();
}

/**
 * @param {object} opts
 * @param {string} opts.dataDir            where PGlite data + config + credentials live
 * @param {string} [opts.standaloneDir]    override for the Next.js standalone build
 *                                         directory (defaults to <app>/.next/standalone);
 *                                         the smoke test uses this to simulate the packaged
 *                                         app.asar / app.asar.unpacked layout
 * @param {boolean} [opts.seed]            currently unused (kept for future demo seed)
 * @param {Console|object} [opts.logger]
 * @param {(msg: string) => void} [opts.onStatus]
 * @param {(code: number|null, signal: string|null) => void} [opts.onWebExit]
 */
async function startDesktop({ dataDir, standaloneDir, logger = console, onStatus, onWebExit } = {}) {
  const log = (msg) => {
    logger.log(msg);
    if (onStatus) onStatus(msg);
  };

  // Dynamically import the WASM-backed ESM packages (works in CJS + Electron).
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');

  const config = loadOrCreateConfig(dataDir);
  const dbDir = path.join(dataDir, 'pglite');
  fs.mkdirSync(dbDir, { recursive: true });

  log('[desktop] starting embedded PostgreSQL (PGlite)…');
  const db = new PGlite(dbDir, { relaxedDurability: true });
  await db.waitReady;

  const dbPort = await getFreePort();
  const socketServer = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port: dbPort,
    maxConnections: 10,
  });
  await socketServer.start();
  log('[desktop] PostgreSQL listening on 127.0.0.1:' + dbPort);

  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`;

  log('[desktop] applying schema migrations…');
  await runMigrations(databaseUrl, logger);

  const admin = await ensureFirstAdmin(databaseUrl, dataDir, logger);
  if (admin) log('[desktop] first-run administrator created — credentials written to ' + admin.credPath);

  const webPort = await getFreePort();

  const resolvedStandaloneDir = standaloneDir
    ? path.resolve(standaloneDir)
    : path.resolve(__dirname, '..', '.next', 'standalone');
  const { serverJsReal } = resolveServerEntry(resolvedStandaloneDir);

  const webEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(webPort),
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: config.authSecret,
    ENCRYPTION_KEY: config.encryptionKey,
    // The embedded PGlite server is single-threaded WASM — a single pooled
    // connection avoids the ECONNRESET bursts a wider pool would cause.
    PGPOOL_MAX: '1',
    APP_URL: `http://127.0.0.1:${webPort}`,
  };

  log('[desktop] starting web server on http://127.0.0.1:' + webPort + ' …');
  log('[desktop] web server entry: ' + serverJsReal);
  // Under Electron this runs the bundled Node (ELECTRON_RUN_AS_NODE); under a
  // plain Node smoke test it is simply `node server.js`. The entry point must
  // be a real file (app.asar.unpacked/…), never a path inside app.asar —
  // see asarUnpackedPath() above.
  const { spawn } = require('node:child_process');
  const web = spawn(process.execPath, [serverJsReal], {
    env: { ...webEnv, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // Keep both ends of the child's stderr so an early crash can be reported
  // with its actual cause. Node prints the error itself first
  // ("Error: Cannot find module 'next'") and a long require stack after it, so
  // a tail-only excerpt — what the failure dialog shows — used to hide the
  // very line the user needs.
  const stderrHead = [];
  const stderrTail = [];
  let stderrDroppedChunks = 0;
  web.stdout.on('data', (c) => logger.log('[web] ' + String(c).trimEnd()));
  web.stderr.on('data', (c) => {
    const s = String(c);
    logger.error('[web] ' + s.trimEnd());
    if (stderrHead.length < 5) stderrHead.push(s);
    stderrTail.push(s);
    if (stderrTail.length > 30) {
      stderrTail.shift();
      stderrDroppedChunks++;
    }
  });
  web.on('exit', (code, signal) => {
    logger.log(`[desktop] web server exited (code=${code}, signal=${signal})`);
    if (onWebExit) onWebExit(code, signal);
  });

  const url = `http://127.0.0.1:${webPort}`;
  // Fail fast when the spawned server dies during startup (with its output),
  // instead of waiting out the full HTTP timeout. When that happens the caller
  // never receives a handle, so nothing else can tear the embedded database
  // down — close it here, or PGlite and its wire server keep the process alive
  // (the desktop app idles with a stray database, the smoke test hangs instead
  // of reporting the failure).
  const earlyExit = new Promise((_, reject) => {
    web.once('exit', (code, signal) => {
      // Give buffered stdout/stderr a moment to land in stderrTail.
      setTimeout(() => {
        // Head + tail: the cause is the first line the child printed, the
        // require stack is the last thing it printed.
        const raw =
          stderrDroppedChunks > 0
            ? stderrHead.join('') +
              `\n… ${stderrDroppedChunks} more output chunks (full output in desktop.log) …\n` +
              stderrTail.join('')
            : stderrTail.join('');
        const details = summarizeStderr(raw);
        reject(
          new Error(
            `The web server exited before it became ready (code=${code}, signal=${signal}).` +
              (details ? '\n--- web server output ---\n' + details : ''),
          ),
        );
      }, 150);
    });
  });
  try {
    await Promise.race([waitForHttp(url, 60_000), earlyExit]);
  } catch (err) {
    await stopDesktop({ web, socketServer, db });
    throw err;
  }
  log('[desktop] web server ready at ' + url);

  return {
    url,
    port: webPort,
    databaseUrl,
    dataDir,
    config,
    admin,
    db,
    socketServer,
    web,
    serverPath: serverJsReal,
  };
}

async function stopDesktop(handle) {
  if (!handle) return;
  try {
    if (handle.web && !handle.web.killed) handle.web.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  try {
    await handle.socketServer.stop();
  } catch {
    /* ignore */
  }
  try {
    await handle.db.close();
  } catch {
    /* ignore */
  }
}

module.exports = {
  startDesktop,
  stopDesktop,
  asarUnpackedPath,
  resolveServerEntry,
  summarizeStderr,
};
