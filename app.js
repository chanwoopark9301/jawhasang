/* =============================================
   自畵像 — 앱 진입점
   모든 로직은 js/ 디렉토리의 모듈 파일에 있습니다.

   로드 순서 (index.html):
     state.js → utils.js → data.js → nav.js → crud.js
     → ai-counseling.js → ai-myrecords.js → ai-pattern.js
     → render-sidebar.js → render-calendar.js → render-forms.js
     → render-session.js → render-myrecords-view.js
     → render-aipanel.js → render-main.js → resize.js
     → app.js (이 파일)
   ============================================= */

loadData();
initResize();
