/**
 * main.js — Electron main process for Boid Brush
 *
 * - Registers a custom `app://` protocol so that fetch() and ES module imports
 *   work correctly when loading from the local file system (required for WASM
 *   streaming compilation and WebGPU).
 * - Enables WebGPU via command-line switches (Windows D3D12 / Vulkan backend).
 * - Creates the main BrowserWindow and loads app.html.
 * - Handles native save-file dialog via IPC for a smoother save experience.
 */

'use strict';

const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

const APP_ROOT = path.resolve(__dirname);
const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

// ---------------------------------------------------------------------------
// WebGPU — must be set before app ready
// ---------------------------------------------------------------------------

// Enable WebGPU on Windows (D3D12 backend is preferred on Win 11)
app.commandLine.appendSwitch('enable-unsafe-webgpu');
// Enable Vulkan as a fallback GPU backend
app.commandLine.appendSwitch('enable-features', 'Vulkan,UseSkiaRenderer');
// Disable frame rate limit so the animation loop runs at full speed
app.commandLine.appendSwitch('disable-frame-rate-limit');

// ---------------------------------------------------------------------------
// Custom protocol — must be registered before app is ready
// ---------------------------------------------------------------------------
//
// We serve all app assets via `app://localhost/<path>` instead of `file://`.
// This avoids Chromium's cross-origin restrictions on file:// that block
// fetch() calls needed for WASM streaming compilation.  The scheme is
// declared privileged so that:
//   • fetch() works for app:// URLs (supportFetchAPI)
//   • ES module imports resolve correctly (standard)
//   • CORS headers are applied (corsEnabled)
//   • Streams work for large WASM files (stream)

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0d14',
    title: 'Boid Brush',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Sandbox must be false so that the preload script can call
      // contextBridge without a full Node sandbox restriction.
      sandbox: false,
    },
  });

  // Start maximised — this is a full-screen painting app
  win.maximize();

  win.loadURL('app://localhost/app.html');

  // Open external links (e.g. GitHub) in the system browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // Serve local files via the `app://` custom protocol.
  // All requests to `app://localhost/<pathname>` are mapped to the
  // corresponding file in __dirname.
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const relativePath = decodeURIComponent(pathname || '/')
      .replace(/^[/\\]+/, '') || 'app.html';
    const filePath = path.resolve(APP_ROOT, relativePath);

    if (filePath !== APP_ROOT && !filePath.startsWith(`${APP_ROOT}${path.sep}`)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) {
        return new Response('Not Found', { status: 404 });
      }
    } catch {
      return new Response('Not Found', { status: 404 });
    }

    const response = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(response.headers);
    const contentType = CONTENT_TYPES.get(path.extname(filePath).toLowerCase());
    if (contentType) headers.set('content-type', contentType);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });

  // IPC: native Save As dialog + file write
  // Renderer calls: await window.electronAPI.saveFile(uint8Array, defaultName)
  ipcMain.handle('save-file', async (_event, buffer, defaultName) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Image',
      defaultPath: defaultName || 'boid-brush.png',
      filters: [
        { name: 'PNG Image', extensions: ['png'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (canceled || !filePath) return { ok: false };
    try {
      await fs.promises.writeFile(filePath, Buffer.from(buffer));
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // On macOS apps stay in the Dock until explicitly quit; on Windows/Linux,
  // close all windows = quit the app.
  if (process.platform !== 'darwin') app.quit();
});
