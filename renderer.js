const API_BASE = 'https://stelchat.xyz';
const state = {
  streamers: [], recent: [], settings: {}, activeTab: 'live',
  versionStatus: null, acknowledgedUpdateVersion: '',
  recentRevision: 0, recentKeyRevisions: new Map(),
  streamerRevision: 0, streamerKeyRevisions: new Map(),
  expandedRecentKey: '',
  recentPreviews: new Map(), recentPreviewLoading: new Set(), recentPreviewRequests: new Map(),
  unreadRecentKeys: new Set(), knownRecentIds: new Map(), recentBaselineReady: false,
  selectedMemberUid: '', memberSessions: [], memberSessionsLoading: false,
  memberSessionsLoadedUid: '',
  memberSessionsError: '', expandedMemberSessionId: null,
  memberPreviews: new Map(), memberPreviewLoading: new Set(), memberPreviewRequests: new Map(),
  memberRequestId: 0, previewRequestId: 0,
  memberSessionRevision: 0, memberSessionKeyRevisions: new Map(),
  snapshotRequestId: 0, lastAppliedSnapshotRequestId: 0,
  latestForegroundRequestId: 0,
};

const RECENT_UNREAD_STORAGE_KEY = 'stelchat-unread-recent-keys';
const RECENT_KNOWN_STORAGE_KEY = 'stelchat-known-recent-ids';
const RECENT_BASELINE_STORAGE_KEY = 'stelchat-recent-baseline-ready';

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

const { memberPreviewKey, recentKey } = window.stelchatRendererState;
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
    state.recentBaselineReady = localStorage.getItem(RECENT_BASELINE_STORAGE_KEY) === 'true'
      || state.knownRecentIds.size > 0;
  } catch {
    state.unreadRecentKeys = new Set();
    state.knownRecentIds = new Map();
    state.recentBaselineReady = false;
  }
}

function saveRecentReadState() {
  try {
    localStorage.setItem(RECENT_UNREAD_STORAGE_KEY, JSON.stringify([...state.unreadRecentKeys]));
    localStorage.setItem(RECENT_KNOWN_STORAGE_KEY, JSON.stringify(Object.fromEntries(state.knownRecentIds)));
    localStorage.setItem(RECENT_BASELINE_STORAGE_KEY, String(state.recentBaselineReady));
  } catch {
    // The unread UI still works for the current app session if local storage is unavailable.
  }
}

function recentIsBeingRead(key) {
  return state.activeTab === 'recent' && state.expandedRecentKey === key
    && document.visibilityState === 'visible' && document.hasFocus();
}

function updateUnreadRecentUi() {
  const count = state.unreadRecentKeys.size;
  const badge = $('#recent-unread-count');
  badge.textContent = '';
  badge.hidden = count === 0;
  badge.title = count ? `읽지 않은 채팅방 ${count}개` : '';
  $('#recent-mark-all-read').disabled = count === 0;
  $('#recent-mark-all-read').title = count ? `읽지 않은 채팅방 ${count}개 모두 확인` : '읽지 않은 채팅이 없습니다';
}

function markRecentRead(key, rerender = false) {
  if (!state.unreadRecentKeys.delete(key)) return;
  saveRecentReadState();
  if (rerender) renderRecent();
  else updateUnreadRecentUi();
}

function markAllRecentRead() {
  if (!state.unreadRecentKeys.size) return;
  state.unreadRecentKeys.clear();
  saveRecentReadState();
  renderRecent();
}

function reconcileRecentReadState(items) {
  const reconciled = window.stelchatRendererState.reconcileRecentReadState(
    items, state.knownRecentIds, state.unreadRecentKeys, {
      baselineReady: state.recentBaselineReady,
      isBeingRead: recentIsBeingRead,
    },
  );
  state.knownRecentIds = reconciled.knownIds;
  state.unreadRecentKeys = reconciled.unreadKeys;
  state.recentBaselineReady = reconciled.baselineReady;
  saveRecentReadState();
}

function reconcileRealtimeChatReadState(item) {
  const reconciled = window.stelchatRendererState.reconcileRecentReadState(
    [item], state.knownRecentIds, state.unreadRecentKeys, {
      baselineReady: state.recentBaselineReady,
      establishBaseline: false,
      markBeforeBaseline: true,
      isBeingRead: recentIsBeingRead,
    },
  );
  state.knownRecentIds = reconciled.knownIds;
  state.unreadRecentKeys = reconciled.unreadKeys;
  state.recentBaselineReady = reconciled.baselineReady;
  saveRecentReadState();
}

function memberPreviewStateKey(sessionId, uid = state.selectedMemberUid) {
  return memberPreviewKey(sessionId, uid);
}

function memberSessionStateKey(sessionId, uid = state.selectedMemberUid) {
  return `${sessionId}:${uid}`;
}

function invalidateRecentPreview(key) {
  state.recentPreviews.delete(key);
  state.recentPreviewLoading.delete(key);
  state.recentPreviewRequests.delete(key);
}

function invalidateMemberPreview(key) {
  state.memberPreviews.delete(key);
  state.memberPreviewLoading.delete(key);
  state.memberPreviewRequests.delete(key);
}

function rememberRevision(map, key, revision, limit = 500) {
  map.delete(key);
  map.set(key, revision);
  while (map.size > limit) {
    map.delete(map.keys().next().value);
  }
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
    .sort(window.stelchatRealtimeMerge.compareMessageOrder)
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
  const key = memberPreviewStateKey(session.id);
  if (state.memberPreviewLoading.has(key)) {
    return '<div class="recent-preview-state"><span></span>채팅을 불러오는 중…</div>';
  }
  const preview = state.memberPreviews.get(key);
  if (!preview) return '';
  if (preview.error) return '<div class="recent-preview-state error-copy">채팅을 불러오지 못했습니다. 다시 눌러 주세요.</div>';
  const messages = [...preview.messages]
    .sort(window.stelchatRealtimeMerge.compareMessageOrder)
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
  if (!uid || (!force && state.memberSessionsLoadedUid === uid)) return;
  if (background && state.memberSessionsLoading) return;
  const requestId = ++state.memberRequestId;
  const memberRevisionAtStart = state.memberSessionRevision;
  if (!background) {
    state.memberSessionsLoading = true;
    state.memberSessionsError = '';
    renderMemberSessions();
  }
  let shouldRender = false;
  let previewToRefresh = null;
  try {
    const sessions = await window.stelchat.memberSessions(uid);
    if (requestId !== state.memberRequestId || uid !== state.selectedMemberUid) return;
    const preserveSessionIds = new Set([...state.memberSessionKeyRevisions]
      .filter(([key, revision]) => key.endsWith(`:${uid}`) && revision > memberRevisionAtStart)
      .map(([key]) => Number(key.slice(0, key.indexOf(':')))));
    const mergedSessions = window.stelchatRealtimeMerge.mergeMemberSessionSnapshot(
      sessions, state.memberSessions, preserveSessionIds,
    );
    for (const session of mergedSessions) {
      const previous = state.memberSessions.find((item) => item.id === session.id);
      const key = memberPreviewStateKey(session.id, uid);
      const changedWhileDisconnected = previous
        && String(previous.latest_id || '') !== String(session.latest_id || '')
        && !preserveSessionIds.has(Number(session.id));
      if (changedWhileDisconnected && state.memberPreviews.has(key)) {
        invalidateMemberPreview(key);
        if (state.expandedMemberSessionId === session.id) previewToRefresh = session;
      }
    }
    shouldRender = !background || JSON.stringify(state.memberSessions) !== JSON.stringify(mergedSessions);
    state.memberSessions = mergedSessions;
    state.memberSessionsLoadedUid = uid;
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
      if (previewToRefresh) void expandMemberSession(previewToRefresh);
    }
  }
}

async function expandMemberSession(session) {
  const targetUid = state.selectedMemberUid;
  const key = memberPreviewStateKey(session.id, targetUid);
  state.expandedMemberSessionId = session.id;
  renderMemberSessions();
  if (state.memberPreviewLoading.has(key)) return;
  if (state.memberPreviews.has(key) && !state.memberPreviews.get(key).error) return;
  state.memberPreviews.delete(key);
  state.memberPreviewLoading.add(key);
  state.memberPreviews.set(key, { messages: [] });
  const requestToken = ++state.previewRequestId;
  state.memberPreviewRequests.set(key, requestToken);
  renderMemberSessions();
  try {
    const preview = await window.stelchat.sessionPreview(session.id, targetUid);
    if (targetUid !== state.selectedMemberUid
        || state.memberPreviewRequests.get(key) !== requestToken) return;
    const realtimeMessages = state.memberPreviews.get(key)?.messages || [];
    state.memberPreviews.set(key, {
      messages: window.stelchatRealtimeMerge.mergePreviewMessages(
        preview.messages, realtimeMessages,
      ),
    });
  } catch {
    if (targetUid === state.selectedMemberUid
        && state.memberPreviewRequests.get(key) === requestToken) {
      const realtimeMessages = state.memberPreviews.get(key)?.messages || [];
      state.memberPreviews.set(key, realtimeMessages.length
        ? { messages: realtimeMessages } : { messages: [], error: true });
    }
  } finally {
    if (state.memberPreviewRequests.get(key) !== requestToken) return;
    state.memberPreviewRequests.delete(key);
    state.memberPreviewLoading.delete(key);
    if (targetUid === state.selectedMemberUid && state.expandedMemberSessionId === session.id) {
      renderMemberSessions();
    }
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
  state.recentPreviews.set(key, { messages: [] });
  const requestToken = ++state.previewRequestId;
  state.recentPreviewRequests.set(key, requestToken);
  renderRecent();
  try {
    const preview = await window.stelchat.sessionPreview(item.session_id, item.target_uid);
    if (state.recentPreviewRequests.get(key) !== requestToken) return;
    const realtimeMessages = state.recentPreviews.get(key)?.messages || [];
    state.recentPreviews.set(key, {
      messages: window.stelchatRealtimeMerge.mergePreviewMessages(
        preview.messages, realtimeMessages,
      ),
    });
  } catch {
    if (state.recentPreviewRequests.get(key) !== requestToken) return;
    const realtimeMessages = state.recentPreviews.get(key)?.messages || [];
    state.recentPreviews.set(key, realtimeMessages.length
      ? { messages: realtimeMessages } : { messages: [], error: true });
  } finally {
    if (state.recentPreviewRequests.get(key) !== requestToken) return;
    state.recentPreviewRequests.delete(key);
    state.recentPreviewLoading.delete(key);
    if (state.expandedRecentKey === key) renderRecent();
  }
}

function bindRecentControls() {
  const root = $('#recent-list');
  root.querySelectorAll('.recent-summary').forEach((element) => {
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
  root.querySelectorAll('.recent-channel-link').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      window.stelchat.openUrl(element.dataset.url);
    });
  });
  root.querySelectorAll('.recent-more').forEach((element) => {
    element.addEventListener('click', () => window.stelchat.openUrl(element.dataset.url));
  });
  root.querySelectorAll('.recent-notification-button').forEach((element) => {
    element.addEventListener('click', async (event) => {
      event.stopPropagation();
      const item = findRecent(`${element.dataset.sessionId}:${element.dataset.targetUid}`);
      if (!item) return;
      await applySettingsUpdate(() => window.stelchat.setChatRoomMuted(
        item.session_id, item.target_uid, !recentNotificationMuted(item),
      ));
      renderRecent();
    });
  });
}

function bindOpenLinks() {
  document.querySelectorAll('.open-member, .live-channel-link').forEach((element) => {
    if (element.dataset.openLinkBound === 'true') return;
    element.dataset.openLinkBound = 'true';
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
      await applySettingsUpdate(() => window.stelchat.setMemberNotification(
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

let settingsErrorTimer;
function showSettingsError() {
  const element = $('#settings-error');
  element.hidden = false;
  clearTimeout(settingsErrorTimer);
  settingsErrorTimer = setTimeout(() => { element.hidden = true; }, 4000);
}

async function applySettingsUpdate(operation) {
  try {
    applySettings(await operation());
    return true;
  } catch {
    applySettings(state.settings);
    showSettingsError();
    return false;
  }
}

async function load(useRefresh = false, silent = false) {
  const requestId = ++state.snapshotRequestId;
  const recentRevisionAtStart = state.recentRevision;
  const streamerRevisionAtStart = state.streamerRevision;
  if (!silent) {
    state.latestForegroundRequestId = requestId;
    $('#loading').hidden = false;
    $('#error').hidden = true;
  }
  try {
    const data = useRefresh ? await window.stelchat.refresh() : await window.stelchat.snapshot();
    if (requestId < state.lastAppliedSnapshotRequestId) return;
    state.lastAppliedSnapshotRequestId = requestId;
    $('#error').hidden = true;
    if (state.latestForegroundRequestId && state.latestForegroundRequestId < requestId) {
      $('#loading').hidden = true;
    }
    const recentPreserveKeys = new Set([...state.recentKeyRevisions]
      .filter(([, revision]) => revision > recentRevisionAtStart)
      .map(([key]) => key));
    const streamerPreserveUids = new Set([...state.streamerKeyRevisions]
      .filter(([, revision]) => revision > streamerRevisionAtStart)
      .map(([uid]) => uid));
    const nextRecent = window.stelchatRealtimeMerge.mergeRecentSnapshot(
      data.recent, state.recent, recentPreserveKeys,
    );
    const nextStreamers = window.stelchatRealtimeMerge.mergeStreamerSnapshot(
      data.streamers, state.streamers, streamerPreserveUids,
    );
    let recentPreviewToRefresh = null;
    for (const item of nextRecent) {
      const key = recentKey(item);
      const previous = findRecent(key);
      const changedWhileDisconnected = previous
        && String(previous.id) !== String(item.id)
        && !recentPreserveKeys.has(key);
      if (changedWhileDisconnected && state.recentPreviews.has(key)) {
        invalidateRecentPreview(key);
        if (state.expandedRecentKey === key) recentPreviewToRefresh = item;
      }
    }
    const streamersChanged = JSON.stringify(state.streamers) !== JSON.stringify(nextStreamers);
    const recentChanged = JSON.stringify(state.recent) !== JSON.stringify(nextRecent);
    reconcileRecentReadState(nextRecent);
    state.streamers = nextStreamers;
    state.recent = nextRecent;
    if (!silent || streamersChanged) renderMemberSelector();
    applySettings(data.settings);
    updateConnection(data.connection || { connected: false, state: 'connecting' });
    if (!silent || streamersChanged) renderLive();
    if (!silent || recentChanged) renderRecent();
    if (state.activeTab === 'member' && state.selectedMemberUid) {
      await loadMemberSessions(state.selectedMemberUid, true, silent);
    }
    if (!silent || streamersChanged) bindOpenLinks();
    if (recentPreviewToRefresh) void expandRecent(recentPreviewToRefresh);
    return true;
  } catch {
    if (!silent && requestId === state.latestForegroundRequestId
        && requestId > state.lastAppliedSnapshotRequestId) $('#error').hidden = false;
    return false;
  } finally {
    if (!silent && requestId === state.latestForegroundRequestId) $('#loading').hidden = true;
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
  if (state.activeTab === 'member' && state.selectedMemberUid
      && state.memberSessionsLoadedUid !== state.selectedMemberUid) {
    void loadMemberSessions(state.selectedMemberUid);
  }
  if (state.activeTab === 'recent' && state.expandedRecentKey && recentIsBeingRead(state.expandedRecentKey)) {
    markRecentRead(state.expandedRecentKey, true);
  }
}));

$('#member-chat-select').addEventListener('change', (event) => {
  state.selectedMemberUid = event.target.value;
  state.memberSessions = [];
  state.memberSessionsLoadedUid = '';
  state.memberSessionsError = '';
  state.expandedMemberSessionId = null;
  state.memberPreviews.clear();
  state.memberPreviewLoading.clear();
  state.memberPreviewRequests.clear();
  void loadMemberSessions(state.selectedMemberUid, true);
});

$('#recent-mark-all-read').addEventListener('click', markAllRecentRead);

$('#refresh-button').addEventListener('click', () => load(true));
$('#retry-button').addEventListener('click', () => load(true));
$('#desktop-button').addEventListener('click', () => applySettingsUpdate(
  () => window.stelchat.setSetting('desktopMode', !state.settings.desktopMode),
));
$('#open-site').addEventListener('click', () => window.stelchat.openUrl(`${API_BASE}/`));
$('#footer-site').addEventListener('click', () => window.stelchat.openUrl(`${API_BASE}/`));
function renderUpdateIndicator() {
  const status = state.versionStatus;
  const showDot = Boolean(status?.updateAvailable && status.latest !== state.acknowledgedUpdateVersion);
  const settingsButton = $('#settings-button');
  settingsButton.classList.toggle('update-available', showDot);
  settingsButton.title = showDot ? '설정 · 최신 버전 있음' : '설정';
  settingsButton.setAttribute('aria-label', settingsButton.title);
}

function applyVersionStatus({ current, latest, updateAvailable, checked, releaseUrl = '' }) {
  if (current) $('#app-version').textContent = `v${current}`;
  if (!checked) return;
  state.versionStatus = { current, latest, updateAvailable, releaseUrl };
  const update = $('#app-update-status');
  $('#app-update-copy').textContent = updateAvailable ? `최신 버전이 존재합니다 · v${latest}` : '';
  $('#app-update-link').hidden = !releaseUrl;
  update.hidden = !updateAvailable;
  renderUpdateIndicator();
}
window.stelchat.appVersionStatus().then(applyVersionStatus).catch(() => {});
window.stelchat.onVersionStatus(applyVersionStatus);
$('#app-update-link').addEventListener('click', () => {
  if (state.versionStatus?.releaseUrl) window.stelchat.openUrl(state.versionStatus.releaseUrl);
});
$('#settings-button').addEventListener('click', () => {
  if (state.versionStatus?.updateAvailable) {
    state.acknowledgedUpdateVersion = state.versionStatus.latest;
    renderUpdateIndicator();
  }
  $('#settings-panel').classList.add('open');
  $('#settings-panel').setAttribute('aria-hidden', 'false');
});
$('#settings-close').addEventListener('click', () => { $('#notification-settings-panel').classList.remove('open'); $('#notification-settings-panel').setAttribute('aria-hidden', 'true'); $('#settings-panel').classList.remove('open'); $('#settings-panel').setAttribute('aria-hidden', 'true'); });
$('#notification-settings-open').addEventListener('click', () => { $('#notification-settings-panel').classList.add('open'); $('#notification-settings-panel').setAttribute('aria-hidden', 'false'); });
$('#notification-settings-back').addEventListener('click', () => { $('#notification-settings-panel').classList.remove('open'); $('#notification-settings-panel').setAttribute('aria-hidden', 'true'); });
$('#notifications-all-on').addEventListener('click', () => applySettingsUpdate(
  () => window.stelchat.setAllMemberNotifications(null, null, true),
));
$('#notifications-all-off').addEventListener('click', () => applySettingsUpdate(
  () => window.stelchat.setAllMemberNotifications(null, null, false),
));
$('#notification-sound-test').addEventListener('click', () => playNotificationSound('live'));
document.querySelectorAll('[data-notification-bulk]').forEach((button) => {
  button.addEventListener('click', async () => {
    const channel = button.dataset.notificationChannel;
    const eventType = button.dataset.notificationEvent;
    await applySettingsUpdate(() => window.stelchat.setAllMemberNotifications(
      channel, eventType, !allNotificationsEnabled(channel, eventType),
    ));
  });
});

for (const [id, key] of [['desktop-mode', 'desktopMode'], ['always-on-top', 'alwaysOnTop'], ['dark-mode', 'darkMode'], ['launch-at-login', 'launchAtLogin']]) {
  $(`#${id}`).addEventListener('change', (event) => applySettingsUpdate(
    () => window.stelchat.setSetting(key, event.target.checked),
  ));
}

const rangeSettingTimers = new Map();
function bindRangeSetting(id, outputId, key) {
  const input = $(`#${id}`);
  const save = () => applySettingsUpdate(
    () => window.stelchat.setSetting(key, Number(input.value) / 100),
  );
  input.addEventListener('input', () => {
    $(`#${outputId}`).textContent = `${input.value}%`;
    clearTimeout(rangeSettingTimers.get(key));
    rangeSettingTimers.set(key, setTimeout(save, 140));
  });
  input.addEventListener('change', () => {
    clearTimeout(rangeSettingTimers.get(key));
    rangeSettingTimers.delete(key);
    void save();
  });
}
bindRangeSetting('window-opacity', 'window-opacity-value', 'opacity');
bindRangeSetting('notification-volume', 'notification-volume-value', 'notificationVolume');

window.stelchat.onConnection(updateConnection);
window.stelchat.onSettings(applySettings);
window.stelchat.onNotificationSound(({ type }) => playNotificationSound(type));
async function resynchronizeAfterEventGap() {
  state.recentPreviews.clear();
  state.recentPreviewLoading.clear();
  state.recentPreviewRequests.clear();
  state.memberPreviews.clear();
  state.memberPreviewLoading.clear();
  state.memberPreviewRequests.clear();
  const recentKeyToRefresh = state.expandedRecentKey;
  const memberSessionIdToRefresh = state.expandedMemberSessionId;
  const synchronized = await load(true, true);
  if (!synchronized) return;
  if (recentKeyToRefresh && state.expandedRecentKey === recentKeyToRefresh) {
    const item = findRecent(recentKeyToRefresh);
    if (item) void expandRecent(item);
  }
  if (memberSessionIdToRefresh && state.expandedMemberSessionId === memberSessionIdToRefresh) {
    const session = state.memberSessions.find((item) => item.id === memberSessionIdToRefresh);
    if (session) void expandMemberSession(session);
  }
}

window.stelchat.onEvent(({ eventName, payload }) => {
  if (eventName === 'ready' || eventName === 'resync') {
    void resynchronizeAfterEventGap();
    return;
  }
  if (eventName === 'chat') {
    const key = recentKey(payload);
    const recentAlreadyHasMessage = state.recent.some(
      (item) => String(item.id) === String(payload.id),
    );
    if (!recentAlreadyHasMessage) {
      const currentRecent = findRecent(key);
      const isLatest = !currentRecent
        || window.stelchatRealtimeMerge.compareMessageOrder(payload, currentRecent) >= 0;
      if (isLatest) {
        state.recentRevision += 1;
        rememberRevision(state.recentKeyRevisions, key, state.recentRevision);
        reconcileRealtimeChatReadState(payload);
        state.recent = window.stelchatRealtimeMerge.mergeRecentSnapshot(
          [payload, ...state.recent.filter((item) => recentKey(item) !== key)],
          [],
          new Set(),
        );
      } else if (state.recentBaselineReady && !recentIsBeingRead(key)) {
        state.unreadRecentKeys.add(key);
        saveRecentReadState();
      }
    }
    const preview = state.recentPreviews.get(key);
    if (preview && !preview.error
        && !preview.messages.some((message) => String(message.id) === String(payload.id))) {
      preview.messages = window.stelchatRealtimeMerge.mergePreviewMessages(
        preview.messages, [payload],
      );
    }
    if (!recentAlreadyHasMessage || preview) renderRecent();
    if (payload.target_uid === state.selectedMemberUid) {
      state.memberSessionRevision += 1;
      rememberRevision(
        state.memberSessionKeyRevisions,
        memberSessionStateKey(payload.session_id, payload.target_uid),
        state.memberSessionRevision,
      );
      const existing = state.memberSessions.find((session) => session.id === payload.session_id);
      if (existing) {
        const latestCollectedId = Number(existing.latest_id || 0);
        const payloadId = Number(payload.id || 0);
        const alreadyCounted = payloadId > 0 && payloadId <= latestCollectedId;
        const currentLatest = { sent_at: existing.last_chat_at, id: existing.latest_message_id };
        if (window.stelchatRealtimeMerge.compareMessageOrder(payload, currentLatest) >= 0) {
          existing.latest = payload.content;
          existing.latest_source = payload.source;
          existing.last_chat_at = payload.sent_at;
          existing.latest_message_id = payload.id;
        }
        existing.latest_id = Math.max(latestCollectedId, payloadId) || payload.id;
        if (!alreadyCounted) existing.message_count = Number(existing.message_count || 0) + 1;
        state.memberSessions = window.stelchatRealtimeMerge.mergeMemberSessionSnapshot(
          [existing, ...state.memberSessions.filter((session) => session.id !== existing.id)],
          [],
          new Set(),
        );
      } else {
        state.memberSessions = [{
          id: payload.session_id,
          title: payload.title || '',
          status: payload.status || 'CLOSE',
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
      const preview = state.memberPreviews.get(memberPreviewStateKey(payload.session_id, payload.target_uid));
      if (preview && !preview.error
          && !preview.messages.some((message) => String(message.id) === String(payload.id))) {
        preview.messages = window.stelchatRealtimeMerge.mergePreviewMessages(
          preview.messages, [payload],
        );
      }
      renderMemberSessions();
    }
  } else if (eventName === 'session') {
    const affectedRecentKeys = state.recent
      .filter((item) => item.session_id === payload.session_id)
      .map(recentKey);
    if (updateRecentSessionStatus(payload)) {
      state.recentRevision += 1;
      affectedRecentKeys.forEach((key) => rememberRevision(
        state.recentKeyRevisions, key, state.recentRevision,
      ));
    }
    const member = state.streamers.find((item) => item.uid === payload.target_uid || item.uid === payload.channel_id);
    const streamerTransition = member
      ? window.stelchatRendererState.applySessionEventToStreamer(payload, member)
      : null;
    if (streamerTransition?.changed) {
      state.streamerRevision += 1;
      rememberRevision(state.streamerKeyRevisions, member.uid, state.streamerRevision, 100);
      Object.assign(member, streamerTransition.streamer);
      renderLive();
      bindOpenLinks();
    }
    const memberSession = state.memberSessions.find((session) => session.id === payload.session_id);
    if (memberSession) {
      state.memberSessionRevision += 1;
      rememberRevision(
        state.memberSessionKeyRevisions,
        memberSessionStateKey(payload.session_id),
        state.memberSessionRevision,
      );
      memberSession.status = payload.status;
      memberSession.title = payload.title || memberSession.title;
      memberSession.live_category = payload.live_category || memberSession.live_category;
      renderMemberSessions();
    }
  }
});

window.addEventListener('focus', () => {
  if (state.expandedRecentKey && recentIsBeingRead(state.expandedRecentKey)) {
    markRecentRead(state.expandedRecentKey, true);
  }
});
document.addEventListener('visibilitychange', () => {
  if (state.expandedRecentKey && recentIsBeingRead(state.expandedRecentKey)) {
    markRecentRead(state.expandedRecentKey, true);
  }
});

setInterval(() => {
  document.querySelectorAll('[data-opened-at]').forEach((element) => { element.textContent = uptime(element.dataset.openedAt); });
}, 1000);
setInterval(() => load(true, true), 60000);
loadRecentReadState();
load();
