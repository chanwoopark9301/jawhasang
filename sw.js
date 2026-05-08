/* =============================================
   自畵像 — Service Worker
   전략:
   - index.html / 루트: Network First → Cache Fallback
     (새 배포 시 항상 최신 HTML 수신, 오프라인만 캐시 폴백)
   - JS / CSS / 아이콘: Cache First → Network Fallback
     (정적 파일 빠른 로딩, 캐시 버전으로 무효화)
   - /api/*, /login, /logout: Network Only (서버 필수)
   ============================================= */

const CACHE_NAME = 'jip-v97'; // Sidebar cleanup and portfolio cash snapshot

const STATIC_ASSETS = [
  '/style.css',
  '/js/logger.js',
  '/js/state.js',
  '/js/utils.js',
  '/js/data.js',
  '/js/nav.js',
  '/js/crud.js',
  '/js/ai-counseling.js',
  '/js/ai-myrecords.js',
  '/js/ai-pattern.js',
  '/js/modal.js',
  '/js/panels.js',
  '/js/chat.js',
  '/js/investment-rules.js',
  '/js/investment-format.js',
  '/js/investment-portfolio.js',
  '/js/investment-api.js',
  '/js/market-data.js',
  '/js/render-sidebar.js',
  '/js/render-calendar.js',
  '/js/render-investment.js',
  '/js/investment-actions.js',
  '/js/verbatim-editor.js',
  '/js/render-aipanel.js',
  '/js/render-main.js',
  '/js/render-home.js',
  '/js/transform-text.js',
  '/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json',
];

// HTML 경로: Network First로 처리 (index.html, / 포함)
const HTML_PATHS = new Set(['/', '/index.html']);

// ---------------------------------------------------------------------------
// 설치: 정적 파일 캐시 (HTML 제외)
// ---------------------------------------------------------------------------

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // allSettled: 개별 파일 실패해도 install 전체가 깨지지 않음
      // (인증 오류·404 등 한 파일 실패가 SW 설치 실패로 번지는 문제 방지)
      Promise.allSettled(
        STATIC_ASSETS.map(url =>
          fetch(url, { credentials: 'same-origin' })
            .then(r => { if (r.ok) return cache.put(url, r); })
            .catch(() => { /* 실패 무시 — 온라인 시 재시도 */ })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// 활성화: 이전 캐시 정리 + 모든 클라이언트에 업데이트 알림
// ---------------------------------------------------------------------------

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      // clients.claim() 이후 브라우저가 controllerchange 이벤트를 페이지에 자동 발화
      // → index.html의 controllerchange 리스너가 자동 새로고침 처리
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => client.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ---------------------------------------------------------------------------
// fetch: 라우팅 전략
// ---------------------------------------------------------------------------

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 서버 필수 경로: Network Only
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/login' ||
    url.pathname === '/logout' ||
    event.request.method !== 'GET'
  ) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: '오프라인: 서버에 연결할 수 없습니다' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // HTML (index.html, /): Network First → Cache Fallback
  // 새 배포 시 항상 최신 HTML 수신. 오프라인일 때만 캐시 사용.
  if (HTML_PATHS.has(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // JS / CSS / 아이콘: Cache First → Network Fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
