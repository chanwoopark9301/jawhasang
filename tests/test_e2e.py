"""
自畵像 — Playwright E2E 테스트
실행: pytest tests/test_e2e.py -v --headed  (브라우저 표시)
     pytest tests/test_e2e.py -v            (헤드리스)

픽스처:
  live_server_url : session-scope Flask 서버 (port 15001)
  logged_in_page  : 로그인된 Playwright page 객체

주의: 서버가 실제로 구동되어야 하므로 E2E 테스트는
      'unit' 마커 없는 별도 실행을 권장합니다.
      pytest -m "not e2e" → E2E 제외
      pytest -m e2e       → E2E만
"""

import re
import pytest

pytestmark = pytest.mark.e2e   # -m e2e 로 선택 실행 가능


# ---------------------------------------------------------------------------
# 인증
# ---------------------------------------------------------------------------

class TestAuth:
    def test_unauthenticated_redirects_to_login(self, page, live_server_url):
        """인증 없이 접근 시 /login 으로 리다이렉트."""
        page.goto(live_server_url)
        assert '/login' in page.url

    def test_login_page_has_password_field(self, page, live_server_url):
        """로그인 페이지에 비밀번호 입력 필드가 있어야 함."""
        page.goto(f'{live_server_url}/login')
        assert page.locator('input[name=password]').is_visible()
        assert page.locator('button[type=submit]').is_visible()

    def test_wrong_password_shows_error(self, page, live_server_url):
        """잘못된 비밀번호 → 오류 메시지 표시."""
        page.goto(f'{live_server_url}/login')
        page.fill('input[name=password]', 'wrong-password-xyz')
        page.click('button[type=submit]')
        page.wait_for_selector('.err', timeout=5_000)
        assert page.locator('.err').is_visible()

    def test_correct_password_enters_app(self, logged_in_page, live_server_url):
        """올바른 비밀번호 → 앱 메인 화면 진입."""
        assert '/login' not in logged_in_page.url
        # 메인 앱 컨테이너가 렌더링돼야 함
        assert logged_in_page.locator('#app').is_visible()


# ---------------------------------------------------------------------------
# 홈 화면 (캘린더)
# ---------------------------------------------------------------------------

class TestHomePage:
    def test_calendar_renders(self, logged_in_page):
        """홈 화면에 캘린더가 렌더링돼야 함."""
        logged_in_page.wait_for_selector('.cal-grid', timeout=8_000)
        assert logged_in_page.locator('.cal-grid').is_visible()

    def test_calendar_has_date_cells(self, logged_in_page):
        """캘린더에 날짜 셀이 존재해야 함."""
        logged_in_page.wait_for_selector('.cal-grid', timeout=8_000)
        cells = logged_in_page.locator('.cal-day').count()
        assert cells >= 28, f"날짜 셀이 너무 적음: {cells}"

    def test_calendar_navigation_buttons(self, logged_in_page):
        """이전/다음 월 이동 버튼이 있어야 함."""
        logged_in_page.wait_for_selector('.cal-grid', timeout=8_000)
        # 이전/다음 버튼 (◀ ▶ 또는 < > 형태)
        nav_buttons = logged_in_page.locator('button:has-text("◀"), button:has-text("▶"), '
                                              'button:has-text("<"), button:has-text(">")').count()
        assert nav_buttons >= 2, "이전/다음 월 버튼이 없음"

    def test_today_cell_is_highlighted(self, logged_in_page):
        """오늘 날짜 셀이 강조 표시돼야 함."""
        logged_in_page.wait_for_selector('.cal-grid', timeout=8_000)
        today_cell = logged_in_page.locator('.cal-day.today, .cal-day--today, [data-today]')
        assert today_cell.count() >= 1, "오늘 날짜 셀 강조 없음"


# ---------------------------------------------------------------------------
# 사이드바
# ---------------------------------------------------------------------------

class TestSidebar:
    def test_sidebar_visible(self, logged_in_page):
        """사이드바가 렌더링돼야 함."""
        assert logged_in_page.locator('#sidebar').is_visible()

    def test_sidebar_has_view_toggle(self, logged_in_page):
        """상담 기록 / 나의 기록 전환 탭이 있어야 함."""
        sidebar = logged_in_page.locator('#sidebar')
        # 두 가지 보기 모드 버튼이 있어야 함
        buttons_text = sidebar.inner_text()
        assert ('상담' in buttons_text or '기록' in buttons_text), \
            "사이드바에 상담/나의 기록 전환 UI가 없음"


# ---------------------------------------------------------------------------
# 상담 기록 — 학생 등록
# ---------------------------------------------------------------------------

class TestStudentCRUD:
    def _open_new_student_form(self, page):
        """새 학생 폼 열기 (버튼 텍스트로 찾기)."""
        page.wait_for_selector('#sidebar', timeout=8_000)
        # "상담 기록" 모드로 전환 (이미 기본값일 수도 있음)
        btn = page.locator('#sidebar button:has-text("상담"), #sidebar button:has-text("내담자")')
        if btn.count():
            btn.first.click()
        # 새 학생 버튼
        new_btn = page.locator('button:has-text("새 학생"), button:has-text("+ 내담자"), '
                               'button:has-text("내담자 추가")')
        new_btn.first.click()
        page.wait_for_selector('input#falias', timeout=5_000)

    def test_new_student_form_opens(self, logged_in_page):
        """새 학생 등록 폼이 열려야 함."""
        self._open_new_student_form(logged_in_page)
        assert logged_in_page.locator('input#falias').is_visible()

    def test_student_saved_appears_in_sidebar(self, logged_in_page):
        """학생 저장 후 사이드바에 표시돼야 함."""
        self._open_new_student_form(logged_in_page)
        logged_in_page.fill('input#falias', 'E2E-테스트')
        logged_in_page.locator('select#fg').select_option('중3')
        # 저장 버튼
        logged_in_page.locator('button:has-text("저장"), button:has-text("등록")').first.click()
        # 사이드바에 alias 표시 대기
        logged_in_page.wait_for_selector('#sidebar >> text=E2E-테스트', timeout=8_000)
        assert logged_in_page.locator('#sidebar').get_by_text('E2E-테스트').is_visible()

    def test_empty_alias_shows_alert(self, logged_in_page):
        """식별 코드 없이 저장 시 알림이 떠야 함."""
        self._open_new_student_form(logged_in_page)
        # alias 비워두고 저장
        logged_in_page.fill('input#falias', '')

        # dialog(alert) 감지
        dialog_fired = []
        logged_in_page.on('dialog', lambda d: (dialog_fired.append(d.message), d.dismiss()))
        logged_in_page.locator('button:has-text("저장"), button:has-text("등록")').first.click()
        logged_in_page.wait_for_timeout(1_000)
        assert dialog_fired, "식별 코드 없이 저장 시 alert가 없음"


# ---------------------------------------------------------------------------
# 나의 기록 — 주제 등록
# ---------------------------------------------------------------------------

class TestTopicCRUD:
    def _switch_to_myrecords(self, page):
        """나의 기록 모드로 전환."""
        page.wait_for_selector('#sidebar', timeout=8_000)
        btn = page.locator('#sidebar button:has-text("나의"), '
                           '#sidebar button:has-text("내 기록"), '
                           '#sidebar [data-view=myrecords]')
        if btn.count():
            btn.first.click()
            page.wait_for_timeout(500)

    def test_myrecords_view_renders(self, logged_in_page):
        """나의 기록 모드 전환 시 사이드바가 변경돼야 함."""
        self._switch_to_myrecords(logged_in_page)
        # "새 주제" 버튼이 나타나야 함
        assert logged_in_page.locator('button:has-text("새 주제"), button:has-text("주제 추가"), '
                                      'button:has-text("+ 주제")').count() >= 1


# ---------------------------------------------------------------------------
# 데이터 지속성 (API → UI 반영)
# ---------------------------------------------------------------------------

class TestDataPersistence:
    def test_api_data_returns_structure(self, logged_in_page, live_server_url):
        """API /api/data 가 올바른 구조를 반환해야 함."""
        import urllib.request, json as _json
        # 세션 쿠키 없이는 401/302 → logged_in_page를 통해 확인 불가
        # 대신 Playwright evaluate로 fetch 실행
        result = logged_in_page.evaluate("""async () => {
            const res = await fetch('/api/data');
            if (!res.ok) return null;
            return await res.json();
        }""")
        assert result is not None, "/api/data 호출 실패"
        assert 'students' in result
        assert 'sessions' in result
        assert 'my_topics' in result
        assert 'my_records' in result

    def test_save_and_reload_data(self, logged_in_page):
        """저장 후 페이지 새로고침 시 데이터가 유지돼야 함."""
        # 현재 학생 수 확인
        before = logged_in_page.evaluate("""async () => {
            const res = await fetch('/api/data');
            const d = await res.json();
            return d.students.length;
        }""")

        # 학생 추가 (API 직접 호출)
        logged_in_page.evaluate("""async () => {
            const res = await fetch('/api/data');
            const d = await res.json();
            d.students.push({
                id: 'e2e-persist-test', alias: '지속성-테스트', grade: '중1',
                gender: '', family: '', peers: '', situation: '', notes: '',
                createdAt: '2026-04-14',
            });
            await fetch('/api/data', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(d),
            });
        }""")

        # 페이지 새로고침 후 로그인 유지 확인
        logged_in_page.reload()
        logged_in_page.wait_for_selector('#app', timeout=10_000)

        after = logged_in_page.evaluate("""async () => {
            const res = await fetch('/api/data');
            const d = await res.json();
            return d.students.length;
        }""")
        assert after > before, "새로고침 후 학생 수가 줄어 있음 — 데이터가 저장되지 않았음"


# ---------------------------------------------------------------------------
# 접근성 / UI 기본 요소
# ---------------------------------------------------------------------------

class TestUIBasics:
    def test_no_console_errors_on_load(self, logged_in_page):
        """페이지 로드 시 콘솔 오류가 없어야 함."""
        errors = []
        logged_in_page.on('console', lambda msg: errors.append(msg.text)
                          if msg.type == 'error' else None)
        logged_in_page.reload()
        logged_in_page.wait_for_selector('#app', timeout=10_000)
        # 치명적 JS 오류 필터 (네트워크 오류 등 환경 오류 제외)
        fatal = [e for e in errors if 'TypeError' in e or 'ReferenceError' in e]
        assert not fatal, f"치명적 JS 오류 발생:\n" + "\n".join(fatal)

    def test_app_title_is_correct(self, logged_in_page):
        """페이지 타이틀이 '自畵像'을 포함해야 함."""
        title = logged_in_page.title()
        assert '自畵像' in title or '자화상' in title.lower(), f"타이틀 불일치: {title}"

    def test_mobile_viewport_no_overflow(self, page, live_server_url):
        """모바일 뷰포트(375px)에서 가로 스크롤이 없어야 함."""
        from tests.conftest import E2E_PASSWORD
        page.set_viewport_size({'width': 375, 'height': 812})
        page.goto(f'{live_server_url}/login')
        page.fill('input[name=password]', E2E_PASSWORD)
        page.click('button[type=submit]')
        page.wait_for_selector('#app', timeout=10_000)

        scroll_width  = page.evaluate('document.body.scrollWidth')
        client_width  = page.evaluate('document.body.clientWidth')
        assert scroll_width <= client_width + 2, \
            f"모바일에서 가로 오버플로: scrollWidth={scroll_width}, clientWidth={client_width}"
