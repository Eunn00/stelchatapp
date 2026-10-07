async function inspectRenderer() {
  const pages = await fetch('http://127.0.0.1:9222/json').then((response) => response.json());
  const page = pages.find((item) => item.type === 'page' && item.title === 'StelChat');
  if (!page) throw new Error('StelChat renderer was not found');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('DevTools response timed out')), 5000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({
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
          notificationMembers: document.querySelectorAll('[data-notification-uid]').length,
          notificationSummary: document.querySelector('#notification-summary').textContent,
          notificationPanelOpens: (() => { document.querySelector('#notification-settings-open').click(); return document.querySelector('#notification-settings-panel').classList.contains('open'); })(),
          desktopMode: document.querySelector('#desktop-button').classList.contains('enabled'),
          bodyLength: document.body.innerText.length
        })`,
        returnByValue: true,
      },
    })));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
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
      || !result.desktopMode || result.liveInteraction.link !== 'https://chzzk.naver.com/live/45e71a76e949e16a34764deb962f9d9f'
      || result.liveInteraction.cardTag !== 'ARTICLE' || result.liveInteraction.cardUrl
      || result.recentGroups < 1 || result.recentLiveLinks !== result.recentGroups
      || !result.opacityValue.endsWith('%') || result.notificationMembers !== 11
      || !result.notificationSummary || !result.notificationPanelOpens || result.bodyLength < 100) {
    throw new Error(`Unexpected renderer state: ${JSON.stringify(result)}`);
  }
}

inspectRenderer().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
