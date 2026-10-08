const API_BASE = 'https://stelchat.xyz';
const state = {
  streamers: [], recent: [], settings: {}, activeTab: 'live',
  expandedRecentKey: '',
  recentPreviews: new Map(), recentPreviewLoading: new Set(),
  unreadRecentKeys: new Set(), knownRecentIds: new Map(),
  selectedMemberUid: '', memberSessions: [], memberSessionsLoading: false,
  memberSessionsError: '', expandedMemberSessionId: null,
  memberPreviews: new Map(), memberPreviewLoading: new Set(), memberRequestId: 0,
};

const RECENT_UNREAD_STORAGE_KEY = 'stelchat-unread-recent-keys';
const RECENT_KNOWN_STORAGE_KEY = 'stelchat-known-recent-ids';

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
  const liveCount = $('#live-count');
  liveCount.textContent = items.length;
  liveCount.hidden = items.length === 0;
  $('#live-list').innerHTML = items.length ? items.map((item) => `
    <article class="live-card" style="--member-color:${escapeHtml(item.color)}">
      ${avatar(item)}
      <span class="card-copy"><span class="card-title"><strong>${escapeHtml(item.name)}</strong><i class="live-pill">LIVE</i></span><b>${escapeHtml(item.live_title || '방송 중')}</b><small>${escapeHtml(item.live_category || '카테고리 없음')}</small></span>
      <span class="live-card-actions"><button class="live-channel-link" data-url="${escapeHtml(liveUrl(item.uid))}" type="button" title="CHZZK 라이브 채널 열기" aria-label="${escapeHtml(item.name)} CHZZK 라이브 채널 열기">↗</button><time data-opened-at="${escapeHtml(item.live_opened_at || '')}">${uptime(item.live_opened_at)}</time></span>
    </article>`).join('') : `<div class="empty"><span>☾</span><strong>현재 방송 중인 멤버가 없어요</strong><p>방송이 시작되면 자동으로 표시됩니다.</p></div>`;
}

function markHtml(item) {
  const marks = item.channel_marks || [];
  return marks.map((mark) => `<i class="channel-mark channel-mark-${escapeHtml(mark.key || 'legacy')}" style="--mark-color:${escapeHtml(mark.color)}" title="${escapeHtml(mark.title)}">${escapeHtml(mark.symbol)}</i>`).join('');
}

function recentSessionStatusHtml(status) {
  const isLive = status === 'OPEN';
  return `<i class="recent-session-status ${isLive ? 'live' : 'ended'}" title="${isLive ? '현재 방송 중' : '종료된 방송'}">${isLive ? 'LIVE' : '종료'}</i>`;
}

const recentKey = (item) => `${item.session_id}:${item.target_uid}`;
const recentNotificationMuted = (item) => Boolean(state.settings.mutedChatRooms?.[recentKey(item)]);

function notificationBellIcon(muted) {
  return muted
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 18H4a1 1 0 0 1-.78-1.63A9 9 0 0 0 6 10"/><path d="M6.26 6.26A6 6 0 0 1 18 8c0 .89.07 1.67.2 2.36"/><path d="m2 2 20 20"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/></svg>';
}

function loadRecentReadState() {
  try {
    const unread = JSON.parse(localStorage.getItem(RECENT_UNREAD_STORAGE_KEY) || '[]');
    const known = JSON.parse(localStorage.getItem(RECENT_KNOWN_STORAGE_KEY) || '{}');
    state.unreadRecentKeys = new Set(Array.isArray(unread) ? unread.filter((key) => typeof key === 'string') : []);
    state.knownRecentIds = new Map(Object.entries(known));
  } catch {
    state.unreadRecentKeys = new Set();
    state.knownRecentIds = new Map();
  }
}

function saveRecentReadState() {
  try {
    localStorage.setItem(RECENT_UNREAD_STORAGE_KEY, JSON.stringify([...state.unreadRecentKeys]));
    localStorage.setItem(RECENT_KNOWN_STORAGE_KEY, JSON.stringify(Object.fromEntries(state.knownRecentIds)));
  } catch {
    // The unread UI still works for the current app session if local storage is unavailable.
  }
}

function recentIsBeingRead(key) {
  return state.activeTab === 'recent' && state.expandedRecentKey === key
    && document.visibilityState === 'visible' && document.hasFocus();
}

function updateUnreadRecentUi() {
  const visibleKeys = new Set(state.recent.map(recentKey));
  state.unreadRecentKeys = new Set([...state.unreadRecentKeys].filter((key) => visibleKeys.has(key)));
  const count = state.unreadRecentKeys.size;
  const badge = $('#recent-unread-count');
  badge.textContent = '';
  badge.hidden = count === 0;
  badge.title = count ? `읽지 않은 채팅방 ${count}개` : '';
  $('#recent-mark-all-read').disabled = count === 0;
  $('#recent-mark-all-read').title = count ? `읽지 않은 채팅방 ${count}개 모두 확인` : '읽지 않은 채팅이 없습니다';
}

function markRecentRead(key) {
  if (!state.unreadRecentKeys.delete(key)) return;
  saveRecentReadState();
  updateUnreadRecentUi();
}

function markAllRecentRead() {
  if (!state.unreadRecentKeys.size) return;
  state.unreadRecentKeys.clear();
  saveRecentReadState();
  renderRecent();
}

function reconcileRecentReadState(items) {
  const hadBaseline = state.knownRecentIds.size > 0;
  items.forEach((item) => {
    const key = recentKey(item);
    const messageId = String(item.id);
    const knownId = state.knownRecentIds.get(key);
    if (hadBaseline && knownId && knownId !== messageId && !recentIsBeingRead(key)) {
      state.unreadRecentKeys.add(key);
    }
    state.knownRecentIds.set(key, messageId);
  });
  saveRecentReadState();
}

function recentPreviewHtml(item) {
  const key = recentKey(item);
  if (state.recentPreviewLoading.has(key)) {
    return '<div class="recent-preview-state"><span></span>채팅을 불러오는 중…</div>';
  }
  const preview = state.recentPreviews.get(key);
  if (!preview) return '';
  if (preview.error) return '<div class="recent-preview-state error-copy">채팅을 불러오지 못했습니다. 다시 눌러 주세요.</div>';
  const messages = [...preview.messages]
    .sort((left, right) => String(left.sent_at).localeCompare(String(right.sent_at))
      || String(left.id).localeCompare(String(right.id)))
    .slice(-8);
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
    <article class="recent-group${state.expandedRecentKey === recentKey(item) ? ' expanded' : ''}${state.unreadRecentKeys.has(recentKey(item)) ? ' unread' : ''}" data-key="${recentKey(item)}">
      <div class="recent-summary" data-key="${recentKey(item)}" role="button" tabindex="0" aria-expanded="${state.expandedRecentKey === recentKey(item)}">
        ${avatar(item, 'target_')}
        <span class="card-copy"><span class="card-title"><strong>${escapeHtml(item.target_name)}</strong>${state.unreadRecentKeys.has(recentKey(item)) ? '<i class="recent-unread-dot" title="읽지 않은 새 채팅" aria-label="읽지 않은 새 채팅"></i>' : ''}${item.source === 'donation' ? '<i class="donation-pill">후원</i>' : ''}</span><small class="recent-channel-row"><span>${escapeHtml(item.channel_name)}${markHtml(item)}의 방송에서</span><button class="recent-channel-link" data-url="${escapeHtml(liveUrl(item.channel_id))}" type="button" title="CHZZK 라이브 채널 열기" aria-label="${escapeHtml(item.channel_name)} CHZZK 라이브 채널 열기">↗</button>${recentSessionStatusHtml(item.status)}</small>${state.expandedRecentKey === recentKey(item) ? '' : `<b>“${escapeHtml(item.content)}”</b>`}</span>
        <span class="recent-meta"><button class="recent-notification-button${recentNotificationMuted(item) ? ' muted' : ''}" data-session-id="${escapeHtml(item.session_id)}" data-target-uid="${escapeHtml(item.target_uid)}" data-state="${recentNotificationMuted(item) ? 'muted' : 'active'}" type="button" title="${recentNotificationMuted(item) ? '알림 켜기' : '알림 끄기'}" aria-label="${escapeHtml(item.target_name)} ${recentNotificationMuted(item) ? '채팅방 알림 켜기' : '채팅방 알림 끄기'}">${notificationBellIcon(recentNotificationMuted(item))}</button><time>${formatDate(item.sent_at)}<br />${formatTime(item.sent_at)}</time><i>⌄</i></span>
      </div>
      ${state.expandedRecentKey === recentKey(item) ? `<div class="recent-preview">${recentPreviewHtml(item)}</div>` : ''}
    </article>`).join('') : `<div class="empty"><span>…</span><strong>최근 채팅이 없습니다</strong></div>`;
  bindRecentControls();
  updateUnreadRecentUi();
}

function selectedMember() {
  return state.streamers.find((member) => member.uid === state.selectedMemberUid);
}

function renderMemberSelector() {
  const select = $('#member-chat-select');
  if (!state.selectedMemberUid || !state.streamers.some((member) => member.uid === state.selectedMemberUid)) {
    state.selectedMemberUid = state.streamers[0]?.uid || '';
  }
  select.innerHTML = state.streamers.map((member) => `
    <option value="${escapeHtml(member.uid)}"${member.uid === state.selectedMemberUid ? ' selected' : ''}>${escapeHtml(member.name)}</option>
  `).join('');
  const member = selectedMember();
  $('#member-chat-heading').textContent = member ? `${member.name}의 채팅방` : '멤버별 채팅';
}

function memberSessionPreviewHtml(session) {
  const key = session.id;
  if (state.memberPreviewLoading.has(key)) {
    return '<div class="recent-preview-state"><span></span>채팅을 불러오는 중…</div>';
  }
  const preview = state.memberPreviews.get(key);
  if (!preview) return '';
  if (preview.error) return '<div class="recent-preview-state error-copy">채팅을 불러오지 못했습니다. 다시 눌러 주세요.</div>';
  const messages = [...preview.messages]
    .sort((left, right) => String(left.sent_at).localeCompare(String(right.sent_at))
      || String(left.id).localeCompare(String(right.id)))
    .slice(-20);
  const messageHtml = messages.length ? messages.map((message) => `
    <div class="preview-message">
      <span>${message.source === 'donation' ? '<i class="donation-pill">후원</i>' : ''}${escapeHtml(message.content)}</span>
      <time>${formatTime(message.sent_at)}</time>
    </div>`).join('') : '<div class="recent-preview-state">표시할 채팅이 없습니다.</div>';
  const member = selectedMember();
  return `${messageHtml}
    <button class="recent-more member-chat-more" data-url="${memberUrl(member?.initials)}" type="button">웹사이트에서 전체 기록 보기 <span>→</span></button>`;
}

function renderMemberSessions() {
  renderMemberSelector();
  const list = $('#member-chat-list');
  if (state.memberSessionsLoading) {
    list.innerHTML = '<div class="member-chat-state"><span></span>채팅방 기록을 불러오는 중…</div>';
    return;
  }
  if (state.memberSessionsError) {
    list.innerHTML = `<div class="member-chat-state error-copy">${escapeHtml(state.memberSessionsError)}<button id="member-chat-retry" type="button">다시 시도</button></div>`;
    $('#member-chat-retry').addEventListener('click', () => loadMemberSessions(state.selectedMemberUid, true));
    return;
  }
  const member = selectedMember();
  list.innerHTML = state.memberSessions.length ? state.memberSessions.map((session) => {
    const expanded = state.expandedMemberSessionId === session.id;
    const channelAvatar = {
      avatar_url: session.channel_avatar_url,
      color: member?.color || '#788CE2',
      initials: session.channel_name?.slice(0, 2) || '?',
    };
    return `<article class="recent-group member-session-group${expanded ? ' expanded' : ''}" data-session-id="${session.id}">
      <div class="recent-summary member-session-summary" data-session-id="${session.id}" role="button" tabindex="0" aria-expanded="${expanded}">
        ${avatar(channelAvatar)}
        <span class="card-copy"><span class="card-title"><strong>${escapeHtml(session.channel_name)}</strong>${session.status === 'OPEN' ? '<i class="live-pill">LIVE</i>' : ''}</span><small class="recent-channel-row"><span>${escapeHtml(session.title || '방송 제목 없음')}</span><button class="recent-channel-link member-channel-link" data-url="${escapeHtml(liveUrl(session.channel_id))}" type="button" title="CHZZK 라이브 채널 열기" aria-label="${escapeHtml(session.channel_name)} CHZZK 라이브 채널 열기">↗</button></small>${expanded ? '' : `<b>“${escapeHtml(session.latest)}”</b>`}</span>
        <span class="member-session-meta"><small>${Number(session.message_count || 0).toLocaleString()}개</small><time>${formatDate(session.last_chat_at)}<br />${formatTime(session.last_chat_at)}</time><i>⌄</i></span>
      </div>
      ${expanded ? `<div class="recent-preview">${memberSessionPreviewHtml(session)}</div>` : ''}
    </article>`;
  }).join('') : '<div class="empty"><span>…</span><strong>이 멤버의 채팅 기록이 없습니다</strong><p>채팅이 수집되면 채팅방별로 표시됩니다.</p></div>';
  bindMemberSessionControls();
}

async function loadMemberSessions(uid, force = false, background = false) {
  if (!uid || (!force && state.memberSessions.length && state.selectedMemberUid === uid)) return;
  if (background && state.memberSessionsLoading) return;
  const requestId = ++state.memberRequestId;
  if (!background) {
    state.memberSessionsLoading = true;
    state.memberSessionsError = '';
    renderMemberSessions();
  }
  let shouldRender = false;
  try {
    const sessions = await window.stelchat.memberSessions(uid);
    if (requestId !== state.memberRequestId || uid !== state.selectedMemberUid) return;
    shouldRender = !background || JSON.stringify(state.memberSessions) !== JSON.stringify(sessions);
    state.memberSessions = sessions;
    state.memberSessionsError = '';
  } catch {
    if (requestId !== state.memberRequestId || uid !== state.selectedMemberUid) return;
    if (!background) {
      state.memberSessions = [];
      state.memberSessionsError = '채팅방 기록을 불러오지 못했습니다.';
      shouldRender = true;
    }
  } finally {
    if (requestId === state.memberRequestId && uid === state.selectedMemberUid) {
      if (!background) state.memberSessionsLoading = false;
      if (shouldRender) renderMemberSessions();
    }
  }
}

async function expandMemberSession(session) {
  state.expandedMemberSessionId = session.id;
  renderMemberSessions();
  if (state.memberPreviewLoading.has(session.id)) return;
  if (state.memberPreviews.has(session.id) && !state.memberPreviews.get(session.id).error) return;
  state.memberPreviews.delete(session.id);
  state.memberPreviewLoading.add(session.id);
  renderMemberSessions();
  try {
    const preview = await window.stelchat.sessionPreview(session.id, state.selectedMemberUid);
    state.memberPreviews.set(session.id, { messages: preview.messages || [] });
  } catch {
    state.memberPreviews.set(session.id, { messages: [], error: true });
  } finally {
    state.memberPreviewLoading.delete(session.id);
    if (state.expandedMemberSessionId === session.id) renderMemberSessions();
  }
}

function bindMemberSessionControls() {
  document.querySelectorAll('.member-session-summary').forEach((element) => {
    const toggle = () => {
      const sessionId = Number(element.dataset.sessionId);
      if (state.expandedMemberSessionId === sessionId) {
        state.expandedMemberSessionId = null;
        renderMemberSessions();
      } else {
        const session = state.memberSessions.find((item) => item.id === sessionId);
        if (session) void expandMemberSession(session);
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
  document.querySelectorAll('.member-channel-link').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      window.stelchat.openUrl(element.dataset.url);
    });
  });
  document.querySelectorAll('.member-chat-more').forEach((element) => {
    element.addEventListener('click', () => window.stelchat.openUrl(element.dataset.url));
  });
}

function findRecent(key) {
  return state.recent.find((item) => recentKey(item) === key);
}

function updateRecentSessionStatus(payload) {
  let changed = false;
  state.recent.forEach((item) => {
    if (item.session_id !== payload.session_id || item.status === payload.status) return;
    item.status = payload.status;
    changed = true;
  });
  if (changed) renderRecent();
  return changed;
}

async function expandRecent(item) {
  const key = recentKey(item);
  state.expandedRecentKey = key;
  markRecentRead(key);
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
  document.querySelectorAll('.recent-notification-button').forEach((element) => {
    element.addEventListener('click', async (event) => {
      event.stopPropagation();
      const item = findRecent(`${element.dataset.sessionId}:${element.dataset.targetUid}`);
      if (!item) return;
      applySettings(await window.stelchat.setChatRoomMuted(
        item.session_id, item.target_uid, !recentNotificationMuted(item),
      ));
      renderRecent();
    });
  });
}

function bindOpenLinks() {
  document.querySelectorAll('.open-member, .live-channel-link').forEach((element) => {
    element.addEventListener('click', () => window.stelchat.openUrl(element.dataset.url));
  });
}

function render() {
  renderLive();
  renderRecent();
  bindOpenLinks();
}

function memberNotificationPreference(uid) {
  const stored = state.settings.notificationPreferences?.[uid];
  return {
    desktop: { live: Boolean(stored?.desktop?.live), chat: Boolean(stored?.desktop?.chat) },
    sound: { live: Boolean(stored?.sound?.live), chat: Boolean(stored?.sound?.chat) },
  };
}

function memberNotificationEnabled(uid, channel, eventType) {
  return Boolean(memberNotificationPreference(uid)[channel][eventType]);
}

function allNotificationsEnabled(channel, eventType) {
  return state.streamers.length > 0 && state.streamers.every((member) => (
    memberNotificationEnabled(member.uid, channel, eventType)
  ));
}

function renderNotificationSettings() {
  const desktopCount = state.streamers.filter((member) => {
    const preference = memberNotificationPreference(member.uid);
    return preference.desktop.live || preference.desktop.chat;
  }).length;
  const soundCount = state.streamers.filter((member) => {
    const preference = memberNotificationPreference(member.uid);
    return preference.sound.live || preference.sound.chat;
  }).length;
  $('#notification-summary').textContent = `Windows ${desktopCount}명 · 소리 ${soundCount}명`;
  $('#notification-member-list').innerHTML = state.streamers.map((member) => `
    <article class="notification-member">
      <header class="notification-member-head"><span class="notification-member-copy">${avatar(member)}<strong>${escapeHtml(member.name)}</strong></span><b>Windows</b><b>소리</b></header>
      <div class="notification-matrix">
        <span>방송 시작</span>
        <input type="checkbox" aria-label="${escapeHtml(member.name)} 방송 시작 Windows 알림" data-notification-uid="${escapeHtml(member.uid)}" data-notification-channel="desktop" data-notification-event="live" ${memberNotificationEnabled(member.uid, 'desktop', 'live') ? 'checked' : ''} />
        <input type="checkbox" aria-label="${escapeHtml(member.name)} 방송 시작 소리 알림" data-notification-uid="${escapeHtml(member.uid)}" data-notification-channel="sound" data-notification-event="live" ${memberNotificationEnabled(member.uid, 'sound', 'live') ? 'checked' : ''} />
        <span>새 채팅</span>
        <input type="checkbox" aria-label="${escapeHtml(member.name)} 새 채팅 Windows 알림" data-notification-uid="${escapeHtml(member.uid)}" data-notification-channel="desktop" data-notification-event="chat" ${memberNotificationEnabled(member.uid, 'desktop', 'chat') ? 'checked' : ''} />
        <input type="checkbox" aria-label="${escapeHtml(member.name)} 새 채팅 소리 알림" data-notification-uid="${escapeHtml(member.uid)}" data-notification-channel="sound" data-notification-event="chat" ${memberNotificationEnabled(member.uid, 'sound', 'chat') ? 'checked' : ''} />
      </div>
    </article>`).join('');
  document.querySelectorAll('[data-notification-uid]').forEach((input) => {
    input.addEventListener('change', async (event) => {
      applySettings(await window.stelchat.setMemberNotification(
        event.target.dataset.notificationUid,
        event.target.dataset.notificationChannel,
        event.target.dataset.notificationEvent,
        event.target.checked,
      ));
    });
  });
  document.querySelectorAll('[data-notification-bulk]').forEach((button) => {
    const channel = button.dataset.notificationChannel;
    const eventType = button.dataset.notificationEvent;
    const enabled = allNotificationsEnabled(channel, eventType);
    button.classList.toggle('enabled', enabled);
    button.querySelector('small').textContent = enabled ? '모두 끄기' : '모두 켜기';
  });
}

let notificationAudioContext;

async function playNotificationSound(type) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  notificationAudioContext ||= new AudioContextClass();
  if (notificationAudioContext.state === 'suspended') {
    try {
      await notificationAudioContext.resume();
    } catch {
      return;
    }
  }
  const volume = Math.min(1, Math.max(0, Number(state.settings.notificationVolume ?? 0.7)));
  if (volume === 0) return;
  const notes = type === 'live' ? [660, 880] : [760];
  const now = notificationAudioContext.currentTime;
  notes.forEach((frequency, index) => {
    const start = now + index * 0.14;
    const oscillator = notificationAudioContext.createOscillator();
    const gain = notificationAudioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.4 * volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
    oscillator.connect(gain).connect(notificationAudioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.13);
  });
}

function applySettings(settings) {
  state.settings = settings;
  document.documentElement.dataset.theme = settings.darkMode ? 'dark' : 'light';
  $('#always-on-top').checked = Boolean(settings.alwaysOnTop);
  $('#always-on-top').disabled = Boolean(settings.desktopMode);
  $('#desktop-mode').checked = Boolean(settings.desktopMode);
  $('#desktop-button').classList.toggle('enabled', Boolean(settings.desktopMode));
  $('#dark-mode').checked = Boolean(settings.darkMode);
  $('#launch-at-login').checked = Boolean(settings.launchAtLogin);
  const opacityPercent = Math.round((Number(settings.opacity) || 1) * 100);
  $('#window-opacity').value = opacityPercent;
  $('#window-opacity-value').textContent = `${opacityPercent}%`;
  const notificationVolumePercent = Math.round(Number(settings.notificationVolume ?? 0.7) * 100);
  $('#notification-volume').value = notificationVolumePercent;
  $('#notification-volume-value').textContent = `${notificationVolumePercent}%`;
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
    reconcileRecentReadState(data.recent);
    state.streamers = data.streamers;
    state.recent = data.recent;
    if (!silent || streamersChanged) renderMemberSelector();
    applySettings(data.settings);
    updateConnection(data.connection || { connected: false, state: 'connecting' });
    if (!silent || streamersChanged) renderLive();
    if (!silent || recentChanged) renderRecent();
    if (state.activeTab === 'member' && state.selectedMemberUid) {
      void loadMemberSessions(state.selectedMemberUid, true, silent);
    }
    if (!silent || streamersChanged || recentChanged) bindOpenLinks();
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
  if (state.activeTab === 'member' && state.selectedMemberUid && !state.memberSessions.length) {
    void loadMemberSessions(state.selectedMemberUid);
  }
}));

$('#member-chat-select').addEventListener('change', (event) => {
  state.selectedMemberUid = event.target.value;
  state.memberSessions = [];
  state.memberSessionsError = '';
  state.expandedMemberSessionId = null;
  state.memberPreviews.clear();
  state.memberPreviewLoading.clear();
  void loadMemberSessions(state.selectedMemberUid, true);
});

$('#recent-mark-all-read').addEventListener('click', markAllRecentRead);

$('#refresh-button').addEventListener('click', () => load(true));
$('#retry-button').addEventListener('click', () => load(true));
$('#desktop-button').addEventListener('click', async () => applySettings(await window.stelchat.setSetting('desktopMode', !state.settings.desktopMode)));
$('#open-site').addEventListener('click', () => window.stelchat.openUrl(`${API_BASE}/`));
$('#footer-site').addEventListener('click', () => window.stelchat.openUrl(`${API_BASE}/`));
$('#settings-button').addEventListener('click', () => { $('#settings-panel').classList.add('open'); $('#settings-panel').setAttribute('aria-hidden', 'false'); });
$('#settings-close').addEventListener('click', () => { $('#notification-settings-panel').classList.remove('open'); $('#notification-settings-panel').setAttribute('aria-hidden', 'true'); $('#settings-panel').classList.remove('open'); $('#settings-panel').setAttribute('aria-hidden', 'true'); });
$('#notification-settings-open').addEventListener('click', () => { $('#notification-settings-panel').classList.add('open'); $('#notification-settings-panel').setAttribute('aria-hidden', 'false'); });
$('#notification-settings-back').addEventListener('click', () => { $('#notification-settings-panel').classList.remove('open'); $('#notification-settings-panel').setAttribute('aria-hidden', 'true'); });
$('#notifications-all-on').addEventListener('click', async () => applySettings(await window.stelchat.setAllMemberNotifications(null, null, true)));
$('#notifications-all-off').addEventListener('click', async () => applySettings(await window.stelchat.setAllMemberNotifications(null, null, false)));
$('#notification-sound-test').addEventListener('click', () => playNotificationSound('live'));
document.querySelectorAll('[data-notification-bulk]').forEach((button) => {
  button.addEventListener('click', async () => {
    const channel = button.dataset.notificationChannel;
    const eventType = button.dataset.notificationEvent;
    applySettings(await window.stelchat.setAllMemberNotifications(
      channel, eventType, !allNotificationsEnabled(channel, eventType),
    ));
  });
});

for (const [id, key] of [['desktop-mode', 'desktopMode'], ['always-on-top', 'alwaysOnTop'], ['dark-mode', 'darkMode'], ['launch-at-login', 'launchAtLogin']]) {
  $(`#${id}`).addEventListener('change', async (event) => applySettings(await window.stelchat.setSetting(key, event.target.checked)));
}

$('#window-opacity').addEventListener('input', async (event) => {
  const opacity = Number(event.target.value) / 100;
  $('#window-opacity-value').textContent = `${event.target.value}%`;
  applySettings(await window.stelchat.setSetting('opacity', opacity));
});

$('#notification-volume').addEventListener('input', async (event) => {
  const volume = Number(event.target.value) / 100;
  $('#notification-volume-value').textContent = `${event.target.value}%`;
  applySettings(await window.stelchat.setSetting('notificationVolume', volume));
});

window.stelchat.onConnection(updateConnection);
window.stelchat.onSettings(applySettings);
window.stelchat.onNotificationSound(({ type }) => playNotificationSound(type));
window.stelchat.onEvent(({ eventName, payload }) => {
  if (eventName === 'chat') {
    if (state.recent.some((item) => item.id === payload.id)) return;
    const key = recentKey(payload);
    state.knownRecentIds.set(key, String(payload.id));
    if (!recentIsBeingRead(key)) state.unreadRecentKeys.add(key);
    saveRecentReadState();
    state.recent = [payload, ...state.recent.filter((item) => recentKey(item) !== key)].slice(0, 20);
    const preview = state.recentPreviews.get(key);
    if (preview && !preview.error && !preview.messages.some((message) => message.id === payload.id)) {
      preview.messages = [...preview.messages, payload].sort((left, right) => left.sent_at.localeCompare(right.sent_at)).slice(-20);
    }
    renderRecent();
    if (payload.target_uid === state.selectedMemberUid && state.memberSessions.length) {
      const existing = state.memberSessions.find((session) => session.id === payload.session_id);
      if (existing) {
        existing.latest = payload.content;
        existing.latest_source = payload.source;
        existing.last_chat_at = payload.sent_at;
        existing.latest_id = payload.id;
        existing.latest_message_id = payload.id;
        existing.message_count = Number(existing.message_count || 0) + 1;
        state.memberSessions = [existing, ...state.memberSessions.filter((session) => session.id !== existing.id)];
      } else {
        state.memberSessions = [{
          id: payload.session_id,
          title: payload.title || '',
          status: payload.was_live ? 'OPEN' : 'CLOSE',
          channel_id: payload.channel_id,
          channel_name: payload.channel_name,
          channel_avatar_url: payload.channel_avatar_url,
          message_count: 1,
          last_chat_at: payload.sent_at,
          latest_id: payload.id,
          latest_message_id: payload.id,
          latest: payload.content,
          latest_source: payload.source,
        }, ...state.memberSessions].slice(0, 50);
      }
      const preview = state.memberPreviews.get(payload.session_id);
      if (preview && !preview.error && !preview.messages.some((message) => message.id === payload.id)) {
        preview.messages = [...preview.messages, payload]
          .sort((left, right) => left.sent_at.localeCompare(right.sent_at)).slice(-20);
      }
      renderMemberSessions();
    }
  } else if (eventName === 'session') {
    updateRecentSessionStatus(payload);
    const member = state.streamers.find((item) => item.uid === payload.target_uid || item.uid === payload.channel_id);
    if (member) {
      member.is_live = payload.status === 'OPEN';
      member.live_opened_at = payload.opened_at;
      member.live_title = payload.title;
      member.live_category = payload.live_category;
      renderLive();
      bindOpenLinks();
    }
    const memberSession = state.memberSessions.find((session) => session.id === payload.session_id);
    if (memberSession) {
      memberSession.status = payload.status;
      memberSession.title = payload.title || memberSession.title;
      memberSession.live_category = payload.live_category || memberSession.live_category;
      renderMemberSessions();
    }
  }
});

window.addEventListener('focus', () => {
  if (state.expandedRecentKey) markRecentRead(state.expandedRecentKey);
});

setInterval(() => {
  document.querySelectorAll('[data-opened-at]').forEach((element) => { element.textContent = uptime(element.dataset.openedAt); });
}, 1000);
setInterval(() => load(true, true), 60000);
loadRecentReadState();
load();
