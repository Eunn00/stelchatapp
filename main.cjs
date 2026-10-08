const { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, shell, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  chatRoomIsMuted, chatRoomKey, liveSessionKey, notificationEventType,
} = require('./notification-policy.cjs');

const API_BASE = 'https://stelchat.xyz';
const DEFAULT_SETTINGS = {
  alwaysOnTop: false,
  darkMode: false,
  desktopMode: false,
  launchAtLogin: false,
  notifications: false,
  notificationMembers: {},
  notificationPreferences: {},
  mutedChatRooms: {},
  notificationVolume: 0.7,
  opacity: 1,
  windowBounds: null,
};
const BOOLEAN_SETTINGS = new Set(['alwaysOnTop', 'darkMode', 'desktopMode', 'launchAtLogin', 'notifications']);

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
let notificationBaselineReady = false;
let startupLiveSessions = new Set();

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const NOTIFICATION_CHANNELS = new Set(['desktop', 'sound']);
const NOTIFICATION_EVENTS = new Set(['live', 'chat']);

function defaultNotificationPreference() {
  return { desktop: { live: false, chat: false }, sound: { live: false, chat: false } };
}

function normalizedNotificationPreference(value) {
  const fallback = defaultNotificationPreference();
  if (!value || typeof value !== 'object') return fallback;
  return {
    desktop: {
      live: typeof value.desktop?.live === 'boolean' ? value.desktop.live : fallback.desktop.live,
      chat: typeof value.desktop?.chat === 'boolean' ? value.desktop.chat : fallback.desktop.chat,
    },
    sound: {
      live: Boolean(value.sound?.live),
      chat: Boolean(value.sound?.chat),
    },
  };
}

function normalizedMutedChatRooms(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, mutedAt]) => /^\d+:.+/.test(key) && Number.isFinite(Number(mutedAt)))
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, 500));
}

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
  const notificationVolume = Number(settings.notificationVolume);
  settings.notificationVolume = Number.isFinite(notificationVolume)
    ? Math.min(1, Math.max(0, notificationVolume))
    : DEFAULT_SETTINGS.notificationVolume;
  settings.mutedChatRooms = normalizedMutedChatRooms(settings.mutedChatRooms);
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function memberUrl(initials) {
  return initials ? `${API_BASE}/members/${encodeURIComponent(initials)}` : API_BASE;
}

function allowedExternalUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.origin === API_BASE) return url.href;
    if (url.origin === 'https://chzzk.naver.com'
        && /^\/live\/[0-9a-f]{32}$/.test(url.pathname)
        && !url.search && !url.hash) return url.href;
  } catch {
    // Ignore malformed or non-HTTPS external URLs.
  }
  return null;
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
  if (!notificationBaselineReady) {
    startupLiveSessions = new Set(streamers
      .filter((streamer) => streamer.is_live)
      .map((streamer) => liveSessionKey(streamer.uid, streamer.live_opened_at)));
    notificationBaselineReady = true;
  }
  const notificationPreferences = { ...(settings.notificationPreferences || {}) };
  let migrated = false;
  for (const streamer of streamers) {
    const normalized = normalizedNotificationPreference(notificationPreferences[streamer.uid]);
    if (JSON.stringify(notificationPreferences[streamer.uid]) !== JSON.stringify(normalized)) migrated = true;
    notificationPreferences[streamer.uid] = normalized;
  }
  if (migrated) {
    settings.notificationPreferences = notificationPreferences;
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

function dispatchNotification(eventName, payload) {
  const notificationEvent = notificationEventType(
    eventName, payload, notificationBaselineReady, startupLiveSessions,
  );
  if (!notificationEvent) return;
  const liveMember = notificationEvent === 'live' ? streamerByUid.get(payload.channel_id) : null;
  if (notificationEvent === 'live' && !liveMember) return;
  const targetUid = eventName === 'chat' ? payload.target_uid : liveMember.uid;
  if (notificationEvent === 'chat' && chatRoomIsMuted(payload, settings.mutedChatRooms)) return;
  const preference = normalizedNotificationPreference(settings.notificationPreferences?.[targetUid]);
  const targetName = eventName === 'chat' ? (payload.target_name || '멤버') : liveMember.name;
  const targetInitials = eventName === 'chat' ? payload.target_initials : liveMember.initials;
  if (preference.desktop[notificationEvent] && Notification.isSupported()) {
    const notification = new Notification({
      title: liveMember ? `${targetName} 방송 시작` : `${targetName}의 새 채팅`,
      body: liveMember ? (payload.title || '방송을 시작했어요.') : `${payload.channel_name || '채팅방'} · ${payload.content || ''}`,
      silent: true,
    });
    notification.on('click', () => shell.openExternal(memberUrl(targetInitials)));
    notification.show();
  }
  if (preference.sound[notificationEvent]) {
    sendToRenderer('notification-sound', { type: notificationEvent });
  }
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
          dispatchNotification(event.eventName, event.payload);
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
  mainWindow.setBackgroundColor(settings.darkMode ? '#17181d' : '#f6f5f2');
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
  } else if (key === 'notificationVolume') {
    const notificationVolume = Number(value);
    if (!Number.isFinite(notificationVolume)) return settings;
    settings.notificationVolume = Math.min(1, Math.max(0, notificationVolume));
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

function setMemberNotification(uid, channel, eventType, value) {
  if (typeof uid !== 'string' || !streamerByUid.has(uid)
      || !NOTIFICATION_CHANNELS.has(channel) || !NOTIFICATION_EVENTS.has(eventType)) return settings;
  const notificationPreferences = { ...(settings.notificationPreferences || {}) };
  const current = normalizedNotificationPreference(notificationPreferences[uid]);
  notificationPreferences[uid] = {
    ...current,
    [channel]: { ...current[channel], [eventType]: Boolean(value) },
  };
  settings.notificationPreferences = notificationPreferences;
  settings.notificationMembers = {
    ...(settings.notificationMembers || {}),
    [uid]: notificationPreferences[uid].desktop.live || notificationPreferences[uid].desktop.chat,
  };
  settings.notifications = [...streamerByUid.keys()].some((memberUid) => {
    const preference = normalizedNotificationPreference(notificationPreferences[memberUid]);
    return preference.desktop.live || preference.desktop.chat;
  });
  saveSettings();
  sendToRenderer('settings', settings);
  return settings;
}

function setAllMemberNotifications(channel, eventType, value) {
  if (channel != null && !NOTIFICATION_CHANNELS.has(channel)) return settings;
  if (eventType != null && !NOTIFICATION_EVENTS.has(eventType)) return settings;
  const enabled = Boolean(value);
  const notificationPreferences = { ...(settings.notificationPreferences || {}) };
  for (const uid of streamerByUid.keys()) {
    const current = normalizedNotificationPreference(notificationPreferences[uid]);
    for (const targetChannel of channel ? [channel] : NOTIFICATION_CHANNELS) {
      for (const targetEvent of eventType ? [eventType] : NOTIFICATION_EVENTS) {
        current[targetChannel][targetEvent] = enabled;
      }
    }
    notificationPreferences[uid] = current;
  }
  settings.notificationPreferences = notificationPreferences;
  settings.notificationMembers = Object.fromEntries([...streamerByUid.keys()].map((uid) => [
    uid, notificationPreferences[uid].desktop.live || notificationPreferences[uid].desktop.chat,
  ]));
  settings.notifications = [...streamerByUid.keys()].some((uid) => settings.notificationMembers[uid]);
  saveSettings();
  sendToRenderer('settings', settings);
  return settings;
}

function setChatRoomMuted(sessionId, targetUid, muted) {
  const key = chatRoomKey(sessionId, targetUid);
  if (!key || !streamerByUid.has(targetUid)) return settings;
  const mutedChatRooms = { ...normalizedMutedChatRooms(settings.mutedChatRooms) };
  if (muted) mutedChatRooms[key] = Date.now();
  else delete mutedChatRooms[key];
  settings.mutedChatRooms = normalizedMutedChatRooms(mutedChatRooms);
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
      backgroundThrottling: false,
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
    const externalUrl = allowedExternalUrl(url);
    if (externalUrl) shell.openExternal(externalUrl);
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
ipcMain.handle('member-sessions', (_event, uid) => {
  if (typeof uid !== 'string' || !streamerByUid.has(uid)) {
    throw new Error('Invalid member sessions request');
  }
  return fetchJson(`/api/streamers/${encodeURIComponent(uid)}/sessions?limit=50`);
});
ipcMain.handle('session-preview', (_event, sessionId, targetUid) => {
  const numericSessionId = Number(sessionId);
  if (!Number.isInteger(numericSessionId) || numericSessionId < 1 || typeof targetUid !== 'string' || !targetUid) {
    throw new Error('Invalid session preview request');
  }
  return fetchJson(`/api/sessions/${numericSessionId}?target_uid=${encodeURIComponent(targetUid)}&limit=20`);
});
ipcMain.handle('open-url', (_event, url) => {
  const externalUrl = allowedExternalUrl(url);
  if (externalUrl) shell.openExternal(externalUrl);
});
ipcMain.handle('set-setting', (_event, key, value) => setSetting(key, value));
ipcMain.handle('set-member-notification', (_event, uid, channel, eventType, value) => setMemberNotification(uid, channel, eventType, value));
ipcMain.handle('set-all-member-notifications', (_event, channel, eventType, value) => setAllMemberNotifications(channel, eventType, value));
ipcMain.handle('set-chat-room-muted', (_event, sessionId, targetUid, muted) => setChatRoomMuted(sessionId, targetUid, muted));
ipcMain.handle('hide-window', () => mainWindow?.hide());
