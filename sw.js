// Service worker: "red primero" para el shell (app siempre fresca online),
// con caída a caché cuando no hay conexión. La API nunca se cachea.
const CACHE = "lumi-pedidos-v3";
const SHELL = [
  "/",
  "/index.html",
  "/app-integration.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Nunca cachear la API: siempre a la red.
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(req));
    return;
  }

  // Resto (shell/estáticos y navegación): red primero, SIEMPRE revalidando contra
  // el servidor ("no-cache" evita que el navegador devuelva un HTML viejo de su
  // propia caché HTTP). Si no hay conexión, se sirve lo cacheado (y el index).
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res && res.status === 200 && req.method === "GET") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || (req.mode === "navigate" ? caches.match("/index.html") : undefined))
      )
  );
});
