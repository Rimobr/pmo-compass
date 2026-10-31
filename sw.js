// PMO Compass — Service Worker
// Estratégia: network-first para o app shell (sempre tenta buscar a versão mais nova),
// com fallback para o cache quando estiver offline. Tudo que não é do app shell
// (CDNs de ícones/fontes, chamadas às APIs de IA) passa direto, sem interferência.

const CACHE_NAME = 'pmo-compass-v2.9.2';
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
  // Avisa as páginas abertas: elas conferem a versão na hora e mostram a faixa "Atualizar agora" (sem esperar o ciclo de 5 min)
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'SW_ACTIVATED' }))));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Só intercepta requisições do próprio app (mesma origem, GET).
  // Chamadas de terceiros (CDN de ícones/fontes, APIs de IA) seguem normalmente.
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // version.json é a fonte do aviso de nova versão: nunca passa pelo cache
  if (new URL(req.url).pathname.endsWith('/version.json')) return;

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
