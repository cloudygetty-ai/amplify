// AMPLIFY Service Worker — Midnight Galaxy PWA
const CACHE = 'amplify-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/watch.html',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Outfit:wght@300;400;500;600;700&family=Orbitron:wght@400;700;900&display=swap'
];

// Install — cache all assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      return cache.addAll(ASSETS).catch(err => {
        console.warn('SW cache partial failure (fonts may fail offline):', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — cache first, network fallback
self.addEventListener('fetch', e => {
  // Skip non-GET and cross-origin audio/mic requests
  if(e.request.method !== 'GET') return;
  if(e.request.url.includes('getUserMedia')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(response => {
        // Cache successful responses
        if(response && response.status === 200 && response.type === 'basic'){
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback
        if(e.request.destination === 'document') return caches.match('/');
      });
    })
  );
});
