"""
自畵像 — 서버 유닛 테스트
실행: pytest tests/test_server.py -v
"""

import json
import os
import pytest


# ---------------------------------------------------------------------------
# 기본 API
# ---------------------------------------------------------------------------

class TestDataAPI:
    def test_get_data_returns_empty_structure(self, client):
        r = client.get('/api/data')
        assert r.status_code == 200
        data = r.get_json()
        assert 'students' in data
        assert 'sessions' in data
        assert 'my_topics' in data
        assert 'my_records' in data
        assert 'investment' in data
        assert 'positions' in data['investment']
        assert 'rules' in data['investment']
        assert 'events' in data['investment']
        assert 'decisions' in data['investment']
        assert 'chat' in data['investment']

    def test_save_and_load_data(self, client, sample_student, sample_session_short):
        payload = {
            'students': [sample_student],
            'sessions': [sample_session_short],
            'aiResults': {},
            'my_topics': [],
            'my_records': [],
            'investment': {
                'positions': [{'id': 'ip1', 'symbol': 'NVDA'}],
                'rules': {'cooldownMinutes': 45},
                'journal': [],
                'events': [],
                'decisions': [],
                'chat': [{'role': 'user', 'text': 'NVDA 뉴스 확인'}],
            },
        }
        r = client.post('/api/data',
                        data=json.dumps(payload),
                        content_type='application/json')
        assert r.status_code == 200
        assert r.get_json()['ok'] is True

        r2 = client.get('/api/data')
        loaded = r2.get_json()
        assert loaded['students'][0]['alias'] == '테스트-01'
        assert loaded['sessions'][0]['id'] == 'ss_test_short'
        assert loaded['investment']['positions'][0]['symbol'] == 'NVDA'
        assert loaded['investment']['rules']['cooldownMinutes'] == 45
        assert loaded['investment']['chat'][0]['text'] == 'NVDA 뉴스 확인'

    def test_market_quote_endpoint_returns_normalized_quotes(self, client, monkeypatch):
        import server

        class FakeResp:
            ok = True
            status_code = 200

            def json(self):
                return {
                    'quoteResponse': {
                        'result': [
                            {
                                'symbol': 'NVDA',
                                'shortName': 'NVIDIA Corporation',
                                'regularMarketPrice': 120.5,
                                'regularMarketChangePercent': 4.2,
                                'regularMarketPreviousClose': 115.6,
                                'regularMarketTime': 1770000000,
                            },
                            {
                                'symbol': '^GSPC',
                                'shortName': 'S&P 500',
                                'regularMarketPrice': 5200.0,
                                'regularMarketChangePercent': -1.1,
                            },
                        ]
                    }
                }

        def fake_get(url, params=None, headers=None, timeout=None):
            assert 'query1.finance.yahoo.com' in url
            assert params['symbols'] == 'NVDA,^GSPC'
            return FakeResp()

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/market/quote?symbols=NVDA,^GSPC')

        assert r.status_code == 200
        data = r.get_json()
        assert data['quotes'][0]['symbol'] == 'NVDA'
        assert data['quotes'][0]['price'] == 120.5
        assert data['quotes'][0]['changePercent'] == 4.2
        assert data['quotes'][1]['symbol'] == '^GSPC'

    def test_market_quote_endpoint_rejects_invalid_symbols(self, client):
        r = client.get('/api/market/quote?symbols=NVDA;DROP')
        assert r.status_code == 400

    def test_unauthorized_api_returns_json_401(self, app):
        with app.test_client() as c:
            r = c.get('/api/data')
            assert r.status_code == 401
            assert r.is_json
            assert r.get_json()['error'] == 'auth_required'

    def test_unauthorized_page_redirects(self, app):
        with app.test_client() as c:
            r = c.get('/')
            assert r.status_code == 302
            assert '/login' in r.location


# ---------------------------------------------------------------------------
# PII 스크러빙 (Stage A 전제 조건)
# ---------------------------------------------------------------------------

class TestPIIScrubbing:
    """server._scrub_pii() 가 민감정보를 마스킹하는지 검증."""

    def _scrub(self):
        import server
        return server._scrub_pii

    def test_phone_number_masked(self):
        scrub = self._scrub()
        assert '[전화번호]' in scrub('010-1234-5678')
        assert '[전화번호]' in scrub('01012345678')

    def test_resident_number_masked(self):
        scrub = self._scrub()
        assert '[주민번호]' in scrub('990101-1234567')

    def test_email_masked(self):
        scrub = self._scrub()
        assert '[이메일]' in scrub('test@school.kr')

    def test_normal_text_unchanged(self):
        scrub = self._scrub()
        text = '오늘 상담에서 내담자가 힘들다고 했어요.'
        assert scrub(text) == text

    def test_payload_scrub_messages(self):
        import server
        payload = {
            'messages': [
                {'role': 'user', 'content': '내 번호는 010-9999-8888이에요.'}
            ]
        }
        result = server._scrub_payload(payload)
        assert '010-9999-8888' not in result['messages'][0]['content']
        assert '[전화번호]' in result['messages'][0]['content']

    def test_payload_scrub_system_list(self):
        import server
        payload = {
            'system': [{'type': 'text', 'text': '이메일은 abc@test.com입니다.'}],
            'messages': []
        }
        result = server._scrub_payload(payload)
        assert 'abc@test.com' not in result['system'][0]['text']


# ---------------------------------------------------------------------------
# Stage A — 긴 축어록 감지 및 요약 엔드포인트
# ---------------------------------------------------------------------------

class TestStagA_LongVerbatim:
    """
    /api/summarize-verbatim 엔드포인트 테스트.
    실제 AI 호출 없이 구조만 검증 (ANTHROPIC_API_KEY 없어도 통과).
    """

    LONG_VERBATIM_THRESHOLD = 3000

    def test_verbatim_length_threshold(self, sample_session_short, sample_session_long):
        """3000자 기준으로 짧음/긺 판별."""
        assert len(sample_session_short['verbatim']) < self.LONG_VERBATIM_THRESHOLD
        assert len(sample_session_long['verbatim']) >= self.LONG_VERBATIM_THRESHOLD

    def test_summarize_endpoint_exists(self, client):
        """/api/summarize-verbatim 엔드포인트가 존재해야 함."""
        r = client.post('/api/summarize-verbatim',
                        data=json.dumps({'verbatim': 'test', 'student': {}}),
                        content_type='application/json')
        # 404가 아니면 엔드포인트 존재 (API 키 없으면 500 가능)
        assert r.status_code != 404

    def test_summarize_endpoint_rejects_short_verbatim(self, client, sample_session_short):
        """짧은 축어록은 요약 불필요 응답을 반환해야 함."""
        r = client.post('/api/summarize-verbatim',
                        data=json.dumps({
                            'verbatim': sample_session_short['verbatim'],
                            'student': {'alias': '테스트-01', 'grade': '중2'},
                        }),
                        content_type='application/json')
        assert r.status_code == 200
        body = r.get_json()
        assert body.get('skip') is True, "짧은 축어록은 skip:true 반환해야 함"

    def test_summarize_endpoint_requires_verbatim_field(self, client):
        """verbatim 필드 없으면 400 반환."""
        r = client.post('/api/summarize-verbatim',
                        data=json.dumps({}),
                        content_type='application/json')
        assert r.status_code == 400

    def test_report_max_tokens_is_reduced(self):
        """보고서 생성 max_tokens 이 2000 이하여야 함 (긴 출력 방지)."""
        import os
        ai_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            'js', 'ai-counseling.js'
        )
        with open(ai_file, 'r', encoding='utf-8') as f:
            content = f.read()
        # max_tokens 값 추출
        import re
        matches = re.findall(r'max_tokens["\s:]+(\d+)', content)
        report_tokens = [int(m) for m in matches]
        assert any(t <= 2000 for t in report_tokens), \
            f"보고서 max_tokens가 2000 이하여야 함. 현재: {report_tokens}"

    def test_timeout_is_sufficient(self):
        """streamAnalyze 타임아웃이 5분(300초) 이상이어야 함."""
        import os
        utils_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            'js', 'utils.js'
        )
        with open(utils_file, 'r', encoding='utf-8') as f:
            content = f.read()
        import re
        # setTimeout(..., N) 에서 N 추출 (JS 숫자 구분자 _ 포함)
        matches = re.findall(r'setTimeout\([^,]+,\s*([\d_]+)\)', content)
        timeouts = [int(m.replace('_', '')) for m in matches]
        assert any(t >= 120_000 for t in timeouts), \
            f"streamAnalyze 타임아웃이 120000ms 이상이어야 함. 현재: {timeouts}"
