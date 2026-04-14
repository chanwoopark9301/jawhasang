/* =============================================
   自畵像 — Service Worker
   전략:
   - 정적 파일: Cache First (오프라인 지원)
   - /api/*, /login, /logout: Network Only (서버 필수)
   ============================================= */

const CACHE_NAME = 'jip-v11'; // 사이드바 트리 + 기록/회기 CRUD (new-session, edit-session, edit-record 모달, detail-view)

const STATIC_ASSETS = [
  '/',
  '/index.html',
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
  '/js/render-sidebar.js',
  '/js/render-calendar.js',
  '/js/verbatim-editor.js',
  '/js/render-aipanel.js',
  '/js/render-main.js',
  '/js/render-home.js',
  '/js/transform-text.js',
  '/app.js',
  '/icons/icon-192.png',
  '/manifest.json',
];

// ---------------------------------------------------------------------------
// 설치: 정적 파일 캐시
// ---------------------------------------------------------------------------

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// 활성화: 이전 캐시 정리
// ---------------------------------------------------------------------------

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
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

  // 정적 파일: Cache First → Network Fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // 성공한 GET 응답은 캐시에 추가
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
