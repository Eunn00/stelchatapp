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
  setMemberNotification: (uid, channel, eventType, value) => ipcRenderer.invoke('set-member-notification', uid, channel, eventType, value),
  setAllMemberNotifications: (channel, eventType, value) => ipcRenderer.invoke('set-all-member-notifications', channel, eventType, value),
  setChatRoomMuted: (sessionId, targetUid, muted) => ipcRenderer.invoke('set-chat-room-muted', sessionId, targetUid, muted),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  onEvent: (callback) => subscribe('stelchat-event', callback),
  onConnection: (callback) => subscribe('connection', callback),
  onSettings: (callback) => subscribe('settings', callback),
  onNotificationSound: (callback) => subscribe('notification-sound', callback),
});
