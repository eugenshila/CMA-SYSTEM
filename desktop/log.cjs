/**
 * Desktop log file.
 *
 * The packaged app runs as a GUI process — there is no console — so without a
 * file log a startup failure leaves nothing to diagnose. Every desktop layer
 * (bootstrap, migrations, first-run, the spawned web server) is routed through
 * this logger, and the startup failure dialog points the user at the file.
 *
 * Writes are synchronous on purpose: the log must be on disk before the error
 * dialog (and the subsequent process exit) can appear.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_LOG_BYTES = 2 * 1024 * 1024;

/**
 * @param {object} opts
 * @param {string} opts.logPath   e.g. <userData>/desktop.log
 * @param {boolean} [opts.echo]   also mirror to the real console (default true)
 * @returns {{ path: string, log: (msg: string) => void, error: (msg: string) => void }}
 */
function createDesktopLogger({ logPath, echo = true } = {}) {
  if (!logPath) throw new Error('createDesktopLogger: logPath is required');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  // Keep one previous generation so a support request can include the log of
  // the session before the failure.
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_LOG_BYTES) {
      const old = logPath + '.old';
      try {
        fs.rmSync(old, { force: true });
      } catch {
        /* ignore */
      }
      fs.renameSync(logPath, old);
    }
  } catch {
    /* best effort */
  }

  const write = (level, msg) => {
    const body = String(msg).replace(/\r?\n/g, '\n').replace(/\n/g, '\n    ');
    try {
      fs.appendFileSync(logPath, `${new Date().toISOString()} ${level} ${body}\n`);
    } catch {
      /* logging must never crash the app */
    }
    if (echo) (level === 'ERROR' ? console.error : console.log)(msg);
  };

  return {
    path: logPath,
    log(msg) {
      write('INFO ', msg);
    },
    error(msg) {
      write('ERROR', msg);
    },
  };
}

module.exports = { createDesktopLogger };
