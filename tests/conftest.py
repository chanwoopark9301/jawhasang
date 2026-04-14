"""
自畵像 — pytest 공통 설정
- Flask 테스트 클라이언트 픽스처 (단위/통합 테스트)
- Playwright E2E 테스트용 live_server 픽스처
- 임시 데이터 파일 격리
- 환경변수 로드
"""

import os
import sys
import json
import time
import threading
import tempfile
import pytest
from dotenv import load_dotenv

# ecrk.env 로드 (프로젝트 루트 기준)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(ROOT, 'ecrk.env'))

# E2E 테스트용 비밀번호 (실제 APP_PASSWORD 우선, 없으면 고정 테스트값)
E2E_PASSWORD = os.getenv('APP_PASSWORD') or 'test-pw-e2e'
E2E_PORT     = 15001


@pytest.fixture
def app(tmp_path):
    """격리된 임시 data.json 을 사용하는 Flask 테스트 앱."""
    data_file = tmp_path / 'data.json'

    # server.py 임포트 전에 환경변수 조작
    import importlib
    import sys

    # 기존 임포트 캐시 제거 (격리)
    if 'server' in sys.modules:
        del sys.modules['server']

    # DATABASE_URL 없이 로컬 파일 모드 강제
    os.environ['DATABASE_URL'] = ''

    import server as srv
    srv.DATA_FILE = str(data_file)
    srv.app.config['TESTING'] = True
    srv.app.config['SECRET_KEY'] = 'test-secret'

    yield srv.app

    # 정리
    os.environ.pop('DATABASE_URL', None)


@pytest.fixture
def client(app):
    """로그인된 테스트 클라이언트."""
    with app.test_client() as c:
        password = os.getenv('APP_PASSWORD', '')
        c.post('/login', data={'password': password})
        yield c


# ---------------------------------------------------------------------------
# Playwright E2E 픽스처
# ---------------------------------------------------------------------------

@pytest.fixture(scope='session')
def live_server_url(tmp_path_factory):
    """
    실제 Flask 서버를 백그라운드 스레드에서 구동하고 URL을 반환.
    scope='session' — 세션 전체에서 서버 1개 공유.
    """
    # 기존 모듈 캐시 제거 (단위 테스트와 격리)
    for mod in list(sys.modules.keys()):
        if mod == 'server':
            del sys.modules[mod]

    os.environ['DATABASE_URL'] = ''
    os.environ['APP_PASSWORD'] = E2E_PASSWORD

    import server as srv

    tmp = tmp_path_factory.mktemp('e2e_data')
    srv.DATA_FILE = str(tmp / 'data.json')
    srv.APP_PASSWORD = E2E_PASSWORD
    srv.app.config.update(
        TESTING=False,         # 실제 서버처럼 동작
        SECRET_KEY='e2e-secret',
        SESSION_COOKIE_SECURE=False,
    )

    def _run():
        # werkzeug 개발 서버 (use_reloader=False 필수)
        srv.app.run(host='127.0.0.1', port=E2E_PORT, debug=False, use_reloader=False)

    t = threading.Thread(target=_run, daemon=True)
    t.start()

    # 서버 준비 대기 (최대 5초)
    import urllib.request
    for _ in range(50):
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{E2E_PORT}/login', timeout=0.5)
            break
        except Exception:
            time.sleep(0.1)

    yield f'http://127.0.0.1:{E2E_PORT}'

    # 스레드는 daemon=True이므로 프로세스 종료 시 자동 정리


@pytest.fixture
def logged_in_page(page, live_server_url):
    """
    로그인된 Playwright 페이지를 반환.
    각 테스트 함수마다 호출됨 (function scope).
    """
    page.goto(f'{live_server_url}/login')
    page.fill('input[name=password]', E2E_PASSWORD)
    page.click('button[type=submit]')
    # 메인 앱 로드 대기
    page.wait_for_selector('#app', timeout=10_000)
    return page


@pytest.fixture
def empty_data():
    """빈 데이터 구조."""
    return {
        'students': [],
        'sessions': [],
        'aiResults': {},
        'my_topics': [],
        'my_records': [],
    }


@pytest.fixture
def sample_session_short():
    """3000자 미만 짧은 축어록 세션."""
    return {
        'id': 'ss_test_short',
        'studentId': 's_test',
        'date': '2026-04-09',
        'sessionNum': 1,
        'verbatim': '상담자: 오늘 어떠셨어요?\n내담자: 그냥 힘들었어요.\n상담자: 어떤 점이 힘드셨나요?\n내담자: 모르겠어요.',
        'memo': '',
        'analysis': None,
        'supervisionChat': [],
        'verbatimSummary': None,
    }


@pytest.fixture
def sample_session_long():
    """3000자 이상 긴 축어록 세션."""
    turn = '상담자: 오늘 학교에서 어떤 일이 있었는지 이야기해줄 수 있어?\n내담자: 음... 그냥 별로 없었어요. 그냥 힘들었어요.\n'
    verbatim = turn * 60  # 약 4800자
    return {
        'id': 'ss_test_long',
        'studentId': 's_test',
        'date': '2026-04-09',
        'sessionNum': 2,
        'verbatim': verbatim,
        'memo': '긴 세션 테스트',
        'analysis': None,
        'supervisionChat': [],
        'verbatimSummary': None,
    }


@pytest.fixture
def sample_student():
    return {
        'id': 's_test',
        'alias': '테스트-01',
        'grade': '중2',
        'gender': '남',
        'family': '양부모',
        'peers': '교우관계 양호',
        'situation': '테스트용',
        'notes': '',
        'createdAt': '2026-04-09',
    }
