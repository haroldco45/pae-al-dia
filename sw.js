// PAE al Día — service worker
const V = 'pae-al-dia-v2';
const BASE = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'data/noticias.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Páginas y noticias: primero la red (para que siempre esté al día), si no hay señal, la copia guardada
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(r => {
        const copia = r.clone();
        caches.open(V).then(c => c.put(req.url.split('?')[0], copia));
        return r;
      }).catch(() => caches.match(req.url.split('?')[0]).then(r => r || caches.match('index.html')))
    );
    return;
  }

  // Fotos: guardadas para que la app cargue rápido aunque la señal sea mala
  if (req.destination === 'image') {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        if (r.ok || r.type === 'opaque') { const copia = r.clone(); caches.open(V).then(c => c.put(req, copia)); }
        return r;
      }).catch(() => hit))
    );
  }
});
