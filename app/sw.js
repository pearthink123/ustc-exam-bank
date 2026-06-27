const CACHE = "ustc-431-v2";
const SHELL = [
  "/app/index.html",
  "/app/style.css",
  "/app/app.js",
  "/app/manifest.webmanifest",
  "/app/icon-192.svg",
  "/app/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isShell = SHELL.some((path) => url.pathname === path || url.pathname.endsWith(path));
  const isData = url.pathname.endsWith("/data/questions.json");

  if (isShell || isData) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        try {
          const response = await fetch(event.request);
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        } catch {
          return cached || Response.error();
        }
      })
    );
  }
});