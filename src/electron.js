const { app, BrowserWindow, shell, ipcMain, Menu, Tray } = require('electron');
const path = require('node:path');
const { startBackend } = require('./main');

// Keep a global reference of the window object to avoid garbage collection
let mainWindow = null;
let backendServer = null;
let tray = null;
let backendUrl = null;

// Allow running multiple instances for development but lock in production
const isDev = process.env.AMETHYST_DEV === '1' || process.env.NODE_ENV === 'development';

if (!isDev) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
}

// Disable GPU sandbox issues on some Linux distros
app.commandLine.appendSwitch('no-sandbox');

// Set App User Model ID for Windows (needed for taskbar pinning and notifications)
if (process.platform === 'win32') {
  app.setAppUserModelId('com.amethyst.launcher');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#100919',
    title: 'Amethyst Launcher',
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,
    autoHideMenuBar: true
  });

  // Show window once ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the system browser instead of the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(backendUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Load the backend URL once it's ready
  if (backendUrl) {
    mainWindow.loadURL(backendUrl);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('minimize', (event) => {
    if (process.platform === 'win32' && app.getSettings?.()?.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function getIconPath() {
  if (process.platform === 'win32') {
    return path.join(__dirname, '..', 'build', 'icon.ico');
  }
  if (process.platform === 'darwin') {
    return path.join(__dirname, '..', 'build', 'icon.png');
  }
  return path.join(__dirname, '..', 'build', 'icon.png');
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('navigate', '/settings');
          }
        },
        { type: 'separator' },
        {
          label: 'Quit Amethyst',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Amethyst',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('show-about');
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createTray() {
  const trayIcon = process.platform === 'win32'
    ? path.join(__dirname, '..', 'build', 'icon-tray.ico')
    : path.join(__dirname, '..', 'build', 'icon-tray.png');

  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Amethyst',
      click: () => {
        if (!mainWindow) createWindow();
        else mainWindow.show();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip('Amethyst Launcher');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (!mainWindow) createWindow();
    else mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

async function initialize() {
  try {
    const { server, url } = await startBackend();
    backendServer = server;
    backendUrl = url;

    if (mainWindow) {
      mainWindow.loadURL(backendUrl);
    }
  } catch (error) {
    console.error('Failed to start Amethyst backend:', error);
  }
}

app.whenReady().then(async () => {
  await initialize();
  createMenu();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (backendServer) {
    backendServer.close();
  }
});

// Handle IPC from renderer
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-app-path', () => app.getPath('userData'));
ipcMain.handle('relaunch', () => {
  app.relaunch();
  app.quit();
});
ipcMain.handle('quit', () => {
  app.quit();
});
ipcMain.handle('is-packaged', () => app.isPackaged);
ipcMain.handle('get-platform', () => process.platform);

// Pin to taskbar (Windows only)
ipcMain.handle('pin-to-taskbar', async () => {
  if (process.platform !== 'win32') return false;
  try {
    const { shell } = require('electron');
    const path = require('node:path');
    const appPath = app.getPath('exe');
    // Use Windows Shell to pin to taskbar
    const { exec } = require('node:child_process');
    return await new Promise((resolve) => {
      exec(`powershell -Command "$shell = New-Object -ComObject Shell.Application; $folder = $shell.Namespace('${path.dirname(appPath).replace(/'/g, "''")}'); $item = $folder.ParseName('${path.basename(appPath).replace(/'/g, "''")}'); $item.InvokeVerb('taskbar')"`, (error) => {
        resolve(!error);
      });
    });
  } catch (error) {
    console.error('Failed to pin to taskbar:', error);
    return false;
  }
});

// Unpin from taskbar (Windows only)
ipcMain.handle('unpin-from-taskbar', async () => {
  if (process.platform !== 'win32') return false;
  try {
    const path = require('node:path');
    const appPath = app.getPath('exe');
    const { exec } = require('node:child_process');
    return await new Promise((resolve) => {
      exec(`powershell -Command "$shell = New-Object -ComObject Shell.Application; $folder = $shell.Namespace('${path.dirname(appPath).replace(/'/g, "''")}'); $item = $folder.ParseName('${path.basename(appPath).replace(/'/g, "''")}'); $item.InvokeVerb('unpinfromtaskbar')"`, (error) => {
        resolve(!error);
      });
    });
  } catch (error) {
    console.error('Failed to unpin from taskbar:', error);
    return false;
  }
});

// Create desktop shortcut (Windows)
ipcMain.handle('create-desktop-shortcut', () => {
  if (process.platform !== 'win32') return false;
  try {
    const path = require('node:path');
    const appPath = app.getPath('exe');
    const desktopPath = app.getPath('desktop');
    const shortcutPath = path.join(desktopPath, 'Amethyst Launcher.lnk');
    shell.writeShortcutLink(shortcutPath, 'create', {
      target: appPath,
      description: 'Amethyst Minecraft Launcher',
      icon: appPath,
      iconIndex: 0
    });
    return true;
  } catch (error) {
    console.error('Failed to create desktop shortcut:', error);
    return false;
  }
});

// Check if running as Electron
ipcMain.handle('is-electron', () => true);
