const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, safe API to the renderer process
contextBridge.exposeInMainWorld('AmethystAPI', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  relaunch: () => ipcRenderer.invoke('relaunch'),
  quit: () => ipcRenderer.invoke('quit'),
  isPackaged: () => ipcRenderer.invoke('is-packaged'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  isElectron: () => ipcRenderer.invoke('is-electron'),
  pinToTaskbar: () => ipcRenderer.invoke('pin-to-taskbar'),
  unpinFromTaskbar: () => ipcRenderer.invoke('unpin-from-taskbar'),
  createDesktopShortcut: () => ipcRenderer.invoke('create-desktop-shortcut'),
  platform: process.platform
});
