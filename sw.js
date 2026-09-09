// =====================================================================
// Service Worker - 馭睿支票系統 PWA
// 版本號更新會自動清除舊快取、更新 App
// =====================================================================

const CACHE_VERSION = 'v3.0.3';
const CACHE_NAME = `check-system-${CACHE_VERSION}`;

// 靜態資源清單（這些檔案會被快取，讓 App 離線可用）
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;600;700&display=swap'
];

// =====================================================================
// 安裝：快取所有靜態資源
// =====================================================================
self.addEventListener('install', event => {
  console.log(`[SW ${CACHE_VERSION}] 安裝中...`);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 忽略 Google Fonts 失敗（離線時 OK）
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => {
      console.log(`[SW ${CACHE_VERSION}] 安裝完成`);
      return self.skipWaiting(); // 立即啟用新版 SW
    })
  );
});

// =====================================================================
// 啟動：清除舊版快取
// =====================================================================
self.addEventListener('activate', event => {
  console.log(`[SW ${CACHE_VERSION}] 啟動中...`);
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(k => k.startsWith('check-system-') && k !== CACHE_NAME)
          .map(k => {
            console.log(`[SW] 刪除舊快取: ${k}`);
            return caches.delete(k);
          })
      );
    }).then(() => {
      console.log(`[SW ${CACHE_VERSION}] 啟動完成，已接管所有分頁`);
      return self.clients.claim();
    })
  );
});

// =====================================================================
// 攔截請求
// =====================================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Google Apps Script API：Network First（優先網路，失敗才用快取）
  if (url.hostname.includes('script.google.com')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Google Fonts：Stale While Revalidate
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // 靜態資源（HTML/JS/圖片）：Cache First（快取優先）
  if (event.request.method === 'GET') {
    event.respondWith(cacheFirst(event.request));
  }
});

// =====================================================================
// 快取策略
// =====================================================================

// Cache First：快取有則用快取，否則抓網路並存入快取
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // 離線且無快取：回傳主頁（讓 App 顯示離線提示）
    return caches.match('./index.html');
  }
}

// Network First：優先網路，失敗才用快取
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(
      JSON.stringify({ success: false, error: '離線中，請檢查網路連線' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// Stale While Revalidate：先回傳快取，同時更新快取
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const networkPromise = fetch(request).then(response => {
    if (response && response.status === 200) {
      caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);
  return cached || await networkPromise;
}
