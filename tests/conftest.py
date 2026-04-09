"""
自畵像 — pytest 공통 설정
- Flask 테스트 클라이언트 픽스처
- 임시 데이터 파일 격리
- 환경변수 로드
"""

import os
import json
import tempfile
import pytest
from dotenv import load_dotenv

# ecrk.env 로드 (프로젝트 루트 기준)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(ROOT, 'ecrk.env'))


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
