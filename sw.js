/* UnderBro service worker — SOLO notificaciones push.
   No cachea assets a propósito, para no interferir con el sistema de versiones. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) {}
  const isCall = d.type === 'call';
  const title = d.title || 'UnderBro';
  const options = {
    body: d.body || 'Tienes un mensaje nuevo',
    tag: d.tag || 'underbro',
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/' },
    requireInteraction: !!d.requireInteraction || isCall,
    vibrate: isCall ? [400, 200, 400, 200, 400, 200, 400] : [120],
  };
  if (isCall) options.actions = [{ action: 'answer', title: 'Abrir' }];
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // si la app está abierta y visible, el aviso in-app ya se muestra: no duplicar
    if (all.some((c) => c.visibilityState === 'visible')) return;
    return self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { c.focus(); return; } }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
