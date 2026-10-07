const { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, shell, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const API_BASE = 'https://stelchat.xyz';
const DEFAULT_SETTINGS = {
  alwaysOnTop: false,
  desktopMode: false,
  launchAtLogin: false,
  notifications: false,
  notificationMembers: {},
  opacity: 1,
  windowBounds: null,
};
const BOOLEAN_SETTINGS = new Set(['alwaysOnTop', 'desktopMode', 'launchAtLogin', 'notifications']);

let mainWindow;
let tray;
let quitting = false;
let settings = { ...DEFAULT_SETTINGS };
let eventAbortController;
let reconnectTimer;
let lastEventId = '';
let connectionStatus = { connected: false, state: 'connecting' };
let boundsSaveTimer;
let streamerByUid = new Map();

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  settings.opacity = Math.min(1, Math.max(0.4, Number(settings.opacity) || 1));
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function memberUrl(initials) {
  return initials ? `${API_BASE}/members/${encodeURIComponent(initials)}` : API_BASE;
}

async function fetchJson(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'StelChat-Desktop/0.1' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function snapshot() {
  const [streamers, recent] = await Promise.all([
    fetchJson('/api/streamers'),
    fetchJson('/api/recent?limit=20'),
  ]);
  streamerByUid = new Map(streamers.map((streamer) => [streamer.uid, streamer]));
  const notificationMembers = { ...(settings.notificationMembers || {}) };
  let migrated = false;
  for (const streamer of streamers) {
    if (!Object.hasOwn(notificationMembers, streamer.uid)) {
      notificationMembers[streamer.uid] = Boolean(settings.notifications);
      migrated = true;
    }
  }
  if (migrated) {
    settings.notificationMembers = notificationMembers;
    saveSettings();
  }
  return { streamers, recent, settings, connection: connectionStatus };
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function updateConnection(status) {
  connectionStatus = status;
  sendToRenderer('connection', status);
}

function showNativeNotification(eventName, payload) {
  if (!Notification.isSupported()) return;
  const liveMember = eventName === 'session' && payload.status === 'OPEN'
    ? streamerByUid.get(payload.channel_id) : null;
  if (eventName !== 'chat' && !liveMember) return;
  const targetUid = eventName === 'chat' ? payload.target_uid : liveMember.uid;
  const memberPreferences = settings.notificationMembers || {};
  const enabled = Object.hasOwn(memberPreferences, targetUid)
    ? Boolean(memberPreferences[targetUid]) : Boolean(settings.notifications);
  if (!enabled) return;
  const targetName = eventName === 'chat' ? (payload.target_name || '멤버') : liveMember.name;
  const targetInitials = eventName === 'chat' ? payload.target_initials : liveMember.initials;
  const notification = new Notification({
    title: liveMember ? `${targetName} 방송 시작` : `${targetName}의 새 채팅`,
    body: liveMember ? (payload.title || '방송을 시작했어요.') : `${payload.channel_name || '채팅방'} · ${payload.content || ''}`,
    silent: true,
  });
  notification.on('click', () => shell.openExternal(memberUrl(targetInitials)));
  notification.show();
}

function parseSseBlock(block) {
  let eventName = 'message';
  let eventId = '';
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('id:')) eventId = line.slice(3).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  return { eventName, eventId, payload: JSON.parse(data.join('\n')) };
}

async function connectEvents() {
  clearTimeout(reconnectTimer);
  eventAbortController?.abort();
  eventAbortController = new AbortController();
  updateConnection({ connected: false, state: 'connecting' });
  try {
    const headers = { Accept: 'text/event-stream', 'User-Agent': 'StelChat-Desktop/0.1' };
    if (lastEventId) headers['Last-Event-ID'] = lastEventId;
    const response = await fetch(`${API_BASE}/api/events`, {
      headers,
      signal: eventAbortController.signal,
    });
    if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
    updateConnection({ connected: true, state: 'connected' });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        if (!block.trim() || block.startsWith(':')) continue;
        try {
          const event = parseSseBlock(block);
          if (!event) continue;
          if (event.eventId) lastEventId = event.eventId;
          sendToRenderer('stelchat-event', event);
          showNativeNotification(event.eventName, event.payload);
        } catch (error) {
          console.warn('Ignored malformed SSE event:', error.message);
        }
      }
    }
    throw new Error('SSE stream ended');
  } catch (error) {
    if (error.name === 'AbortError' || quitting) return;
    updateConnection({ connected: false, state: 'reconnecting' });
    reconnectTimer = setTimeout(connectEvents, 3000);
  }
}

function showWindow() {
  if (!mainWindow) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function applyWindowBehavior() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const desktopMode = Boolean(settings.desktopMode);
  mainWindow.setAlwaysOnTop(!desktopMode && Boolean(settings.alwaysOnTop));
  mainWindow.setSkipTaskbar(desktopMode);
  mainWindow.setMinimizable(!desktopMode);
  mainWindow.setVisibleOnAllWorkspaces(desktopMode, { visibleOnFullScreen: false });
  mainWindow.setOpacity(settings.opacity);
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'StelChat 열기', click: showWindow },
    { label: '웹사이트 열기', click: () => shell.openExternal(API_BASE) },
    { type: 'separator' },
    {
      label: '항상 위에 표시', type: 'checkbox', checked: settings.alwaysOnTop,
      click: (item) => setSetting('alwaysOnTop', item.checked),
    },
    {
      label: '바탕화면 모드', type: 'checkbox', checked: settings.desktopMode,
      click: (item) => setSetting('desktopMode', item.checked),
    },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
}

function setSetting(key, value) {
  if (key === 'opacity') {
    const opacity = Number(value);
    if (!Number.isFinite(opacity)) return settings;
    settings.opacity = Math.min(1, Math.max(0.4, opacity));
  } else {
    if (!BOOLEAN_SETTINGS.has(key)) return settings;
    settings[key] = Boolean(value);
  }
  if (key === 'desktopMode' && settings.desktopMode) settings.alwaysOnTop = false;
  if (key === 'alwaysOnTop' && settings.alwaysOnTop) settings.desktopMode = false;
  saveSettings();
  applyWindowBehavior();
  if (key === 'launchAtLogin') {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtLogin,
      path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
    });
  }
  updateTrayMenu();
  sendToRenderer('settings', settings);
  return settings;
}

function setMemberNotification(uid, value) {
  if (typeof uid !== 'string' || !streamerByUid.has(uid)) return settings;
  settings.notificationMembers = { ...(settings.notificationMembers || {}), [uid]: Boolean(value) };
  settings.notifications = [...streamerByUid.keys()].some((memberUid) => Boolean(settings.notificationMembers[memberUid]));
  saveSettings();
  sendToRenderer('settings', settings);
  return settings;
}

function setAllMemberNotifications(value) {
  const enabled = Boolean(value);
  settings.notificationMembers = Object.fromEntries([...streamerByUid.keys()].map((uid) => [uid, enabled]));
  settings.notifications = enabled;
  saveSettings();
  sendToRenderer('settings', settings);
  return settings;
}

function createWindow() {
  const savedBounds = settings.windowBounds && Number.isFinite(settings.windowBounds.x)
    && Number.isFinite(settings.windowBounds.y) ? settings.windowBounds : {};
  mainWindow = new BrowserWindow({
    width: 410,
    height: 690,
    minWidth: 360,
    minHeight: 520,
    show: false,
    backgroundColor: '#f6f5f2',
    autoHideMenuBar: true,
    title: 'StelChat',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    ...savedBounds,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  applyWindowBehavior();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('minimize', (event) => {
    if (settings.desktopMode) {
      event.preventDefault();
      mainWindow.showInactive();
    }
  });
  const rememberBounds = () => {
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
      settings.windowBounds = mainWindow.getBounds();
      saveSettings();
    }, 350);
  };
  mainWindow.on('move', rememberBounds);
  mainWindow.on('resize', rememberBounds);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://stelchat.xyz/')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip('StelChat');
  tray.on('double-click', showWindow);
  updateTrayMenu();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    loadSettings();
    createWindow();
    createTray();
    connectEvents();
  });
}

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true;
  clearTimeout(reconnectTimer);
  eventAbortController?.abort();
});

ipcMain.handle('snapshot', snapshot);
ipcMain.handle('refresh', snapshot);
ipcMain.handle('session-preview', (_event, sessionId, targetUid) => {
  const numericSessionId = Number(sessionId);
  if (!Number.isInteger(numericSessionId) || numericSessionId < 1 || typeof targetUid !== 'string' || !targetUid) {
    throw new Error('Invalid session preview request');
  }
  return fetchJson(`/api/sessions/${numericSessionId}?target_uid=${encodeURIComponent(targetUid)}&limit=20`);
});
ipcMain.handle('open-url', (_event, url) => {
  if (typeof url === 'string' && url.startsWith('https://stelchat.xyz/')) shell.openExternal(url);
});
ipcMain.handle('set-setting', (_event, key, value) => setSetting(key, value));
ipcMain.handle('set-member-notification', (_event, uid, value) => setMemberNotification(uid, value));
ipcMain.handle('set-all-member-notifications', (_event, value) => setAllMemberNotifications(value));
ipcMain.handle('hide-window', () => mainWindow?.hide());
