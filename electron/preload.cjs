/**
 * Main-window preload. Exposes a tiny, read-only descriptor of the desktop
 * shell to the web app (contextIsolation on, nodeIntegration off).
 */
'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('cmaDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
