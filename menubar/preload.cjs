const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hotate', {
  plan: (intent) => ipcRenderer.invoke('hotate-plan', intent),
  getContext: () => ipcRenderer.invoke('hotate-get-context'),
  copyText: (text) => ipcRenderer.invoke('hotate-copy-text', text),
  selectFolder: () => ipcRenderer.invoke('hotate-select-folder'),
  startOllama: () => ipcRenderer.invoke('hotate-start-ollama'),
  quit: () => ipcRenderer.invoke('hotate-quit'),
  reloadWindow: () => ipcRenderer.invoke('hotate-reload-window'),
  checkForUpdates: () => ipcRenderer.invoke('hotate-check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('hotate-download-update'),
  quitAndInstall: () => ipcRenderer.invoke('hotate-quit-and-install'),
  onUpdateEvent: (cb) => {
    const fn = (_e, p) => cb(p)
    ipcRenderer.on('hotate-update-event', fn)
    return () => ipcRenderer.removeListener('hotate-update-event', fn)
  },
  onSetup: (cb) => {
    const fn = (_e, p) => cb(p)
    ipcRenderer.on('hotate-setup', fn)
    return () => ipcRenderer.removeListener('hotate-setup', fn)
  },
})
