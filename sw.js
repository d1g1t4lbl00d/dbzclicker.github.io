/* UnderBro service worker — notificaciones push (mensajes y llamadas) + página offline.
   No cachea assets a propósito, para no interferir con el sistema de versiones (?v=). */
const OFFLINE_CACHE = 'ub-offline-v1';
const OFFLINE_URL = '/offline.html';
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try { const c = await caches.open(OFFLINE_CACHE); await c.add(new Request(OFFLINE_URL, { cache: 'reload' })); } catch (_) {}
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // limpiar cachés de versiones anteriores
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
// Solo interceptamos NAVEGACIONES (y solo para dar la página offline si falla la red).
// El handler 'fetch' además hace la web instalable en Chrome (beforeinstallprompt).
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;   // assets: passthrough total
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error())
  );
});

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
    icon: d.icon || '/icon-192.png',   // foto de perfil de quien escribe (si viene)
    badge: '/icon-192.png',
    image: d.image || undefined,        // miniatura grande (p. ej. foto enviada)
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
  const url = isCall ? ('/?ucall=' + ucall) : (data.url || '/');
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        await c.focus();
        // la app ya estaba abierta: dile a qué pantalla ir
        if (isCall) c.postMessage({ type: 'callAction', action: ucall, from: data.from || '' });
        else c.postMessage({ type: 'notifOpen', url });
        return;
      }
    }
    // no había ninguna ventana: abre la app directamente en el destino
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
