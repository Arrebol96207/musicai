const CACHE = "claudio-music-__CLAUDIO_FRONTEND_VERSION__";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css?v=__CLAUDIO_FRONTEND_VERSION__",
  "/eq.js?v=__CLAUDIO_FRONTEND_VERSION__",
  "/app.js?v=__CLAUDIO_FRONTEND_VERSION__",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

function isCacheableRequest(request) {
  if (!request || request.method !== "GET") return false;

  try {
    const url = new URL(request.url);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function networkFirst(request, fallbackKey = request) {
  return fetch(request).then(response => {
    if (!response || response.status !== 200) return response;
    if (isCacheableRequest(request)) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(fallbackKey).then(cached => cached || new Response(null, { status: 503 })));
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS).catch(err => {
      console.warn("SW install: some assets failed to cache", err.message);
    }))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", event => {
  if (!isCacheableRequest(event.request)) {
    return;
  }

  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/music/")) {
    event.respondWith(fetch(event.request).catch(() => new Response(null, { status: 503 })));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      networkFirst(event.request, "/index.html").catch(() =>
        caches.match("/index.html").then(cached => cached || new Response(
          "<!doctype html><html lang=zh-CN><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Claudio Music</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#08080d;color:#f5f4fa;text-align:center;padding:24px}h1{font-size:clamp(32px,8vw,72px)}p{color:#9896a6;font-size:18px}</style><h1>♪</h1><h1>Claudio Music</h1><p>当前处于离线状态，请检查网络连接后刷新页面。</p>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        ))
      )
    );
    return;
  }

  event.respondWith(
    networkFirst(event.request)
  );
});
