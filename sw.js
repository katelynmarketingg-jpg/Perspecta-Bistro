const CACHE = 'alianca-v31';
const ASSETS = ['./'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const req = e.request;

  // Chamadas de API (Firebase / login Google) NUNCA são cacheadas — sempre rede.
  // Evita servir dados velhos do banco (sync) e respostas de token vencidas.
  if (/firebaseio\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/.test(req.url)) return;

  const isDoc = req.mode === 'navigate' || req.destination === 'document';

  if (isDoc) {
    // HTML: network-first — sempre pega a versão nova quando há internet
    // (timeout de 4s para não travar em conexão lenta); cai no cache se offline.
    e.respondWith((async () => {
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
        ]);
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      } catch (err) {
        const cached = await caches.match(req);
        return cached || caches.match('./');
      }
    })());
    return;
  }

  // Demais assets (ícones, manifest): cache-first com atualização em segundo plano.
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
