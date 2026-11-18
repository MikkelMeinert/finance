/* Offline shell for finance.
   - The app page: network first (a new deploy shows on the next open), cached copy offline.
   - Its own static files (font, icons, manifest): cache first.
   - Never touches another origin: GitHub API calls (sync) must never be cached or answered from cache.
   - Never caches a response that isn't ok (a cached 401 once froze the training app's sync).
   Bump CACHE together with APP_VERSION in index.html on every deploy; a test checks they match. */
const CACHE = "finance-0.2.0";
const ASSETS = ["./", "index.html", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "fonts/schibsted-grotesk-latin.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;
  // The bank consent callback is never cached and never answered from cache.
  if (/\/callback\.(html|js)$/.test(new URL(req.url).pathname)) return;

  const isPage = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  if (isPage) {
    e.respondWith(
      fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("index.html", copy)); }
          return res;
        })
        .catch(() => caches.match("index.html").then((r) => r || caches.match(req)))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
    )
  );
});
