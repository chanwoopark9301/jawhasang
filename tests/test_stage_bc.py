"""
自畵像 — Stage B+C 테스트
B: 축어록 찾기/바꾸기
C: 빠른 주석 버튼

서버 로직 검증 + JS 파일 구조 검증
실행: pytest tests/test_stage_bc.py -v
"""

import os
import re
import json
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------

def read_js(filename):
    with open(os.path.join(ROOT, 'js', filename), encoding='utf-8') as f:
        return f.read()

def read_html():
    with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
        return f.read()


# ---------------------------------------------------------------------------
# Stage B — 찾기/바꾸기
# ---------------------------------------------------------------------------

class TestStageB_FindReplace:

    def test_find_replace_function_exists(self):
        """verbatimFindReplace() 함수가 JS에 존재해야 함."""
        # utils.js 또는 crud.js 에 있어야 함
        sources = ['utils.js', 'crud.js', 'render-forms.js']
        found = any('verbatimFindReplace' in read_js(f) for f in sources)
        assert found, "verbatimFindReplace 함수가 없습니다"

    def test_find_replace_counts_matches(self):
        """countMatches() 또는 동등한 로직이 존재해야 함."""
        sources = ['utils.js', 'crud.js', 'render-forms.js']
        # 'replace' + 'g' 플래그 정규식 패턴이 존재하는지 확인
        pattern = r'new RegExp.*?[gG]'
        found = any(re.search(pattern, read_js(f)) for f in sources)
        assert found, "찾기/바꾸기에 RegExp global 플래그가 없습니다"

    def test_find_replace_panel_in_forms(self):
        """찾기/바꾸기 패널 HTML이 render-forms.js에 존재해야 함."""
        content = read_js('render-forms.js')
        assert 'vt-find-replace' in content, "vt-find-replace 패널이 없습니다"

    def test_find_replace_inputs_present(self):
        """찾기/바꾸기 입력 필드 id가 존재해야 함."""
        content = read_js('render-forms.js')
        assert 'vt-find-input' in content, "vt-find-input 없음"
        assert 'vt-replace-input' in content, "vt-replace-input 없음"

    def test_find_replace_result_feedback(self):
        """교체 결과 피드백 요소가 존재해야 함."""
        content = read_js('render-forms.js')
        assert 'vt-replace-result' in content, "교체 결과 표시 요소 없음"

    def test_find_replace_toggle_button(self):
        """찾기/바꾸기 토글 버튼이 축어록 헤더에 있어야 함."""
        content = read_js('render-forms.js')
        # 버튼 텍스트 또는 함수 호출 확인
        assert 'toggleFindReplace' in content or '찾기/바꾸기' in content, \
            "찾기/바꾸기 토글 버튼이 없습니다"


# ---------------------------------------------------------------------------
# Stage C — 빠른 주석 버튼
# ---------------------------------------------------------------------------

class TestStageC_AnnotationButtons:

    REQUIRED_ANNOTATIONS = ['침묵', '눈물', '웃음']  # 최소 이 3개는 있어야 함

    def test_annotation_toolbar_exists(self):
        """주석 툴바가 render-forms.js에 존재해야 함."""
        content = read_js('render-forms.js')
        assert 'vt-annotation-bar' in content, "vt-annotation-bar 툴바가 없습니다"

    def test_required_annotations_present(self):
        """필수 주석 버튼들이 존재해야 함."""
        content = read_js('render-forms.js')
        for annotation in self.REQUIRED_ANNOTATIONS:
            assert annotation in content, f"'{annotation}' 주석 버튼이 없습니다"

    def test_insert_annotation_function_exists(self):
        """insertAnnotation() 함수가 존재해야 함."""
        sources = ['utils.js', 'crud.js', 'render-forms.js']
        found = any('insertAnnotation' in read_js(f) for f in sources)
        assert found, "insertAnnotation 함수가 없습니다"

    def test_insert_annotation_targets_textarea(self):
        """insertAnnotation 이 #fv textarea를 대상으로 해야 함."""
        sources = ['utils.js', 'crud.js', 'render-forms.js']
        for f in sources:
            content = read_js(f)
            if 'insertAnnotation' in content:
                # fv 가 참조되어야 함
                assert 'fv' in content, f"{f}의 insertAnnotation이 #fv를 참조하지 않습니다"
                break

    def test_silence_annotation_accepts_duration(self):
        """침묵 주석은 초 단위를 포함해야 함 (예: [침묵 3초])."""
        sources = ['utils.js', 'crud.js', 'render-forms.js']
        found_silence = False
        for f in sources:
            content = read_js(f)
            # 침묵 + 숫자/입력 패턴 확인
            if '침묵' in content and ('초' in content or 'sec' in content.lower()):
                found_silence = True
                break
        assert found_silence, "침묵 주석에 초 단위가 없습니다"

    def test_annotation_css_exists(self):
        """주석 툴바 CSS가 style.css에 존재해야 함."""
        with open(os.path.join(ROOT, 'style.css'), encoding='utf-8') as f:
            css = f.read()
        assert 'vt-annotation-bar' in css, "vt-annotation-bar CSS가 없습니다"


# ---------------------------------------------------------------------------
# 기존 테스트 회귀 (Stage A 기능 유지 확인)
# ---------------------------------------------------------------------------

class TestRegression_StageA:

    def test_long_verbatim_threshold_still_3000(self):
        """Stage A의 3000자 기준이 유지되어야 함."""
        content = read_js('ai-counseling.js')
        assert '3000' in content, "LONG_VERBATIM_THRESHOLD 3000이 없습니다"

    def test_max_tokens_still_2000(self):
        """보고서 max_tokens가 2000 이하로 유지되어야 함."""
        content = read_js('ai-counseling.js')
        matches = re.findall(r'max_tokens["\s:]+(\d+)', content)
        tokens = [int(m) for m in matches]
        assert any(t <= 2000 for t in tokens), f"max_tokens가 2000 초과: {tokens}"

    def test_verbatim_char_count_in_forms(self):
        """글자수 카운터가 render-forms.js에 유지되어야 함."""
        content = read_js('render-forms.js')
        assert 'verbatim-char-count' in content
        assert 'updateVerbatimCounter' in content
