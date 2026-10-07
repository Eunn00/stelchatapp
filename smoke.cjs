async function inspectRenderer() {
  const pages = await fetch('http://127.0.0.1:9222/json').then((response) => response.json());
  const page = pages.find((item) => item.type === 'page' && item.title === 'StelChat');
  if (!page) throw new Error('StelChat renderer was not found');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('DevTools response timed out')), 5000);
    const evaluateRenderer = () => socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `JSON.stringify({
          loadingHidden: document.querySelector('#loading').hidden,
          errorHidden: document.querySelector('#error').hidden,
          connection: document.querySelector('#connection span').textContent,
          liveCards: document.querySelectorAll('.live-card').length,
          liveInteraction: (() => {
            const original = state.streamers;
            state.streamers = [{ uid: '45e71a76e949e16a34764deb962f9d9f', initials: 'YN', name: '아야츠노 유니', color: '#a993e8', is_live: true }];
            renderLive();
            const card = document.querySelector('.live-card');
            const value = {
              link: document.querySelector('.live-channel-link').dataset.url,
              cardTag: card.tagName,
              cardUrl: card.dataset.url || '',
            };
            state.streamers = original;
            renderLive();
            bindOpenLinks();
            return value;
          })(),
          recentGroups: document.querySelectorAll('.recent-group').length,
          recentLiveLinks: [...document.querySelectorAll('.recent-channel-link')].filter((item) => {
            const prefix = 'https://chzzk.naver.com/live/';
            return item.dataset.url.startsWith(prefix) && /^[0-9a-f]{32}$/.test(item.dataset.url.slice(prefix.length));
          }).length,
          expandedGroups: document.querySelectorAll('.recent-group.expanded').length,
          previewMessages: document.querySelectorAll('.preview-message').length,
          moreButtons: document.querySelectorAll('.recent-more').length,
          opacityValue: document.querySelector('#window-opacity-value').textContent,
          notificationVolumeValue: document.querySelector('#notification-volume-value').textContent,
          notificationSoundTestExists: Boolean(document.querySelector('#notification-sound-test')),
          unreadRecentUi: (() => {
            const first = state.recent[0];
            if (!first) return { available: false };
            const key = recentKey(first);
            const originalUnread = new Set(state.unreadRecentKeys);
            const originalExpanded = state.expandedRecentKey;
            const storedUnread = localStorage.getItem(RECENT_UNREAD_STORAGE_KEY);
            const storedKnown = localStorage.getItem(RECENT_KNOWN_STORAGE_KEY);
            state.unreadRecentKeys.add(key);
            renderRecent();
            const unread = {
              available: true,
              badge: document.querySelector('#recent-unread-count').textContent,
              badgeHidden: document.querySelector('#recent-unread-count').hidden,
              dots: document.querySelectorAll('.recent-unread-dot').length,
              markAllDisabled: document.querySelector('#recent-mark-all-read').disabled,
            };
            document.querySelector('#recent-mark-all-read').click();
            unread.cleared = document.querySelector('#recent-unread-count').hidden
              && document.querySelectorAll('.recent-unread-dot').length === 0;
            state.unreadRecentKeys = originalUnread;
            state.expandedRecentKey = originalExpanded;
            if (storedUnread === null) localStorage.removeItem(RECENT_UNREAD_STORAGE_KEY);
            else localStorage.setItem(RECENT_UNREAD_STORAGE_KEY, storedUnread);
            if (storedKnown === null) localStorage.removeItem(RECENT_KNOWN_STORAGE_KEY);
            else localStorage.setItem(RECENT_KNOWN_STORAGE_KEY, storedKnown);
            renderRecent();
            return unread;
          })(),
          chatRoomMuteUi: (() => {
            const first = state.recent[0];
            if (!first) return { available: false };
            const key = recentKey(first);
            const originalMuted = { ...(state.settings.mutedChatRooms || {}) };
            state.settings.mutedChatRooms = { ...originalMuted, [key]: Date.now() };
            renderRecent();
            const result = {
              available: true,
              mutedButton: document.querySelector('.recent-notification-button')?.classList.contains('muted'),
              mutedIcon: document.querySelector('.recent-notification-button')?.textContent.trim(),
              mutedTitle: document.querySelector('.recent-notification-button')?.title,
            };
            const bellRect = document.querySelector('.recent-notification-button')?.getBoundingClientRect();
            const timeRect = document.querySelector('.recent-meta time')?.getBoundingClientRect();
            const linkRect = document.querySelector('.recent-channel-link')?.getBoundingClientRect();
            result.aboveTime = Boolean(bellRect && timeRect && bellRect.bottom <= timeRect.top + 1);
            result.overlapsChannelLink = Boolean(bellRect && linkRect
              && bellRect.left < linkRect.right && bellRect.right > linkRect.left
              && bellRect.top < linkRect.bottom && bellRect.bottom > linkRect.top);
            delete state.settings.mutedChatRooms[key];
            renderRecent();
            result.unmutedIcon = document.querySelector('.recent-notification-button')?.textContent.trim();
            result.unmutedTitle = document.querySelector('.recent-notification-button')?.title;
            state.settings.mutedChatRooms = originalMuted;
            renderRecent();
            return result;
          })(),
          notificationMembers: new Set([...document.querySelectorAll('[data-notification-uid]')].map((item) => item.dataset.notificationUid)).size,
          notificationInputs: document.querySelectorAll('[data-notification-uid]').length,
          notificationBulkButtons: document.querySelectorAll('[data-notification-bulk]').length,
          notificationSoundState: (() => { playNotificationSound('chat'); playNotificationSound('live'); return notificationAudioContext?.state || 'missing'; })(),
          notificationSummary: document.querySelector('#notification-summary').textContent,
          notificationPanelOpens: (() => { document.querySelector('#notification-settings-open').click(); return document.querySelector('#notification-settings-panel').classList.contains('open'); })(),
          desktopMode: document.querySelector('#desktop-button').classList.contains('enabled'),
          bodyLength: document.body.innerText.length
        })`,
        returnByValue: true,
      },
    }));
    socket.addEventListener('open', () => {
      if (process.env.TEST_NOTIFICATION_SETTINGS === '1' || process.env.RESET_NOTIFICATIONS === '1') {
        const expression = process.env.TEST_NOTIFICATION_SETTINGS === '1'
          ? `(async () => {
              const uid = state.streamers[0].uid;
              const originalVolume = state.settings.notificationVolume;
              const first = state.recent[0];
              const roomKey = recentKey(first);
              const originallyMuted = Boolean(state.settings.mutedChatRooms?.[roomKey]);
              const originalPreferences = JSON.parse(JSON.stringify(state.settings.notificationPreferences || {}));
              const volumeResult = await window.stelchat.setSetting('notificationVolume', 0.85);
              if (volumeResult.notificationVolume !== 0.85) {
                throw new Error('Notification volume update failed');
              }
              const memberResult = await window.stelchat.setMemberNotification(uid, 'sound', 'chat', true);
              const memberPreference = memberResult.notificationPreferences[uid];
              const originalMemberPreference = originalPreferences[uid] || {};
              if (!memberPreference.sound.chat
                  || memberPreference.sound.live !== Boolean(originalMemberPreference.sound?.live)
                  || memberPreference.desktop.chat !== Boolean(originalMemberPreference.desktop?.chat)
                  || memberPreference.desktop.live !== Boolean(originalMemberPreference.desktop?.live)) {
                throw new Error('Member notification preference update failed');
              }
              const bulkResult = await window.stelchat.setAllMemberNotifications('desktop', 'live', true);
              if (!state.streamers.every((member) => bulkResult.notificationPreferences[member.uid].desktop.live)) {
                throw new Error('Bulk notification preference update failed');
              }
              const mutedResult = await window.stelchat.setChatRoomMuted(first.session_id, first.target_uid, true);
              if (!mutedResult.mutedChatRooms?.[roomKey]) {
                throw new Error('Chat room mute update failed');
              }
              const restoredMuteResult = await window.stelchat.setChatRoomMuted(
                first.session_id, first.target_uid, originallyMuted,
              );
              if (Boolean(restoredMuteResult.mutedChatRooms?.[roomKey]) !== originallyMuted) {
                throw new Error('Chat room mute restore failed');
              }
              let resetResult = restoredMuteResult;
              for (const member of state.streamers) {
                for (const channel of ['desktop', 'sound']) {
                  for (const eventType of ['live', 'chat']) {
                    resetResult = await window.stelchat.setMemberNotification(
                      member.uid, channel, eventType,
                      Boolean(originalPreferences[member.uid]?.[channel]?.[eventType]),
                    );
                  }
                }
              }
              const restoredResult = await window.stelchat.setSetting('notificationVolume', originalVolume);
              applySettings(restoredResult);
              return true;
            })()`
          : 'window.stelchat.setAllMemberNotifications(null, null, false).then(applySettings)';
        socket.send(JSON.stringify({
          id: 0,
          method: 'Runtime.evaluate',
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
          },
        }));
      } else {
        evaluateRenderer();
      }
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 0) {
        if (message.result?.exceptionDetails) {
          clearTimeout(timeout);
          reject(new Error(message.result.exceptionDetails.text || 'Notification reset failed'));
        } else {
          evaluateRenderer();
        }
        return;
      }
      if (message.id !== 1) return;
      clearTimeout(timeout);
      if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description
          || message.result.exceptionDetails.text
          || 'Renderer evaluation failed'));
        return;
      }
      resolve(JSON.parse(message.result.result.value));
    });
    socket.addEventListener('error', () => reject(new Error('DevTools socket failed')));
  });
  socket.close();
  console.log(JSON.stringify(result));
  if (!result.loadingHidden || !result.errorHidden || result.connection !== '실시간'
      || result.liveInteraction.link !== 'https://chzzk.naver.com/live/45e71a76e949e16a34764deb962f9d9f'
      || result.liveInteraction.cardTag !== 'ARTICLE' || result.liveInteraction.cardUrl
      || result.recentGroups < 1 || result.recentLiveLinks !== result.recentGroups
      || result.expandedGroups !== 0
      || !result.opacityValue.endsWith('%') || !result.notificationVolumeValue.endsWith('%')
      || !result.notificationSoundTestExists || result.notificationMembers !== 11
      || !result.unreadRecentUi.available || result.unreadRecentUi.badgeHidden
      || result.unreadRecentUi.dots < 1 || result.unreadRecentUi.markAllDisabled
      || !result.unreadRecentUi.cleared
      || !result.chatRoomMuteUi.available || !result.chatRoomMuteUi.mutedButton
      || result.chatRoomMuteUi.mutedIcon !== '🔕' || result.chatRoomMuteUi.mutedTitle !== '알림 켜기'
      || result.chatRoomMuteUi.unmutedIcon !== '🔔' || result.chatRoomMuteUi.unmutedTitle !== '알림 끄기'
      || !result.chatRoomMuteUi.aboveTime || result.chatRoomMuteUi.overlapsChannelLink
      || result.notificationInputs !== 44 || result.notificationBulkButtons !== 4
      || !['running', 'suspended'].includes(result.notificationSoundState)
      || (process.env.EXPECT_DEFAULT_NOTIFICATIONS === '1'
        && result.notificationSummary !== 'Windows 0명 · 소리 0명')
      || !result.notificationPanelOpens || result.bodyLength < 100) {
    throw new Error(`Unexpected renderer state: ${JSON.stringify(result)}`);
  }
}

inspectRenderer().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
