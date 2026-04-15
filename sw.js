// ============================================
// MEGANE_PICTURE - Service Worker
// Gestion du cache et mode hors ligne
// ============================================

const CACHE_NAME = 'megane-picture-v1.0.0';
const OFFLINE_URL = '/offline.html';

// Fichiers à mettre en cache
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/css/app.css',
  '/css/login.css',
  '/js/app.js',
  '/js/login.js',
  '/images/logo.png',
  '/images/icone.png',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js'
];

// Installation du Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installation');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Mise en cache des fichiers');
        return cache.addAll(FILES_TO_CACHE);
      })
      .catch((err) => {
        console.error('[SW] Erreur cache:', err);
      })
  );
  self.skipWaiting();
});

// Activation - nettoyage des anciens caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Suppression ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Stratégie de cache : Network First (réseau d'abord, cache en secours)
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  
  // Exclure les appels API Supabase du cache
  if (requestUrl.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Hors ligne' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }
  
  // Pour les images du bucket Supabase
  if (requestUrl.pathname.includes('/storage/v1/object/public/photos/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        }).catch(() => {
          return new Response('Image non disponible hors ligne', { status: 404 });
        });
      })
    );
    return;
  }
  
  // Pour les autres ressources (CSS, JS, HTML)
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Mettre à jour le cache avec la nouvelle version
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Hors ligne : essayer le cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Page d'offline pour les navigations
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
          return new Response('Contenu non disponible hors ligne', {
            status: 404,
            statusText: 'Not Found'
          });
        });
      })
  );
});

// Gestion des messages (pour la mise à jour)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});