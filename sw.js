// sw.js
// Cache-first service worker. Bump CACHE_VERSION to force clients to refresh.

const CACHE_VERSION = 'pdf-talker-v2';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './pdf-engine.js',
  './tts-engine.js',
  './storage.js',
  './text-utils.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './silent.wav',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
    );
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (err) {
        const cached = await caches.match('./index.html');
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const network = await fetch(request);
      if (network && network.ok && request.url.startsWith(self.location.origin)) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(request, network.clone()).catch(() => { /* ignore */ });
      }
      return network;
    } catch (err) {
      return new Response('Offline', { status: 503 });
    }
  })());
});
