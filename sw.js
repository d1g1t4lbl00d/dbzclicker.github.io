/* UnderBro service worker — notificaciones push (mensajes y llamadas).
   No cachea assets a propósito, para no interferir con el sistema de versiones. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) {}
  const isCall = d.type === 'call';
  const from = (d.tag && d.tag.indexOf('call-') === 0) ? d.tag.slice(5) : '';
  const title = d.title || 'UnderBro';
  const options = {
    body: d.body || 'Tienes un mensaje nuevo',
    tag: d.tag || 'underbro',
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/', type: d.type || '', from },
    requireInteraction: !!d.requireInteraction || isCall,
    vibrate: isCall ? [500, 300, 500, 300, 500, 300, 500] : [120],
  };
  // notificación de llamada: botones Aceptar / Rechazar (como una llamada real)
  if (isCall) options.actions = [{ action: 'accept', title: '✅ Aceptar' }, { action: 'decline', title: '❌ Rechazar' }];
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // si la app está abierta y visible, el aviso in-app ya se muestra: no duplicar
    if (all.some((c) => c.visibilityState === 'visible')) return;
    return self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  const isCall = data.type === 'call';
  const action = event.action; // 'accept' | 'decline' | '' (toque en el cuerpo)
  event.notification.close();
  const ucall = isCall ? (action === 'decline' ? 'decline' : 'accept') : '';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        await c.focus();
        if (isCall) c.postMessage({ type: 'callAction', action: ucall, from: data.from || '' });
        return;
      }
    }
    const url = isCall ? ('/?ucall=' + ucall) : (data.url || '/');
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
