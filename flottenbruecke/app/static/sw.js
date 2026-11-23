// Service worker of the bridge (#37): shows a Web-Push of "Braucht dich" while the app is closed and
// opens the bridge on a tap. No fetch handler: the page always loads from the bridge.
'use strict';

self.addEventListener('push', (ev) => {
  let d = {};
  try {
    d = ev.data ? ev.data.json() : {};
  } catch {
    d = {};
  }
  ev.waitUntil(self.registration.showNotification(d.titel || 'Braucht dich', { body: d.text || '', icon: '/static/icon-192.png', badge: '/static/icon-192.png', tag: 'braucht-dich', renotify: true }));
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  ev.waitUntil((async () => {
    const offen = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const da = offen.find((c) => new URL(c.url).origin === self.location.origin);
    if (da) return da.focus();
    return self.clients.openWindow('/#bruecke');
  })());
});
