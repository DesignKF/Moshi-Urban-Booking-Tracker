import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {Plugin} from 'vite';

// Precache only public application files. Never cache authenticated API traffic.
export function pwa(): Plugin {
  return {
    name: 'moshi-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter(name => !name.endsWith('.map'));
      const publicFiles = ['manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png',
        'icons/icon-512.png', 'icons/apple-touch-icon.png',
        'moshi_urban_logo_vertical_white.svg', 'moshi_urban_logo_horizontal_white.svg',
        'moshi_urban_logo_horizontal.svg'];
      const hash = createHash('sha256');
      hash.update(readFileSync('index.html'));
      hash.update(readFileSync('scripts/pwa.ts'));
      for (const file of Object.values(bundle)) {
        hash.update(file.type === 'chunk' ? file.code : file.source);
      }
      for (const file of publicFiles) hash.update(readFileSync(`public/${file}`));
      const cache = `moshi-app-${hash.digest('hex').slice(0, 16)}`;
      const urls = ['/', ...files.map(file => `/${file}`), ...publicFiles.map(file => `/${file}`)];
      this.emitFile({type: 'asset', fileName: 'sw.js', source: `
const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
// Wait for existing windows to close before activating an updated app.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('moshi-app-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/')).then(shell => shell || fetch(request)));
  } else if (!url.search && FILES.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname, {ignoreVary: true})).then(file => file || fetch(request)));
  }
});
`});
    },
  };
}
