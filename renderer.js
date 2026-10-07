const API_BASE = 'https://stelchat.xyz';
const state = {
  streamers: [], recent: [], settings: {}, activeTab: 'live',
  expandedRecentKey: '', recentAutoExpanded: false,
  recentPreviews: new Map(), recentPreviewLoading: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));
const absoluteUrl = (value) => value?.startsWith('/') ? `${API_BASE}${value}` : value;
const memberUrl = (initials) => `${API_BASE}/members/${encodeURIComponent(initials)}`;
const liveUrl = (uid) => `https://chzzk.naver.com/live/${encodeURIComponent(uid)}`;
const formatTime = (value) => value?.slice(11, 16) || '';
const formatDate = (value) => value ? `${value.slice(5, 7)}/${value.slice(8, 10)}` : '';

function uptime(openedAt) {
  if (!openedAt) return 'LIVE';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(openedAt).getTime()) / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const remaining = String(seconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${remaining}`;
}

function avatar(item, prefix = '') {
  const image = absoluteUrl(item[`${prefix}avatar_url`]);
  const color = item[`${prefix}color`] || '#788CE2';
  const initials = item[`${prefix}initials`] || '?';
  return image
    ? `<span class="avatar" style="--avatar-color:${escapeHtml(color)}"><img src="${escapeHtml(image)}" alt="" /></span>`
    : `<span class="avatar initials" style="--avatar-color:${escapeHtml(color)}">${escapeHtml(initials)}</span>`;
}

function renderLive() {
  const items = state.streamers.filter((item) => item.is_live);
  $('#live-count').textContent = items.length;
  $('#live-list').innerHTML = items.length ? items.map((item) => `
    <button class="live-card open-member" data-url="${escapeHtml(liveUrl(item.uid))}" type="button" style="--member-color:${escapeHtml(item.color)}">
      ${avatar(item)}
      <span class="card-copy"><span class="card-title"><strong>${escapeHtml(item.name)}</strong><i class="live-pill">LIVE</i></span><b>${escapeHtml(item.live_title || '방송 중')}</b><small>${escapeHtml(item.live_category || '카테고리 없음')}</small></span>
      <time data-opened-at="${escapeHtml(item.live_opened_at || '')}">${uptime(item.live_opened_at)}</time>
    </button>`).join('') : `<div class="empty"><span>☾</span><strong>현재 방송 중인 멤버가 없어요</strong><p>방송이 시작되면 자동으로 표시됩니다.</p></div>`;
}

function markHtml(item) {
  const marks = item.channel_marks || [];
  return marks.map((mark) => `<i class="channel-mark" style="--mark-color:${escapeHtml(mark.color)}" title="${escapeHtml(mark.title)}">${escapeHtml(mark.symbol)}</i>`).join('');
}

const recentKey = (item) => `${item.session_id}:${item.target_uid}`;

function recentPreviewHtml(item) {
  const key = recentKey(item);
  if (state.recentPreviewLoading.has(key)) {
    return '<div class="recent-preview-state"><span></span>채팅을 불러오는 중…</div>';
  }
  const preview = state.recentPreviews.get(key);
  if (!preview) return '';
  if (preview.error) return '<div class="recent-preview-state error-copy">채팅을 불러오지 못했습니다. 다시 눌러 주세요.</div>';
  const messages = preview.messages.slice(-8);
  const messageHtml = messages.length ? messages.map((message) => `
    <div class="preview-message">
      <span>${message.source === 'donation' ? '<i class="donation-pill">후원</i>' : ''}${escapeHtml(message.content)}</span>
      <time>${formatTime(message.sent_at)}</time>
    </div>`).join('') : '<div class="recent-preview-state">표시할 채팅이 없습니다.</div>';
  return `${messageHtml}
    <button class="recent-more" data-url="${memberUrl(item.target_initials)}" type="button">웹사이트에서 채팅 더보기 <span>→</span></button>`;
}

function renderRecent() {
  $('#recent-list').innerHTML = state.recent.length ? state.recent.map((item) => `
    <article class="recent-group${state.expandedRecentKey === recentKey(item) ? ' expanded' : ''}" data-key="${recentKey(item)}">
      <div class="recent-summary" data-key="${recentKey(item)}" role="button" tabindex="0" aria-expanded="${state.expandedRecentKey === recentKey(item)}">
        ${avatar(item, 'target_')}
        <span class="card-copy"><span class="card-title"><strong>${escapeHtml(item.target_name)}</strong>${item.source === 'donation' ? '<i class="donation-pill">후원</i>' : ''}</span><small class="recent-channel-row"><span>${escapeHtml(item.channel_name)}${markHtml(item)}의 방송에서</span><button class="recent-channel-link" data-url="${escapeHtml(liveUrl(item.channel_id))}" type="button" title="CHZZK 라이브 채널 열기" aria-label="${escapeHtml(item.channel_name)} CHZZK 라이브 채널 열기">↗</button></small><b>“${escapeHtml(item.content)}”</b></span>
        <span class="recent-meta"><time>${formatDate(item.sent_at)}<br />${formatTime(item.sent_at)}</time><i>⌄</i></span>
      </div>
      ${state.expandedRecentKey === recentKey(item) ? `<div class="recent-preview">${recentPreviewHtml(item)}</div>` : ''}
    </article>`).join('') : `<div class="empty"><span>…</span><strong>최근 채팅이 없습니다</strong></div>`;
  bindRecentControls();
}

function findRecent(key) {
  return state.recent.find((item) => recentKey(item) === key);
}

async function expandRecent(item) {
  const key = recentKey(item);
  state.expandedRecentKey = key;
  renderRecent();
  if (state.recentPreviewLoading.has(key)) return;
  if (state.recentPreviews.has(key) && !state.recentPreviews.get(key).error) return;
  state.recentPreviews.delete(key);
  state.recentPreviewLoading.add(key);
  renderRecent();
  try {
    const preview = await window.stelchat.sessionPreview(item.session_id, item.target_uid);
    state.recentPreviews.set(key, { messages: preview.messages || [] });
  } catch {
    state.recentPreviews.set(key, { messages: [], error: true });
  } finally {
    state.recentPreviewLoading.delete(key);
    if (state.expandedRecentKey === key) renderRecent();
  }
}

function bindRecentControls() {
  document.querySelectorAll('.recent-summary').forEach((element) => {
    const toggle = () => {
      const key = element.dataset.key;
      if (state.expandedRecentKey === key) {
        state.expandedRecentKey = '';
        renderRecent();
      } else {
        const item = findRecent(key);
        if (item) void expandRecent(item);
      }
    };
    element.addEventListener('click', toggle);
    element.addEventListener('keydown', (event) => {
      if (event.target === element && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        toggle();
      }
    });
  });
  document.querySelectorAll('.recent-channel-link').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      window.stelchat.openUrl(element.dataset.url);
    });
  });
  document.querySelectorAll('.recent-more').forEach((element) => {
    element.addEventListener('click', () => window.stelchat.openUrl(element.dataset.url));
  });
}

function bindOpenLinks() {
  document.querySelectorAll('.open-member').forEach((element) => {
    element.addEventListener('click', () => window.stelchat.openUrl(element.dataset.url));
  });
}

function render() {
  renderLive();
  renderRecent();
  bindOpenLinks();
}

function memberNotificationEnabled(uid) {
  const preferences = state.settings.notificationMembers || {};
  return Object.hasOwn(preferences, uid) ? Boolean(preferences[uid]) : Boolean(state.settings.notifications);
}

function renderNotificationSettings() {
  const enabledCount = state.streamers.filter((member) => memberNotificationEnabled(member.uid)).length;
  $('#notification-summary').textContent = enabledCount === 0 ? '모두 꺼짐'
    : enabledCount === state.streamers.length ? '모두 켜짐' : `${enabledCount}명 켜짐`;
  $('#notification-member-list').innerHTML = state.streamers.map((member) => `
    <label class="notification-member">
      <span class="notification-member-copy">${avatar(member)}<span><strong>${escapeHtml(member.name)}</strong><small>방송 시작 · 새 채팅</small></span></span>
      <input type="checkbox" data-notification-uid="${escapeHtml(member.uid)}" ${memberNotificationEnabled(member.uid) ? 'checked' : ''} />
    </label>`).join('');
  document.querySelectorAll('[data-notification-uid]').forEach((input) => {
    input.addEventListener('change', async (event) => {
      applySettings(await window.stelchat.setMemberNotification(event.target.dataset.notificationUid, event.target.checked));
    });
  });
}

function applySettings(settings) {
  state.settings = settings;
  $('#always-on-top').checked = Boolean(settings.alwaysOnTop);
  $('#always-on-top').disabled = Boolean(settings.desktopMode);
  $('#desktop-mode').checked = Boolean(settings.desktopMode);
  $('#desktop-button').classList.toggle('enabled', Boolean(settings.desktopMode));
  $('#launch-at-login').checked = Boolean(settings.launchAtLogin);
  const opacityPercent = Math.round((Number(settings.opacity) || 1) * 100);
  $('#window-opacity').value = opacityPercent;
  $('#window-opacity-value').textContent = `${opacityPercent}%`;
  renderNotificationSettings();
}

async function load(useRefresh = false, silent = false) {
  if (!silent) {
    $('#loading').hidden = false;
    $('#error').hidden = true;
  }
  try {
    const data = useRefresh ? await window.stelchat.refresh() : await window.stelchat.snapshot();
    const streamersChanged = JSON.stringify(state.streamers) !== JSON.stringify(data.streamers);
    const recentChanged = JSON.stringify(state.recent) !== JSON.stringify(data.recent);
    state.streamers = data.streamers;
    state.recent = data.recent;
    applySettings(data.settings);
    updateConnection(data.connection || { connected: false, state: 'connecting' });
    if (!silent || streamersChanged) renderLive();
    if (!silent || recentChanged) renderRecent();
    if (!silent || streamersChanged || recentChanged) bindOpenLinks();
    if (!state.recentAutoExpanded && state.recent[0]) {
      state.recentAutoExpanded = true;
      void expandRecent(state.recent[0]);
    }
  } catch {
    if (!silent) $('#error').hidden = false;
  } finally {
    if (!silent) $('#loading').hidden = true;
  }
}

function updateConnection({ connected, state: connectionState }) {
  const element = $('#connection');
  element.classList.toggle('connected', connected);
  element.classList.toggle('reconnecting', connectionState === 'reconnecting');
  element.querySelector('span').textContent = connected ? '실시간' : connectionState === 'reconnecting' ? '재연결 중' : '연결 중';
}

document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
  state.activeTab = button.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${state.activeTab}-panel`));
}));

$('#refresh-button').addEventListener('click', () => load(true));
$('#retry-button').addEventListener('click', () => load(true));
$('#desktop-button').addEventListener('click', async () => applySettings(await window.stelchat.setSetting('desktopMode', !state.settings.desktopMode)));
$('#open-site').addEventListener('click', () => window.stelchat.openUrl(`${API_BASE}/`));
$('#footer-site').addEventListener('click', () => window.stelchat.openUrl(`${API_BASE}/`));
$('#settings-button').addEventListener('click', () => { $('#settings-panel').classList.add('open'); $('#settings-panel').setAttribute('aria-hidden', 'false'); });
$('#settings-close').addEventListener('click', () => { $('#notification-settings-panel').classList.remove('open'); $('#notification-settings-panel').setAttribute('aria-hidden', 'true'); $('#settings-panel').classList.remove('open'); $('#settings-panel').setAttribute('aria-hidden', 'true'); });
$('#notification-settings-open').addEventListener('click', () => { $('#notification-settings-panel').classList.add('open'); $('#notification-settings-panel').setAttribute('aria-hidden', 'false'); });
$('#notification-settings-back').addEventListener('click', () => { $('#notification-settings-panel').classList.remove('open'); $('#notification-settings-panel').setAttribute('aria-hidden', 'true'); });
$('#notifications-all-on').addEventListener('click', async () => applySettings(await window.stelchat.setAllMemberNotifications(true)));
$('#notifications-all-off').addEventListener('click', async () => applySettings(await window.stelchat.setAllMemberNotifications(false)));

for (const [id, key] of [['desktop-mode', 'desktopMode'], ['always-on-top', 'alwaysOnTop'], ['launch-at-login', 'launchAtLogin']]) {
  $(`#${id}`).addEventListener('change', async (event) => applySettings(await window.stelchat.setSetting(key, event.target.checked)));
}

$('#window-opacity').addEventListener('input', async (event) => {
  const opacity = Number(event.target.value) / 100;
  $('#window-opacity-value').textContent = `${event.target.value}%`;
  applySettings(await window.stelchat.setSetting('opacity', opacity));
});

window.stelchat.onConnection(updateConnection);
window.stelchat.onSettings(applySettings);
window.stelchat.onEvent(({ eventName, payload }) => {
  if (eventName === 'chat') {
    if (state.recent.some((item) => item.id === payload.id)) return;
    const key = recentKey(payload);
    state.recent = [payload, ...state.recent.filter((item) => recentKey(item) !== key)].slice(0, 20);
    const preview = state.recentPreviews.get(key);
    if (preview && !preview.error && !preview.messages.some((message) => message.id === payload.id)) {
      preview.messages = [...preview.messages, payload].sort((left, right) => left.sent_at.localeCompare(right.sent_at)).slice(-20);
    }
    renderRecent();
  } else if (eventName === 'session') {
    const member = state.streamers.find((item) => item.uid === payload.target_uid || item.uid === payload.channel_id);
    if (member) {
      member.is_live = payload.status === 'OPEN';
      member.live_opened_at = payload.opened_at;
      member.live_title = payload.title;
      member.live_category = payload.live_category;
      renderLive();
      bindOpenLinks();
    }
  }
});

setInterval(() => {
  document.querySelectorAll('[data-opened-at]').forEach((element) => { element.textContent = uptime(element.dataset.openedAt); });
}, 1000);
setInterval(() => load(true, true), 60000);
load();
