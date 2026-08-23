// PMO Compass — Service Worker
// Estratégia: network-first para o app shell (sempre tenta buscar a versão mais nova),
// com fallback para o cache quando estiver offline. Tudo que não é do app shell
// (CDNs de ícones/fontes, chamadas às APIs de IA) passa direto, sem interferência.

const CACHE_NAME = 'pmo-compass-v1';
const APP_SHELL = [
  './PMO_Compass_v2.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // não bloqueia a instalação se algum item falhar (ex: offline no 1º acesso)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Só intercepta requisições do próprio app (mesma origem, GET).
  // Chamadas de terceiros (CDN de ícones/fontes, APIs de IA) seguem normalmente.
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./PMO_Compass_v2.html')))
  );
});
