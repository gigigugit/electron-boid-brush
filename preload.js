/**
 * preload.js — Electron preload script for Boid Brush
 *
 * Exposes a minimal `window.electronAPI` surface to the renderer process via
 * contextBridge so that app.js can detect the Electron environment and use
 * native capabilities (e.g. native Save As dialog) when available.
 *
 * Everything exposed here is explicitly allow-listed.  The renderer has no
 * direct access to Node.js or Electron internals.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** True when running inside Electron (as opposed to a plain browser). */
  isElectron: true,

  /** Current platform: 'win32' | 'darwin' | 'linux' */
  platform: process.platform,

  /**
   * Show the native Save As dialog and write the file.
   *
   * @param {Uint8Array} buffer     - File contents to write.
   * @param {string}     defaultName - Suggested filename (e.g. 'boid-brush.png').
   * @returns {Promise<{ok: boolean, filePath?: string, error?: string}>}
   */
  saveFile: (buffer, defaultName) =>
    ipcRenderer.invoke('save-file', buffer, defaultName),
});
