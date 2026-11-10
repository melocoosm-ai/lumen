// Exposes a narrow, fixed API to the toolbar UI. Web pages in tabs never get this.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumen', {
  newTab: () => ipcRenderer.send('tab:new'),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  activateTab: (id) => ipcRenderer.send('tab:activate', id),
  go: (input) => ipcRenderer.send('nav:go', input),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  stop: () => ipcRenderer.send('nav:stop'),
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onFocusOmnibox: (fn) => ipcRenderer.on('focus-omnibox', () => fn()),
});
