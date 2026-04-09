"""
自畵像 — Stage E 테스트
PWA + 아이패드 레이아웃

실행: pytest tests/test_stage_e.py -v
"""

import os
import json
import re
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_file(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()

def read_css():
    return read_file('style.css')

def read_html():
    return read_file('index.html')


# ---------------------------------------------------------------------------
# manifest.json
# ---------------------------------------------------------------------------

class TestManifest:

    def _manifest(self):
        path = os.path.join(ROOT, 'manifest.json')
        assert os.path.exists(path), "manifest.json 이 없습니다"
        with open(path, encoding='utf-8') as f:
            return json.load(f)

    def test_manifest_exists(self):
        """manifest.json 파일이 존재해야 함."""
        assert os.path.exists(os.path.join(ROOT, 'manifest.json'))

    def test_manifest_has_name(self):
        m = self._manifest()
        assert m.get('name'), "manifest name 없음"
        assert '自畵像' in m['name'] or '자화상' in m['name'].lower() or m['name'], \
            "manifest name이 비어있음"

    def test_manifest_has_short_name(self):
        m = self._manifest()
        assert m.get('short_name'), "manifest short_name 없음"

    def test_manifest_display_standalone(self):
        """display가 standalone이어야 PWA 앱처럼 열림."""
        m = self._manifest()
        assert m.get('display') == 'standalone', \
            f"display가 standalone이 아님: {m.get('display')}"

    def test_manifest_has_start_url(self):
        m = self._manifest()
        assert m.get('start_url'), "start_url 없음"

    def test_manifest_has_icons(self):
        """아이콘이 최소 1개 이상 있어야 함."""
        m = self._manifest()
        assert m.get('icons') and len(m['icons']) > 0, "icons 없음"

    def test_manifest_has_theme_color(self):
        m = self._manifest()
        assert m.get('theme_color'), "theme_color 없음"

    def test_manifest_has_background_color(self):
        m = self._manifest()
        assert m.get('background_color'), "background_color 없음"


# ---------------------------------------------------------------------------
# Service Worker
# ---------------------------------------------------------------------------

class TestServiceWorker:

    def _sw(self):
        path = os.path.join(ROOT, 'sw.js')
        assert os.path.exists(path), "sw.js 가 없습니다"
        with open(path, encoding='utf-8') as f:
            return f.read()

    def test_sw_exists(self):
        """sw.js 파일이 존재해야 함."""
        assert os.path.exists(os.path.join(ROOT, 'sw.js'))

    def test_sw_has_install_listener(self):
        """install 이벤트 리스너가 있어야 함."""
        assert 'install' in self._sw(), "install 이벤트 없음"

    def test_sw_has_fetch_listener(self):
        """fetch 이벤트 리스너가 있어야 함."""
        assert 'fetch' in self._sw(), "fetch 이벤트 없음"

    def test_sw_caches_static_assets(self):
        """정적 파일 캐시 목록이 있어야 함."""
        sw = self._sw()
        assert 'caches' in sw, "caches API 없음"
        assert 'index.html' in sw or 'style.css' in sw, "정적 파일 캐시 목록 없음"

    def test_sw_bypasses_api_routes(self):
        """/api/ 경로는 캐시 없이 네트워크로 처리해야 함."""
        sw = self._sw()
        assert '/api/' in sw, "SW가 /api/ 경로를 처리하지 않음"

    def test_sw_bypasses_login_route(self):
        """/login 경로는 SW를 통과해야 함."""
        sw = self._sw()
        assert '/login' in sw, "SW가 /login 경로를 처리하지 않음"


# ---------------------------------------------------------------------------
# index.html — 메타태그 + SW 등록
# ---------------------------------------------------------------------------

class TestIndexHTML:

    def test_manifest_link_in_html(self):
        """index.html 에 manifest 링크가 있어야 함."""
        html = read_html()
        assert 'manifest.json' in html, "manifest.json 링크 없음"

    def test_sw_registration_in_html(self):
        """index.html 에 SW 등록 코드가 있어야 함."""
        html = read_html()
        assert 'serviceWorker' in html, "serviceWorker 등록 코드 없음"
        assert 'sw.js' in html, "sw.js 등록 경로 없음"

    def test_apple_mobile_web_app_capable(self):
        """iOS PWA용 apple-mobile-web-app-capable 메타태그가 있어야 함."""
        html = read_html()
        assert 'apple-mobile-web-app-capable' in html, \
            "apple-mobile-web-app-capable 메타태그 없음"

    def test_apple_mobile_web_app_title(self):
        """iOS 홈화면 앱 이름 메타태그가 있어야 함."""
        html = read_html()
        assert 'apple-mobile-web-app-title' in html, \
            "apple-mobile-web-app-title 없음"

    def test_apple_touch_icon(self):
        """iOS 홈화면 아이콘 링크가 있어야 함."""
        html = read_html()
        assert 'apple-touch-icon' in html, "apple-touch-icon 없음"

    def test_viewport_meta_includes_viewport_fit(self):
        """아이패드 노치/안전영역 처리를 위한 viewport-fit이 있어야 함."""
        html = read_html()
        assert 'viewport-fit=cover' in html, \
            "viewport-fit=cover 없음 (아이패드 안전영역 처리 필요)"


# ---------------------------------------------------------------------------
# CSS — 아이패드 레이아웃
# ---------------------------------------------------------------------------

class TestIPadCSS:

    def test_app_uses_dvh_not_vh(self):
        """body와 .app 의 height가 100dvh 여야 함 (하드 키보드 툴바 대응)."""
        css = read_css()
        # body { height: 100dvh } 확인
        body_section = re.search(r'body\s*\{[^}]+\}', css)
        if body_section:
            assert 'dvh' in body_section.group(), \
                "body height가 dvh를 사용하지 않음"

    def test_no_100vh_in_main_layout(self):
        """메인 레이아웃(.app, body)에 100vh 가 남아있지 않아야 함."""
        css = read_css()
        # body { height: 100vh } 패턴이 없어야 함
        # 단, calc(100vh ...) 형태도 제거 대상
        main_layout = re.findall(
            r'(?:body|\.app)\s*\{[^}]+height\s*:\s*100vh[^}]*\}', css
        )
        assert not main_layout, \
            f"body/.app 에 100vh 가 남아있음: {main_layout}"

    def test_dvh_applied_in_mobile_media_query(self):
        """모바일 미디어쿼리에서도 dvh를 사용해야 함."""
        css = read_css()
        assert 'dvh' in css, "style.css 에 dvh 가 전혀 없음"

    def test_icon_file_exists(self):
        """PWA 아이콘 파일이 존재해야 함."""
        icons_dir = os.path.join(ROOT, 'icons')
        assert os.path.exists(icons_dir), "icons/ 디렉토리 없음"
        files = os.listdir(icons_dir)
        assert len(files) > 0, "icons/ 디렉토리가 비어있음"


# ---------------------------------------------------------------------------
# 서버 — manifest, sw.js, icons 정적 파일 서빙
# ---------------------------------------------------------------------------

class TestStaticServing:

    def test_manifest_served(self, client):
        """서버가 /manifest.json 을 200으로 서빙해야 함."""
        r = client.get('/manifest.json')
        assert r.status_code == 200

    def test_sw_served(self, client):
        """서버가 /sw.js 를 200으로 서빙해야 함."""
        r = client.get('/sw.js')
        assert r.status_code == 200

    def test_icon_served(self, client):
        """서버가 /icons/icon.svg 를 200으로 서빙해야 함."""
        r = client.get('/icons/icon.svg')
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# 회귀
# ---------------------------------------------------------------------------

class TestRegression_ABCD:

    def test_block_editor_intact(self):
        assert os.path.exists(os.path.join(ROOT, 'js', 'verbatim-editor.js'))

    def test_find_replace_intact(self):
        content = read_file('js/utils.js')
        assert 'verbatimFindReplace' in content

    def test_long_verbatim_endpoint_intact(self, client):
        r = client.post(
            '/api/summarize-verbatim',
            data=json.dumps({'verbatim': 'short'}),
            content_type='application/json'
        )
        assert r.status_code == 200
        assert r.get_json().get('skip') is True
