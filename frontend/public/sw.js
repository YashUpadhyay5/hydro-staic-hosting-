// High-Performance Cache-First Service Worker for Hydro Platform
const CACHE_NAME = 'hydro-static-v11';


// Install event - activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event - purge obsolete caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - Cache-First for versioned hashed assets, Network-First for API & HTML
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API or dynamic database endpoints
  if (
    url.pathname.startsWith('/api') || 
    url.pathname.startsWith('/v1/invoice') ||
    url.pathname.startsWith('/storage') ||
    url.pathname.startsWith('/invoices') ||
    request.method !== 'GET'
  ) {
    return;
  }

  // Cache-First strategy for static assets (JS, CSS, fonts, images)
  const isStaticAsset = (
    url.pathname.startsWith('/assets/') ||
    /\.(js|css|woff2?|ttf|eot|svg|png|jpe?g|ico|webp)$/.test(url.pathname)
  );

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Network-First with Cache fallback for index.html navigation
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
  }
});
