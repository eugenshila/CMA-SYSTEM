/**
 * CMA System — Electron main process.
 *
 * Production mode boots the embedded database + migrations + the Next.js
 * standalone server, then shows the application in a native window. A frameless
 * splash window covers the (one-time, migration-heavy) startup.
 *
 * Development mode: set CMA_DEV_URL (e.g. http://localhost:3000) to point the
 * window at `npm run dev:all` instead of booting the embedded stack.
 */
'use strict';

const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEV_URL = process.env.CMA_DEV_URL || '';
const APP_USER_MODEL_ID = 'org.cma.system';

let splashWin = null;
let mainWin = null;
let handle = null;
let quitting = false;

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

async function run() {
  app.setAppUserModelId(APP_USER_MODEL_ID);
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
      logger: console,
      onStatus: sendStatus,
      onWebExit: (code) => {
        if (!quitting) {
          dialog.showErrorBox(
            'CMA System',
            'The application server stopped unexpectedly (code ' + code + '). Please restart the app.',
          );
          app.quit();
        }
      },
    });
    createMainWindow(handle.url);
  } catch (err) {
    console.error('[desktop] startup failed', err);
    sendStatus('Startup failed — see details below.');
    dialog.showErrorBox('CMA System failed to start', String((err && err.stack) || err));
    app.quit();
  }
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (quitting || !handle) return;
  event.preventDefault();
  quitting = true;
  (async () => {
    try {
      const { stopDesktop } = require('../desktop/bootstrap.cjs');
      await stopDesktop(handle);
    } catch (err) {
      console.error('[desktop] shutdown error', err);
    } finally {
      handle = null;
      app.exit(0);
    }
  })();
});
