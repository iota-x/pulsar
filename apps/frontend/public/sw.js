// Self-destructing "kill switch" service worker.
//
// This app does NOT use a service worker. But a previously-installed worker from
// another app on this origin (e.g. localhost:3000) can keep intercepting requests
// and serving its stale, broken bundle. Browsers re-fetch the worker script at
// /sw.js on navigation to check for updates — serving this file there replaces
// that rogue worker with one that unregisters itself and clears all caches.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.navigate(client.url));
    })(),
  );
});
