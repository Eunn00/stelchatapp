const {
  app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, shell, Tray,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const {
  chatRoomIsMuted, chatRoomKey, liveSessionKey, notificationEventType,
} = require('./notification-policy.cjs');
const { createExternalOpenGuard } = require('./external-link-policy.cjs');
const { isNewerVersion, normalizedVersion } = require('./update-policy.cjs');
const { normalizedWindowBounds } = require('./window-bounds-policy.cjs');
const { createEventDeduper, reconnectDelay } = require('./event-delivery-policy.cjs');
const { createSnapshotCoordinator } = require('./snapshot-coordinator.cjs');
const { applySessionEventToStreamer, retainSessionWatermark } = require('./renderer-state-policy.js');

const API_BASE = 'https://stelchat.xyz';
const LATEST_RELEASE_API = 'https://api.github.com/repos/Eunn00/stelchatapp/releases/latest';
const VERSION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const VERSION_RETRY_INTERVAL_MS = 15 * 60 * 1000;
const SSE_CONNECT_TIMEOUT_MS = 15000;
const SSE_IDLE_TIMEOUT_MS = 55000;
const WINDOWS_APP_ID = 'xyz.stelchat.desktop';
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
let versionCheckTimer;
let lastEventId = '';
let connectionStatus = { connected: false, state: 'connecting' };
let boundsSaveTimer;
let streamerByUid = new Map();
let notificationBaselineReady = false;
let startupLiveSessions = new Set();
const shouldOpenExternal = createExternalOpenGuard();
let versionStatusPromise;
let cachedVersionStatus;
let settingsMigrationPending = false;
let rendererReloadAttempts = 0;
let rendererReloadTimer;
let rendererStableTimer;
let reconnectAttempt = 0;
const isDuplicateEvent = createEventDeduper();
const activeNotifications = [];
const APP_ENTRY_PATH = path.join(__dirname, 'index.html');
const APP_ENTRY_URL = pathToFileURL(APP_ENTRY_PATH).href;

if (process.platform === 'win32') app.setAppUserModelId(WINDOWS_APP_ID);
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
      live: typeof value.sound?.live === 'boolean' ? value.sound.live : fallback.sound.live,
      chat: typeof value.sound?.chat === 'boolean' ? value.sound.chat : fallback.sound.chat,
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

function ensureWindowsPortableShortcut() {
  const executablePath = process.env.PORTABLE_EXECUTABLE_FILE;
  if (process.platform !== 'win32' || !app.isPackaged || !executablePath) return;
  const shortcutPath = path.join(
    app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StelChat.lnk',
  );
  try {
    fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
    shell.writeShortcutLink(shortcutPath, 'replace', {
      target: executablePath,
      cwd: path.dirname(executablePath),
      description: 'StelChat Windows companion',
      icon: executablePath,
      iconIndex: 0,
      appUserModelId: WINDOWS_APP_ID,
    });
  } catch {
    // The app remains usable even if Windows rejects optional shell integration.
  }
}

function loadSettings() {
  let stored = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
  } catch {
    // A missing or damaged settings file falls back to safe defaults.
  }
  settings = { ...DEFAULT_SETTINGS, ...stored };
  for (const key of BOOLEAN_SETTINGS) {
    settings[key] = typeof stored[key] === 'boolean' ? stored[key] : DEFAULT_SETTINGS[key];
  }
  settings.opacity = Math.min(1, Math.max(0.4, Number(settings.opacity) || 1));
  const notificationVolume = Number(settings.notificationVolume);
  settings.notificationVolume = Number.isFinite(notificationVolume)
    ? Math.min(1, Math.max(0, notificationVolume))
    : DEFAULT_SETTINGS.notificationVolume;
  settings.mutedChatRooms = normalizedMutedChatRooms(settings.mutedChatRooms);
}

function saveSettings(nextSettings = settings) {
  const targetPath = settingsPath();
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(nextSettings, null, 2));
    fs.renameSync(temporaryPath, targetPath);
    return true;
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* Best-effort cleanup. */ }
    console.warn('Could not persist settings:', error.message);
    return false;
  }
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
    if (url.origin === 'https://github.com'
        && /^\/Eunn00\/stelchatapp\/releases\/tag\/v\d+\.\d+\.\d+$/.test(url.pathname)
        && !url.search && !url.hash) return url.href;
  } catch {
    // Ignore malformed or non-HTTPS external URLs.
  }
  return null;
}

function openExternalOnce(value) {
  const externalUrl = allowedExternalUrl(value);
  if (!externalUrl || !shouldOpenExternal(externalUrl)) return false;
  shell.openExternal(externalUrl).catch(() => {});
  return true;
}

async function fetchVersionStatus() {
  const current = app.getVersion();
  const developmentOverride = process.env.STELCHAT_UPDATE_PREVIEW === '1'
    ? normalizedVersion(process.env.STELCHAT_LATEST_VERSION_OVERRIDE)
    : null;
  if (developmentOverride) {
    return {
      current,
      latest: developmentOverride,
      updateAvailable: isNewerVersion(developmentOverride, current),
      releaseUrl: `https://github.com/Eunn00/stelchatapp/releases/tag/v${developmentOverride}`,
      checked: true,
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `StelChat-Desktop/${current}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = await response.json();
    const latest = normalizedVersion(release.tag_name);
    const expectedReleaseUrl = latest
      ? `https://github.com/Eunn00/stelchatapp/releases/tag/v${latest}`
      : null;
    return {
      current,
      latest,
      updateAvailable: Boolean(latest && isNewerVersion(latest, current)),
      releaseUrl: release.html_url === expectedReleaseUrl ? expectedReleaseUrl : null,
      checked: true,
    };
  } catch {
    return {
      current, latest: null, updateAvailable: false, releaseUrl: null, checked: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function versionStatus(force = false) {
  if (versionStatusPromise) return versionStatusPromise;
  if (!force && cachedVersionStatus) return Promise.resolve(cachedVersionStatus);
  versionStatusPromise = fetchVersionStatus()
    .then((status) => {
      cachedVersionStatus = status;
      return status;
    })
    .finally(() => { versionStatusPromise = null; });
  return versionStatusPromise;
}

function startVersionChecks() {
  clearTimeout(versionCheckTimer);
  const check = async () => {
    const status = await versionStatus(true);
    sendToRenderer('version-status', status);
    versionCheckTimer = setTimeout(
      check,
      status.checked ? VERSION_CHECK_INTERVAL_MS : VERSION_RETRY_INTERVAL_MS,
    );
  };
  versionCheckTimer = setTimeout(check, VERSION_RETRY_INTERVAL_MS);
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

async function fetchSnapshot() {
  const [snapshotStreamers, recent] = await Promise.all([
    fetchJson('/api/streamers'),
    fetchJson('/api/recent?limit=20'),
  ]);
  const streamers = snapshotStreamers.map((streamer) => (
    retainSessionWatermark(streamer, streamerByUid.get(streamer.uid))
  ));
  streamerByUid = new Map(streamers.map((streamer) => [streamer.uid, streamer]));
  if (!notificationBaselineReady) {
    startupLiveSessions = new Set(streamers
      .filter((streamer) => streamer.is_live)
      .map((streamer) => liveSessionKey(
        streamer.uid, streamer.live_opened_at, streamer.latest_session_id,
      )));
    notificationBaselineReady = true;
  }
  const notificationPreferences = { ...(settings.notificationPreferences || {}) };
  let migrated = false;
  for (const streamer of streamers) {
    const normalized = normalizedNotificationPreference(notificationPreferences[streamer.uid]);
    if (JSON.stringify(notificationPreferences[streamer.uid]) !== JSON.stringify(normalized)) migrated = true;
    notificationPreferences[streamer.uid] = normalized;
  }
  if (migrated || settingsMigrationPending) {
    const nextSettings = { ...settings, notificationPreferences };
    settingsMigrationPending = !saveSettings(nextSettings);
    settings = nextSettings;
  }
  return { streamers, recent, settings, connection: connectionStatus };
}

const snapshotCoordinator = createSnapshotCoordinator(fetchSnapshot);

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
  try {
    mainWindow.webContents.send(channel, payload);
    return true;
  } catch (error) {
    console.warn(`Could not send renderer event ${channel}:`, error.message);
    return false;
  }
}

function updateConnection(status) {
  connectionStatus = status;
  sendToRenderer('connection', status);
}

function dispatchNotification(eventName, payload, sessionTransition = null) {
  if (eventName === 'session' && !sessionTransition?.accepted) return;
  if (eventName === 'session' && payload.status === 'OPEN' && !sessionTransition.notify) return;
  if (eventName === 'session' && payload.status === 'CLOSE') {
    startupLiveSessions.delete(liveSessionKey(payload.channel_id, payload.opened_at, payload.session_id));
    startupLiveSessions.delete(liveSessionKey(payload.channel_id, payload.opened_at));
  }
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
    try {
      const notification = new Notification({
        title: liveMember ? `${targetName} 방송 시작` : `${targetName}의 새 채팅`,
        body: liveMember ? (payload.title || '방송을 시작했어요.') : `${payload.channel_name || '채팅방'} · ${payload.content || ''}`,
        silent: true,
      });
      const forgetNotification = () => {
        const index = activeNotifications.indexOf(notification);
        if (index >= 0) activeNotifications.splice(index, 1);
      };
      notification.once('click', () => {
        openExternalOnce(memberUrl(targetInitials));
        forgetNotification();
      });
      notification.once('failed', forgetNotification);
      activeNotifications.push(notification);
      if (activeNotifications.length > 500) activeNotifications.shift();
      notification.show();
    } catch (error) {
      console.warn('Could not display Windows notification:', error.message);
    }
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
  const controller = new AbortController();
  eventAbortController = controller;
  let connectTimeout = setTimeout(() => controller.abort(), SSE_CONNECT_TIMEOUT_MS);
  let idleTimeout;
  let retryAfterMs = 0;
  let connectedAt = 0;
  const resetIdleTimeout = () => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => controller.abort(), SSE_IDLE_TIMEOUT_MS);
  };
  updateConnection({ connected: false, state: 'connecting' });
  try {
    const headers = { Accept: 'text/event-stream', 'User-Agent': 'StelChat-Desktop/0.1' };
    if (lastEventId) headers['Last-Event-ID'] = lastEventId;
    const response = await fetch(`${API_BASE}/api/events`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(connectTimeout);
    connectTimeout = null;
    if (!response.ok || !response.body) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = Number(retryAfterHeader);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        retryAfterMs = retryAfterSeconds * 1000;
      } else if (retryAfterHeader) {
        const retryAt = Date.parse(retryAfterHeader);
        if (Number.isFinite(retryAt)) retryAfterMs = Math.max(0, retryAt - Date.now());
      }
      throw new Error(`SSE HTTP ${response.status}`);
    }
    updateConnection({ connected: true, state: 'connected' });
    connectedAt = Date.now();
    resetIdleTimeout();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdleTimeout();
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        if (!block.trim() || block.startsWith(':')) continue;
        try {
          const event = parseSseBlock(block);
          if (!event) continue;
          if (event.eventId) lastEventId = event.eventId;
          if (isDuplicateEvent(event.eventName, event.payload)) continue;
          let sessionTransition = null;
          if (event.eventName === 'session') {
            const member = streamerByUid.get(event.payload?.channel_id);
            sessionTransition = applySessionEventToStreamer(event.payload, member);
            if (sessionTransition.accepted && member) {
              streamerByUid.set(member.uid, sessionTransition.streamer);
            }
          }
          sendToRenderer('stelchat-event', event);
          dispatchNotification(event.eventName, event.payload, sessionTransition);
        } catch (error) {
          console.warn('Ignored malformed SSE event:', error.message);
        }
      }
    }
    throw new Error('SSE stream ended');
  } catch (error) {
    if (quitting || controller !== eventAbortController) return;
    updateConnection({ connected: false, state: 'reconnecting' });
    if (connectedAt && Date.now() - connectedAt >= 60000) reconnectAttempt = 0;
    const delay = reconnectDelay(reconnectAttempt, retryAfterMs);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(connectEvents, delay);
  } finally {
    clearTimeout(connectTimeout);
    clearTimeout(idleTimeout);
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function applyWindowBehavior() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const desktopMode = Boolean(settings.desktopMode);
  mainWindow.setAlwaysOnTop(!desktopMode && Boolean(settings.alwaysOnTop));
  mainWindow.setMinimizable(!desktopMode);
  mainWindow.setVisibleOnAllWorkspaces(desktopMode, { visibleOnFullScreen: false });
  mainWindow.setOpacity(settings.opacity);
  mainWindow.setBackgroundColor(settings.darkMode ? '#17181d' : '#f6f5f2');
}

function applyWindowsTaskbarDetails() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  const executablePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  mainWindow.setAppDetails({
    appId: WINDOWS_APP_ID,
    appIconPath: executablePath,
    appIconIndex: 0,
    relaunchCommand: `"${executablePath}"`,
    relaunchDisplayName: 'StelChat',
  });
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'StelChat 열기', click: showWindow },
    { label: '웹사이트 열기', click: () => openExternalOnce(API_BASE) },
    { type: 'separator' },
    {
      label: '항상 위에 표시', type: 'checkbox', checked: settings.alwaysOnTop,
      click: (item) => {
        try { setSetting('alwaysOnTop', item.checked); } catch (error) {
          console.warn('Could not update tray setting:', error.message);
          updateTrayMenu();
        }
      },
    },
    {
      label: '바탕화면 모드', type: 'checkbox', checked: settings.desktopMode,
      click: (item) => {
        try { setSetting('desktopMode', item.checked); } catch (error) {
          console.warn('Could not update tray setting:', error.message);
          updateTrayMenu();
        }
      },
    },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
}

function applyLoginItemSetting(enabled) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
  });
}

function commitSettings(nextSettings) {
  if (!saveSettings(nextSettings)) throw new Error('설정을 저장하지 못했습니다.');
  settings = nextSettings;
  settingsMigrationPending = false;
  return settings;
}

function setSetting(key, value) {
  const nextSettings = { ...settings };
  if (key === 'opacity') {
    const opacity = Number(value);
    if (!Number.isFinite(opacity)) return settings;
    nextSettings.opacity = Math.min(1, Math.max(0.4, opacity));
  } else if (key === 'notificationVolume') {
    const notificationVolume = Number(value);
    if (!Number.isFinite(notificationVolume)) return settings;
    nextSettings.notificationVolume = Math.min(1, Math.max(0, notificationVolume));
  } else {
    if (!BOOLEAN_SETTINGS.has(key)) return settings;
    nextSettings[key] = Boolean(value);
  }
  if (key === 'desktopMode' && nextSettings.desktopMode) nextSettings.alwaysOnTop = false;
  if (key === 'alwaysOnTop' && nextSettings.alwaysOnTop) nextSettings.desktopMode = false;
  if (key === 'launchAtLogin') {
    applyLoginItemSetting(nextSettings.launchAtLogin);
  }
  try {
    commitSettings(nextSettings);
  } catch (error) {
    if (key === 'launchAtLogin') {
      try { applyLoginItemSetting(settings.launchAtLogin); } catch { /* Best-effort rollback. */ }
    }
    throw error;
  }
  applyWindowBehavior();
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
  const nextSettings = {
    ...settings,
    notificationPreferences,
    notificationMembers: {
    ...(settings.notificationMembers || {}),
    [uid]: notificationPreferences[uid].desktop.live || notificationPreferences[uid].desktop.chat,
    },
  };
  nextSettings.notifications = [...streamerByUid.keys()].some((memberUid) => {
    const preference = normalizedNotificationPreference(notificationPreferences[memberUid]);
    return preference.desktop.live || preference.desktop.chat;
  });
  commitSettings(nextSettings);
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
  const notificationMembers = Object.fromEntries([...streamerByUid.keys()].map((uid) => [
    uid, notificationPreferences[uid].desktop.live || notificationPreferences[uid].desktop.chat,
  ]));
  commitSettings({
    ...settings,
    notificationPreferences,
    notificationMembers,
    notifications: [...streamerByUid.keys()].some((uid) => notificationMembers[uid]),
  });
  sendToRenderer('settings', settings);
  return settings;
}

function setChatRoomMuted(sessionId, targetUid, muted) {
  const key = chatRoomKey(sessionId, targetUid);
  if (!key || !streamerByUid.has(targetUid)) return settings;
  const mutedChatRooms = { ...normalizedMutedChatRooms(settings.mutedChatRooms) };
  if (muted) mutedChatRooms[key] = Date.now();
  else delete mutedChatRooms[key];
  commitSettings({ ...settings, mutedChatRooms: normalizedMutedChatRooms(mutedChatRooms) });
  sendToRenderer('settings', settings);
  return settings;
}

function createWindow() {
  const savedBounds = normalizedWindowBounds(
    settings.windowBounds,
    screen.getAllDisplays().map((display) => display.workArea),
  );
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
  const scheduleRendererReload = (reason) => {
    if (quitting || !mainWindow || mainWindow.isDestroyed()
        || rendererReloadTimer || rendererReloadAttempts >= 2) return;
    rendererReloadAttempts += 1;
    console.warn('Scheduling renderer reload:', reason);
    rendererReloadTimer = setTimeout(() => {
      rendererReloadTimer = null;
      if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile(APP_ENTRY_PATH).catch((error) => {
          scheduleRendererReload(error.message);
        });
      }
    }, 1000);
  };
  mainWindow.loadFile(APP_ENTRY_PATH).catch((error) => {
    console.warn('Could not load the renderer:', error.message);
    scheduleRendererReload(error.message);
  });
  mainWindow.once('ready-to-show', () => {
    rendererReloadAttempts = 0;
    mainWindow.show();
    applyWindowsTaskbarDetails();
  });
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('did-finish-load', () => {
    clearTimeout(rendererStableTimer);
    rendererStableTimer = setTimeout(() => { rendererReloadAttempts = 0; }, 30000);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) scheduleRendererReload(errorDescription);
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
      const nextSettings = { ...settings, windowBounds: mainWindow.getBounds() };
      if (saveSettings(nextSettings)) settings = nextSettings;
    }, 350);
  };
  mainWindow.on('move', rememberBounds);
  mainWindow.on('resize', rememberBounds);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalOnce(url);
    return { action: 'deny' };
  });
  const preventUnexpectedNavigation = (event, url) => {
    if (url !== APP_ENTRY_URL) event.preventDefault();
  };
  mainWindow.webContents.on('will-navigate', preventUnexpectedNavigation);
  mainWindow.webContents.on('will-redirect', preventUnexpectedNavigation);
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
    console.warn('Renderer process stopped:', details.reason);
    scheduleRendererReload(details.reason);
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip('StelChat');
  tray.on('double-click', showWindow);
  updateTrayMenu();
}

const updatePreviewMode = process.env.STELCHAT_UPDATE_PREVIEW === '1'
  && (!app.isPackaged || process.env.STELCHAT_TEST_INSTANCE === '1');
const gotLock = updatePreviewMode || app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    loadSettings();
    try { applyLoginItemSetting(settings.launchAtLogin); } catch (error) {
      console.warn('Could not reconcile launch-at-login:', error.message);
    }
    ensureWindowsPortableShortcut();
    createWindow();
    createTray();
    connectEvents();
    startVersionChecks();
    powerMonitor.on('resume', () => connectEvents());
  });
}

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true;
  clearTimeout(reconnectTimer);
  clearTimeout(versionCheckTimer);
  clearTimeout(rendererReloadTimer);
  clearTimeout(rendererStableTimer);
  eventAbortController?.abort();
});

function trustedIpcEvent(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false;
  try {
    return path.resolve(fileURLToPath(event.senderFrame.url)) === path.resolve(APP_ENTRY_PATH);
  } catch {
    return false;
  }
}

function handleTrusted(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedIpcEvent(event)) throw new Error('Untrusted IPC request');
    return handler(...args);
  });
}

handleTrusted('snapshot', snapshotCoordinator.snapshot);
handleTrusted('refresh', snapshotCoordinator.refresh);
handleTrusted('member-sessions', (uid) => {
  if (typeof uid !== 'string' || !streamerByUid.has(uid)) {
    throw new Error('Invalid member sessions request');
  }
  return fetchJson(`/api/streamers/${encodeURIComponent(uid)}/sessions?limit=50`);
});
handleTrusted('session-preview', (sessionId, targetUid) => {
  const numericSessionId = Number(sessionId);
  if (!Number.isInteger(numericSessionId) || numericSessionId < 1 || typeof targetUid !== 'string' || !targetUid) {
    throw new Error('Invalid session preview request');
  }
  return fetchJson(`/api/sessions/${numericSessionId}?target_uid=${encodeURIComponent(targetUid)}&limit=20`);
});
handleTrusted('open-url', (url) => {
  openExternalOnce(url);
});
handleTrusted('app-version-status', () => versionStatus(false));
handleTrusted('set-setting', (key, value) => setSetting(key, value));
handleTrusted('set-member-notification', (uid, channel, eventType, value) => setMemberNotification(uid, channel, eventType, value));
handleTrusted('set-all-member-notifications', (channel, eventType, value) => setAllMemberNotifications(channel, eventType, value));
handleTrusted('set-chat-room-muted', (sessionId, targetUid, muted) => setChatRoomMuted(sessionId, targetUid, muted));
handleTrusted('hide-window', () => mainWindow?.hide());
