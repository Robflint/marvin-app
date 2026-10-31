// Offline shell: app files come from the network when online (so updates land at once),
// falling back to the cache when offline.
// API calls (Anthropic, GitHub, Google) always go to the network.

const CACHE = "marvin-v2";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "main.js",
  "manifest.webmanifest",
  "lib/agent.js",
  "lib/github.js",
  "lib/google.js",
  "lib/md.js",
  "lib/voice.js",
  "vendor/anthropic-sdk-0.135.0.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cache.match(e.request, { ignoreSearch: true })),
    ),
  );
});
