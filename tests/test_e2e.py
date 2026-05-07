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
    def _go_to_calendar(self, page):
        """메인 캘린더 허브로 이동."""
        page.evaluate("() => setView('calendar')")
        page.wait_for_selector('.cal-grid', timeout=8_000)

    def test_calendar_renders(self, logged_in_page):
        """캘린더 뷰로 이동 후 캘린더가 렌더링돼야 함."""
        self._go_to_calendar(logged_in_page)
        assert logged_in_page.locator('.cal-grid').is_visible()

    def test_calendar_is_default_home_without_mode_hub(self, logged_in_page):
        """초기 메인 화면은 캘린더이고 상단 모드 허브는 없어야 함."""
        logged_in_page.wait_for_selector('.cal-grid', timeout=8_000)
        assert logged_in_page.locator('.calendar-hub').count() == 0

    def test_logo_returns_to_calendar_home(self, logged_in_page):
        logged_in_page.click('#nav-invest')
        logged_in_page.wait_for_selector('.investment-view', timeout=8_000)
        logged_in_page.click('.sidebar-logo')
        logged_in_page.wait_for_selector('.cal-grid', timeout=8_000)
        assert logged_in_page.evaluate("() => state.view") == 'calendar'
    def test_calendar_has_date_cells(self, logged_in_page):
        """캘린더에 날짜 셀이 존재해야 함."""
        self._go_to_calendar(logged_in_page)
        cells = logged_in_page.locator('.cal-day').count()
        assert cells >= 28, f"날짜 셀이 너무 적음: {cells}"

    def test_calendar_navigation_buttons(self, logged_in_page):
        """이전/다음 월 이동 버튼이 있어야 함."""
        self._go_to_calendar(logged_in_page)
        # 이전/다음 버튼 (‹ › 또는 ◀ ▶ 또는 < > 형태)
        nav_buttons = logged_in_page.locator(
            'button:has-text("‹"), button:has-text("›"), '
            'button:has-text("◀"), button:has-text("▶"), '
            'button:has-text("<"), button:has-text(">"), '
            '.cal-nav'
        ).count()
        assert nav_buttons >= 2, "이전/다음 월 버튼이 없음"

    def test_today_cell_is_highlighted(self, logged_in_page):
        """오늘 날짜 셀이 강조 표시돼야 함."""
        self._go_to_calendar(logged_in_page)
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
        """일상 / 상담 / 투자 전환 메뉴가 있어야 함."""
        sidebar = logged_in_page.locator('#sidebar')
        buttons_text = sidebar.inner_text()
        assert '일상' in buttons_text
        assert '상담' in buttons_text
        assert '투자' in buttons_text
        assert '캘린더' not in buttons_text

    def test_context_picker_includes_calendar_daily_counseling_and_investment(self, logged_in_page):
        """상단 상태 버튼은 전체 앱 허브를 열어야 함."""
        logged_in_page.evaluate("""() => {
            state.myTopics = [{ id: 't-picker', title: '일기', aiPrompt: '', createdAt: '2026-05-06' }];
            state.myRecords = [{ id: 'r-picker', topicId: 't-picker', date: '2026-05-06', recordNum: 1, content: 'x' }];
            state.students = [{ id: 's-picker', alias: '별-01', grade: '중1', createdAt: '2026-05-06' }];
            state.sessions = [{ id: 'ss-picker', studentId: 's-picker', date: '2026-05-06', sessionNum: 1, verbatim: '', memo: '' }];
            state.investment.positions = [{ id: 'ip-picker', symbol: 'CRCL', name: 'Circle', shares: 2, avgPrice: 80, currentPrice: 90 }];
            state.investment.decisions = [{ id: 'd-picker', label: '진행 가능' }];
            render();
        }""")

        logged_in_page.locator('#ctx-topic').click()
        logged_in_page.wait_for_selector('#new-chat-modal', timeout=8_000)
        picker_text = logged_in_page.locator('#new-chat-modal').inner_text()
        assert '캘린더' in picker_text
        assert '일기' in picker_text
        assert '별-01' in picker_text
        assert '투자 파트너' in picker_text
        assert 'CRCL' in picker_text

    def test_investment_right_current_opens_portfolio_not_context_picker(self, logged_in_page):
        logged_in_page.evaluate("""() => {
            state.investment.positions = [{ id: 'ip-rp', symbol: 'CRCL', name: 'Circle', shares: 2, avgPrice: 80, currentPrice: 90 }];
            setView('investment');
        }""")

        logged_in_page.locator('#rp-topic').click()
        logged_in_page.wait_for_selector('#investment-portfolio-modal', timeout=8_000)
        assert 'CRCL' in logged_in_page.locator('#modal-box').inner_text()
        assert logged_in_page.locator('#new-chat-modal').is_hidden()


# ---------------------------------------------------------------------------
# 상담 기록 — 학생 등록
# ---------------------------------------------------------------------------

class TestStudentCRUD:
    def _open_new_student_form(self, page):
        """새 학생 폼 열기 (새 UI: #nav-sv 클릭 → sub-item-add 클릭)."""
        page.wait_for_selector('#nav-sv', timeout=8_000)
        # "상담 기록" 모드로 전환
        page.click('#nav-sv')
        page.wait_for_timeout(300)
        # "새 내담자" sub-item-add 클릭 (#sub-sv 안)
        new_btn = page.locator('#sub-sv .sub-item-add')
        new_btn.click()
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
        """나의 기록 모드로 전환 (새 UI: #nav-my 클릭)."""
        page.wait_for_selector('#nav-my', timeout=8_000)
        page.click('#nav-my')
        page.wait_for_timeout(500)

    def test_myrecords_view_renders(self, logged_in_page):
        """나의 기록 모드 전환 시 사이드바가 변경돼야 함."""
        self._switch_to_myrecords(logged_in_page)
        # "새 주제" sub-item-add가 나타나야 함 (새 UI: div.sub-item-add)
        assert logged_in_page.locator('#sub-my .sub-item-add').count() >= 1


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

    def test_save_data_does_not_show_error_when_local_cache_succeeds(self, logged_in_page):
        """서버 동기화가 실패해도 localStorage 저장이 성공하면 오류 토스트를 띄우지 않아야 함."""
        result = logged_in_page.evaluate("""async () => {
            const originalFetch = window.fetch;
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/data') && opts?.method === 'POST') {
                    return Promise.reject(new Error('offline test'));
                }
                return originalFetch(url, opts);
            };
            state.students.push({
                id: 'local-cache-only',
                alias: '로컬-저장',
                grade: '중1',
                gender: '',
                family: '',
                peers: '',
                situation: '',
                notes: '',
                createdAt: '2026-05-04',
            });
            saveData();
            await new Promise(r => setTimeout(r, 300));
            window.fetch = originalFetch;
            const cached = JSON.parse(localStorage.getItem('jip_data_cache') || '{}');
            return {
                hasToast: !!document.getElementById('save-error-toast'),
                savedLocal: !!cached.students?.find(s => s.id === 'local-cache-only'),
            };
        }""")

        assert result['savedLocal'] is True
        assert result['hasToast'] is False

    def test_save_error_toast_code_removed(self, logged_in_page):
        """구버전 서버 연결 실패 토스트 코드가 배포 JS에 남아있지 않아야 함."""
        has_old_toast = logged_in_page.evaluate("""async () => {
            const res = await fetch('/js/data.js?v=20260507-06');
            const text = await res.text();
            return text.includes('save-error-toast') || text.includes('서버 연결을 확인');
        }""")
        assert has_old_toast is False


# ---------------------------------------------------------------------------
# 대화(채팅) 화면
# ---------------------------------------------------------------------------

class TestChatDialogue:
    """대화창 UI 동작 및 iOS 키보드 대응 테스트."""

    def test_ai_chat_bubble_renders_basic_markdown(self, logged_in_page):
        logged_in_page.evaluate("""() => {
            state.currentChatMessages = [{
                role: 'ai',
                text: '핵심 흐름 요약\\n---\\n**핵심**\\n- 리스크 확인\\n[원문](https://example.com)'
            }];
            renderChatView();
        }""")
        logged_in_page.wait_for_selector('.chat-markdown h4', timeout=5_000)
        logged_in_page.wait_for_selector('.chat-markdown strong', timeout=5_000)
        assert logged_in_page.locator('.chat-markdown h4').inner_text() == '핵심 흐름 요약'
        assert logged_in_page.locator('.chat-markdown hr').count() == 1
        assert logged_in_page.locator('.chat-markdown strong').inner_text() == '핵심'
        assert logged_in_page.locator('.chat-markdown li').inner_text() == '리스크 확인'
        assert logged_in_page.locator('.chat-markdown a').get_attribute('href') == 'https://example.com'
    def _select_student_via_js(self, page):
        """
        학생 데이터 삽입 + JS state 갱신 + selectStudent() 호출.
        - networkidle 보장된 page에서만 사용할 것.
        - startContextChat()이 AI 호출을 하므로 input-area 표시만 확인.
        """
        page.wait_for_load_state('networkidle')
        page.evaluate("""async () => {
            // 1. 학생 데이터 삽입
            const res  = await fetch('/api/data');
            const d    = await res.json();
            const exists = d.students.find(s => s.id === 'e2e-chat-stu');
            if (!exists) {
                d.students.push({
                    id: 'e2e-chat-stu', alias: 'chat-e2e',
                    grade: '2', gender: '', family: '', peers: '',
                    situation: '', notes: '', createdAt: '2026-04-16',
                });
                await fetch('/api/data', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(d),
                });
            }
            // 2. JS state 갱신
            await loadData();
            // 3. 학생 선택 → 대화창 뷰
            selectStudent('e2e-chat-stu');
        }""")
        # 입력창이 표시될 때까지 대기
        page.wait_for_selector('#input-area:not([style*="none"])', timeout=8_000)

    # ── --app-height CSS 변수 ──────────────────────────────────────────────

    def test_app_height_css_var_is_set(self, logged_in_page):
        """_lockAppHeight()가 --app-height CSS 변수를 px 값으로 설정해야 함."""
        app_height = logged_in_page.evaluate(
            "() => getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim()"
        )
        assert app_height != '', "--app-height CSS 변수가 비어 있음"
        assert 'px' in app_height, f"--app-height가 px 단위가 아님: {app_height}"

    # ── 입력창 가시성 ─────────────────────────────────────────────────────

    def test_chat_input_visible_when_student_selected(self, logged_in_page):
        """학생 선택 시 하단 입력창(#input-area)이 표시돼야 함."""
        self._select_student_via_js(logged_in_page)
        assert logged_in_page.locator('#input-area').is_visible(), \
            "#input-area가 표시되지 않음"
        assert logged_in_page.locator('#chat-input-bottom').is_visible(), \
            "#chat-input-bottom이 보이지 않음"

    # ── 메시지 전송 ───────────────────────────────────────────────────────

    def test_user_message_appears_after_send(self, logged_in_page):
        """입력 후 전송 시 user 말풍선이 #chat-messages에 나타나야 함."""
        self._select_student_via_js(logged_in_page)

        input_el = logged_in_page.locator('#chat-input-bottom')
        input_el.fill('E2E test message hello')
        # Enter 전송
        input_el.press('Enter')

        logged_in_page.wait_for_selector('.chat-bubble-user', timeout=6_000)
        bubble = logged_in_page.locator('.chat-bubble-user').first.inner_text()
        assert 'E2E test message hello' in bubble, \
            f"전송 메시지가 말풍선에 없음: {bubble}"

    def test_chat_messages_scrolled_to_bottom_after_send(self, logged_in_page):
        """메시지 전송 후 #chat-messages가 맨 아래로 스크롤돼야 함."""
        self._select_student_via_js(logged_in_page)

        input_el = logged_in_page.locator('#chat-input-bottom')
        input_el.fill('scroll test message')
        input_el.press('Enter')
        logged_in_page.wait_for_selector('.chat-bubble-user', timeout=6_000)
        logged_in_page.wait_for_timeout(400)  # scrollChatToBottom rAF 대기

        # scrollTop + clientHeight ≈ scrollHeight 이면 맨 아래
        at_bottom = logged_in_page.evaluate("""() => {
            const el = document.getElementById('chat-messages');
            if (!el) return false;
            return (el.scrollTop + el.clientHeight) >= (el.scrollHeight - 10);
        }""")
        assert at_bottom, "메시지 전송 후 chat-messages가 맨 아래로 스크롤되지 않음"

    # ── 키보드 오프셋 transform ───────────────────────────────────────────

    def test_input_area_transforms_up_when_kb_offset_set(self, logged_in_page):
        """--kb-offset 설정 시 .input-area에 translateY(-300px) transform이 걸려야 함."""
        self._select_student_via_js(logged_in_page)

        logged_in_page.evaluate(
            "() => document.documentElement.style.setProperty('--kb-offset', '300px')"
        )
        logged_in_page.wait_for_timeout(350)  # transition 0.25s 대기

        transform = logged_in_page.evaluate(
            "() => getComputedStyle(document.querySelector('#input-area')).transform"
        )
        # matrix(1,0,0,1,0,-300) 형태 — y 값이 -300이어야 함
        assert transform != 'none', "--kb-offset 설정 시 input-area에 transform이 없음"
        # matrix의 ty 값 (6번째) 추출
        ty = logged_in_page.evaluate("""() => {
            const m = getComputedStyle(document.querySelector('#input-area')).transform;
            const vals = m.replace('matrix(', '').replace(')', '').split(',');
            return parseFloat(vals[5]);
        }""")
        assert ty < -50, f"input-area translateY 값이 충분히 올라가지 않음: {ty}"

        # 원복
        logged_in_page.evaluate(
            "() => document.documentElement.style.setProperty('--kb-offset', '0px')"
        )

    def test_chat_messages_padding_grows_with_kb_offset(self, logged_in_page):
        """--kb-offset 설정 시 .chat-messages의 padding-bottom이 커져야 함."""
        self._select_student_via_js(logged_in_page)

        # 서빙된 CSS에 --kb-offset 규칙이 있는지 먼저 확인
        css_ok = logged_in_page.evaluate("""async () => {
            const res = await fetch('/style.css?t=' + Date.now());
            const txt = await res.text();
            return (txt.match(/chat-messages[\s\S]*?kb-offset/g) || []).length;
        }""")
        assert css_ok and css_ok >= 1, \
            f"서빙된 style.css에 chat-messages + kb-offset 규칙이 없음 (매치 수: {css_ok})"

        # rAF 후 측정 (CSS 변수 변경이 paint cycle에 반영된 뒤 확인)
        pb = logged_in_page.evaluate("""async () => {
            document.documentElement.style.setProperty('--kb-offset', '250px');
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const el = document.querySelector('.chat-messages')
                     || document.querySelector('#chat-messages');
            if (!el) return null;
            const result = parseFloat(getComputedStyle(el).paddingBottom);
            document.documentElement.style.setProperty('--kb-offset', '0px');
            return result;
        }""")

        assert pb is not None, ".chat-messages 요소를 찾지 못함"
        assert pb > 100, \
            f"--kb-offset:250px 설정 시 padding-bottom이 충분히 크지 않음: {pb}px (예상 >100)"

    # ── 모바일 가로 오버플로 ──────────────────────────────────────────────

    def test_mobile_chat_no_horizontal_overflow(self, page, live_server_url):
        """모바일(390px) 대화 화면에서 가로 스크롤 없어야 함."""
        from tests.conftest import E2E_PASSWORD
        page.set_viewport_size({'width': 390, 'height': 844})
        page.goto(f'{live_server_url}/login')
        page.fill('input[name=password]', E2E_PASSWORD)
        page.click('button[type=submit]')
        page.wait_for_selector('#app', timeout=10_000)

        scroll_w = page.evaluate('document.body.scrollWidth')
        client_w = page.evaluate('document.body.clientWidth')
        assert scroll_w <= client_w + 2, \
            f"모바일 대화 화면 가로 오버플로: scrollWidth={scroll_w}, clientWidth={client_w}"


class TestChatRoleAndReplyMode:
    """AI 역할과 응답 모드가 대화 프롬프트에 실제로 반영되는지 확인."""

    def _select_topic_with_role(self, page, role='counselor'):
        page.wait_for_load_state('networkidle')
        page.evaluate(
            """(role) => {
                const preset = AI_ROLE_PRESETS.find(p => p.id === role);
                state.myTopics = [{
                    id: 't-role-e2e',
                    title: 'role e2e',
                    aiPrompt: preset ? preset.prompt : 'custom role prompt',
                    selectedRole: role,
                    createdAt: '2026-05-04',
                }];
                state.myRecords = [];
                state.view = 'myrecords';
                selectTopic('t-role-e2e');
            }""",
            role,
        )

    def test_dictation_mode_is_default_and_avoids_followup_questions(self, logged_in_page):
        self._select_topic_with_role(logged_in_page, 'counselor')

        prompt = logged_in_page.evaluate("""() => {
            const topic = state.myTopics.find(t => t.id === 't-role-e2e');
            return _buildChatSysPrompt(true, topic, null);
        }""")

        assert '받아쓰기' in prompt
        assert '사용자가 요청하지 않으면 후속 질문을 하지 않는다' in prompt
        assert '감정을 충분히 듣고 공감' in prompt

    def test_reply_mode_buttons_update_current_mode(self, logged_in_page):
        self._select_topic_with_role(logged_in_page, 'listener')

        logged_in_page.locator('.input-plus').click()
        logged_in_page.locator('#reply-mode-question').click()
        mode = logged_in_page.evaluate("() => state.replyMode")
        prompt = logged_in_page.evaluate("""() => {
            const topic = state.myTopics.find(t => t.id === 't-role-e2e');
            return _buildChatSysPrompt(true, topic, null);
        }""")

        assert mode == 'question'
        assert '사용자의 질문에 바로 답한다' in prompt
        assert '되묻거나 대화를 이어가기 위한 질문을 하지 않는다' in prompt
        assert logged_in_page.locator('#chat-input-bottom').get_attribute('placeholder') == '묻고 싶은 걸 그대로 적어주세요'

    def test_plus_menu_shows_domain_accordion_modes(self, logged_in_page):
        self._select_topic_with_role(logged_in_page, 'listener')

        logged_in_page.locator('.input-plus').click()
        menu_text = logged_in_page.locator('#plus-menu').inner_text()

        assert logged_in_page.locator('.pm-group-daily').is_visible()
        assert logged_in_page.locator('.pm-group-counseling').is_visible()
        assert logged_in_page.locator('.pm-group-investment').is_visible()
        assert '일상' in menu_text
        assert '상담' in menu_text
        assert '투자' in menu_text
        assert '받아쓰기' in menu_text
        assert '답변' in menu_text
        assert '정리' in menu_text
        assert '조언' in menu_text
        logged_in_page.locator('.pm-group-investment summary').click()
        assert logged_in_page.locator('#reply-mode-invest-status').is_visible()
        assert logged_in_page.locator('#reply-mode-invest-news').is_visible()
        assert logged_in_page.locator('#reply-mode-invest-rules').is_visible()
        assert logged_in_page.locator('#reply-mode-invest-trade').is_visible()
        assert '직접 쓰기' not in menu_text
        assert 'AI 응답 방식' not in menu_text

    def test_summary_mode_saves_ai_reply_as_record(self, logged_in_page):
        self._select_topic_with_role(logged_in_page, 'listener')
        logged_in_page.evaluate("""() => {
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/analyze')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        content: [{ text: '헬스장 가기 규칙: 전날 밤 운동복과 출근복을 함께 싸서 현관에 둔다.' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
            setReplyMode('summary');
        }""")

        logged_in_page.locator('#chat-input-bottom').fill('여기까지 정리해줘')
        logged_in_page.locator('#chat-input-bottom').press('Enter')
        logged_in_page.wait_for_function(
            "() => state.myRecords.some(r => r.memo === '대화 정리')",
            timeout=8_000,
        )

        record = logged_in_page.evaluate("""() => {
            const r = state.myRecords.find(r => r.memo === '대화 정리');
            return {
                topicId: r.topicId,
                content: r.content,
                recordNum: r.recordNum,
                aiChatLength: r.aiChat.length,
            };
        }""")

        assert record['topicId'] == 't-role-e2e'
        assert '헬스장 가기 규칙' in record['content']
        assert record['recordNum'] == 1
        assert record['aiChatLength'] >= 2

    def test_dictation_mode_records_without_ai_reply(self, logged_in_page):
        self._select_topic_with_role(logged_in_page, 'listener')

        logged_in_page.locator('#chat-input-bottom').fill('오늘 그냥 너무 피곤했음')
        logged_in_page.locator('#chat-input-bottom').press('Enter')
        logged_in_page.wait_for_selector('.chat-bubble-user', timeout=6_000)
        logged_in_page.wait_for_timeout(300)

        assert logged_in_page.locator('.chat-bubble-user').count() == 1
        assert logged_in_page.locator('.chat-bubble-ai').count() == 0
        assert logged_in_page.locator('#chat-typing-indicator').count() == 0

    def test_ai_does_not_start_chat_first(self, logged_in_page):
        self._select_topic_with_role(logged_in_page, 'listener')

        msg_count = logged_in_page.evaluate("() => state.currentChatMessages.length")
        assert msg_count == 0
        assert logged_in_page.locator('.chat-system-msg').count() == 0
        assert logged_in_page.locator('.chat-bubble-ai').count() == 0

    def test_old_starter_messages_are_not_restored(self, logged_in_page):
        logged_in_page.wait_for_load_state('networkidle')
        logged_in_page.evaluate("""() => {
            state.myTopics = [{
                id: 't-old-history',
                title: 'old history',
                aiPrompt: '',
                selectedRole: 'listener',
                createdAt: '2026-05-04',
            }];
            localStorage.setItem('jip_chat_t-old-history', JSON.stringify([
                { role: 'system', text: '대화 준비가 되었어요!' },
                { role: 'ai', text: '오늘 하루는 어땠어요?' },
            ]));
            state.view = 'myrecords';
            selectTopic('t-old-history');
        }""")

        assert logged_in_page.evaluate("() => state.currentChatMessages.length") == 0
        assert logged_in_page.locator('.chat-bubble-ai').count() == 0

    def test_new_chat_history_uses_v2_storage_key(self, logged_in_page):
        self._select_topic_with_role(logged_in_page, 'listener')

        logged_in_page.locator('#chat-input-bottom').fill('새 키에만 저장')
        logged_in_page.locator('#chat-input-bottom').press('Enter')
        logged_in_page.wait_for_selector('.chat-bubble-user', timeout=6_000)

        keys = logged_in_page.evaluate("""() => ({
            oldKey: localStorage.getItem('jip_chat_t-role-e2e'),
            newKey: localStorage.getItem('jip_chat_v2_t-role-e2e'),
        })""")
        assert keys['oldKey'] is None
        assert keys['newKey'] is not None


class TestInvestmentPartner:
    """투자 파트너 1차 MVP — 룰 기반 매매 전 판단 게이트."""

    def _open_investment(self, page):
        page.wait_for_selector('#nav-invest', timeout=8_000)
        page.click('#nav-invest')
        page.wait_for_selector('#investment-view', timeout=8_000)

    def test_investment_nav_renders_chat_first_layout(self, logged_in_page):
        self._open_investment(logged_in_page)

        assert logged_in_page.locator('#investment-view').is_visible()
        assert logged_in_page.locator('#investment-portfolio-summary').is_visible()
        assert logged_in_page.locator('#chat-input-bottom').is_visible()
        assert '대화를 시작해보세요' in logged_in_page.locator('#main-content').inner_text()
        assert logged_in_page.locator('#investment-position-form').count() == 0
        assert logged_in_page.locator('#investment-gate-form').count() == 0

    def test_investment_has_default_guardrail_rules(self, logged_in_page):
        self._open_investment(logged_in_page)

        rules = logged_in_page.evaluate("""() => state.investment.rules""")
        assert rules['dailyLossLimit'] == 2
        assert rules['maxPositionWeight'] == 25
        assert rules['cooldownMinutes'] == 45
        assert rules['chaseLimit'] == 3
        assert '계획 없이 매수하지 않는다' in rules['coreRules']
        assert '손실 직후 물타기' in rules['coreRules']
        assert '뉴스 제목만 보고 즉시 시장가 매수' in rules['bannedSetups']
        assert '주문 연동' in logged_in_page.locator('#main-content').inner_text()

    def test_investment_plus_menu_defaults_to_investment_modes(self, logged_in_page):
        self._open_investment(logged_in_page)

        logged_in_page.locator('.input-plus').click()
        assert logged_in_page.locator('.pm-group-investment').get_attribute('open') is not None
        logged_in_page.locator('#reply-mode-invest-status').click()

        assert logged_in_page.evaluate("() => state.replyMode") == 'invest-status'
        assert logged_in_page.locator('#chat-input-bottom').get_attribute('placeholder') == '확인할 종목이나 포트폴리오 상태를 물어보세요'
        prompt = logged_in_page.evaluate("() => _replyModePrompt(state.replyMode)")
        assert '현재 응답 모드: 투자 상태' in prompt
        assert '현재가, 평단, 평가손익' in prompt

    def test_investment_side_menu_opens_management_modals(self, logged_in_page):
        self._open_investment(logged_in_page)

        logged_in_page.evaluate("""() => {
            state.investment.positions = [{
                id: 'ip-chart-1',
                symbol: 'IREN',
                name: 'Iris Energy',
                shares: '1,700',
                avgPrice: '46.06',
                currentPrice: 58,
                marketUpdatedAt: '2026-05-06T04:00:00.000Z',
            }, {
                id: 'ip-chart-2',
                symbol: 'AAPL',
                name: 'Apple',
                shares: 1,
                avgPrice: 40,
                currentPrice: 50,
            }];
            render();
        }""")

        logged_in_page.locator('#investment-menu-portfolio').click()
        logged_in_page.wait_for_selector('#investment-portfolio-modal', timeout=8_000)
        assert logged_in_page.locator('.investment-pie-chart').is_visible()
        modal_text = logged_in_page.locator('#modal-box').inner_text()
        assert 'IREN' in modal_text
        assert '$98,600' in modal_text
        assert '$78,342' in modal_text
        assert '1,700' in modal_text
        assert '99.9%' in modal_text
        assert '포트폴리오 리포트' in modal_text
        assert '현재 상태' in modal_text
        assert '투자 원칙 체크' in modal_text
        assert '성과 기여' in modal_text
        assert '최대 보유' in modal_text
        assert '고집중' in modal_text
        assert '위험 신호' in modal_text
        assert '현재가 갱신 필요' in modal_text
        assert logged_in_page.locator('#investment-menu-refresh').count() == 0
        assert logged_in_page.locator('#investment-menu-positions').count() == 0
        logged_in_page.locator('.modal-close').click()

        logged_in_page.locator('#investment-menu-portfolio').click()
        logged_in_page.wait_for_selector('#investment-position-form', state='attached', timeout=8_000)
        assert logged_in_page.locator('#investment-manage-tools').evaluate("(el) => !el.open")
        assert '종목 관리' in logged_in_page.locator('#modal-box').inner_text()
        assert logged_in_page.locator('#ip-current').count() == 0
        logged_in_page.locator('.modal-close').click()

        logged_in_page.locator('#investment-menu-news').click()
        logged_in_page.wait_for_selector('#investment-news-form', state='attached', timeout=8_000)
        assert '뉴스 동향' in logged_in_page.locator('#modal-box').inner_text()
        assert logged_in_page.locator('#investment-news-edit-tools').evaluate("(el) => !el.open")
        logged_in_page.locator('#investment-news-edit-tools summary').click()
        logged_in_page.locator('#in-symbol').fill('IREN')
        logged_in_page.locator('#in-title').fill('Clarity Act update')
        logged_in_page.locator('#in-body').fill('## 핵심 요약\n- 규제 불확실성 완화\n[원문](https://example.com/news)')
        logged_in_page.locator('#investment-news-form button[type="submit"]').click()
        logged_in_page.wait_for_function("() => !document.getElementById('modal-overlay').classList.contains('open')", timeout=8_000)
        logged_in_page.locator('#investment-menu-news').click()
        logged_in_page.wait_for_selector('.investment-news-card .chat-markdown h5', timeout=8_000)
        news_text = logged_in_page.locator('#modal-box').inner_text()
        assert '뉴스 동향 리포트' in news_text
        assert '저장 뉴스' in news_text
        assert '관련 종목' in news_text
        assert logged_in_page.locator('.investment-news-card .chat-markdown h5').inner_text() == '핵심 요약'
        assert logged_in_page.locator('.investment-news-card .chat-markdown li').inner_text() == '규제 불확실성 완화'
        assert logged_in_page.locator('.investment-news-card .chat-markdown a').get_attribute('href') == 'https://example.com/news'
        logged_in_page.locator('.modal-close').click()

        logged_in_page.locator('#investment-menu-rules').click()
        logged_in_page.wait_for_selector('#investment-save-rules', state='attached', timeout=8_000)
        rules_text = logged_in_page.locator('#modal-box').inner_text()
        assert '트레이딩 플랜' in rules_text
        assert '하루 손실' in rules_text
        assert '핵심 원칙' in rules_text
        assert logged_in_page.locator('.investment-rules-overview').is_visible()
        assert logged_in_page.locator('#investment-rules-edit-tools').evaluate("(el) => !el.open")
        logged_in_page.locator('#investment-rules-edit-tools summary').click()
        rules_text = logged_in_page.locator('#modal-box').inner_text()
        assert '리스크 한도' in rules_text
        assert '진입 / 청산 체크리스트' in rules_text
        logged_in_page.locator('#ir-risk-trade').fill('0.8')
        logged_in_page.locator('#ir-entry').fill('손익비 2:1 이상일 때만 진입')
        logged_in_page.locator('#investment-save-rules').click()
        logged_in_page.wait_for_function("() => state.investment.rules.riskPerTrade === 0.8", timeout=8_000)

        logged_in_page.locator('#investment-menu-decisions').click()
        logged_in_page.wait_for_selector('#investment-gate-form', state='attached', timeout=8_000)
        journal_text = logged_in_page.locator('#modal-box').inner_text()
        assert '매매 저널' in journal_text
        assert logged_in_page.locator('#investment-gate-tools').evaluate("(el) => !el.open")
        logged_in_page.locator('#investment-gate-tools summary').click()
        journal_text = logged_in_page.locator('#modal-box').inner_text()
        assert '거래 개요' in journal_text
        assert '주문 계획' in journal_text
        assert '주문 전 확인' in journal_text
        logged_in_page.locator('.modal-close').click()

    def test_investment_krw_auxiliary_display_keeps_usd_inputs(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.investment.positions = [{
                id: 'ip-currency',
                symbol: 'NVDA',
                name: 'NVIDIA',
                shares: 2,
                avgPrice: 100,
                currentPrice: 120,
            }];
            state.investment.usdKrwRate = 1300;
            window.apiSaveInvestmentPosition = async (position) => ({
                ok: true,
                position,
                investment: { ...state.investment, positions: state.investment.positions },
            });
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/market/quote')) {
                    return Promise.resolve(new Response(JSON.stringify({ quotes: [] }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }));
                }
                return originalFetch(url, opts);
            };
            render();
        }""")

        logged_in_page.locator('#investment-menu-portfolio').click()
        logged_in_page.wait_for_selector('#investment-portfolio-modal', timeout=8_000)
        modal_text = logged_in_page.locator('#modal-box').inner_text()
        assert '$240' in modal_text
        assert '₩312,000' in modal_text
        assert logged_in_page.locator('#investment-currency-toggle-modal').count() == 0
        assert '($)' in logged_in_page.locator('#ip-avg').get_attribute('placeholder')

        logged_in_page.locator('#investment-manage-tools summary').click()
        logged_in_page.locator('#ip-symbol').fill('USD1')
        logged_in_page.locator('#ip-name').fill('Usd Test')
        logged_in_page.locator('#ip-shares').fill('3')
        logged_in_page.locator('#ip-avg').fill('80')
        logged_in_page.locator('#investment-add-position').click()
        logged_in_page.wait_for_function(
            "() => Math.round(state.investment.positions.at(-1).avgPrice * 100) / 100 === 80",
            timeout=8_000,
        )

    def test_investment_timeline_modal_lists_events_and_decisions(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.investment.events = [{
                id: 'ie-timeline-news',
                date: '2026-05-06',
                type: 'news',
                symbol: 'CRCL',
                title: 'Circle news',
                body: 'Stablecoin policy update',
                severity: 'info',
            }];
            state.investment.decisions = [{
                id: 'id-timeline',
                createdAt: '2026-05-05T10:00:00',
                symbol: 'IREN',
                action: 'buy',
                setup: 'planned',
                timeframe: 'swing',
                verdict: 'journal',
                label: 'Chat note',
                summary: 'Planned entry memo',
            }];
            render();
        }""")

        logged_in_page.locator('#investment-menu-timeline').click()
        logged_in_page.wait_for_selector('.investment-timeline', timeout=8_000)
        timeline_text = logged_in_page.locator('#modal-box').inner_text()
        assert 'CRCL' in timeline_text
        assert 'Circle news' in timeline_text
        assert 'IREN' in timeline_text
        assert 'Planned entry memo' in timeline_text

    def test_investment_ai_compare_modal_renders_two_provider_cards(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            window.apiCompareInvestmentAI = async () => ({
                ok: true,
                results: [
                    { ok: true, provider: 'claude', model: 'claude-test', text: 'Check the rule first.' },
                    { ok: true, provider: 'openai', model: 'openai-test', text: 'Check the risk first.' },
                ],
            });
            window.fetchInvestmentNewsContext = async () => '';
        }""")

        logged_in_page.locator('#investment-menu-ai-compare').click()
        logged_in_page.wait_for_selector('#investment-ai-compare-form', timeout=8_000)
        logged_in_page.locator('#iac-question').fill('IREN add?')
        logged_in_page.locator('#iac-run').click()
        logged_in_page.wait_for_selector('.investment-ai-card', timeout=8_000)
        modal_text = logged_in_page.locator('#modal-box').inner_text()
        assert 'Claude' in modal_text
        assert 'OpenAI' in modal_text
        assert 'Check the rule first.' in modal_text
        assert 'Check the risk first.' in modal_text

    def test_investment_signal_modal_saves_manual_source_without_auto_x_sync(self, logged_in_page):
        self._open_investment(logged_in_page)

        logged_in_page.locator('#investment-menu-signals').click()
        logged_in_page.wait_for_selector('#investment-signals-modal', timeout=8_000)
        assert logged_in_page.locator('#investment-x-sync').count() == 0
        modal_text = logged_in_page.locator('#modal-box').inner_text()
        assert 'Auto X sync' in modal_text
        assert 'Paused' in modal_text

        logged_in_page.locator('#investment-signal-manual-tools').evaluate("(el) => { el.open = true; }")
        logged_in_page.wait_for_selector('#is-title', state='visible', timeout=8_000)
        logged_in_page.evaluate("""() => {
            document.getElementById('is-symbol').value = 'IREN';
            document.getElementById('is-handle').value = 'thetechinvest';
            document.getElementById('is-title').value = 'AI infra signal';
            document.getElementById('is-url').value = 'https://x.com/thetechinvest/status/123';
            document.getElementById('is-body').value = '## Signal\\n- IREN data center thread needs verification';
            document.getElementById('investment-signal-form').requestSubmit();
        }""")
        logged_in_page.wait_for_function(
            "() => state.investment.events.some(e => e.type === 'signal' && e.symbol === 'IREN')",
            timeout=8_000,
        )
        logged_in_page.wait_for_selector('.investment-news-card .chat-markdown h5', timeout=8_000)
        assert logged_in_page.locator('.investment-news-card .chat-markdown h5').inner_text() == 'Signal'

    def test_investment_chat_searches_news_for_x_or_trader_requests(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            const originalFetch = window.fetch.bind(window);
            window.__investmentNewsUrl = '';
            window.__capturedAnalyzePayload = null;
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/investment/news')) {
                    window.__investmentNewsUrl = String(url);
                    return Promise.resolve(new Response(JSON.stringify({
                        source: 'test-news-search',
                        requested: ['IREN'],
                        requestedQueries: ['thetechinvest IREN market news'],
                        news: [{
                            topic: 'thetechinvest IREN market news',
                            title: 'Trader commentary says IREN AI infra remains in focus',
                            published: '2026-05-07',
                            publisher: 'Test News',
                            source: 'google-news-rss',
                            summary: 'Public search result summary.',
                            link: 'https://example.com/iren-signal',
                        }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                if (String(url).includes('/api/analyze')) {
                    window.__capturedAnalyzePayload = JSON.parse(opts.body);
                    return Promise.resolve(new Response(JSON.stringify({
                        content: [{ text: 'Searched public results first and treated this as a weak signal.' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
        }""")

        logged_in_page.locator('#chat-input-bottom').fill('thetechinvest IREN X 코멘트 찾아줘')
        logged_in_page.locator('#chat-input-bottom').press('Enter')
        logged_in_page.wait_for_function(
            "() => window.__capturedAnalyzePayload && window.__investmentNewsUrl.includes('/api/investment/news')",
            timeout=8_000,
        )
        assert 'thetechinvest' in logged_in_page.evaluate("() => decodeURIComponent(window.__investmentNewsUrl)")
        system_text = logged_in_page.evaluate("() => window.__capturedAnalyzePayload.system[0].text")
        assert 'Trader commentary says IREN AI infra remains in focus' in system_text
        assert 'Automatic X monitoring is paused' in system_text

    def test_investment_chat_fetches_market_context_for_position_status(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.investment.positions = [{
                id: 'ip-crcl-status',
                symbol: 'CRCL',
                name: 'Circle Internet Group',
                shares: 2,
                avgPrice: 128.91,
                currentPrice: 120,
                targetPrice: 300,
                stopPrice: 50,
            }];
            const originalFetch = window.fetch.bind(window);
            window.__capturedAnalyzePayload = null;
            window.fetch = (url, opts) => {
                const textUrl = String(url);
                if (textUrl.includes('/api/market/quote')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        source: 'test-quote',
                        requested: ['CRCL'],
                        quotes: [{
                            symbol: 'CRCL',
                            name: 'Circle Internet Group',
                            price: 131.25,
                            changePercent: 2.4,
                            previousClose: 128.17,
                        }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                if (textUrl.includes('/api/analyze')) {
                    window.__capturedAnalyzePayload = JSON.parse(opts.body);
                    return Promise.resolve(new Response(JSON.stringify({
                        content: [{ text: 'CRCL 현재가는 $131.25 기준으로 보겠습니다.' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
            render();
        }""")

        logged_in_page.evaluate("() => continueContextChat('지금 써클 상태 어때?')")
        logged_in_page.wait_for_function(
            "() => window.__capturedAnalyzePayload?.system?.[0]?.text?.includes('투자 시세/보유 상태 조회 결과')",
            timeout=8_000,
        )
        system_prompt = logged_in_page.evaluate("() => window.__capturedAnalyzePayload.system[0].text")
        assert 'CRCL' in system_prompt
        assert '131.25' in system_prompt
        assert '실시간 시세 조회 기능이 없다' in system_prompt
        logged_in_page.wait_for_function(
            "() => state.investment.positions.find(p => p.symbol === 'CRCL')?.currentPrice === 131.25",
            timeout=8_000,
        )

    def test_investment_rule_prompt_allows_default_guardrail_proposals(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.replyMode = 'invest-rules';
            state.investment.rules.maxPositionWeight = 25;
            state.investment.positions = [{
                id: 'ip-iren-heavy',
                symbol: 'IREN',
                name: 'Iris Energy',
                shares: 100,
                avgPrice: 40,
                currentPrice: 50,
            }, {
                id: 'ip-cash',
                assetType: 'cash',
                symbol: 'CASH',
                name: 'USD Cash',
                shares: 1000,
                avgPrice: 1,
                currentPrice: 1,
                cashAmount: 1000,
                manualPrice: true,
            }];
        }""")

        prompt = logged_in_page.evaluate("() => _buildChatSysPrompt(false, null, null)")

        assert '제 역할 밖' in prompt
        assert '원칙 후보' in prompt
        assert '보수적 기본안' in prompt
        assert '단계적 축소안' in prompt
        assert '현재 비중' in prompt
        assert '25%' in prompt

    def test_investment_trade_prompt_requires_analyst_action_plan_quality(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.replyMode = 'invest-trade';
            state.investment.positions = [{
                id: 'ip-iren-event',
                symbol: 'IREN',
                name: 'Iris Energy',
                shares: 780,
                avgPrice: 46.06,
                currentPrice: 60.98,
                targetPrice: 75,
                stopPrice: 55,
                thesis: 'AI cloud execution and earnings catalyst',
            }];
            state.investment.events = [{
                id: 'earnings-iren-2026-05-07',
                date: '2026-05-07',
                type: 'earnings',
                symbol: 'IREN',
                title: 'IREN 실적 발표',
                body: 'EPS 컨센서스와 AI cloud 가이던스 확인',
            }];
        }""")

        prompt = logged_in_page.evaluate("() => _buildChatSysPrompt(false, null, null)")

        assert '포트폴리오 스냅샷' in prompt
        assert '남은 원가' in prompt
        assert '세금 예비금' in prompt
        assert '시나리오별 행동 규칙' in prompt
        assert '수익 방어/업사이드 참여' in prompt
        assert '공짜 주식' in prompt
        assert '최종 액션 플랜' in prompt
        assert '다가오는 투자 일정' in prompt
        assert 'IREN 실적 발표' in prompt
        assert '컨센서스가 빗나갈 수 있는 지점' in prompt
        assert '옵션 기대 변동폭' in prompt
        assert 'AI Cloud revenue' in prompt
        assert 'ATM/유상증자' in prompt
        assert '루머 해소 실패' in prompt

    def test_kis_sync_button_merges_broker_positions(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/investment/broker/sync')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        ok: true,
                        positionsSynced: 1,
                        tradesSynced: 1,
                        investment: {
                            ...state.investment,
                            positions: [{
                                id: 'kis-us-IREN',
                                symbol: 'IREN',
                                name: 'Iris Energy',
                                shares: 10,
                                avgPrice: 40,
                                currentPrice: 50,
                                brokerSource: 'kis',
                            }],
                            decisions: [{
                                id: 'kis-trade-1',
                                type: 'trade',
                                symbol: 'IREN',
                                action: 'buy',
                                tradeShares: 10,
                                tradePrice: 40,
                            }],
                            broker: {
                                status: 'connected',
                                provider: 'kis',
                                orderIntentOnly: true,
                                lastSyncedAt: '2026-05-06T00:00:00Z',
                            },
                        },
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
            render();
        }""")

        logged_in_page.locator('#investment-sync-kis').click()
        logged_in_page.wait_for_function(
            "() => state.investment.positions.some(p => p.symbol === 'IREN' && p.brokerSource === 'kis')",
            timeout=8_000,
        )
        assert 'IREN' in logged_in_page.locator('#investment-view').inner_text()

    def test_investment_calendar_sync_adds_events_to_calendar(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/investment/calendar/sync')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        ok: true,
                        eventsSynced: 3,
                        missingProviders: [],
                        investment: {
                            ...state.investment,
                            events: [{
                                id: 'earnings-iren-2026-05-07',
                                date: '2026-05-07',
                                type: 'earnings',
                                symbol: 'IREN',
                                title: 'IREN 실적 발표',
                                body: 'EPS 컨센서스 점검',
                            }, {
                                id: 'macro-cpi-2026-05-12',
                                date: '2026-05-12',
                                type: 'macro',
                                symbol: 'MACRO',
                                title: 'CPI',
                                body: '인플레이션 컨센서스 확인',
                            }, {
                                id: 'analyst-iren-target',
                                date: '2026-05-07',
                                type: 'analyst',
                                symbol: 'IREN',
                                title: 'IREN 목표주가 컨센서스',
                                body: '목표가 변화 점검',
                            }],
                            calendar: {
                                lastSyncedAt: '2026-05-07T00:00:00Z',
                                lookaheadDays: 45,
                                eventsSynced: 3,
                            },
                        },
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
            render();
        }""")

        logged_in_page.locator('#investment-sync-calendar').click()
        logged_in_page.wait_for_function(
            "() => state.investment.events.some(e => e.type === 'macro' && e.title === 'CPI')",
            timeout=8_000,
        )
        logged_in_page.evaluate("() => setView('calendar')")
        logged_in_page.wait_for_selector('.cal-event-invest', timeout=8_000)
        calendar_text = logged_in_page.locator('.calendar').inner_text()
        assert 'IREN 실적 발표' in calendar_text
        assert 'CPI' in calendar_text

    def test_refresh_data_from_server_updates_investment_positions(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/data')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        students: [],
                        sessions: [],
                        my_topics: [],
                        my_records: [],
                        investment: {
                            ...state.investment,
                            positions: [{
                                id: 'ip-sync',
                                symbol: 'SYNC',
                                name: 'Synced Position',
                                shares: 4,
                                avgPrice: 10,
                                currentPrice: 12,
                            }],
                        },
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }));
                }
                return originalFetch(url, opts);
            };
        }""")

        logged_in_page.evaluate("() => refreshDataFromServer({ force: true })")
        logged_in_page.wait_for_function(
            "() => state.investment.positions.some(p => p.symbol === 'SYNC')",
            timeout=8_000,
        )
        assert 'SYNC' in logged_in_page.locator('#investment-view').inner_text()

    def test_rule_engine_blocks_overweight_add(self, logged_in_page):
        logged_in_page.wait_for_load_state('networkidle')
        verdict = logged_in_page.evaluate("""() => evaluateInvestmentDecision({
            position: {
                symbol: 'NVDA',
                shares: 10,
                avgPrice: 100,
                currentPrice: 120,
                longTerm: false,
            },
            rules: {
                maxPositionWeight: 30,
                cooldownMinutes: 30,
                chaseLimit: 5,
                antiAveraging: true,
                longTermBias: true,
            },
            totals: { totalValue: 1200 },
            action: 'add',
            context: 'rally',
            reason: '오르는 것 같아서 더 사고 싶다',
        })""")

        assert verdict['status'] == 'block'
        assert '비중' in '\n'.join(verdict['findings'])

    def test_gate_saves_decision_and_calendar_event(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.locator('#investment-menu-portfolio').click()
        logged_in_page.evaluate("""() => {
            state.investment.positions = [];
            state.investment.decisions = [];
            state.investment.events = [];
            window.apiSaveInvestmentPosition = async () => ({
                ok: true,
                investment: { ...state.investment, positions: state.investment.positions },
            });
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/market/quote')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        quotes: [{ symbol: 'NVDA', price: 120, changePercent: 2.1, previousClose: 117.5, name: 'NVIDIA' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
        }""")

        logged_in_page.locator('#investment-manage-tools summary').click()
        logged_in_page.locator('#ip-symbol').fill('NVDA')
        logged_in_page.locator('#ip-name').fill('NVIDIA')
        logged_in_page.locator('#ip-shares').fill('10')
        logged_in_page.locator('#ip-avg').fill('100')
        logged_in_page.locator('#ip-thesis').fill('AI 가속기 장기 성장')
        logged_in_page.locator('#investment-add-position').click()
        logged_in_page.wait_for_function(
            "() => state.investment.positions.at(-1)?.currentPrice === 120",
            timeout=8_000,
        )
        logged_in_page.locator('.modal-close').click()

        logged_in_page.evaluate("() => { state.investment.rules.maxPositionWeight = 30; render(); }")

        logged_in_page.locator('#investment-menu-decisions').click()
        position_id = logged_in_page.evaluate("() => state.investment.positions.at(-1).id")
        logged_in_page.locator('#ig-position').select_option(position_id)
        logged_in_page.locator('#ig-action').select_option('add')
        logged_in_page.locator('#ig-context').select_option('rally')
        logged_in_page.locator('#ig-reason').fill('급등을 놓칠까 봐 추가매수하고 싶다')
        logged_in_page.locator('#investment-gate-run').click()

        logged_in_page.wait_for_selector('.investment-verdict.block', timeout=8_000)
        result = logged_in_page.evaluate("""() => ({
            decisions: state.investment.decisions.length,
            events: state.investment.events.length,
            lastStatus: state.investment.decisions.at(-1).verdict,
            eventType: state.investment.events.at(-1).type,
        })""")

        assert result['decisions'] == 1
        assert result['events'] >= 1
        assert result['lastStatus'] == 'block'
        assert result['eventType'] == 'alert'

        logged_in_page.evaluate("() => setView('calendar')")
        logged_in_page.wait_for_selector('.cal-event-invest', timeout=8_000)

    def test_allowed_trade_updates_portfolio_position(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.investment.positions = [{
                id: 'ip-trade-sync',
                symbol: 'NVDA',
                name: 'NVIDIA',
                shares: 10,
                avgPrice: 100,
                currentPrice: 120,
            }];
            state.investment.rules = { ...state.investment.rules, maxPositionWeight: 200, chaseLimit: 50 };
            state.investment.decisions = [];
            state.investment.events = [];
            render();
        }""")

        logged_in_page.locator('#investment-menu-decisions').click()
        logged_in_page.locator('#ig-position').select_option('ip-trade-sync')
        logged_in_page.locator('#ig-action').select_option('add')
        logged_in_page.locator('#ig-context').select_option('normal')
        logged_in_page.locator('#ig-shares').fill('5')
        logged_in_page.locator('#ig-price').fill('140')
        logged_in_page.locator('#ig-stop').fill('120')
        logged_in_page.locator('#ig-target').fill('190')
        logged_in_page.locator('#ig-risk-reward').fill('2.5')
        logged_in_page.locator('#ig-check-thesis').check()
        logged_in_page.locator('#ig-check-risk').check()
        logged_in_page.locator('#ig-check-size').check()
        logged_in_page.locator('#ig-check-cooldown').check()
        logged_in_page.locator('#ig-invalidation').fill('120 이탈')
        logged_in_page.locator('#ig-reason').fill('계획된 분할매수')
        logged_in_page.locator('#investment-gate-run').click()
        logged_in_page.wait_for_selector('.investment-verdict.allow', timeout=8_000)

        result = logged_in_page.evaluate("""() => {
            const p = state.investment.positions.find(item => item.id === 'ip-trade-sync');
            return {
                shares: p.shares,
                avgPrice: p.avgPrice,
                currentPrice: p.currentPrice,
                decisionTradeShares: state.investment.decisions.at(-1).tradeShares,
                eventType: state.investment.events.at(-1).type,
            };
        }""")
        assert result['shares'] == 15
        assert round(result['avgPrice'], 2) == 113.33
        assert result['currentPrice'] == 140
        assert result['decisionTradeShares'] == 5
        assert result['eventType'] == 'trade'

    def test_portfolio_modal_edits_and_deletes_position(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.investment.positions = [{
                id: 'ip-edit',
                symbol: 'EDIT',
                name: 'Edit Co',
                shares: 3,
                avgPrice: 10,
                currentPrice: 11,
                manualPrice: true,
            }];
            render();
        }""")

        logged_in_page.locator('#investment-menu-portfolio').click()
        logged_in_page.locator('.investment-manage-row button').first.click()
        assert logged_in_page.locator('#ip-id').input_value() == 'ip-edit'
        logged_in_page.locator('#ip-shares').fill('4')
        logged_in_page.locator('#investment-add-position').click()
        logged_in_page.wait_for_function(
            "() => state.investment.positions.find(p => p.id === 'ip-edit')?.shares === 4",
            timeout=8_000,
        )

        logged_in_page.once("dialog", lambda dialog: dialog.accept())
        logged_in_page.locator('.investment-manage-row .danger').click()
        logged_in_page.wait_for_function(
            "() => !state.investment.positions.some(p => p.id === 'ip-edit')",
            timeout=8_000,
        )

    def test_portfolio_registers_crypto_alias_and_cash(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.locator('#investment-menu-portfolio').click()
        logged_in_page.evaluate("""() => {
            state.investment.positions = [];
            window.apiSaveInvestmentPosition = async () => ({
                ok: true,
                investment: { ...state.investment, positions: state.investment.positions },
            });
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/market/quote')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        quotes: [{ symbol: 'ETH-USD', price: 3100, changePercent: 1.5, previousClose: 3054, name: 'Ethereum USD' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
        }""")

        logged_in_page.locator('#investment-manage-tools summary').click()
        logged_in_page.locator('#ip-asset-type').select_option('crypto')
        logged_in_page.locator('#ip-symbol').fill('이더리움')
        logged_in_page.locator('#ip-shares').fill('2')
        logged_in_page.locator('#ip-avg').fill('2500')
        logged_in_page.locator('#investment-add-position').click()
        logged_in_page.wait_for_function(
            "() => state.investment.positions.some(p => p.symbol === 'ETH-USD' && p.currentPrice === 3100)",
            timeout=8_000,
        )

        logged_in_page.locator('#investment-manage-tools summary').click()
        logged_in_page.locator('#ip-asset-type').select_option('cash')
        logged_in_page.locator('#ip-shares').fill('1000')
        logged_in_page.locator('#investment-add-position').click()
        logged_in_page.wait_for_function(
            "() => state.investment.positions.some(p => p.assetType === 'cash' && p.cashAmount === 1000)",
            timeout=8_000,
        )
        result = logged_in_page.evaluate("""() => ({
            total: investmentTotals(state.investment.positions).totalValue,
            cashInGate: [...document.querySelectorAll('#ig-position option')].some(o => o.value.includes('cash')),
        })""")
        assert result['total'] == 7200

    def test_portfolio_registers_circle_label_as_crcl(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.locator('#investment-menu-portfolio').click()
        logged_in_page.evaluate("""() => {
            state.investment.positions = [];
            window.apiSaveInvestmentPosition = async () => ({
                ok: true,
                investment: { ...state.investment, positions: state.investment.positions },
            });
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/market/quote')) {
                    if (!String(url).includes('CRCL')) throw new Error('CRCL not requested');
                    return Promise.resolve(new Response(JSON.stringify({
                        quotes: [{ symbol: 'CRCL', price: 91.2, changePercent: 1.1, previousClose: 90.2, name: 'Circle Internet Group' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
        }""")

        logged_in_page.locator('#investment-manage-tools summary').click()
        logged_in_page.locator('#ip-symbol').fill('써클(CRCL)')
        logged_in_page.locator('#ip-name').fill('Circle Internet Group')
        logged_in_page.locator('#ip-shares').fill('2')
        logged_in_page.locator('#ip-avg').fill('80')
        logged_in_page.locator('#investment-add-position').click()
        logged_in_page.wait_for_function(
            "() => state.investment.positions.at(-1)?.symbol === 'CRCL' && state.investment.positions.at(-1)?.currentPrice === 91.2",
            timeout=8_000,
        )

    def test_position_register_waits_for_server_persistence(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""async () => {
            const res = await fetch('/api/data');
            const d = await res.json();
            d.investment = {
                positions: [],
                rules: {},
                journal: [],
                events: [],
                decisions: [],
                chat: [],
                market: { indexes: [], fetchedAt: null, source: '' },
                alerts: [],
            };
            await fetch('/api/data', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(d),
            });
            await loadData();
            state.view = 'investment';
            render();
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/market/quote')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        quotes: [{ symbol: 'QQQ', price: 46.06, changePercent: 0.5, previousClose: 45.83, name: 'Invesco QQQ' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
        }""")
        logged_in_page.locator('#investment-menu-portfolio').click()

        logged_in_page.locator('#investment-manage-tools summary').click()
        logged_in_page.locator('#ip-symbol').fill('QQQ')
        logged_in_page.locator('#ip-name').fill('Invesco QQQ')
        logged_in_page.locator('#ip-shares').fill('3')
        logged_in_page.locator('#investment-add-position').click()
        logged_in_page.wait_for_function(
            """async () => {
                const res = await fetch('/api/data');
                const d = await res.json();
                return d.investment.positions.some(p => p.symbol === 'QQQ' && p.currentPrice === 46.06);
            }""",
            timeout=8_000,
        )
        logged_in_page.wait_for_function(
            "() => document.querySelector('#modal-box')?.innerText.includes('$138.18')",
            timeout=8_000,
        )

    def test_position_register_retries_transient_server_save_failure(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.locator('#investment-menu-portfolio').click()
        logged_in_page.evaluate("""() => {
            let saveAttempts = 0;
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/market/quote')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        quotes: [{ symbol: 'MSFT', price: 410, changePercent: 0.7, previousClose: 407, name: 'Microsoft' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                if (String(url).includes('/api/investment/positions') && opts?.method === 'POST') {
                    saveAttempts += 1;
                    if (saveAttempts < 3) {
                        return Promise.resolve(new Response(JSON.stringify({ error: 'temporary' }), {
                            status: 502,
                            headers: { 'Content-Type': 'application/json' },
                        }));
                    }
                    const position = JSON.parse(opts.body).position;
                    return Promise.resolve(new Response(JSON.stringify({
                        ok: true,
                        position,
                        investment: {
                            positions: [position],
                            rules: state.investment.rules,
                            journal: [],
                            events: [],
                            decisions: [],
                            chat: [],
                            market: { indexes: [], fetchedAt: null, source: '' },
                            alerts: [],
                        },
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }));
                }
                return originalFetch(url, opts);
            };
            window.__saveAttempts = () => saveAttempts;
        }""")

        logged_in_page.locator('#investment-manage-tools summary').click()
        logged_in_page.locator('#ip-symbol').fill('MSFT')
        logged_in_page.locator('#ip-shares').fill('1')
        logged_in_page.locator('#investment-add-position').click()
        logged_in_page.wait_for_function("() => window.__saveAttempts() === 3", timeout=8_000)
        logged_in_page.wait_for_selector('#investment-portfolio-manage', timeout=8_000)

    def test_position_save_response_does_not_drop_existing_positions(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.investment.positions = [{
                id: 'ip-old-1',
                symbol: 'OLD1',
                name: 'Old One',
                shares: 2,
                avgPrice: 10,
                currentPrice: 12,
            }, {
                id: 'ip-old-2',
                symbol: 'OLD2',
                name: 'Old Two',
                shares: 3,
                avgPrice: 20,
                currentPrice: null,
            }];
            render();
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/market/quote')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        quotes: [{ symbol: 'NEW1', price: 30, changePercent: 0.2, previousClose: 29.94, name: 'New One' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                if (String(url).includes('/api/investment/positions') && opts?.method === 'POST') {
                    const position = JSON.parse(opts.body).position;
                    return Promise.resolve(new Response(JSON.stringify({
                        ok: true,
                        position,
                        investment: {
                            positions: [position],
                            rules: state.investment.rules,
                            journal: [],
                            events: [],
                            decisions: [],
                            chat: [],
                            market: { indexes: [], fetchedAt: null, source: '' },
                            alerts: [],
                        },
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
        }""")

        logged_in_page.locator('#investment-menu-portfolio').click()
        logged_in_page.locator('#investment-manage-tools summary').click()
        logged_in_page.locator('#ip-symbol').fill('NEW1')
        logged_in_page.locator('#ip-name').fill('New One')
        logged_in_page.locator('#ip-shares').fill('4')
        logged_in_page.locator('#investment-add-position').click()
        logged_in_page.wait_for_function(
            "() => state.investment.positions.length === 3 && state.investment.positions.some(p => p.symbol === 'OLD1') && state.investment.positions.some(p => p.symbol === 'OLD2') && state.investment.positions.some(p => p.symbol === 'NEW1')",
            timeout=8_000,
        )

        modal_text = logged_in_page.locator('#modal-box').inner_text()
        assert 'OLD1' in modal_text
        assert 'OLD2' in modal_text
        assert 'NEW1' in modal_text
        assert '현재가 미조회 종목' in modal_text

    def test_investment_chat_records_news_when_requested(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.currentChatMessages = [];
            state.investment.chat = [];
            render();
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/analyze')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        content: [{ text: 'NVDA 뉴스 동향: AI 수요 기대가 이어지지만 밸류에이션 부담도 함께 확인해야 합니다.' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
            setReplyMode('question');
        }""")

        logged_in_page.locator('#chat-input-bottom').fill('오늘 NVDA 관련 뉴스 정리하고 뉴스 동향에 기록해줘')
        logged_in_page.locator('#chat-input-bottom').press('Enter')
        logged_in_page.wait_for_function(
            "() => state.investment.events.some(e => e.type === 'news' && e.title.includes('뉴스 동향'))",
            timeout=8_000,
        )

        assert logged_in_page.locator('.chat-bubble-ai').count() == 1

    def test_investment_news_request_injects_search_results(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            window.__analyzePayloads = [];
            window.__newsUrls = [];
            state.investment.positions = [{
                id: 'ip-news-iren',
                symbol: 'IREN',
                name: 'Iris Energy',
                shares: 1,
                currentPrice: 46.06,
            }];
            state.currentChatMessages = [];
            state.investment.chat = [];
            render();
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/investment/news')) {
                    window.__newsUrls.push(String(url));
                    return Promise.resolve(new Response(JSON.stringify({
                        source: 'aggregated-investment-news',
                        requested: ['IREN'],
                        requestedQueries: ['crypto market structure clarity act'],
                        news: [{
                            symbol: 'IREN',
                            title: 'IREN expands AI cloud capacity',
                            summary: 'Iris Energy announced a new AI infrastructure update.',
                            published: 'Mon, 04 May 2026 10:00:00 GMT',
                            source: 'yahoo-finance-rss',
                            kind: 'news',
                            link: 'https://finance.yahoo.com/news/iren-test',
                        }, {
                            symbol: 'crypto market structure clarity act',
                            topic: 'crypto market structure clarity act',
                            title: 'Clarity Act crypto market structure bill advances',
                            summary: 'Lawmakers moved a crypto market structure bill forward.',
                            published: 'Tue, 05 May 2026 10:00:00 GMT',
                            source: 'google-news-rss',
                            kind: 'general-news',
                            link: 'https://example.com/clarity-act',
                        }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                if (String(url).includes('/api/analyze')) {
                    window.__analyzePayloads.push(JSON.parse(opts.body));
                    return Promise.resolve(new Response(JSON.stringify({
                        content: [{ text: 'IREN 뉴스와 Clarity Act 이슈를 분리해서 확인했습니다.' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
            setReplyMode('question');
        }""")

        logged_in_page.locator('#chat-input-bottom').fill('IREN latest news and clarity act news')
        logged_in_page.locator('#chat-input-bottom').press('Enter')
        logged_in_page.wait_for_function("() => window.__analyzePayloads?.length === 1", timeout=8_000)

        news_url = logged_in_page.evaluate("() => window.__newsUrls[0]")
        assert 'symbols=IREN' in news_url
        assert 'query=crypto+market+structure+clarity+act' in news_url
        assert 'Digital+Asset+Market+Structure+Clarity+Act' in news_url
        system_prompt = logged_in_page.evaluate("() => window.__analyzePayloads[0].system[0].text")
        assert '투자 뉴스/공시 조회 결과' in system_prompt
        assert 'IREN expands AI cloud capacity' in system_prompt
        assert 'Clarity Act crypto market structure bill advances' in system_prompt
        assert 'crypto market structure clarity act' in system_prompt
        assert '링크 URL을 중간에서 자르지 말고' in system_prompt
        assert '무슨 일이 있었나 / 시장 영향 / 내 보유 종목과의 연결 / 내 원칙상 확인할 점' in system_prompt
        assert 'https://finance.yahoo.com/news/iren-test' in system_prompt
        assert 'https://example.com/clarity-act' in system_prompt
        assert logged_in_page.locator('.chat-bubble-ai').count() == 1
    def test_investment_chat_is_stored_in_investment_data(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.currentChatMessages = [];
            state.investment.chat = [];
            render();
            const originalFetch = window.fetch.bind(window);
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/analyze')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        content: [{ text: '투자 원칙 초안: 손실 직후에는 30분 쿨다운을 둡니다.' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return originalFetch(url, opts);
            };
            setReplyMode('question');
        }""")

        logged_in_page.locator('#chat-input-bottom').fill('손실 직후 투자 원칙을 같이 세워줘')
        logged_in_page.locator('#chat-input-bottom').press('Enter')
        logged_in_page.wait_for_function(
            "() => state.investment.chat && state.investment.chat.length >= 2",
            timeout=8_000,
        )

        saved = logged_in_page.evaluate("""() => ({
            count: state.investment.chat.length,
            first: state.investment.chat[0].text,
            last: state.investment.chat.at(-1).text,
        })""")

        assert saved['count'] >= 2
        assert '손실 직후' in saved['first']
        assert '투자 원칙 초안' in saved['last']

    def test_market_refresh_updates_prices_and_risk_alerts(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.investment.positions = [{
                id: 'ip-market',
                symbol: 'NVDA',
                name: 'NVIDIA',
                shares: 10,
                avgPrice: 100,
                currentPrice: 100,
                targetPrice: 120,
                stopPrice: 95,
                longTerm: true,
                thesis: 'AI demand',
                addRule: '',
            }];
            state.investment.rules.maxPositionWeight = 80;
            state.investment.rules.dailyLossLimit = 3;
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/market/quote')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        quotes: [
                            { symbol: 'NVDA', price: 119, changePercent: 6.4, previousClose: 111.8, name: 'NVIDIA' },
                            { symbol: '^IXIC', price: 17000, changePercent: 1.2, name: 'NASDAQ Composite' },
                            { symbol: '^GSPC', price: 5200, changePercent: 0.8, name: 'S&P 500' },
                        ],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return Promise.reject(new Error('unexpected fetch'));
            };
            render();
        }""")

        logged_in_page.locator('#investment-refresh-market').click()
        logged_in_page.wait_for_function(
            "() => state.investment.positions[0].currentPrice === 119",
            timeout=8_000,
        )

        logged_in_page.wait_for_selector('.investment-alert', timeout=8_000)
        assert logged_in_page.locator('.investment-alert').count() >= 1
        assert '목표가' in logged_in_page.locator('#investment-view').inner_text()

    def test_portfolio_modal_refresh_updates_modal_values(self, logged_in_page):
        self._open_investment(logged_in_page)
        logged_in_page.evaluate("""() => {
            state.investment.positions = [{
                id: 'ip-modal-market',
                symbol: 'NVDA',
                name: 'NVIDIA',
                shares: 10,
                avgPrice: 100,
                currentPrice: 100,
                targetPrice: 120,
                stopPrice: 90,
                longTerm: false,
                thesis: '',
                addRule: '',
            }];
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/market/quote')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        quotes: [
                            { symbol: 'NVDA', price: 119, changePercent: 6.4, previousClose: 111.8, name: 'NVIDIA' },
                            { symbol: '^IXIC', price: 17000, changePercent: 1.2, name: 'NASDAQ Composite' },
                            { symbol: '^GSPC', price: 5200, changePercent: 0.8, name: 'S&P 500' },
                        ],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }));
            };
            render();
        }""")

        logged_in_page.locator('#investment-menu-portfolio').click()
        logged_in_page.wait_for_selector('#investment-portfolio-modal', timeout=8_000)
        assert logged_in_page.locator('#investment-modal-refresh-market').is_visible()

        logged_in_page.locator('#investment-modal-refresh-market').click()
        logged_in_page.wait_for_function(
            "() => state.investment.positions[0].currentPrice === 119",
            timeout=8_000,
        )

        modal_text = logged_in_page.locator('#investment-portfolio-modal').inner_text()
        assert '$1,190' in modal_text
        assert '현재 $119' in modal_text


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
