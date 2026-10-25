/*
  KasiFlow SA service worker: a small offline shell, written by hand.
  - Hashed build files (/assets/*) and the icons: cache-first (they never change under the same name).
  - Page navigations: network-first; offline, the last cached app shell (index.html) opens instead.
  - NEVER cached: the KasiFlow API (any other origin, and /api/ on this one), Supabase sign-in, map tiles — every
    request that is not same-origin is left to the browser untouched.
*/
const VERSION = 'kf-v1'
const SHELL = `${VERSION}-shell`
const ASSETS = `${VERSION}-assets`
const PRECACHE = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function isStatic(url) {
  return url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/favicon.svg' || url.pathname === '/manifest.webmanifest'
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Other origins (the API, Supabase auth, map tiles) and anything API-like: not ours to cache.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/rest/')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
            const copy = res.clone()
            caches.open(SHELL).then((c) => c.put('/', copy))
          }
          return res
        })
        .catch(() =>
          caches.match('/').then(
            (hit) =>
              hit ||
              new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p style="font-family:sans-serif;padding:24px">You are offline. Open KasiFlow again when you have signal.</p>', {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
              }),
          ),
        ),
    )
    return
  }

  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(ASSETS).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})
