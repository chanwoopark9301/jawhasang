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
        """캘린더 뷰로 이동 (새 UI: #nav-cal 클릭)."""
        page.wait_for_selector('#nav-cal', timeout=8_000)
        page.click('#nav-cal')
        page.wait_for_selector('.cal-grid', timeout=8_000)

    def test_calendar_renders(self, logged_in_page):
        """캘린더 뷰로 이동 후 캘린더가 렌더링돼야 함."""
        self._go_to_calendar(logged_in_page)
        assert logged_in_page.locator('.cal-grid').is_visible()

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
            const res = await fetch('/js/data.js?v=20260504-7');
            const text = await res.text();
            return text.includes('save-error-toast') || text.includes('서버 연결을 확인');
        }""")
        assert has_old_toast is False


# ---------------------------------------------------------------------------
# 대화(채팅) 화면
# ---------------------------------------------------------------------------

class TestChatDialogue:
    """대화창 UI 동작 및 iOS 키보드 대응 테스트."""

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

    def test_plus_menu_only_shows_reply_modes(self, logged_in_page):
        self._select_topic_with_role(logged_in_page, 'listener')

        logged_in_page.locator('.input-plus').click()
        menu_text = logged_in_page.locator('#plus-menu').inner_text()

        assert '받아쓰기' in menu_text
        assert '답변' in menu_text
        assert '정리' in menu_text
        assert '조언' in menu_text
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

    def test_investment_nav_and_gate_render(self, logged_in_page):
        self._open_investment(logged_in_page)

        assert logged_in_page.locator('#investment-view').is_visible()
        assert logged_in_page.locator('#investment-position-form').is_visible()
        assert logged_in_page.locator('#investment-gate-form').is_visible()
        assert '매매 전 점검' in logged_in_page.locator('#investment-view').inner_text()

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

        logged_in_page.locator('#ip-symbol').fill('NVDA')
        logged_in_page.locator('#ip-name').fill('NVIDIA')
        logged_in_page.locator('#ip-shares').fill('10')
        logged_in_page.locator('#ip-avg').fill('100')
        logged_in_page.locator('#ip-current').fill('120')
        logged_in_page.locator('#ip-thesis').fill('AI 가속기 장기 성장')
        logged_in_page.locator('#investment-add-position').click()

        logged_in_page.locator('#ir-max-weight').fill('30')
        logged_in_page.locator('#investment-save-rules').click()

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
        assert result['events'] == 1
        assert result['lastStatus'] == 'block'
        assert result['eventType'] == 'alert'

        logged_in_page.click('#nav-cal')
        logged_in_page.wait_for_selector('.cal-dot-invest', timeout=8_000)


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
