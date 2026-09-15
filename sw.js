const CACHE_NAME = 'svr-pwa-b-v1.6.11';
const MAP_CACHE_NAME = 'svr-pwa-b-tiles';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './offline.html',
  './css/local_style.css',
  './css/custom_styles.css',
  './css/MarkerCluster.css',
  './css/MarkerCluster.Default.css',
  './js/config.js',
  './js/app.js',
  './js/leaflet.markercluster.js',
  './js/pwa_install.js',
  './fonts/befalow.ttf',
  './icons/icon-192.webp',
  './icons/icon-512.png',
  'https://code.jquery.com/jquery-3.6.0.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/fontawesome.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/solid.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/regular.min.css',
  'https://unpkg.com/swiper/swiper-bundle.min.css',
  'https://unpkg.com/swiper/swiper-bundle.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME && cache !== MAP_CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network only (no caching)
  if (url.hostname.includes('svr-backend.e60-manuels.workers.dev') || url.pathname.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Map tiles: cache-first
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(MAP_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          return response || fetch(event.request).then((networkResponse) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // App shell: network-first with cache fallback
  const isAppShell = event.request.mode === 'navigate' || 
                     url.pathname.endsWith('/index.html') || 
                     (url.origin === location.origin && url.pathname.endsWith('/'));

  if (isAppShell) {
    event.respondWith(
      // cache: 'no-cache' forceert hervalidatie met de server, zodat GitHub
      // Pages/Fastly's max-age=600 de HTML niet tot tien minuten oud serveert.
      fetch(event.request, { cache: 'no-cache' })
        .then(networkResponse => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          return caches.match('./index.html').then(response => {
            return response || caches.match('./offline.html');
          });
        })
    );
    return;
  }

  // Other static assets: cache-first
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((response) => {
      return response || fetch(event.request).catch((error) => {
        throw error;
      });
    })
  );
});
