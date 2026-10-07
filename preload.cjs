const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('stelchat', {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  refresh: () => ipcRenderer.invoke('refresh'),
  sessionPreview: (sessionId, targetUid) => ipcRenderer.invoke('session-preview', sessionId, targetUid),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  setMemberNotification: (uid, value) => ipcRenderer.invoke('set-member-notification', uid, value),
  setAllMemberNotifications: (value) => ipcRenderer.invoke('set-all-member-notifications', value),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  onEvent: (callback) => subscribe('stelchat-event', callback),
  onConnection: (callback) => subscribe('connection', callback),
  onSettings: (callback) => subscribe('settings', callback),
});
