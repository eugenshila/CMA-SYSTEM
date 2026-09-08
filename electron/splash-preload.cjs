/**
 * Splash-window preload. Bridges startup status messages from the main process
 * into the splash page so the user sees what is happening during first boot.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splash', {
  onStatus(callback) {
    ipcRenderer.on('desktop:status', (_event, message) => callback(String(message)));
  },
});
