/**
 * CMA System — Electron main process.
 *
 * Production mode boots the embedded database + migrations + the Next.js
 * standalone server, then shows the application in a native window. A frameless
 * splash window covers the (one-time, migration-heavy) startup.
 *
 * Development mode: set CMA_DEV_URL (e.g. http://localhost:3000) to point the
 * window at `npm run dev:all` instead of booting the embedded stack.
 *
 * All startup output is teed to <data dir>/desktop.log, and every failure
 * dialog names that file so its cause can be reported to support.
 */
'use strict';

const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createDesktopLogger } = require('../desktop/log.cjs');

const DEV_URL = process.env.CMA_DEV_URL || '';
const APP_USER_MODEL_ID = 'org.cma.system';

let splashWin = null;
let mainWin = null;
let handle = null;
let quitting = false;
let logger = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
  app.whenReady().then(run);
}

function dataDir() {
  if (process.env.CMA_DATA_DIR) return path.resolve(process.env.CMA_DATA_DIR);
  return app.getPath('userData');
}

function sendStatus(message) {
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.webContents.send('desktop:status', String(message));
  }
}

function createSplash() {
  splashWin = new BrowserWindow({
    width: 480,
    height: 340,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: '#0e2340',
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWin.loadFile(path.join(__dirname, 'splash.html'));
  splashWin.once('ready-to-show', () => splashWin.show());
  splashWin.on('closed', () => {
    splashWin = null;
  });
}

function createMainWindow(url) {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f6fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin.loadURL(url);
  mainWin.once('ready-to-show', () => {
    if (splashWin) splashWin.close();
    mainWin.show();
  });
  // External links open in the user's browser, never inside the app shell.
  mainWin.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWin.on('closed', () => {
    mainWin = null;
  });
}

/**
 * Error dialog that always points at the desktop.log file, so a user reporting
 * a problem can send us the cause (logged in full) even when the dialog itself
 * is truncated.
 */
function showErrorBoxWithLog(title, message) {
  const logPath = logger ? logger.path : path.join(dataDir(), 'desktop.log');
  dialog.showErrorBox(
    title,
    message + '\n\nA full diagnostic log was written to:\n' + logPath + '\n\nPlease send that file to support if the problem persists.',
  );
}

async function run() {
  app.setAppUserModelId(APP_USER_MODEL_ID);

  // Everything the desktop stack logs (bootstrap, migrations, first-run, the
  // spawned web server) is teed into <data dir>/desktop.log. The packaged app
  // has no console — without this file a startup failure is undiagnosable.
  logger = createDesktopLogger({ logPath: path.join(dataDir(), 'desktop.log') });
  logger.log(
    `[desktop] CMA System v${app.getVersion()} starting — Electron ${process.versions.electron}, Node ${process.versions.node}, ${process.platform} ${process.arch}`,
  );
  logger.log('[desktop] log file: ' + logger.path);

  createSplash();

  try {
    if (DEV_URL) {
      sendStatus('Connecting to development server…');
      createMainWindow(DEV_URL);
      return;
    }

    const { startDesktop } = require('../desktop/bootstrap.cjs');
    sendStatus('Preparing your database…');
    handle = await startDesktop({
      dataDir: dataDir(),
      logger,
      onStatus: sendStatus,
      onWebExit: (code, signal) => {
        // A server that dies *during* startup is reported by the catch below
        // (with the child's own output as the cause). This dialog is only for
        // a server that was running fine and then stopped.
        if (!quitting && handle && handle.ready) {
          logger.error(`[desktop] web server died while running (code=${code}, signal=${signal})`);
          showErrorBoxWithLog(
            'CMA System',
            'The application server stopped unexpectedly (code ' +
              code +
              ', signal ' +
              signal +
              '). Please restart the app.',
          );
          app.quit();
        }
      },
    });
    handle.ready = true;
    logger.log('[desktop] startup complete — opening application window at ' + handle.url);
    createMainWindow(handle.url);
  } catch (err) {
    const cause = String((err && err.stack) || err);
    if (logger) logger.error('[desktop] startup failed\n' + cause);
    sendStatus('Startup failed — see the error dialog.');
    showErrorBoxWithLog('CMA System failed to start', cause);
    app.quit();
  }
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (logger) logger.log('[desktop] quitting…');
  if (quitting || !handle) return;
  event.preventDefault();
  quitting = true;
  (async () => {
    try {
      const { stopDesktop } = require('../desktop/bootstrap.cjs');
      await stopDesktop(handle);
    } catch (err) {
      if (logger) logger.error('[desktop] shutdown error\n' + ((err && err.stack) || err));
    } finally {
      handle = null;
      app.exit(0);
    }
  })();
});
