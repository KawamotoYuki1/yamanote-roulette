/*
 * オフライン対応: アプリ一式を版ごとのキャッシュ (CACHE) に入れ、そこから返す (キャッシュ優先)。
 * ファイルごとにネットと混ぜない = 新旧のファイルが混ざらない。新しい版は CACHE を上げて公開すると、
 * 次に開いたときに裏でまるごと取り込まれ、その次に開いたときから使われる。
 */
const CACHE = 'yr-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './js/app.js',
  './js/roulette.js',
  './js/stations.js',
  './manifest.webmanifest',
  './fonts/noto-sans-jp-700.woff2',
  './fonts/noto-sans-jp-900.woff2',
  './fonts/league-spartan-800.woff2',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

/** アプリ一式を、HTTP キャッシュ (GitHub Pages は max-age=600) を通さずに取り直して入れる */
async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('yr-') && key !== CACHE).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function fromCache(request) {
  const cache = await caches.open(CACHE);
  const { pathname } = new URL(request.url);
  const root = new URL(self.registration.scope).pathname;
  const isApp = request.mode === 'navigate' && (pathname === root || pathname === `${root}index.html`);
  const hit = await cache.match(isApp ? './' : request, { ignoreSearch: true });
  return hit || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fromCache(request));
});

// キャッシュだけが消えていた (容量整理など) とき: ページの読み込みが終わってから、ページの合図で丸ごと入れ直す。
// 読み込みの途中で入れ直すと、オフラインのとき Chromium でページ自身の読み込みが失敗するため
self.addEventListener('message', (event) => {
  if (event.data !== 'heal') return;
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.match('./'))
      .then((hit) => (hit ? null : precache()))
      .catch(() => {}),
  );
});
