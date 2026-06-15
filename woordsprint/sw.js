const CACHE_NAME = "woordsprint-v4";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./data.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-180.png",
  "./icon-192.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (new URL(event.request.url).pathname.endsWith("/styles.css")) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request)).then(async (response) => {
        const css = await response.text();
        const headers = new Headers(response.headers);
        headers.set("content-type", "text/css; charset=utf-8");
        return new Response(`${css}\n[data-mode="write-definition"]{display:none!important}`, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
