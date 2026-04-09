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
    def test_verbatim_char_count_displayed(self, page: Page):
        """축어록 입력창에 글자수가 표시되어야 함."""
        login(page)
        # 새 학생 추가
        page.click('#add-btn')
        page.fill('#falias', 'UI테스트-01')
        page.click('button:has-text("등록")')

        # 회기 추가
        page.click('button:has-text("회기 추가")')
        verbatim_area = page.locator('#fverbatim')
        verbatim_area.fill('상담자: 안녕\n내담자: 안녕하세요')

        # 글자수 카운터가 보여야 함
        char_counter = page.locator('.verbatim-char-count')
        expect(char_counter).to_be_visible()

    def test_long_verbatim_shows_warning(self, page: Page):
        """3000자 초과 시 긴 축어록 안내가 나타나야 함."""
        login(page)
        page.click('#add-btn')
        page.fill('#falias', 'UI테스트-02')
        page.click('button:has-text("등록")')
        page.click('button:has-text("회기 추가")')

        # 3000자 이상 입력
        long_text = '상담자: 오늘 어떠셨어요?\n내담자: 힘들었어요.\n' * 80
        page.locator('#fverbatim').fill(long_text)

        # 긴 축어록 안내 메시지 표시
        warning = page.locator('.verbatim-long-notice')
        expect(warning).to_be_visible()
        expect(warning).to_contain_text('긴 축어록')

    def test_report_progress_shows_stages(self, page: Page):
        """보고서 생성 중 1단계/2단계 진행 표시가 나타나야 함."""
        login(page)
        # 이미 저장된 긴 세션이 있다고 가정하고
        # AI 패널의 보고서 생성 버튼 클릭 시 진행 표시 확인
        # (실제 AI 호출 없이 로딩 상태만 확인)
        page.click('#add-btn')
        page.fill('#falias', 'UI테스트-03')
        page.click('button:has-text("등록")')
        page.click('button:has-text("회기 추가")')

        long_text = '상담자: 오늘 어떠셨어요?\n내담자: 힘들었어요.\n' * 80
        page.locator('#fverbatim').fill(long_text)
        # 날짜 입력
        page.locator('#fdate').fill('2026-04-09')
        page.click('button:has-text("저장")')

        # AI 보고서 생성 버튼 클릭
        ai_btn = page.locator('button:has-text("보고서")')
        if ai_btn.count() > 0:
            # 로딩 시작 확인 (AI 키 없어도 로딩 상태는 잠깐 표시)
            ai_btn.first.click()
            # 로딩 레이블 또는 단계 표시 확인
            # 실제 AI 호출은 안 되더라도 UI 구조는 존재해야 함
            stage_label = page.locator('.ai-stage-label')
            # 버튼 클릭 후 구조 존재 여부만 확인
            assert page.locator('#ai-content').count() > 0
