// Кэш приложения: всё нужное лежит на телефоне, интернет нужен только для обновлений.
// Меняя любой файл приложения, поднимайте VERSION — иначе телефон останется на старом.
const VERSION = 'v3';
const FILES = [
  './', './index.html', './style.css', './app.js', './cards.json', './manifest.webmanifest',
  './fonts/Unbounded-Bold.ttf', './fonts/Manrope-Regular.ttf', './fonts/Manrope-Bold.ttf',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
