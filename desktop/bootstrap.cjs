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
 * @param {object} opts
 * @param {string} opts.dataDir       where PGlite data + config + credentials live
 * @param {boolean} [opts.seed]       currently unused (kept for future demo seed)
 * @param {Console|object} [opts.logger]
 * @param {(msg: string) => void} [opts.onStatus]
 * @param {(code: number|null, signal: string|null) => void} [opts.onWebExit]
 */
async function startDesktop({ dataDir, logger = console, onStatus, onWebExit } = {}) {
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

  const standaloneDir = path.resolve(__dirname, '..', '.next', 'standalone');
  const serverJs = path.join(standaloneDir, 'server.js');
  if (!fs.existsSync(serverJs)) {
    throw new Error(
      'Standalone server not found at ' + serverJs + ' — run `npm run build` before packaging.',
    );
  }

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
  // Under Electron this runs the bundled Node (ELECTRON_RUN_AS_NODE); under a
  // plain Node smoke test it is simply `node server.js`.
  const { spawn } = require('node:child_process');
  const web = spawn(process.execPath, [serverJs], {
    env: { ...webEnv, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  web.stdout.on('data', (c) => logger.log('[web] ' + String(c).trimEnd()));
  web.stderr.on('data', (c) => logger.error('[web] ' + String(c).trimEnd()));
  web.on('exit', (code, signal) => {
    logger.log(`[desktop] web server exited (code=${code}, signal=${signal})`);
    if (onWebExit) onWebExit(code, signal);
  });

  const url = `http://127.0.0.1:${webPort}`;
  await waitForHttp(url, 60_000);
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

module.exports = { startDesktop, stopDesktop };
