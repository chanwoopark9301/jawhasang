"""
自畵像 — Stage D 테스트
블록 에디터: 모드 전환, 블록↔텍스트 변환, 발화자 토글, 비언어 블록

실행: pytest tests/test_stage_d.py -v
"""

import os
import re
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_js(filename):
    path = os.path.join(ROOT, 'js', filename)
    with open(path, encoding='utf-8') as f:
        return f.read()

def read_html():
    with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
        return f.read()

def read_css():
    with open(os.path.join(ROOT, 'style.css'), encoding='utf-8') as f:
        return f.read()


# ---------------------------------------------------------------------------
# 파일 존재 및 로드 확인
# ---------------------------------------------------------------------------

class TestStageDFileStructure:

    def test_verbatim_editor_file_exists(self):
        """js/verbatim-editor.js 파일이 존재해야 함."""
        path = os.path.join(ROOT, 'js', 'verbatim-editor.js')
        assert os.path.exists(path), "js/verbatim-editor.js 가 없습니다"

    def test_verbatim_editor_loaded_in_html(self):
        """index.html 이 verbatim-editor.js 를 로드해야 함."""
        html = read_html()
        assert 'verbatim-editor.js' in html, \
            "index.html 에 verbatim-editor.js 스크립트 태그가 없습니다"

    def test_verbatim_editor_loaded_before_render_forms(self):
        """verbatim-editor.js가 render-main.js보다 먼저 로드되어야 함 (render-forms.js 제거됨)."""
        html = read_html()
        assert 'render-forms.js' not in html, "삭제된 render-forms.js가 아직 로드됨"
        pos_editor = html.find('verbatim-editor.js')
        pos_main   = html.find('render-main.js')
        assert pos_editor < pos_main, \
            "verbatim-editor.js 가 render-main.js 보다 뒤에 로드됩니다"


# ---------------------------------------------------------------------------
# 핵심 함수 존재 확인
# ---------------------------------------------------------------------------

class TestStageDFunctions:

    def _editor(self):
        return read_js('verbatim-editor.js')

    def test_switch_mode_function_exists(self):
        """switchVtMode() 함수가 존재해야 함."""
        assert 'switchVtMode' in self._editor(), "switchVtMode 함수 없음"

    def test_add_block_function_exists(self):
        """addVtBlock() 함수가 존재해야 함."""
        assert 'addVtBlock' in self._editor(), "addVtBlock 함수 없음"

    def test_delete_block_function_exists(self):
        """deleteVtBlock() 함수가 존재해야 함."""
        assert 'deleteVtBlock' in self._editor(), "deleteVtBlock 함수 없음"

    def test_toggle_speaker_function_exists(self):
        """toggleVtSpeaker() 함수가 존재해야 함."""
        assert 'toggleVtSpeaker' in self._editor(), "toggleVtSpeaker 함수 없음"

    def test_blocks_to_text_function_exists(self):
        """vtBlocksToText() 함수가 존재해야 함."""
        assert 'vtBlocksToText' in self._editor(), "vtBlocksToText 함수 없음"

    def test_text_to_blocks_function_exists(self):
        """vtTextToBlocks() 함수가 존재해야 함."""
        assert 'vtTextToBlocks' in self._editor(), "vtTextToBlocks 함수 없음"


# ---------------------------------------------------------------------------
# 블록 ↔ 텍스트 변환 로직 검증 (JS 코드 정적 분석)
# ---------------------------------------------------------------------------

class TestStageDConversion:

    def _editor(self):
        return read_js('verbatim-editor.js')

    def test_counselor_speaker_label_in_conversion(self):
        """T 블록은 '상담자:' 형식으로 변환되어야 함."""
        content = self._editor()
        assert '상담자' in content, "상담자 레이블이 변환 코드에 없습니다"

    def test_client_speaker_label_in_conversion(self):
        """C 블록은 '내담자:' 형식으로 변환되어야 함."""
        content = self._editor()
        assert '내담자' in content, "내담자 레이블이 변환 코드에 없습니다"

    def test_nonverbal_format_in_conversion(self):
        """비언어 블록은 [비언어: ...] 형식으로 변환되어야 함."""
        content = self._editor()
        assert '비언어' in content, "비언어 형식이 변환 코드에 없습니다"

    def test_speaker_types_defined(self):
        """T, C, nonverbal 세 가지 타입이 코드에 명시되어야 함."""
        content = self._editor()
        assert "'T'" in content or '"T"' in content, "T 타입 없음"
        assert "'C'" in content or '"C"' in content, "C 타입 없음"
        assert 'nonverbal' in content, "nonverbal 타입 없음"


# ---------------------------------------------------------------------------
# UI 구조 검증
# ---------------------------------------------------------------------------

class TestStageDUI:

    def test_mode_tabs_in_forms(self):
        """모드 전환 탭 로직이 verbatim-editor.js에 있어야 함 (render-forms.js 제거됨)."""
        content = read_js('verbatim-editor.js')
        assert 'vt-mode-tabs' in content or 'switchVtMode' in content, "vt-mode 전환 로직 없음"

    def test_block_editor_container_in_forms(self):
        """블록 에디터 로직이 verbatim-editor.js에 있어야 함."""
        content = read_js('verbatim-editor.js')
        assert 'vt-block-editor' in content or 'addVtBlock' in content, "vt-block-editor 로직 없음"

    def test_add_block_buttons_present(self):
        """addVtBlock 함수가 verbatim-editor.js에 있어야 함."""
        content = read_js('verbatim-editor.js')
        assert 'addVtBlock' in content, "+ 블록 추가 함수 없음"

    def test_nonverbal_block_add_button(self):
        """비언어 블록 로직이 verbatim-editor.js에 있어야 함."""
        content = read_js('verbatim-editor.js')
        assert 'nonverbal' in content, "비언어 로직 없음"

    def test_block_editor_css_exists(self):
        """블록 에디터 CSS 클래스가 style.css 에 있어야 함."""
        css = read_css()
        assert 'vt-block-editor' in css, "vt-block-editor CSS 없음"
        assert 'vt-block' in css, "vt-block CSS 없음"
        assert 'speaker-btn' in css, "speaker-btn CSS 없음"

    def test_mode_tabs_css_exists(self):
        """모드 탭 CSS가 있어야 함."""
        css = read_css()
        assert 'vt-mode-tabs' in css, "vt-mode-tabs CSS 없음"


# ---------------------------------------------------------------------------
# 회귀 테스트 (Stage A, B, C 기능 유지)
# ---------------------------------------------------------------------------

class TestRegression_ABC:

    def test_find_replace_still_works(self):
        content = read_js('utils.js')
        assert 'verbatimFindReplace' in content
        assert 'toggleFindReplace' in content

    def test_annotation_buttons_still_exist(self):
        content = read_js('utils.js')
        assert 'insertAnnotation' in content
        assert 'toggleFindReplace' in content

    def test_long_verbatim_threshold_intact(self):
        content = read_js('ai-counseling.js')
        assert '3000' in content

    def test_char_counter_intact(self):
        content = read_js('utils.js')
        assert 'updateVerbatimCounter' in content
