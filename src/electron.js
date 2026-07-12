'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray } = require('electron');
const path = require('node:path');
const { startBackend } = require('./main');

const APP_ID = 'com.amethyst.launcher';
const isDev = process.env.AMETHYST_DEV === '1' || process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

let mainWindow;
let backendServer;
let backendUrl;
let tray;
let isQuitting = false;

// Keep one backend and one data writer active. A second launch focuses the
// existing window instead of failing because the loopback port is occupied.
const hasSingleInstanceLock = isDev || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

function iconPath(trayIcon = false) {
  const filename = process.platform === 'win32'
    ? (trayIcon ? 'icon-tray.ico' : 'icon.ico')
    : (trayIcon ? 'icon-tray.png' : 'icon.png');
  return path.join(__dirname, '..', 'build', filename);
}

function isTrustedLauncherUrl(value) {
  if (!backendUrl) return false;
  try {
    return new URL(value).origin === new URL(backendUrl).origin;
  } catch {
    return false;
  }
}

function openExternal(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      void shell.openExternal(url.toString());
    }
  } catch {
    // Ignore malformed links from the renderer.
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#100919',
    title: 'Amethyst Launcher',
    icon: iconPath(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedLauncherUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  void mainWindow.loadURL(backendUrl);
}

function showMainWindow() {
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Open launcher', accelerator: 'CmdOrCtrl+O', click: showMainWindow },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Amethyst' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Amethyst',
          click: () => dialog.showMessageBox({
            type: 'info',
            title: 'About Amethyst',
            message: 'Amethyst Launcher',
            detail: `Version ${app.getVersion()}\nA desktop Minecraft launcher.`
          })
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

function createTray() {
  tray = new Tray(iconPath(true));
  tray.setToolTip('Amethyst Launcher');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Amethyst', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('click', showMainWindow);
}

async function initialize() {
  // Port zero lets Windows select an unused loopback port. The server remains
  // inaccessible from other machines and avoids collisions with port 3000.
  const result = await startBackend({ port: 0 });
  backendServer = result.server;
  backendUrl = result.url;
}

if (hasSingleInstanceLock) {
  app.on('second-instance', showMainWindow);

  app.whenReady().then(async () => {
    try {
      // Never grant web content access to camera, microphone, geolocation, etc.
      app.on('web-contents-created', (_event, contents) => {
        contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      });

      await initialize();
      createMenu();
      createWindow();
      createTray();
    } catch (error) {
      console.error('Failed to start Amethyst:', error);
      await dialog.showMessageBox({
        type: 'error',
        title: 'Amethyst could not start',
        message: 'The launcher backend could not be started.',
        detail: error?.stack || String(error)
      });
      app.quit();
    }
  });

  app.on('activate', showMainWindow);
}

app.on('before-quit', () => {
  isQuitting = true;
  tray?.destroy();
  tray = undefined;
  backendServer?.close();
  backendServer = undefined;
});

app.on('window-all-closed', () => {
  // Closing the window exits on Windows/Linux. macOS follows normal platform
  // behavior and keeps the app available in the dock.
  if (process.platform !== 'darwin' && !isQuitting) app.quit();
});

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-app-path', () => app.getPath('userData'));
ipcMain.handle('get-platform', () => process.platform);
ipcMain.handle('is-packaged', () => app.isPackaged);
ipcMain.handle('is-electron', () => true);
ipcMain.handle('relaunch', () => {
  app.relaunch();
  app.quit();
});
ipcMain.handle('quit', () => app.quit());
ipcMain.handle('create-desktop-shortcut', () => {
  if (process.platform !== 'win32') return false;
  return shell.writeShortcutLink(path.join(app.getPath('desktop'), 'Amethyst Launcher.lnk'), 'create', {
    target: app.getPath('exe'),
    description: 'Amethyst Minecraft Launcher',
    icon: app.getPath('exe'),
    iconIndex: 0
  });
});
