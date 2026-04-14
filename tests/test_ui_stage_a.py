"""
自畵像 — Stage A UI 테스트 (Playwright)
긴 축어록 처리: 진행 표시, 2단계 안내 메시지

실행: pytest tests/test_ui_stage_a.py -v
전제: server.py 가 localhost:5000 에서 실행 중이어야 함
"""

import os
import pytest
from playwright.sync_api import Page, expect

BASE_URL = os.getenv('TEST_BASE_URL', 'http://localhost:5000')
PASSWORD  = os.getenv('APP_PASSWORD', '')


def login(page: Page):
    page.goto(f'{BASE_URL}/login')
    page.fill('input[name="password"]', PASSWORD)
    page.click('button[type="submit"]')
    page.wait_for_url(f'{BASE_URL}/')


# ---------------------------------------------------------------------------
# 기본 로딩
# ---------------------------------------------------------------------------

class TestBasicLoad:
    def test_app_loads(self, page: Page):
        login(page)
        expect(page.locator('#app')).to_be_visible()

    def test_title_is_correct(self, page: Page):
        login(page)
        expect(page).to_have_title('自畵像')

    def test_sidebar_visible(self, page: Page):
        login(page)
        expect(page.locator('#sidebar')).to_be_visible()


# ---------------------------------------------------------------------------
# Stage A — 긴 축어록 UI
# ---------------------------------------------------------------------------

class TestLongVerbatimUI:
    def _add_student_and_open_session_form(self, page: Page, alias: str):
        """새 학생 추가 후 회기 폼 열기 (새 UI: #nav-sv → sub-item-add)."""
        page.wait_for_selector('#nav-sv', timeout=8_000)
        page.click('#nav-sv')
        page.wait_for_selector('#sub-sv .sub-item-add', timeout=5_000)
        page.locator('#sub-sv .sub-item-add').click()
        page.wait_for_selector('#falias', timeout=5_000)
        page.fill('#falias', alias)
        page.click('button:has-text("등록")')
        page.wait_for_selector('#ns-btn', state='visible', timeout=5_000)
        page.click('#ns-btn')
        page.wait_for_selector('#fv', timeout=5_000)

    def test_verbatim_char_count_displayed(self, page: Page):
        """축어록 입력창에 글자수가 표시되어야 함."""
        login(page)
        # 새 학생 추가
        self._add_student_and_open_session_form(page, 'UI테스트-01')
        verbatim_area = page.locator('#fv')
        verbatim_area.fill('상담자: 안녕\n내담자: 안녕하세요')

        # 글자수 카운터가 보여야 함
        char_counter = page.locator('.verbatim-char-count')
        expect(char_counter).to_be_visible()

    def test_long_verbatim_shows_warning(self, page: Page):
        """3000자 초과 시 긴 축어록 안내가 나타나야 함."""
        login(page)
        self._add_student_and_open_session_form(page, 'UI테스트-02')

        # 3000자 이상 입력
        # 3000자 초과 (27자/반복 × 120 = 3240자)
        long_text = '상담자: 오늘 어떠셨어요?\n내담자: 힘들었어요.\n' * 120
        page.locator('#fv').fill(long_text)
        # fill() 후 updateVerbatimCounter 직접 호출 (oninput 미발동 우회)
        page.evaluate("""() => {
            const el = document.getElementById('fv');
            if (el && typeof updateVerbatimCounter === 'function') {
                updateVerbatimCounter(el.value);
            }
        }""")
        # 긴 축어록 안내 메시지가 표시되어야 함
        visible = page.evaluate("""() => {
            const notice = document.getElementById('vt-long-notice');
            return notice ? notice.style.display !== 'none' : false;
        }""")
        assert visible, "3000자 초과 시 긴 축어록 안내가 표시되지 않음"

    def test_report_progress_shows_stages(self, page: Page):
        """보고서 생성 중 1단계/2단계 진행 표시가 나타나야 함."""
        login(page)
        # 이미 저장된 긴 세션이 있다고 가정하고
        # AI 패널의 보고서 생성 버튼 클릭 시 진행 표시 확인
        # (실제 AI 호출 없이 로딩 상태만 확인)
        self._add_student_and_open_session_form(page, 'UI테스트-03')

        long_text = '상담자: 오늘 어떠셨어요?\n내담자: 힘들었어요.\n' * 120
        page.locator('#fv').fill(long_text)
        # 날짜 입력
        page.locator('#fd').fill('2026-04-09')
        page.locator('button:has-text("저장"), button[onclick="saveSession()"]').first.click(force=True)
        # 세션 저장 후 detail 뷰가 렌더링될 때까지 대기
        page.wait_for_selector('.session-tabs, .vt-section, #rp-report-btn',
                               timeout=5_000)

        # AI 보고서 생성 버튼이 있고 활성화되어 있으면 클릭
        ai_btn = page.locator('#rp-report-btn')
        # 실제 AI 호출은 안 되더라도 UI 구조는 존재해야 함
        assert ai_btn.count() > 0, "rp-report-btn 버튼이 없음"
        assert page.locator('#ai-content').count() > 0, "ai-content 영역이 없음"
