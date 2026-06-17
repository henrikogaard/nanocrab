// NanoCrab PWA Service Worker — network-first with offline fallback
const CACHE_NAME = 'nanocrab-v8-rc4';
const OFFLINE_PAGE = '/offline.html';

// Pre-cache critical assets on install
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(['/static/nanocrab-mark.png'])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Push notification handler
self.addEventListener('push', (e) => {
  if (!e.data) return;
  try {
    const data = e.data.json();
    e.waitUntil(
      self.registration.showNotification(data.title || 'NanoCrab', {
        body: data.body || '',
        icon: data.icon || '/static/nanocrab-mark.png',
        badge: data.badge || '/static/nanocrab-mark.png',
        data: data.data || {},
        vibrate: [200, 100, 200],
      })
    );
  } catch {}
});

// Notification click — open the app to the right page
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const page = e.notification.data?.page || 'dashboard';
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.registration.scope)) {
          client.focus();
          client.navigate('/#/' + page);
          return;
        }
      }
      return clients.openWindow('/#/' + page);
    })
  );
});

self.addEventListener('fetch', (e) => {
  // Skip API, WebSocket, and chrome-extension requests
  if (e.request.url.includes('/api/') || e.request.url.includes('ws') || e.request.url.startsWith('chrome-extension')) return;

  const url = new URL(e.request.url);
  const isAppShellAsset =
    e.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json');
  if (isAppShellAsset) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  e.respondWith(
    fetch(e.request).then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
      }
      return response;
    }).catch(() =>
      caches.match(e.request).then((cached) => cached || caches.match('/'))
    )
  );
});
