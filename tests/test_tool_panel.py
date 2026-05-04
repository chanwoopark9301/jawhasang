"""
自畵像 — 도구 패널 E2E 테스트 (심층 질문 · 성장 타임라인)

실행:
  pytest tests/test_tool_panel.py -v          # 헤드리스
  pytest tests/test_tool_panel.py -v --headed  # 브라우저 표시

커버하는 내용:
  1. 버튼 존재 여부 (rp-deepq-btn, rp-timeline-btn)
  2. 데이터 없을 때 비활성화(disabled) 상태
  3. 나의 기록 — 주제+기록 존재 시 활성화
  4. 상담 기록 — 축어록 있는 회기 선택 시 활성화
  5. 심층 질문 모달 DOM 구조 (overlay·modal 존재)
  6. 성장 타임라인 모달 DOM 구조 (overlay·modal 존재)
  7. 심층 질문 — 질문 클릭 시 chat-input-bottom 에 텍스트 삽입 + 모달 닫힘
"""

import pytest

pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# 픽스처 — networkidle 보장 (logged_in_page는 #app만 대기하므로 JS 로딩 전일 수 있음)
# ---------------------------------------------------------------------------

@pytest.fixture
def app_page(logged_in_page):
    """모든 JS 파일 로딩 완료를 보장하는 페이지 픽스처."""
    logged_in_page.wait_for_load_state('networkidle')
    return logged_in_page


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------

def _inject_data(page, data: dict):
    """API를 통해 테스트 데이터를 서버에 저장."""
    page.evaluate(
        """async (d) => {
            await fetch('/api/data', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(d),
            });
        }""",
        data,
    )


def _reload_app(page):
    """페이지를 새로고침하고 앱 JS 초기화 완료까지 대기."""
    page.reload()
    page.wait_for_load_state('networkidle', timeout=15_000)
    # 스플래시가 사라지면 render() 완료 — 없으면 즉시 통과
    page.wait_for_selector('#app-splash', state='hidden', timeout=8_000)


def _select_topic(page, topic_id: str):
    """사이드바에서 주제 sub-item 클릭."""
    page.click(f'[data-id="{topic_id}"]')
    page.wait_for_timeout(400)


def _select_student(page, student_id: str):
    """사이드바에서 학생 sub-item 클릭."""
    page.click(f'[data-id="{student_id}"]')
    page.wait_for_timeout(400)


# ---------------------------------------------------------------------------
# 1. 버튼 존재 여부
# ---------------------------------------------------------------------------

class TestToolButtonsExist:
    def test_deepq_button_exists_in_dom(self, logged_in_page):
        """심층 질문 버튼(#rp-deepq-btn)이 DOM에 존재해야 함."""
        assert logged_in_page.locator('#rp-deepq-btn').count() == 1, \
            "#rp-deepq-btn 버튼이 DOM에 없음"

    def test_timeline_button_exists_in_dom(self, logged_in_page):
        """성장 타임라인 버튼(#rp-timeline-btn)이 DOM에 존재해야 함."""
        assert logged_in_page.locator('#rp-timeline-btn').count() == 1, \
            "#rp-timeline-btn 버튼이 DOM에 없음"

    def test_report_button_visible_on_student_view(self, logged_in_page):
        """상담 기록 뷰에서 보고서 버튼(#rp-report-btn)이 표시돼야 함."""
        logged_in_page.click('#nav-sv')
        logged_in_page.wait_for_timeout(300)
        btn = logged_in_page.locator('#rp-report-btn')
        # student 뷰에서는 display != 'none'
        display = btn.evaluate("el => window.getComputedStyle(el).display")
        assert display != 'none', "상담 기록 뷰에서 보고서 버튼이 숨겨짐"

    def test_report_button_hidden_on_myrecords_view(self, logged_in_page):
        """나의 기록 뷰에서 보고서 버튼(#rp-report-btn)이 숨겨져야 함."""
        logged_in_page.click('#nav-my')
        logged_in_page.wait_for_timeout(300)
        btn = logged_in_page.locator('#rp-report-btn')
        display = btn.evaluate("el => window.getComputedStyle(el).display")
        assert display == 'none', "나의 기록 뷰에서 보고서 버튼이 표시되고 있음"


# ---------------------------------------------------------------------------
# 2. 초기 비활성화 상태
# ---------------------------------------------------------------------------

class TestToolButtonsDisabledByDefault:
    def test_deepq_disabled_with_no_selection(self, logged_in_page):
        """아무것도 선택하지 않으면 심층 질문 버튼이 비활성화돼야 함."""
        # 홈 화면 (캘린더)으로 이동
        logged_in_page.evaluate("() => setView('calendar')")
        logged_in_page.wait_for_timeout(300)
        btn = logged_in_page.locator('#rp-deepq-btn')
        assert btn.is_disabled(), "선택 없을 때 심층 질문 버튼이 활성화되어 있음"

    def test_timeline_disabled_with_no_selection(self, logged_in_page):
        """아무것도 선택하지 않으면 성장 타임라인 버튼이 비활성화돼야 함."""
        logged_in_page.evaluate("() => setView('calendar')")
        logged_in_page.wait_for_timeout(300)
        btn = logged_in_page.locator('#rp-timeline-btn')
        assert btn.is_disabled(), "선택 없을 때 성장 타임라인 버튼이 활성화되어 있음"


# ---------------------------------------------------------------------------
# 3. 나의 기록 — 데이터 있을 때 활성화
# ---------------------------------------------------------------------------

class TestMyRecordsToolButtons:
    TOPIC = {
        'id': 't_test_tool', 'title': '도구패널테스트',
        'aiPrompt': '성찰을 돕는 코치', 'createdAt': '2026-04-16',
        'selectedRole': 'coach',
    }
    RECORD = {
        'id': 'r_test_tool_1', 'topicId': 't_test_tool',
        'date': '2026-04-16', 'recordNum': 1,
        'content': '오늘은 새로운 기능 테스트를 진행했다.', 'memo': '',
        'tags': [], 'analysis': None, 'aiChat': [],
    }
    RECORD2 = {
        'id': 'r_test_tool_2', 'topicId': 't_test_tool',
        'date': '2026-04-15', 'recordNum': 2,
        'content': '어제도 비슷한 상황이었다.', 'memo': '',
        'tags': [], 'analysis': None, 'aiChat': [],
    }

    def _setup(self, page):
        data = {
            'students': [], 'sessions': [], 'aiResults': {},
            'my_topics': [self.TOPIC],
            'my_records': [self.RECORD, self.RECORD2],
        }
        _inject_data(page, data)
        _reload_app(page)
        # 나의 기록 뷰로 전환
        page.click('#nav-my')
        page.wait_for_timeout(300)
        # 주제 선택 — sub-item 클릭
        page.locator('#sub-my .sub-item:not(.sub-item-add)').first.click()
        page.wait_for_timeout(500)

    def test_deepq_enabled_with_one_record(self, logged_in_page):
        """나의 기록: 주제 선택 + 기록 1개 이상 → 심층 질문 버튼 활성화."""
        self._setup(logged_in_page)
        btn = logged_in_page.locator('#rp-deepq-btn')
        assert not btn.is_disabled(), \
            "기록이 있는 주제 선택 후에도 심층 질문 버튼이 비활성화"

    def test_timeline_disabled_with_records_lt2(self, logged_in_page):
        """나의 기록: 기록 2개 미만이면 타임라인 버튼 비활성화."""
        # 기록 1개만 있는 주제로 재설정
        data = {
            'students': [], 'sessions': [], 'aiResults': {},
            'my_topics': [self.TOPIC],
            'my_records': [self.RECORD],  # 1개만
        }
        _inject_data(logged_in_page, data)
        _reload_app(logged_in_page)
        logged_in_page.click('#nav-my')
        logged_in_page.wait_for_timeout(300)
        logged_in_page.locator('#sub-my .sub-item:not(.sub-item-add)').first.click()
        logged_in_page.wait_for_timeout(500)
        btn = logged_in_page.locator('#rp-timeline-btn')
        assert btn.is_disabled(), "기록 1개인데 성장 타임라인 버튼이 활성화됨"

    def test_timeline_enabled_with_two_records(self, logged_in_page):
        """나의 기록: 기록 2개 이상이면 타임라인 버튼 활성화."""
        self._setup(logged_in_page)
        btn = logged_in_page.locator('#rp-timeline-btn')
        assert not btn.is_disabled(), \
            "기록 2개인데 성장 타임라인 버튼이 비활성화"


# ---------------------------------------------------------------------------
# 4. 상담 기록 — 축어록 있는 회기 선택 시 활성화
# ---------------------------------------------------------------------------

class TestStudentToolButtons:
    STUDENT = {
        'id': 's_tool_test', 'alias': '도구-01', 'grade': '중2',
        'gender': '', 'family': '', 'peers': '', 'situation': '', 'notes': '',
        'createdAt': '2026-04-16',
    }
    SESSION_WITH_VT = {
        'id': 'ss_tool_1', 'studentId': 's_tool_test',
        'date': '2026-04-15', 'sessionNum': 1,
        'verbatim': '상담자: 어떻게 지내셨어요?\n내담자: 좋았어요.',
        'memo': '', 'analysis': None, 'supervisionChat': [], 'verbatimSummary': None,
        'tags': [],
    }
    SESSION2 = {
        'id': 'ss_tool_2', 'studentId': 's_tool_test',
        'date': '2026-04-16', 'sessionNum': 2,
        'verbatim': '상담자: 오늘은 어떤가요?\n내담자: 조금 나아졌어요.',
        'memo': '', 'analysis': None, 'supervisionChat': [], 'verbatimSummary': None,
        'tags': [],
    }

    def _setup(self, page):
        data = {
            'students': [self.STUDENT],
            'sessions': [self.SESSION_WITH_VT, self.SESSION2],
            'aiResults': {}, 'my_topics': [], 'my_records': [],
        }
        _inject_data(page, data)
        _reload_app(page)
        # 상담 기록 뷰로 전환 + 학생 선택
        page.click('#nav-sv')
        page.wait_for_timeout(300)
        page.locator('#sub-sv .sub-item:not(.sub-item-add)').first.click()
        page.wait_for_timeout(500)

    def test_deepq_disabled_without_session_selection(self, logged_in_page):
        """상담 기록: 학생만 선택하고 회기 미선택 → 심층 질문 비활성화."""
        self._setup(logged_in_page)
        # 아직 회기를 선택하지 않은 상태
        btn = logged_in_page.locator('#rp-deepq-btn')
        assert btn.is_disabled(), "회기 미선택 시 심층 질문 버튼이 활성화됨"

    def test_timeline_enabled_with_two_sessions(self, logged_in_page):
        """상담 기록: 학생에 회기 2개 이상 → 타임라인 버튼 활성화."""
        self._setup(logged_in_page)
        btn = logged_in_page.locator('#rp-timeline-btn')
        assert not btn.is_disabled(), "회기 2개인데 성장 타임라인 버튼이 비활성화"


# ---------------------------------------------------------------------------
# 5~6. 모달 DOM 구조 확인
# ---------------------------------------------------------------------------

class TestModalDomStructure:
    def test_deep_q_overlay_exists(self, logged_in_page):
        """#deep-q-overlay 요소가 DOM에 존재해야 함."""
        assert logged_in_page.locator('#deep-q-overlay').count() == 1, \
            "#deep-q-overlay가 DOM에 없음"

    def test_deep_q_modal_exists(self, logged_in_page):
        """#deep-q-modal 요소가 DOM에 존재해야 함."""
        assert logged_in_page.locator('#deep-q-modal').count() == 1, \
            "#deep-q-modal이 DOM에 없음"

    def test_timeline_overlay_exists(self, logged_in_page):
        """#timeline-overlay 요소가 DOM에 존재해야 함."""
        assert logged_in_page.locator('#timeline-overlay').count() == 1, \
            "#timeline-overlay가 DOM에 없음"

    def test_timeline_modal_exists(self, logged_in_page):
        """#timeline-modal 요소가 DOM에 존재해야 함."""
        assert logged_in_page.locator('#timeline-modal').count() == 1, \
            "#timeline-modal이 DOM에 없음"

    def test_deep_q_modal_hidden_by_default(self, logged_in_page):
        """심층 질문 모달은 초기에 숨겨져 있어야 함."""
        modal = logged_in_page.locator('#deep-q-modal')
        display = modal.evaluate("el => window.getComputedStyle(el).display")
        assert display == 'none', "심층 질문 모달이 초기에 표시되고 있음"

    def test_timeline_modal_hidden_by_default(self, logged_in_page):
        """성장 타임라인 모달은 초기에 숨겨져 있어야 함."""
        modal = logged_in_page.locator('#timeline-modal')
        display = modal.evaluate("el => window.getComputedStyle(el).display")
        assert display == 'none', "성장 타임라인 모달이 초기에 표시되고 있음"


# ---------------------------------------------------------------------------
# 7. 심층 질문 — showDeepQuestionModal 직접 호출로 클릭 동작 검증
# ---------------------------------------------------------------------------

class TestDeepQuestionInsert:
    def test_show_modal_renders_items(self, app_page):
        """showDeepQuestionModal 호출 시 질문 항목들이 렌더링돼야 함."""
        app_page.evaluate("""() => {
            showDeepQuestionModal(
                'Q1\\nQ2\\nQ3',
                'Test',
                '2026-04-16'
            );
        }""")
        app_page.wait_for_timeout(200)
        items = app_page.locator('#deep-q-modal .deep-q-item')
        assert items.count() == 3, f"질문 항목이 3개여야 하는데 {items.count()}개"

    def test_modal_visible_after_show(self, app_page):
        """showDeepQuestionModal 호출 후 모달이 표시돼야 함."""
        app_page.evaluate("""() => {
            showDeepQuestionModal('Single question', 'Test', '2026-04-16');
        }""")
        app_page.wait_for_timeout(200)
        modal = app_page.locator('#deep-q-modal')
        display = modal.evaluate("el => window.getComputedStyle(el).display")
        assert display != 'none', "showDeepQuestionModal 후 모달이 여전히 숨겨짐"

    def test_question_click_inserts_text_to_input(self, app_page):
        """질문 클릭 시 chat-input-bottom에 텍스트가 삽입돼야 함."""
        q_text = 'What is most important right now?'
        app_page.evaluate(f"""() => {{
            showDeepQuestionModal('{q_text}', 'Test', '2026-04-16');
        }}""")
        app_page.wait_for_timeout(200)
        # 첫 번째 질문 클릭
        app_page.locator('#deep-q-modal .deep-q-item').first.click()
        app_page.wait_for_timeout(200)
        input_val = app_page.locator('#chat-input-bottom').input_value()
        assert input_val == q_text, \
            f"입력창 값이 '{input_val}'인데 '{q_text}'여야 함"

    def test_question_click_closes_modal(self, app_page):
        """질문 클릭 시 심층 질문 모달이 닫혀야 함."""
        app_page.evaluate("""() => {
            showDeepQuestionModal('Is this a test question?', 'Test', '2026-04-16');
        }""")
        app_page.wait_for_timeout(200)
        app_page.locator('#deep-q-modal .deep-q-item').first.click()
        app_page.wait_for_timeout(200)
        modal = app_page.locator('#deep-q-modal')
        display = modal.evaluate("el => window.getComputedStyle(el).display")
        assert display == 'none', "질문 클릭 후 모달이 닫히지 않음"

    def test_close_button_hides_modal(self, app_page):
        """closeDeepQuestion 호출 시 심층 질문 모달이 닫혀야 함."""
        app_page.evaluate("""() => {
            showDeepQuestionModal('Close test?', 'Test', '2026-04-16');
        }""")
        app_page.wait_for_timeout(200)
        app_page.evaluate("() => closeDeepQuestion()")
        app_page.wait_for_timeout(200)
        modal = app_page.locator('#deep-q-modal')
        display = modal.evaluate("el => window.getComputedStyle(el).display")
        assert display == 'none', "closeDeepQuestion 후 모달이 닫히지 않음"


# ---------------------------------------------------------------------------
# 8. 성장 타임라인 — showTimelineModal 직접 호출로 렌더링 검증
# ---------------------------------------------------------------------------

class TestTimelineModal:
    SAMPLE_RESULT = {
        'start':     'Initial state.',
        'journey':   'Middle changes.',
        'now':       'Current state.',
        'highlight': 'Biggest change.',
        'overall':   'Overall growth.',
    }

    def test_timeline_modal_shows_sections(self, app_page):
        """showTimelineModal 호출 시 5개 섹션이 렌더링돼야 함."""
        import json
        app_page.evaluate(f"""() => {{
            showTimelineModal(
                {json.dumps(self.SAMPLE_RESULT)},
                'TestTopic', '2026-04-16', true
            );
        }}""")
        app_page.wait_for_timeout(200)
        sections = app_page.locator('#timeline-modal .timeline-section')
        assert sections.count() == 5, f"타임라인 섹션이 5개여야 하는데 {sections.count()}개"

    def test_timeline_modal_visible_after_show(self, app_page):
        """showTimelineModal 호출 후 타임라인 모달이 표시돼야 함."""
        import json
        app_page.evaluate(f"""() => {{
            showTimelineModal({json.dumps(self.SAMPLE_RESULT)}, 'Test', '2026-04-16', false);
        }}""")
        app_page.wait_for_timeout(200)
        modal = app_page.locator('#timeline-modal')
        display = modal.evaluate("el => window.getComputedStyle(el).display")
        assert display != 'none', "showTimelineModal 후 모달이 여전히 숨겨짐"

    def test_close_timeline(self, app_page):
        """closeTimeline 호출 시 타임라인 모달이 닫혀야 함."""
        import json
        app_page.evaluate(f"""() => {{
            showTimelineModal({json.dumps(self.SAMPLE_RESULT)}, 'Test', '2026-04-16', true);
        }}""")
        app_page.wait_for_timeout(200)
        app_page.evaluate("() => closeTimeline()")
        app_page.wait_for_timeout(200)
        modal = app_page.locator('#timeline-modal')
        display = modal.evaluate("el => window.getComputedStyle(el).display")
        assert display == 'none', "closeTimeline 후 모달이 닫히지 않음"
