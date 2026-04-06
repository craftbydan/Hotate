const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hotate', {
  plan: (intent) => ipcRenderer.invoke('hotate-plan', intent),
  getContext: () => ipcRenderer.invoke('hotate-get-context'),
  copyText: (text) => ipcRenderer.invoke('hotate-copy-text', text),
  selectFolder: () => ipcRenderer.invoke('hotate-select-folder'),
  startOllama: () => ipcRenderer.invoke('hotate-start-ollama'),
  quit: () => ipcRenderer.invoke('hotate-quit'),
  update: () => ipcRenderer.invoke('hotate-update'),
})
