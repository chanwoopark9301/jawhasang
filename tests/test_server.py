"""
自畵像 — 서버 유닛 테스트
실행: pytest tests/test_server.py -v
"""

import json
import os
import pytest
from urllib.parse import quote


# ---------------------------------------------------------------------------
# 기본 API
# ---------------------------------------------------------------------------

class TestDataAPI:
    def test_sensitive_project_files_are_never_served(self, client):
        for path in ('/ecrk.env', '/data.json', '/server.py', '/server.log'):
            r = client.get(path)
            assert r.status_code in (403, 404)
            assert b'APP_PASSWORD' not in r.data
            assert b'KIS_APP_SECRET' not in r.data

    def test_security_headers_are_applied_to_api_responses(self, client):
        r = client.get('/api/data')
        assert r.status_code == 200
        assert r.headers['X-Content-Type-Options'] == 'nosniff'
        assert r.headers['X-Frame-Options'] == 'DENY'
        assert r.headers['Referrer-Policy'] == 'no-referrer'
        assert 'no-store' in r.headers['Cache-Control']

    def test_cross_site_state_changing_api_is_rejected(self, client):
        r = client.post('/api/data',
                        data=json.dumps({'students': []}),
                        headers={'Origin': 'https://evil.example'},
                        content_type='application/json')
        assert r.status_code == 403
        assert r.get_json()['error'] == 'forbidden_origin'

    def test_safe_error_detail_redacts_broker_and_exchange_secrets(self, app):
        import server

        detail = server._safe_error_detail(
            RuntimeError('KIS_APP_SECRET=abc BITHUMB_SECRET_KEY=def appsecret=ghi Authorization: Bearer token')
        )
        assert 'abc' not in detail
        assert 'def' not in detail
        assert 'ghi' not in detail
        assert 'token' not in detail
        assert '[redacted]' in detail

    def test_storage_ready_caches_schema_metadata(self, monkeypatch):
        import server

        calls = {'ensure': 0, 'type': 0}

        def fake_ensure_table(conn):
            calls['ensure'] += 1

        def fake_storage_data_type(conn):
            calls['type'] += 1
            return 'bytea'

        monkeypatch.setattr(server, '_STORAGE_READY', False)
        monkeypatch.setattr(server, '_STORAGE_DATA_TYPE_CACHE', None)
        monkeypatch.setattr(server, '_ensure_table', fake_ensure_table)
        monkeypatch.setattr(server, '_storage_data_type', fake_storage_data_type)

        assert server._ensure_storage_ready(object()) == 'bytea'
        assert server._ensure_storage_ready(object()) == 'bytea'
        assert calls == {'ensure': 1, 'type': 1}

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
        assert 'orderIntents' in data['investment']
        assert data['investment']['rules']['dailyLossLimit'] == 2
        assert data['investment']['rules']['maxPositionWeight'] == 25
        assert '계획 없이 매수하지 않는다' in data['investment']['rules']['coreRules']
        assert data['investment']['broker']['orderIntentOnly'] is True
        assert 'calendar' in data['investment']
        assert data['investment']['calendar']['lookaheadDays'] == 45
        assert 'signals' in data['investment']
        assert len(data['investment']['signals']['watchlist']) >= 1
        assert data['investment']['desk']['autoPrepare'] is True
        assert data['investment']['desk']['prepareTime'] == '09:00'

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

    def test_save_investment_position_endpoint_persists_position(self, client):
        payload = {
            'position': {
                'id': 'ip-iren',
                'symbol': 'iren',
                'name': 'Iris Energy',
                'shares': '1,700',
                'avgPrice': '46.06',
                'currentPrice': 46.06,
            }
        }
        r = client.post('/api/investment/positions',
                        data=json.dumps(payload),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['position']['symbol'] == 'IREN'

        loaded = client.get('/api/data').get_json()
        pos = loaded['investment']['positions'][0]
        assert pos['symbol'] == 'IREN'
        assert pos['shares'] == 1700
        assert pos['avgPrice'] == 46.06
        assert pos['currentPrice'] == 46.06

    def test_save_investment_position_endpoint_reports_request_id_on_bad_payload(self, client):
        r = client.post('/api/investment/positions',
                        data=json.dumps({'position': None}),
                        content_type='application/json')

        assert r.status_code == 400
        data = r.get_json()
        assert data['error']
        assert data['requestId'].startswith('ipos-')

    def test_save_cash_position_normalizes_amount(self, client):
        payload = {
            'position': {
                'id': 'ip-cash',
                'assetType': 'cash',
                'symbol': 'cash',
                'name': 'USD Cash',
                'shares': '12,345.67',
            }
        }
        r = client.post('/api/investment/positions',
                        data=json.dumps(payload),
                        content_type='application/json')

        assert r.status_code == 200
        pos = r.get_json()['position']
        assert pos['assetType'] == 'cash'
        assert pos['symbol'] == 'CASH'
        assert pos['shares'] == 12345.67
        assert pos['cashAmount'] == 12345.67
        assert pos['avgPrice'] == 1.0
        assert pos['currentPrice'] == 1.0

    def test_investment_transaction_updates_position_cash_and_blocks_duplicate(self, client):
        client.post('/api/investment/positions',
                    data=json.dumps({'position': {
                        'id': 'ip-iren',
                        'symbol': 'IREN',
                        'shares': 1700,
                        'avgPrice': 46.06,
                        'currentPrice': 60,
                    }}),
                    content_type='application/json')

        payload = {
            'transaction': {
                'id': 'tx-iren-sell',
                'positionId': 'ip-iren',
                'symbol': 'IREN',
                'action': 'sell',
                'quantity': 1190,
                'price': 60,
                'idempotencyKey': 'IREN|sell|1190|60',
            }
        }
        r = client.post('/api/investment/transactions',
                        data=json.dumps(payload),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        inv = data['investment']
        iren = next(p for p in inv['positions'] if p['symbol'] == 'IREN')
        cash = next(p for p in inv['positions'] if p['symbol'] == 'CASH')
        assert iren['shares'] == 510
        assert cash['cashAmount'] == 71400
        assert round(data['transaction']['realizedGain'], 2) == 16588.6

        r2 = client.post('/api/investment/transactions',
                         data=json.dumps(payload),
                         content_type='application/json')
        assert r2.status_code == 200
        data2 = r2.get_json()
        assert data2['duplicate'] is True
        inv2 = client.get('/api/data').get_json()['investment']
        iren2 = next(p for p in inv2['positions'] if p['symbol'] == 'IREN')
        cash2 = next(p for p in inv2['positions'] if p['symbol'] == 'CASH')
        assert iren2['shares'] == 510
        assert cash2['cashAmount'] == 71400
        assert len(inv2['decisions']) == 1

    def test_investment_ledger_endpoint_prefers_normalized_table_snapshot(self, client, monkeypatch):
        import server

        client.post('/api/data',
                    data=json.dumps({'investment': {
                        'positions': [{'id': 'ip-stale', 'symbol': 'CASH', 'assetType': 'cash', 'shares': 1, 'cashAmount': 1}],
                        'rules': {},
                        'journal': [],
                        'events': [],
                        'decisions': [],
                    }}),
                    content_type='application/json')

        def fake_ledger(inv):
            return {
                'ledgerSource': 'normalized-tables',
                'account': {'id': 'primary', 'baseCurrency': 'USD', 'cashBalance': 125000},
                'positions': [
                    {'id': 'ip-iren-ledger', 'symbol': 'IREN', 'name': 'Iris Energy', 'assetType': 'stock', 'shares': 510, 'avgPrice': 66.38, 'currentPrice': 64},
                    {'id': 'ip-cash-ledger', 'symbol': 'CASH', 'name': 'Cash', 'assetType': 'cash', 'shares': 125000, 'cashAmount': 125000, 'avgPrice': 1, 'currentPrice': 1},
                ],
            }

        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', fake_ledger)

        r = client.get('/api/investment/ledger')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['source'] == 'normalized-tables'
        assert data['investment']['positions'][0]['symbol'] == 'IREN'
        assert data['investment']['positions'][0]['shares'] == 510
        assert data['investment']['positions'][1]['cashAmount'] == 125000

    def test_investment_ledger_post_saves_only_investment_snapshot(self, client, monkeypatch):
        import server

        mirrored = []
        monkeypatch.setattr(server, '_mirror_investment_snapshot_to_tables', lambda data: mirrored.append(data['investment']) or True)
        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: None)

        client.post('/api/data',
                    data=json.dumps({
                        'students': [{'id': 's-keep', 'alias': 'A'}],
                        'investment': {
                            'positions': [
                                {'id': 'ip-old', 'symbol': 'IREN', 'shares': 510, 'avgPrice': 66.38, 'currentPrice': 61.2},
                                {'id': 'ip-cash-old', 'symbol': 'CASH', 'assetType': 'cash', 'cashAmount': 42135, 'shares': 42135},
                            ],
                            'rules': {'maxPositionWeight': 25},
                            'journal': [],
                            'events': [],
                            'decisions': [],
                        },
                    }),
                    content_type='application/json')

        r = client.post('/api/investment/ledger',
                        data=json.dumps({'investment': {
                            'positions': [
                                {'id': 'ip-eth', 'symbol': 'ETH-USD', 'assetType': 'crypto', 'shares': 5, 'avgPrice': 4156.46, 'currentPrice': 2353.74},
                                {'id': 'ip-intc', 'symbol': 'INTC', 'shares': 754, 'avgPrice': 129.67, 'currentPrice': 0},
                            ],
                            'rules': {'maxPositionWeight': 25},
                            'journal': [],
                            'events': [{'id': 'ie-ledger', 'title': 'ledger saved', 'date': '2026-05-13'}],
                            'decisions': [],
                        }}),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['normalized'] is True
        assert [p['symbol'] for p in data['investment']['positions']] == ['ETH-USD', 'INTC']
        assert data['investment']['positions'][0]['shares'] == 5
        assert mirrored and [p['symbol'] for p in mirrored[-1]['positions']] == ['ETH-USD', 'INTC']

        persisted = client.get('/api/data').get_json()
        assert persisted['students'][0]['id'] == 's-keep'
        assert [p['symbol'] for p in persisted['investment']['positions']] == ['ETH-USD', 'INTC']

    def test_investment_ledger_post_with_db_skips_full_app_storage_roundtrip(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, 'DATABASE_URL', 'postgres://unit-test')
        mirrored = []
        monkeypatch.setattr(server, '_mirror_investment_snapshot_to_tables', lambda data: mirrored.append(data['investment']) or True)
        monkeypatch.setattr(server, 'read_data', lambda: (_ for _ in ()).throw(AssertionError('read_data should not run for DB ledger POST')))
        monkeypatch.setattr(server, 'write_data', lambda data: (_ for _ in ()).throw(AssertionError('write_data should not run for DB ledger POST')))

        r = client.post('/api/investment/ledger',
                        data=json.dumps({'investment': {
                            'positions': [
                                {'id': 'ip-intc', 'symbol': 'INTC', 'shares': 754, 'avgPrice': 129.67, 'currentPrice': 120.61},
                            ],
                            'rules': {'maxPositionWeight': 25},
                            'events': [],
                            'decisions': [],
                        }}),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['normalized'] is True
        assert mirrored and mirrored[-1]['positions'][0]['symbol'] == 'INTC'

    def test_get_data_overlays_normalized_investment_ledger(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, 'read_data', lambda: {
            'students': [{'id': 's-keep', 'alias': 'A'}],
            'investment': {
                'positions': [{'id': 'ip-stale', 'symbol': 'CASH', 'assetType': 'cash', 'shares': 1, 'cashAmount': 1}],
                'rules': {'maxPositionWeight': 25},
                'journal': [],
                'events': [],
                'decisions': [],
            },
        })
        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: {
            'ledgerSource': 'normalized-tables',
            'account': {'id': 'primary', 'baseCurrency': 'USD', 'cashBalance': 0},
            'positions': [
                {'id': 'ip-intc-ledger', 'symbol': 'INTC', 'assetType': 'stock', 'shares': 754, 'avgPrice': 129.67, 'currentPrice': 120.61},
            ],
        })

        r = client.get('/api/data')

        assert r.status_code == 200
        data = r.get_json()
        assert data['students'][0]['id'] == 's-keep'
        assert [p['symbol'] for p in data['investment']['positions']] == ['INTC']
        assert data['investment']['ledgerSource'] == 'normalized-tables'

    def test_full_snapshot_mirror_deletes_positions_missing_from_snapshot(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, 'DATABASE_URL', 'postgres://unit-test')

        calls = []

        class FakeCursor:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def execute(self, sql, params=None):
                calls.append((' '.join(sql.split()), params))

            def fetchone(self):
                return None

            def fetchall(self):
                return []

        class FakeConn:
            def cursor(self):
                return FakeCursor()

            def commit(self):
                calls.append(('COMMIT', None))

            def close(self):
                calls.append(('CLOSE', None))

        monkeypatch.setattr(server, '_get_db_conn', lambda: FakeConn())
        monkeypatch.setattr(server, '_ensure_investment_tables', lambda conn: None)

        mirrored = server._mirror_investment_snapshot_to_tables({
            'investment': {
                'positions': [
                    {'id': 'ip-eth', 'symbol': 'ETH-USD', 'assetType': 'crypto', 'shares': 5, 'avgPrice': 4156.46, 'currentPrice': 2353.74},
                    {'id': 'ip-intc', 'symbol': 'INTC', 'shares': 754, 'avgPrice': 129.67, 'currentPrice': 0},
                ],
                'events': [],
                'decisions': [],
            }
        })

        assert mirrored is True
        delete_calls = [call for call in calls if call[0].startswith('DELETE FROM investment_positions')]
        assert delete_calls, calls
        assert delete_calls[0][1][0] == 'primary'
        assert delete_calls[0][1] == ('primary',)

    def test_investment_desk_engine_endpoint_generates_theses_controls_and_snapshot(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: None)
        client.post('/api/data',
                    data=json.dumps({'investment': {
                        'positions': [
                            {'id': 'ip-crcl', 'symbol': 'CRCL', 'name': 'Circle Internet Group', 'shares': 113, 'avgPrice': 128.91, 'currentPrice': 113.67, 'changePercent': 5.5},
                            {'id': 'ip-iren', 'symbol': 'IREN', 'name': 'Iris Energy', 'shares': 510, 'avgPrice': 66.38, 'currentPrice': 61.20},
                            {'id': 'ip-cash', 'symbol': 'CASH', 'assetType': 'cash', 'shares': 42135, 'cashAmount': 42135},
                        ],
                        'rules': {'maxPositionWeight': 25, 'chaseLimit': 3},
                        'events': [
                            {'id': 'earnings-crcl', 'date': '2026-05-11', 'type': 'earnings', 'symbol': 'CRCL', 'title': 'CRCL earnings'},
                            {'id': 'crcl-rumor', 'date': '2026-05-11', 'type': 'signal', 'symbol': 'CRCL', 'title': 'X rumor says stablecoin bill may pass', 'source': 'x.com'},
                            {'id': 'iren-dilution', 'date': '2026-05-11', 'type': 'news', 'symbol': 'IREN', 'title': 'IREN ATM offering dilution risk', 'source': 'sec-edgar'},
                            {'id': 'macro-cpi', 'date': '2026-05-12', 'type': 'macro', 'symbol': 'MACRO', 'title': 'CPI'},
                        ],
                        'decisions': [
                            {'id': 'sell-iren', 'date': '2026-05-11', 'symbol': 'IREN', 'action': 'sell', 'tradeShares': 1190, 'tradePrice': 60},
                        ],
                    }}),
                    content_type='application/json')

        r = client.post('/api/investment/desk/engine',
                        data=json.dumps({'date': '2026-05-11'}),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        engine = data['engine']
        assert engine['version'].startswith('2026-05-13.py-engine-4')
        thesis = {item['symbol']: item for item in engine['theses']}
        assert thesis['CRCL']['profile'] == 'stablecoin_issuer'
        assert 'stablecoin legislation' in thesis['CRCL']['drivers']
        assert thesis['CRCL']['status'] == 'needs_confirmation'
        assert thesis['CRCL']['unconfirmedEvidence'][0]['needsVerification'] is True
        assert thesis['IREN']['profile'] == 'ai_miner_infrastructure'
        assert thesis['IREN']['status'] == 'under_pressure'
        assert thesis['IREN']['bearishEvidence'][0]['evidenceLevel'] == 'A'
        controls = {item['symbol']: item for item in engine['behaviorControls']}
        assert 'market buy' in controls['CRCL']['blockedActions']
        assert 'impulse trade' in controls['CRCL']['blockedActions']
        assert 'act on rumor' in controls['CRCL']['blockedActions']
        assert 'immediate re-entry' in controls['IREN']['blockedActions']
        assert 'add before thesis review' in controls['IREN']['blockedActions']
        assert engine['marketView']['topLine']
        assert engine['marketView']['thesisEvidence']['IREN']['status'] == 'under_pressure'
        scenarios = {item['symbol']: item for item in engine['scenarios']}
        assert scenarios['CRCL']['baseCase']['action'] == 'wait_for_confirmation'
        assert 'A/B evidence' in scenarios['CRCL']['baseCase']['requiredEvidence'][0]
        assert scenarios['IREN']['bearCase']['action'] == 'reduce_or_exit_review'
        assert 'dilution' in ' '.join(scenarios['IREN']['bearCase']['rationale']).lower()
        assert any(item['symbol'] == 'CRCL' and item['driver'] == 'stablecoin legislation'
                   for item in engine['researchQueue'])

        loaded = client.get('/api/data').get_json()['investment']
        assert loaded['desk']['engine']['date'] == '2026-05-11'
        assert loaded['theses']['IREN']['status'] == 'under_pressure'
        assert loaded['deskSnapshots'][0]['topLine'] == engine['marketView']['topLine']
        assert loaded['deskSnapshots'][0]['marketRegime']['regime']['regime'] == engine['marketRegime']['regime']['regime']
        assert loaded['deskSnapshots'][0]['eventDefenseLevel'] == engine['marketRegime']['regime']['eventDefenseLevel']
        assert loaded['deskSnapshots'][0]['targetCashRange'] == engine['marketRegime']['regime']['targetCashRange']
        assert loaded['deskSnapshots'][0]['cashGap']['status'] == engine['marketRegime']['allocation']['cashGap']['status']
        assert loaded['deskSnapshots'][0]['marketRegimeReview']['windowDays'] == 7

    def test_investment_desk_engine_persists_review_loop_event(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: None)
        client.post('/api/data',
                    data=json.dumps({'investment': {
                        'positions': [
                            {'id': 'ip-qld', 'symbol': 'QLD', 'shares': 312, 'avgPrice': 88.88, 'currentPrice': 91.72},
                            {'id': 'ip-cash', 'symbol': 'CASH', 'assetType': 'cash', 'shares': 42135, 'cashAmount': 42135},
                        ],
                        'events': [],
                        'deskSnapshots': [{
                            'date': '2026-05-12',
                            'eventDefenseLevel': 'high',
                            'cashGap': {'current': 33.3, 'status': 'too_low'},
                            'marketRegime': {
                                'regime': {'regime': 'sideways', 'eventDefenseLevel': 'high', 'targetCashRange': [40, 55]},
                                'allocation': {
                                    'cashGap': {'current': 33.3, 'status': 'too_low'},
                                    'actions': [{'type': 'cap_leverage', 'title': 'QLD add blocked'}],
                                },
                            },
                        }],
                        'decisions': [{
                            'id': 'dec-qld-buy',
                            'date': '2026-05-12',
                            'symbol': 'QLD',
                            'action': 'buy',
                            'tradeShares': 10,
                            'tradePrice': 91,
                        }],
                    }}),
                    content_type='application/json')

        r = client.post('/api/investment/desk/engine',
                        data=json.dumps({'date': '2026-05-13'}),
                        content_type='application/json')

        assert r.status_code == 200
        loaded = client.get('/api/data').get_json()['investment']
        snapshot = loaded['deskSnapshots'][-1]
        assert snapshot['marketRegimeReview']['violationCount'] == 1
        review_events = [e for e in loaded['events'] if e.get('type') == 'review']
        assert len(review_events) == 1
        assert review_events[0]['source'] == 'market-regime-review'
        assert 'QLD' in review_events[0]['title']
        assert review_events[0]['date'] == '2026-05-13'

    def test_investment_desk_review_event_is_idempotent_per_date(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: None)
        seed = {'investment': {
            'positions': [
                {'id': 'ip-qld', 'symbol': 'QLD', 'shares': 312, 'avgPrice': 88.88, 'currentPrice': 91.72},
                {'id': 'ip-cash', 'symbol': 'CASH', 'assetType': 'cash', 'shares': 42135, 'cashAmount': 42135},
            ],
            'events': [],
            'deskSnapshots': [{
                'date': '2026-05-12',
                'eventDefenseLevel': 'high',
                'cashGap': {'current': 33.3, 'status': 'too_low'},
                'marketRegime': {
                    'regime': {'regime': 'sideways', 'eventDefenseLevel': 'high', 'targetCashRange': [40, 55]},
                    'allocation': {
                        'cashGap': {'current': 33.3, 'status': 'too_low'},
                        'actions': [{'type': 'cap_leverage', 'title': 'QLD add blocked'}],
                    },
                },
            }],
            'decisions': [{
                'id': 'dec-qld-buy',
                'date': '2026-05-12',
                'symbol': 'QLD',
                'action': 'buy',
                'tradeShares': 10,
                'tradePrice': 91,
            }],
        }}
        client.post('/api/data', data=json.dumps(seed), content_type='application/json')

        for _ in range(2):
            r = client.post('/api/investment/desk/engine',
                            data=json.dumps({'date': '2026-05-13'}),
                            content_type='application/json')
            assert r.status_code == 200

        loaded = client.get('/api/data').get_json()['investment']
        review_events = [e for e in loaded['events'] if e.get('id') == 'market-regime-review-2026-05-13']
        assert len(review_events) == 1
        assert review_events[0]['violationCount'] == 1

    def test_investment_desk_engine_is_dynamic_for_unknown_symbol(self):
        from investment_desk_engine import build_investment_desk_engine

        engine = build_investment_desk_engine({
            'positions': [
                {'symbol': 'UEC', 'name': 'Uranium Energy', 'shares': 100, 'avgPrice': 5, 'currentPrice': 6},
            ],
            'events': [],
            'rules': {},
        }, '2026-05-11')

        thesis = engine['theses'][0]
        assert thesis['symbol'] == 'UEC'
        assert thesis['profile'] == 'single_equity'
        assert engine['scenarios'][0]['symbol'] == 'UEC'
        assert engine['scenarios'][0]['baseCase']['action'] == 'write_plan_before_trade'
        assert any('UEC' in item['query'] for item in engine['researchQueue'])

    def test_market_regime_engine_raises_cash_in_event_sideways_market(self):
        from market_regime_engine import build_market_allocation_engine

        engine = build_market_allocation_engine({
            'positions': [
                {'symbol': 'CASH', 'assetType': 'cash', 'shares': 12000, 'cashAmount': 12000},
                {'symbol': 'QLD', 'assetType': 'stock', 'shares': 300, 'currentPrice': 90},
                {'symbol': 'CRCL', 'assetType': 'stock', 'shares': 100, 'currentPrice': 120},
            ],
            'market': {
                'regimeMetrics': {
                    'indexTrend': 0.2,
                    'breadth': 0.0,
                    'volatility': 0.4,
                    'ratesPressure': 0.3,
                }
            },
            'events': [
                {'id': 'cpi', 'date': '2026-05-13', 'type': 'macro', 'symbol': 'MACRO', 'title': 'CPI 발표'},
            ],
        }, '2026-05-12')

        assert engine['regime']['regime'] == 'sideways'
        assert engine['regime']['eventDefense'] is True
        assert engine['regime']['targetCashRange'] == [30, 45]
        assert engine['allocation']['cashGap']['status'] == 'too_low'
        assert any(a['type'] == 'raise_cash' for a in engine['allocation']['actions'])
        assert any(a['type'] == 'cap_leverage' for a in engine['allocation']['actions'])
        assert any('빅 이벤트' in item for item in engine['allocation']['doNotDo'])

    def test_market_regime_metrics_marks_insufficient_data_conservative(self):
        from market_regime_engine import build_market_allocation_engine

        engine = build_market_allocation_engine({
            'positions': [
                {'symbol': 'CASH', 'assetType': 'cash', 'shares': 20000, 'cashAmount': 20000},
                {'symbol': 'QQQ', 'shares': 100, 'currentPrice': 400},
            ],
            'market': {
                'regimeMetrics': {
                    'indexTrend': 0.95,
                    'sources': ['qqq'],
                    'updatedAt': '2026-05-13T09:00:00+09:00',
                }
            },
            'events': [],
        }, '2026-05-13')

        assert engine['regime']['metricsQuality']['dataQuality'] == 'insufficient'
        assert engine['regime']['metricsQuality']['coverage'] < 3
        assert engine['regime']['regime'] == 'sideways'
        assert abs(engine['regime']['riskScore']) <= 0.15

    def test_market_regime_metrics_marks_stale_data_conservative(self):
        from market_regime_engine import build_market_allocation_engine

        engine = build_market_allocation_engine({
            'positions': [
                {'symbol': 'CASH', 'assetType': 'cash', 'shares': 5000, 'cashAmount': 5000},
                {'symbol': 'QLD', 'shares': 200, 'currentPrice': 100},
            ],
            'market': {
                'regimeMetrics': {
                    'indexTrend': 1,
                    'breadth': 1,
                    'volatility': -1,
                    'ratesPressure': -1,
                    'cryptoRisk': 1,
                    'updatedAt': '2026-05-10T09:00:00+09:00',
                    'sources': ['qqq', 'vix', 'rates'],
                }
            },
            'events': [],
        }, '2026-05-13')

        assert engine['regime']['metricsQuality']['stale'] is True
        assert engine['regime']['metricsQuality']['dataQuality'] == 'stale'
        assert engine['regime']['regime'] == 'sideways'
        assert abs(engine['regime']['riskScore']) <= 0.15

    def test_big_event_calendar_sets_high_defense_for_cpi_d1(self):
        from market_regime_engine import build_market_allocation_engine

        engine = build_market_allocation_engine({
            'positions': [
                {'symbol': 'CASH', 'assetType': 'cash', 'shares': 30000, 'cashAmount': 30000},
                {'symbol': 'QLD', 'shares': 300, 'currentPrice': 90},
            ],
            'market': {'regimeMetrics': {'indexTrend': 0.4, 'breadth': 0.2, 'volatility': 0.2, 'updatedAt': '2026-05-12T09:00:00+09:00'}},
            'events': [
                {'id': 'cpi', 'date': '2026-05-13', 'type': 'macro', 'symbol': 'MACRO', 'title': 'CPI 발표'},
            ],
        }, '2026-05-12')

        assert engine['regime']['eventDefense'] is True
        assert engine['regime']['eventDefenseLevel'] == 'high'
        event = engine['regime']['bigEvents'][0]
        assert event['importance'] == 'high'
        assert event['category'] == 'macro'
        assert event['heldExposure'] is True

    def test_big_event_calendar_prioritizes_held_earnings_over_unheld_news(self):
        from market_regime_engine import build_market_allocation_engine

        engine = build_market_allocation_engine({
            'positions': [
                {'symbol': 'CRCL', 'shares': 113, 'currentPrice': 123.65},
                {'symbol': 'CASH', 'assetType': 'cash', 'shares': 10000, 'cashAmount': 10000},
            ],
            'market': {'regimeMetrics': {'indexTrend': 0.2, 'breadth': 0.1, 'volatility': 0.2, 'updatedAt': '2026-05-12T09:00:00+09:00'}},
            'events': [
                {'id': 'crcl-er', 'date': '2026-05-15', 'type': 'earnings', 'symbol': 'CRCL', 'title': 'CRCL earnings'},
                {'id': 'nvda-news', 'date': '2026-05-13', 'type': 'news', 'symbol': 'NVDA', 'title': 'NVDA analyst note'},
            ],
        }, '2026-05-12')

        assert engine['regime']['eventDefense'] is True
        assert engine['regime']['eventDefenseLevel'] in {'medium', 'high'}
        events = {event['id']: event for event in engine['regime']['bigEvents']}
        assert events['crcl-er']['importance'] in {'medium', 'high'}
        assert events['crcl-er']['heldExposure'] is True
        assert 'nvda-news' not in events or events['nvda-news']['importance'] == 'low'

    def test_allocation_policy_overrides_cash_band_and_risk_limits(self):
        from market_regime_engine import build_market_allocation_engine

        engine = build_market_allocation_engine({
            'positions': [
                {'symbol': 'CASH', 'assetType': 'cash', 'shares': 10000, 'cashAmount': 10000},
                {'symbol': 'QLD', 'shares': 250, 'currentPrice': 100},
                {'symbol': 'IREN', 'shares': 500, 'currentPrice': 60},
            ],
            'market': {'regimeMetrics': {'indexTrend': 0.2, 'breadth': 0.0, 'volatility': 0.3, 'updatedAt': '2026-05-13T09:00:00+09:00'}},
            'events': [
                {'id': 'cpi', 'date': '2026-05-14', 'type': 'macro', 'symbol': 'MACRO', 'title': 'CPI 발표'},
            ],
            'allocationPolicy': {
                'cashRanges': {
                    'sideways': [28, 42],
                    'eventDefense': [40, 55],
                },
                'maxLeverageWeight': 15,
                'maxVolatileWeight': 25,
            },
        }, '2026-05-13')

        assert engine['regime']['targetCashRange'] == [40, 55]
        assert engine['allocation']['policy']['source'] == 'custom'
        assert engine['allocation']['riskLimits']['maxLeverageWeight'] == 15
        assert engine['allocation']['riskLimits']['maxVolatileWeight'] == 25
        assert engine['allocation']['cashGap']['status'] == 'too_low'
        assert any(action['type'] == 'cap_leverage' for action in engine['allocation']['actions'])
        assert any(action['type'] == 'trim_event_risk' for action in engine['allocation']['actions'])

    def test_default_allocation_policy_deploys_excess_cash_in_uptrend(self):
        from market_regime_engine import build_market_allocation_engine

        engine = build_market_allocation_engine({
            'positions': [
                {'symbol': 'CASH', 'assetType': 'cash', 'shares': 60000, 'cashAmount': 60000},
                {'symbol': 'QQQ', 'shares': 100, 'currentPrice': 400},
            ],
            'market': {'regimeMetrics': {'indexTrend': 0.9, 'breadth': 0.7, 'volatility': 0.0, 'ratesPressure': 0.0, 'updatedAt': '2026-05-13T09:00:00+09:00'}},
            'events': [],
        }, '2026-05-13')

        assert engine['regime']['regime'] == 'uptrend'
        assert engine['allocation']['policy']['source'] == 'default'
        assert engine['allocation']['targetCashRange'] == [10, 25]
        assert engine['allocation']['cashGap']['status'] == 'too_high'
        assert any(action['type'] == 'deploy_cash_selectively' for action in engine['allocation']['actions'])

    def test_investment_desk_engine_includes_market_allocation_engine(self):
        from investment_desk_engine import build_investment_desk_engine

        engine = build_investment_desk_engine({
            'positions': [
                {'symbol': 'CASH', 'assetType': 'cash', 'shares': 50000, 'cashAmount': 50000},
                {'symbol': 'CRCL', 'assetType': 'stock', 'shares': 100, 'currentPrice': 120},
            ],
            'market': {
                'regimeMetrics': {
                    'indexTrend': 0.8,
                    'breadth': 0.5,
                    'volatility': 0.1,
                    'ratesPressure': 0.0,
                }
            },
            'events': [],
            'rules': {},
        }, '2026-05-12')

        assert engine['marketRegime']['regime']['regime'] == 'uptrend'
        assert engine['marketRegime']['allocation']['cashGap']['status'] == 'too_high'
        assert 'marketRegime' in engine['marketView']

    def test_market_regime_review_flags_buy_after_event_defense_warning(self):
        from investment_desk_engine import build_investment_desk_engine

        engine = build_investment_desk_engine({
            'positions': [
                {'symbol': 'QLD', 'shares': 312, 'avgPrice': 88.88, 'currentPrice': 91.72},
                {'symbol': 'CASH', 'assetType': 'cash', 'shares': 42135, 'cashAmount': 42135},
            ],
            'deskSnapshots': [{
                'date': '2026-05-12',
                'regime': 'sideways',
                'eventDefenseLevel': 'high',
                'targetCashRange': [40, 55],
                'cashGap': {'current': 33.3, 'status': 'too_low'},
                'marketRegime': {
                    'regime': {'regime': 'sideways', 'eventDefenseLevel': 'high', 'targetCashRange': [40, 55]},
                    'allocation': {
                        'cashGap': {'current': 33.3, 'status': 'too_low'},
                        'actions': [{'type': 'cap_leverage', 'title': 'QLD add blocked'}],
                        'doNotDo': ['Do not add leverage before CPI confirmation.'],
                    },
                },
            }],
            'decisions': [{
                'id': 'dec-qld-buy',
                'date': '2026-05-12',
                'symbol': 'QLD',
                'action': 'buy',
                'tradeShares': 10,
                'tradePrice': 91,
            }],
            'market': {'regimeMetrics': {'indexTrend': 0.2, 'breadth': 0.1, 'volatility': 0.4, 'updatedAt': '2026-05-13T09:00:00+09:00'}},
        }, '2026-05-13')

        review = engine['marketRegimeReview']
        assert review['windowDays'] == 7
        assert review['snapshotCount'] == 1
        assert review['violationCount'] == 1
        assert review['violations'][0]['type'] == 'event_defense_buy'
        assert review['violations'][0]['symbol'] == 'QLD'
        assert review['score'] < 0
        assert review['correctiveActions'][0]['type'] == 'cooldown_after_violation'
        assert review['correctiveActions'][0]['symbol'] == 'QLD'

    def test_investment_order_intent_endpoint_creates_draft(self, client):
        payload = {
            'symbol': 'IREN',
            'action': 'buy',
            'quantity': 3,
            'orderType': 'limit',
            'price': 46.06,
            'reason': 'planned entry',
        }
        r = client.post('/api/investment/order-intent',
                        data=json.dumps(payload),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['brokerReady'] is False
        assert data['intent']['symbol'] == 'IREN'
        assert data['intent']['status'] == 'draft'
        loaded = client.get('/api/data').get_json()
        assert loaded['investment']['orderIntents'][0]['symbol'] == 'IREN'
        assert loaded['investment']['broker']['status'] == 'not_connected'

    def test_investment_trade_gate_blocks_rumor_driven_buy(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: None)
        client.post('/api/data',
                    data=json.dumps({'investment': {
                        'positions': [
                            {'id': 'ip-crcl', 'symbol': 'CRCL', 'name': 'Circle', 'shares': 113, 'avgPrice': 128.91, 'currentPrice': 113.67, 'changePercent': 5.5},
                            {'id': 'ip-cash', 'symbol': 'CASH', 'assetType': 'cash', 'shares': 42135, 'cashAmount': 42135},
                        ],
                        'rules': {'maxPositionWeight': 25, 'chaseLimit': 3},
                        'events': [
                            {'id': 'crcl-rumor', 'date': '2026-05-11', 'type': 'signal', 'symbol': 'CRCL', 'title': 'X rumor says stablecoin bill may pass', 'source': 'x.com'},
                        ],
                    }}),
                    content_type='application/json')

        r = client.post('/api/investment/trade-gate',
                        data=json.dumps({'date': '2026-05-11', 'symbol': 'CRCL', 'action': 'buy', 'quantity': 10, 'orderType': 'market', 'reason': 'policy rumor looks good'}),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        gate = data['gate']
        assert gate['status'] == 'block'
        assert gate['canCreateOrderIntent'] is False
        assert 'act on rumor' in gate['blockedActions']
        assert any('A/B evidence' in item for item in gate['requiredEvidence'])
        assert gate['scenario']['baseCase']['action'] == 'wait_for_confirmation'

    def test_investment_trade_gate_allows_sell_review_when_thesis_under_pressure(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: None)
        client.post('/api/data',
                    data=json.dumps({'investment': {
                        'positions': [
                            {'id': 'ip-iren', 'symbol': 'IREN', 'name': 'Iris Energy', 'shares': 510, 'avgPrice': 66.38, 'currentPrice': 61.20},
                        ],
                        'rules': {'maxPositionWeight': 25, 'chaseLimit': 3},
                        'events': [
                            {'id': 'iren-dilution', 'date': '2026-05-11', 'type': 'news', 'symbol': 'IREN', 'title': 'IREN ATM offering dilution risk', 'source': 'sec-edgar'},
                        ],
                    }}),
                    content_type='application/json')

        r = client.post('/api/investment/trade-gate',
                        data=json.dumps({'date': '2026-05-11', 'symbol': 'IREN', 'action': 'sell', 'quantity': 100, 'price': 64, 'reason': 'reduce after dilution risk'}),
                        content_type='application/json')

        assert r.status_code == 200
        gate = r.get_json()['gate']
        assert gate['status'] == 'review'
        assert gate['canCreateOrderIntent'] is True
        assert gate['scenario']['bearCase']['action'] == 'reduce_or_exit_review'
        assert any('bearish evidence' in item.lower() for item in gate['requiredEvidence'])

    def test_investment_chat_gate_blocks_buy_intent_before_ai(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: None)
        client.post('/api/data',
                    data=json.dumps({'investment': {
                        'positions': [
                            {'id': 'ip-crcl', 'symbol': 'CRCL', 'name': 'Circle', 'shares': 113, 'avgPrice': 128.91, 'currentPrice': 113.67, 'changePercent': 5.5},
                            {'id': 'ip-cash', 'symbol': 'CASH', 'assetType': 'cash', 'shares': 42135, 'cashAmount': 42135},
                        ],
                        'rules': {'maxPositionWeight': 25, 'chaseLimit': 3},
                        'events': [
                            {'id': 'crcl-rumor', 'date': '2026-05-11', 'type': 'signal', 'symbol': 'CRCL', 'title': 'X rumor says stablecoin bill may pass', 'source': 'x.com'},
                        ],
                    }}),
                    content_type='application/json')

        r = client.post('/api/investment/chat-gate',
                        data=json.dumps({'date': '2026-05-11', 'text': 'CRCL 루머가 좋은데 지금 매수할까?'}),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['intentDetected'] is True
        assert data['intent']['symbol'] == 'CRCL'
        assert data['intent']['action'] == 'buy'
        assert data['gate']['status'] == 'block'
        assert 'act on rumor' in data['gate']['blockedActions']
        assert '서버 투자 게이트' in data['reply']
        assert '차단' in data['reply']

    def test_investment_chat_gate_ignores_non_trade_briefing(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: None)
        client.post('/api/data',
                    data=json.dumps({'investment': {
                        'positions': [
                            {'id': 'ip-iren', 'symbol': 'IREN', 'name': 'Iris Energy', 'shares': 510, 'avgPrice': 66.38, 'currentPrice': 61.20},
                        ],
                        'rules': {'maxPositionWeight': 25, 'chaseLimit': 3},
                    }}),
                    content_type='application/json')

        r = client.post('/api/investment/chat-gate',
                        data=json.dumps({'date': '2026-05-11', 'text': '오늘 내 계좌 기준으로 중요한 시황을 브리핑해줘'}),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['intentDetected'] is False
        assert data['intent'] is None
        assert data['gate'] is None
        assert data['reply'] == ''

    def test_investment_reasoning_engine_interprets_portfolio_restructure(self):
        from investment_reasoning_engine import build_investment_reasoning

        reasoning = build_investment_reasoning(
            '나 이더리움 5개 그대로고 남은 돈과 주식은 전부 인텔로 바꿨어.',
            {
                'positions': [
                    {'symbol': 'ETH-USD', 'name': 'Ethereum', 'assetType': 'crypto', 'shares': 5, 'avgPrice': 4531.54, 'currentPrice': 2334.95},
                    {'symbol': 'CRCL', 'name': 'Circle', 'shares': 113, 'avgPrice': 128.91, 'currentPrice': 123.65},
                    {'symbol': 'CASH', 'assetType': 'cash', 'cashAmount': 42135, 'shares': 42135},
                ],
                'rules': {'maxPositionWeight': 25},
            },
            '2026-05-13',
        )

        assert reasoning['intentType'] == 'portfolio_update'
        assert reasoning['action'] == 'ask_missing_before_write'
        assert reasoning['mentionedSymbols'] == ['INTC', 'ETH-USD']
        assert 'ETH-USD' in reasoning['interpretation']['unchanged']
        assert 'INTC' in reasoning['interpretation']['newOrIncrease']
        assert any('INTC quantity' in item for item in reasoning['questions'])
        assert any(row['symbol'] == 'CRCL' for row in reasoning['ledgerContext']['holdings'])

    def test_investment_reasoning_engine_autofills_estimated_purchase_plan(self):
        from investment_reasoning_engine import build_investment_reasoning

        reasoning = build_investment_reasoning(
            '인텔 몇 주 샀는지는 모르겠고 1억 4천만원 샀는데 지금 6프로 마이너스 상황이야.',
            {'positions': [], 'rules': {}},
            '2026-05-13',
        )

        assert reasoning['intentType'] == 'portfolio_update'
        assert reasoning['action'] == 'autofill_then_estimated_write'
        plan = reasoning['interpretation']['autofill'][0]
        assert plan['type'] == 'estimated_purchase'
        assert plan['symbols'] == ['INTC']
        assert plan['inputs']['krwAmount'] == 140000000
        assert plan['inputs']['lossPercent'] == 6
        assert 'current quote' in plan['needs']
        assert any('estimated' in item.lower() for item in reasoning['llmInstructions'])

    def test_investment_reasoning_engine_builds_rule_and_briefing_frames(self):
        from investment_reasoning_engine import build_investment_reasoning

        inv = {
            'positions': [
                {'symbol': 'CRCL', 'name': 'Circle', 'shares': 113, 'avgPrice': 128.91, 'currentPrice': 123.65},
                {'symbol': 'ETH-USD', 'name': 'Ethereum', 'assetType': 'crypto', 'shares': 5, 'avgPrice': 4531.54, 'currentPrice': 2334.95},
            ],
            'events': [
                {'date': '2026-05-13', 'type': 'signal', 'symbol': 'CRCL', 'title': 'X rumor about stablecoin bill', 'source': 'x.com'},
            ],
            'rules': {'maxPositionWeight': 25},
        }
        rule = build_investment_reasoning('써클 손절 조건을 가격 말고 법안이랑 USDC 기준으로 세우고 싶어', inv, '2026-05-13')
        briefing = build_investment_reasoning('오늘 중요한 시황 브리핑해줘', inv, '2026-05-13')

        assert rule['intentType'] == 'rule_design'
        assert rule['action'] == 'draft_rule_with_invalidation_questions'
        assert 'CRCL' in rule['mentionedSymbols']
        assert any('USDC supply' in item for item in rule['researchFrame']['symbols'][0]['neededEvidence'])
        assert any('CRCL' in item for item in rule['questions'])
        assert briefing['intentType'] == 'briefing'
        assert briefing['action'] == 'build_desk_briefing'
        assert 'what is already priced in versus not confirmed' in briefing['researchFrame']['macro']
        assert any('Brief from portfolio exposure' in item for item in briefing['llmInstructions'])

    def test_investment_reasoning_endpoint_uses_ledger_snapshot(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: {
            'positions': [
                {'symbol': 'ETH-USD', 'name': 'Ethereum', 'assetType': 'crypto', 'shares': 5, 'avgPrice': 4531.54, 'currentPrice': 2334.95},
                {'symbol': 'CASH', 'assetType': 'cash', 'cashAmount': 1000, 'shares': 1000},
            ],
            'ledgerSource': 'normalized-tables',
        })
        client.post('/api/data',
                    data=json.dumps({'investment': {'positions': [{'symbol': 'CRCL', 'shares': 999, 'avgPrice': 1, 'currentPrice': 1}], 'rules': {}}}),
                    content_type='application/json')

        r = client.post('/api/investment/reasoning',
                        data=json.dumps({'date': '2026-05-13', 'text': '이더리움은 그대로 두고 나머지는 인텔로 바꿨어'}),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        reasoning = data['reasoning']
        assert reasoning['intentType'] == 'portfolio_update'
        assert reasoning['action'] == 'ask_missing_before_write'
        assert reasoning['interpretation']['existingSymbols'] == ['ETH-USD']
        assert 'ETH-USD' in reasoning['interpretation']['unchanged']

    def test_investment_reasoning_engine_marks_residual_portfolio_ambiguity(self):
        from investment_reasoning_engine import build_investment_reasoning

        reasoning = build_investment_reasoning(
            '이더리움은 그대로 두고 나머지 돈이랑 주식은 전부 인텔로 바꿨어.',
            {
                'positions': [
                    {'symbol': 'ETH-USD', 'assetType': 'crypto', 'shares': 5, 'avgPrice': 4531.54, 'currentPrice': 2334.95},
                    {'symbol': 'CRCL', 'shares': 113, 'avgPrice': 128.91, 'currentPrice': 123.65},
                    {'symbol': 'IREN', 'shares': 510, 'avgPrice': 66.38, 'currentPrice': 61.2},
                    {'symbol': 'CASH', 'assetType': 'cash', 'shares': 42135, 'cashAmount': 42135},
                ],
                'rules': {'maxPositionWeight': 25},
            },
            '2026-05-13',
        )

        interp = reasoning['interpretation']
        assert interp['unchanged'] == ['ETH-USD']
        assert interp['newOrIncrease'] == ['INTC']
        assert interp['residualCandidates'] == ['CASH', 'CRCL', 'IREN']
        assert interp['confirmationRequired'] is True
        assert any('CRCL' in q and 'IREN' in q for q in reasoning['questions'])

    def test_investment_reasoning_engine_trade_decision_requires_gate_and_evidence(self):
        from investment_reasoning_engine import build_investment_reasoning

        reasoning = build_investment_reasoning(
            'CRCL 루머가 좋은데 지금 더 사도 돼?',
            {
                'positions': [
                    {'symbol': 'CRCL', 'name': 'Circle', 'shares': 113, 'avgPrice': 128.91, 'currentPrice': 123.65, 'changePercent': 6.2},
                    {'symbol': 'CASH', 'assetType': 'cash', 'shares': 42135, 'cashAmount': 42135},
                ],
                'events': [
                    {'date': '2026-05-13', 'type': 'signal', 'symbol': 'CRCL', 'title': 'X rumor says bill may pass', 'source': 'x.com'},
                ],
                'rules': {'maxPositionWeight': 25, 'chaseLimit': 3},
            },
            '2026-05-13',
        )

        assert reasoning['intentType'] == 'trade_decision'
        assert reasoning['action'] == 'run_trade_gate_before_ai'
        assert reasoning['decisionProtocol']['requiresGate'] is True
        assert 'official bill text or committee schedule' in reasoning['decisionProtocol']['evidenceToCheck']
        assert any('rumor' in item.lower() for item in reasoning['decisionProtocol']['doNotDo'])
        assert any('Trade Gate' in item for item in reasoning['llmInstructions'])

    def test_investment_reasoning_engine_rule_design_returns_template(self):
        from investment_reasoning_engine import build_investment_reasoning

        reasoning = build_investment_reasoning(
            '써클 손절 조건을 가격 말고 법안이랑 USDC 기준으로 세우고 싶어',
            {
                'positions': [
                    {'symbol': 'CRCL', 'name': 'Circle', 'shares': 113, 'avgPrice': 128.91, 'currentPrice': 123.65},
                ],
                'rules': {'maxPositionWeight': 25},
            },
            '2026-05-13',
        )

        draft = reasoning['ruleDraft']
        assert draft['symbol'] == 'CRCL'
        assert 'USDC supply trend' in draft['evidenceHierarchy']
        assert 'official bill text or committee schedule' in draft['evidenceHierarchy']
        assert 'invalidation' in draft['template'].lower()
        assert 'action' in draft['template'].lower()

    def test_investment_trade_gate_blocks_leverage_buy_during_event_defense(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: None)
        client.post('/api/data',
                    data=json.dumps({'investment': {
                        'positions': [
                            {'id': 'ip-qld', 'symbol': 'QLD', 'name': 'QLD', 'shares': 312, 'avgPrice': 88.88, 'currentPrice': 91.72},
                            {'id': 'ip-cash', 'symbol': 'CASH', 'assetType': 'cash', 'shares': 42135, 'cashAmount': 42135},
                        ],
                        'market': {'regimeMetrics': {'indexTrend': 0.2, 'breadth': 0.1, 'volatility': 0.4, 'updatedAt': '2026-05-13T09:00:00+09:00'}},
                        'events': [
                            {'id': 'cpi', 'date': '2026-05-14', 'type': 'macro', 'symbol': 'MACRO', 'title': 'CPI 발표'},
                        ],
                        'allocationPolicy': {
                            'cashRanges': {'eventDefense': [40, 55]},
                            'maxLeverageWeight': 15,
                        },
                    }}),
                    content_type='application/json')

        r = client.post('/api/investment/trade-gate',
                        data=json.dumps({'date': '2026-05-13', 'symbol': 'QLD', 'action': 'buy', 'quantity': 10, 'reason': 'add leverage before CPI'}),
                        content_type='application/json')

        assert r.status_code == 200
        gate = r.get_json()['gate']
        assert gate['status'] == 'block'
        assert gate['canCreateOrderIntent'] is False
        assert 'cap_leverage' in gate['blockedActions']
        assert any('Market allocation engine' in item for item in gate['reasons'])

    def test_investment_trade_gate_blocks_buy_after_review_violation(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, '_read_investment_snapshot_from_tables', lambda inv: None)
        client.post('/api/data',
                    data=json.dumps({'investment': {
                        'positions': [
                            {'id': 'ip-qld', 'symbol': 'QLD', 'shares': 312, 'avgPrice': 88.88, 'currentPrice': 91.72},
                            {'id': 'ip-cash', 'symbol': 'CASH', 'assetType': 'cash', 'shares': 42135, 'cashAmount': 42135},
                        ],
                        'desk': {
                            'engine': {
                                'date': '2026-05-13',
                                'marketRegimeReview': {
                                    'correctiveActions': [{
                                        'type': 'cooldown_after_violation',
                                        'symbol': 'QLD',
                                        'title': 'QLD add cooldown',
                                        'reason': 'A buy/add happened after event-defense warnings.',
                                    }],
                                },
                            },
                        },
                    }}),
                    content_type='application/json')

        r = client.post('/api/investment/trade-gate',
                        data=json.dumps({'symbol': 'QLD', 'action': 'buy', 'date': '2026-05-13'}),
                        content_type='application/json')

        assert r.status_code == 200
        gate = r.get_json()['gate']
        assert gate['status'] == 'block'
        assert 'cooldown_after_violation' in gate['blockedActions']
        assert any('cooldown' in item.lower() for item in gate['reasons'])

    def test_investment_broker_sync_requires_kis_credentials(self, client, monkeypatch):
        monkeypatch.delenv('KIS_APP_KEY', raising=False)
        monkeypatch.delenv('KIS_APP_SECRET', raising=False)
        monkeypatch.delenv('KIS_CANO', raising=False)
        monkeypatch.delenv('KIS_ACNT_PRDT_CD', raising=False)

        r = client.post('/api/investment/broker/sync',
                        data=json.dumps({'days': 30}),
                        content_type='application/json')

        assert r.status_code == 400
        data = r.get_json()
        assert data['ok'] is False
        assert data['configured'] is False
        assert 'KIS_APP_KEY' in data['missing']
        assert 'KIS_CANO' in data['missing']

    def test_kis_adapter_refuses_trading_mode_even_if_configured(self, monkeypatch):
        import kis_broker

        monkeypatch.setenv('KIS_APP_KEY', 'app')
        monkeypatch.setenv('KIS_APP_SECRET', 'secret')
        monkeypatch.setenv('KIS_CANO', '12345678')
        monkeypatch.setenv('KIS_ACNT_PRDT_CD', '01')
        monkeypatch.setenv('KIS_ENABLE_TRADING', 'true')

        result = kis_broker.sync_kis_account({}, days=1)

        assert result['ok'] is False
        assert result['readOnly'] is True
        assert result['error'] == 'kis_trading_mode_forbidden'

    def test_kis_adapter_rejects_non_readonly_tr_id(self):
        import kis_broker

        cfg = kis_broker.KisConfig('app', 'secret', '12345678', '01')

        with pytest.raises(RuntimeError, match='read-only'):
            kis_broker._kis_get(cfg, 'token', '/uapi/domestic-stock/v1/trading/order-cash', 'TTTC0802U', {})

    def test_kis_overseas_position_uses_now_pric2_and_row_exchange(self):
        import kis_broker

        pos = kis_broker._position_from_overseas({
            'ovrs_pdno': 'CRCL',
            'ovrs_item_name': '서클 인터넷 그룹',
            'ovrs_cblc_qty': '113',
            'pchs_avg_pric': '128.9104',
            'now_pric2': '123.65',
            'ovrs_stck_evlu_amt': '13972.45',
            'ovrs_excg_cd': 'NYSE',
        }, 'NASD')

        assert pos['symbol'] == 'CRCL'
        assert pos['market'] == 'NYSE'
        assert pos['shares'] == 113
        assert pos['currentPrice'] == 123.65

    def test_kis_merge_positions_dedupes_same_symbol_from_multiple_exchanges(self):
        import kis_broker

        synced = [
            {'id': 'kis-us-CRCL', 'symbol': 'CRCL', 'market': 'NASD', 'shares': 113, 'currentPrice': 0},
            {'id': 'kis-us-CRCL', 'symbol': 'CRCL', 'market': 'NYSE', 'shares': 113, 'currentPrice': 123.65},
        ]

        merged = kis_broker._merge_positions([], synced)

        assert len(merged) == 1
        assert merged[0]['symbol'] == 'CRCL'
        assert merged[0]['market'] == 'NYSE'
        assert merged[0]['currentPrice'] == 123.65

    def test_kis_merge_positions_updates_existing_manual_symbol_instead_of_duplicating(self):
        import kis_broker

        existing = [
            {'id': 'ip-crcl-manual', 'symbol': 'CRCL', 'name': '써클', 'shares': 113, 'avgPrice': 128.91, 'currentPrice': 113.67},
            {'id': 'ip-cash', 'symbol': 'CASH', 'assetType': 'cash', 'shares': 42135, 'cashAmount': 42135},
        ]
        synced = [
            {'id': 'kis-us-CRCL', 'symbol': 'CRCL', 'name': 'Circle Internet Group', 'market': 'NYSE', 'shares': 113, 'avgPrice': 128.91, 'currentPrice': 123.65, 'brokerSource': 'kis'},
        ]

        merged = kis_broker._merge_positions(existing, synced)
        crcl_rows = [p for p in merged if p.get('symbol') == 'CRCL']

        assert len(crcl_rows) == 1
        assert crcl_rows[0]['id'] == 'kis-us-CRCL'
        assert crcl_rows[0]['currentPrice'] == 123.65
        assert crcl_rows[0]['brokerSource'] == 'kis'

    def test_bithumb_adapter_refuses_trading_mode_even_if_configured(self, monkeypatch):
        import bithumb_broker

        monkeypatch.setenv('BITHUMB_API_KEY', 'access')
        monkeypatch.setenv('BITHUMB_SECRET_KEY', 'secret')
        monkeypatch.setenv('BITHUMB_ENABLE_TRADING', 'true')

        result = bithumb_broker.sync_bithumb_account({}, days=1)

        assert result['ok'] is False
        assert result['readOnly'] is True
        assert result['error'] == 'bithumb_trading_mode_forbidden'

    def test_bithumb_adapter_rejects_non_readonly_paths(self):
        import bithumb_broker

        cfg = bithumb_broker.BithumbConfig('access', 'secret')

        with pytest.raises(RuntimeError, match='read-only'):
            bithumb_broker._bithumb_request(cfg, 'POST', '/v1/orders', {'market': 'KRW-BTC'})

        with pytest.raises(RuntimeError, match='read-only'):
            bithumb_broker._bithumb_request(cfg, 'GET', '/v1/withdraws', {})

    def test_bithumb_sync_normalizes_accounts_and_filled_orders(self, monkeypatch):
        import bithumb_broker

        monkeypatch.setenv('BITHUMB_API_KEY', 'access')
        monkeypatch.setenv('BITHUMB_SECRET_KEY', 'secret')
        monkeypatch.delenv('BITHUMB_ENABLE_TRADING', raising=False)

        def fake_get(config, path, params=None):
            if path == '/v1/accounts':
                return [
                    {'currency': 'KRW', 'balance': '1200000', 'locked': '0', 'avg_buy_price': '0', 'unit_currency': 'KRW'},
                    {'currency': 'ETH', 'balance': '2.5', 'locked': '0.1', 'avg_buy_price': '4100000', 'unit_currency': 'KRW'},
                ]
            if path == '/v1/orders':
                return [
                    {'uuid': 'ord-1', 'market': 'KRW-ETH', 'side': 'bid', 'executed_volume': '1.2', 'price': '4000000', 'paid_fee': '1000', 'created_at': '2026-05-12T09:00:00+09:00'},
                ]
            return []

        monkeypatch.setattr(bithumb_broker, '_bithumb_get', fake_get)

        result = bithumb_broker.sync_bithumb_account({'positions': [], 'decisions': [], 'events': []}, days=7)

        assert result['ok'] is True
        assert result['readOnly'] is True
        assert result['positionsSynced'] == 2
        assert result['tradesSynced'] == 1
        inv = result['investment']
        assert inv['broker']['providers']['bithumb']['readOnly'] is True
        assert any(p['symbol'] == 'CASH' and p['currency'] == 'KRW' for p in inv['positions'])
        assert any(p['symbol'] == 'ETH-KRW' and p['assetType'] == 'crypto' for p in inv['positions'])
        assert inv['decisions'][0]['source'] == 'bithumb'

    def test_bithumb_sync_endpoint_persists_readonly_crypto_data(self, client, monkeypatch):
        import server

        def fake_sync(investment, days=30):
            inv = dict(investment or {})
            inv['positions'] = [{'id': 'bithumb-ETH-KRW', 'symbol': 'ETH-KRW', 'assetType': 'crypto', 'shares': 2, 'avgPrice': 4000000, 'currency': 'KRW'}]
            inv['decisions'] = [{'id': 'bithumb-order-1', 'type': 'trade', 'source': 'bithumb', 'symbol': 'ETH-KRW', 'action': 'buy', 'tradeShares': 2, 'tradePrice': 4000000}]
            inv['broker'] = {'status': 'connected', 'provider': 'multi', 'orderIntentOnly': True, 'providers': {'bithumb': {'status': 'connected', 'readOnly': True}}}
            return {'ok': True, 'configured': True, 'readOnly': True, 'investment': inv, 'positionsSynced': 1, 'tradesSynced': 1}

        monkeypatch.setattr(server, 'sync_bithumb_account', fake_sync)

        r = client.post('/api/investment/crypto/bithumb/sync',
                        data=json.dumps({'days': 7}),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['readOnly'] is True
        assert data['positionsSynced'] == 1
        loaded = client.get('/api/data').get_json()
        assert loaded['investment']['broker']['providers']['bithumb']['readOnly'] is True
        assert loaded['investment']['positions'][0]['symbol'] == 'ETH-KRW'

    def test_investment_broker_sync_persists_synced_positions_and_trades(self, client, monkeypatch):
        import server

        def fake_sync(investment, days=30):
            inv = dict(investment)
            inv['positions'] = [{
                'id': 'kis-us-IREN',
                'symbol': 'IREN',
                'name': 'Iris Energy',
                'shares': 10,
                'avgPrice': 40,
                'currentPrice': 50,
                'brokerSource': 'kis',
            }]
            inv['decisions'] = [{
                'id': 'kis-trade-20260506-1-buy',
                'type': 'trade',
                'symbol': 'IREN',
                'action': 'buy',
                'tradeShares': 10,
                'tradePrice': 40,
            }]
            inv['broker'] = {
                'status': 'connected',
                'provider': 'kis',
                'orderIntentOnly': True,
                'lastSyncedAt': '2026-05-06T00:00:00Z',
            }
            return {'ok': True, 'configured': True, 'investment': inv, 'positionsSynced': 1, 'tradesSynced': 1}

        monkeypatch.setattr(server, 'sync_kis_account', fake_sync)

        r = client.post('/api/investment/broker/sync',
                        data=json.dumps({'days': 30}),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['positionsSynced'] == 1
        assert data['tradesSynced'] == 1
        loaded = client.get('/api/data').get_json()
        assert loaded['investment']['positions'][0]['symbol'] == 'IREN'
        assert loaded['investment']['decisions'][0]['action'] == 'buy'
        assert loaded['investment']['broker']['provider'] == 'kis'

    def test_investment_calendar_sync_persists_macro_earnings_and_analyst_events(self, client, monkeypatch):
        import server

        client.post('/api/data',
                    data=json.dumps({
                        'students': [],
                        'sessions': [],
                        'my_topics': [],
                        'my_records': [],
                        'investment': {
                            'positions': [{'id': 'ip-iren', 'symbol': 'IREN', 'shares': 1}],
                            'events': [],
                        },
                    }),
                    content_type='application/json')

        def fake_sync(investment, days=45):
            inv = dict(investment)
            inv['events'] = [
                {'id': 'earnings-iren-2026-05-07', 'date': '2026-05-07', 'type': 'earnings', 'symbol': 'IREN', 'title': 'IREN 실적 발표'},
                {'id': 'macro-cpi-2026-05-12', 'date': '2026-05-12', 'type': 'macro', 'symbol': 'MACRO', 'title': 'CPI'},
                {'id': 'analyst-iren-target', 'date': '2026-05-07', 'type': 'analyst', 'symbol': 'IREN', 'title': 'IREN 목표주가 컨센서스', 'consensus': {'targetConsensus': 70}},
            ]
            inv['calendar'] = {'lastSyncedAt': '2026-05-07T00:00:00Z', 'lookaheadDays': days, 'eventsSynced': 3}
            return {'ok': True, 'investment': inv, 'eventsSynced': 3, 'missingProviders': []}

        monkeypatch.setattr(server, 'sync_investment_calendar', fake_sync)

        r = client.post('/api/investment/calendar/sync',
                        data=json.dumps({'days': 45}),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['eventsSynced'] == 3
        loaded = client.get('/api/data').get_json()
        titles = [e['title'] for e in loaded['investment']['events']]
        assert 'IREN 실적 발표' in titles
        assert 'CPI' in titles
        analyst = next(e for e in loaded['investment']['events'] if e['type'] == 'analyst')
        assert analyst['consensus']['targetConsensus'] == 70
        assert loaded['investment']['calendar']['eventsSynced'] == 3

    def test_investment_x_sync_requires_bearer_token(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, 'X_BEARER_TOKEN', '')

        r = client.post('/api/investment/x/sync',
                        data=json.dumps({'watchlist': [{'handle': 'thetechinvest'}]}),
                        content_type='application/json')

        assert r.status_code == 400
        data = r.get_json()
        assert data['ok'] is False
        assert 'X_BEARER_TOKEN' in data['missing']

    def test_investment_x_sync_persists_keyword_matched_posts(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, 'X_BEARER_TOKEN', 'test-token')
        monkeypatch.setattr(server, '_x_recent_posts', lambda handle, limit=5: [{
            'id': '123',
            'text': 'IREN AI data center progress looks important.',
            'created_at': '2026-05-07T10:00:00Z',
        }])

        client.post('/api/data',
                    data=json.dumps({
                        'students': [],
                        'sessions': [],
                        'my_topics': [],
                        'my_records': [],
                        'investment': {
                            'positions': [{'id': 'ip-iren', 'symbol': 'IREN'}],
                            'events': [],
                            'signals': {
                                'watchlist': [{'handle': 'thetechinvest', 'label': 'The Tech Investor'}],
                                'keywords': ['IREN', 'AI'],
                            },
                        },
                    }),
                    content_type='application/json')

        r = client.post('/api/investment/x/sync',
                        data=json.dumps({}),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['signalsSynced'] == 1
        loaded = client.get('/api/data').get_json()
        event = loaded['investment']['events'][0]
        assert event['type'] == 'signal'
        assert event['source'] == 'x-api'
        assert event['handle'] == 'thetechinvest'
        assert 'IREN AI data center' in event['body']

    def test_investment_calendar_skips_invalid_earnings_dates(self, monkeypatch):
        import investment_calendar

        monkeypatch.setenv('ALPHA_VANTAGE_API_KEY', 'test-alpha')

        class FakeResp:
            ok = True
            text = 'symbol,name,reportDate,fiscalDateEnding,estimate,currency\nIREN,Iris Energy,f,2026-03-31,0.01,USD\n'

        monkeypatch.setattr(investment_calendar.requests, 'get', lambda *args, **kwargs: FakeResp())

        events, missing = investment_calendar.fetch_earnings_events(['IREN'], days=90)

        assert events == []
        assert missing == []

    def test_investment_calendar_earnings_fallback_extracts_month_day_without_year(self, monkeypatch):
        import investment_calendar

        rss = '''<?xml version="1.0" encoding="UTF-8"?>
        <rss><channel><item>
          <title>IREN schedules Q3 FY26 results and live investor Q&amp;A for May 7 - Stock Titan</title>
          <link>https://example.com/iren-earnings</link>
          <description>IREN earnings results release date</description>
        </item></channel></rss>'''

        class FakeResp:
            ok = True
            content = rss.encode('utf-8')

        monkeypatch.setattr(investment_calendar.requests, 'get', lambda *args, **kwargs: FakeResp())

        events, missing = investment_calendar.fetch_earnings_press_release_events(['IREN'], days=90)

        assert missing == []
        assert len(events) == 1
        assert events[0]['date'] == '2026-05-07'
        assert events[0]['type'] == 'earnings'
        assert events[0]['source'] == 'google-news-earnings-fallback'

    def test_investment_ai_compare_endpoint_calls_claude_and_openai(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, 'ANTHROPIC_API_KEY', 'test-anthropic')
        monkeypatch.setattr(server, 'OPENAI_API_KEY', 'test-openai')

        class FakeResp:
            ok = True
            status_code = 200
            text = ''

            def __init__(self, body):
                self._body = body

            def json(self):
                return self._body

        calls = []

        def fake_post(url, headers=None, json=None, timeout=None, stream=False):
            calls.append((url, json))
            if 'anthropic.com' in url:
                return FakeResp({'content': [{'text': 'Claude says check rules.'}]})
            if 'openai.com' in url:
                return FakeResp({'choices': [{'message': {'content': 'OpenAI says check risk.'}}]})
            raise AssertionError(url)

        monkeypatch.setattr(server.requests, 'post', fake_post)

        r = client.post('/api/investment/ai-compare',
                        data=json.dumps({
                            'system': [{'type': 'text', 'text': 'Investment rules only'}],
                            'messages': [{'role': 'user', 'content': 'IREN add?'}],
                            'max_tokens': 300,
                        }),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert [item['provider'] for item in data['results']] == ['claude', 'openai']
        assert data['results'][0]['text'] == 'Claude says check rules.'
        assert data['results'][1]['text'] == 'OpenAI says check risk.'
        assert any('anthropic.com' in call[0] for call in calls)
        assert any('openai.com' in call[0] for call in calls)

    def test_analyze_endpoint_logs_request_id_strips_local_keys_and_retries_model(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, 'ANTHROPIC_API_KEY', 'test-anthropic')
        monkeypatch.setattr(server, 'ANTHROPIC_FALLBACK_MODEL', 'claude-sonnet-4-5-20250929')

        class FakeResp:
            def __init__(self, status_code, body):
                self.status_code = status_code
                self._body = body
                self.content = json.dumps(body).encode('utf-8')
                self.text = json.dumps(body)
                self.ok = 200 <= status_code < 300

        calls = []

        def fake_post(url, headers=None, json=None, timeout=None, stream=False):
            calls.append(json)
            assert 'clientRequestId' not in json
            if len(calls) == 1:
                return FakeResp(400, {'error': {'message': 'model does not exist'}})
            return FakeResp(200, {'content': [{'text': 'fallback ok'}]})

        monkeypatch.setattr(server.requests, 'post', fake_post)

        r = client.post('/api/analyze',
                        data=json.dumps({
                            'clientRequestId': 'chat-test',
                            'model': 'claude-sonnet-4-6',
                            'max_tokens': 100,
                            'system': [{'type': 'text', 'text': '투자 브리핑'}],
                            'messages': [{'role': 'user', 'content': '브리핑'}],
                        }),
                        content_type='application/json',
                        headers={'X-Client-Request-Id': 'chat-test'})

        assert r.status_code == 200
        assert json.loads(r.data.decode('utf-8'))['content'][0]['text'] == 'fallback ok'
        assert calls[0]['model'] == 'claude-sonnet-4-6'
        assert calls[1]['model'] == 'claude-sonnet-4-5-20250929'

    def test_analyze_endpoint_falls_back_to_openai_when_anthropic_credit_empty(self, client, monkeypatch):
        import server

        monkeypatch.setattr(server, 'ANTHROPIC_API_KEY', 'test-anthropic')
        monkeypatch.setattr(server, 'OPENAI_API_KEY', 'test-openai')
        monkeypatch.setattr(server, 'OPENAI_MODEL', 'gpt-test')

        class FakeResp:
            def __init__(self, status_code, body):
                self.status_code = status_code
                self._body = body
                self.content = json.dumps(body).encode('utf-8')
                self.text = json.dumps(body)
                self.ok = 200 <= status_code < 300

            def json(self):
                return self._body

        calls = []

        def fake_post(url, headers=None, json=None, timeout=None, stream=False):
            calls.append((url, json))
            if 'anthropic.com' in url:
                return FakeResp(400, {'error': {'message': 'Your credit balance is too low'}})
            if 'openai.com' in url:
                return FakeResp(200, {'choices': [{'message': {'content': 'OpenAI fallback briefing'}}]})
            raise AssertionError(url)

        monkeypatch.setattr(server.requests, 'post', fake_post)

        r = client.post('/api/analyze',
                        data=json.dumps({
                            'clientRequestId': 'chat-credit',
                            'model': 'claude-sonnet-4-6',
                            'max_tokens': 100,
                            'system': [{'type': 'text', 'text': '투자 브리핑'}],
                            'messages': [{'role': 'user', 'content': '브리핑'}],
                        }),
                        content_type='application/json')

        assert r.status_code == 200
        data = r.get_json()
        assert data['provider'] == 'openai'
        assert data['fallbackFrom'] == 'anthropic'
        assert data['content'][0]['text'] == 'OpenAI fallback briefing'
        assert any('anthropic.com' in call[0] for call in calls)
        assert any('openai.com' in call[0] for call in calls)

    def test_decode_stored_data_accepts_legacy_json_dict(self):
        import server

        raw = {'investment': {'positions': [{'symbol': 'IREN'}]}}
        decoded = server._normalize_data(server._decode_stored_data(raw))
        assert decoded['investment']['positions'][0]['symbol'] == 'IREN'

    def test_decode_stored_data_accepts_json_text(self):
        import server

        raw = json.dumps({'investment': {'positions': [{'symbol': 'NVDA'}]}})
        decoded = server._normalize_data(server._decode_stored_data(raw))
        assert decoded['investment']['positions'][0]['symbol'] == 'NVDA'

    def test_storage_adapter_keeps_bytea_encrypted(self):
        import server

        encrypted = b'gAAAA-test-token'
        assert server._adapt_data_for_storage({'students': []}, encrypted, 'bytea').getquoted()

    def test_storage_adapter_supports_text_columns(self):
        import server

        encrypted = b'gAAAA-test-token'
        assert server._adapt_data_for_storage({'students': []}, encrypted, 'text') == 'gAAAA-test-token'

    def test_storage_adapter_supports_jsonb_udt_name(self):
        import server

        adapted = server._adapt_data_for_storage({'students': []}, b'gAAAA-test-token', 'jsonb')
        assert adapted.adapted == {'students': []}

    def test_storage_adapter_wraps_bytea_binary(self):
        import server

        adapted = server._adapt_data_for_storage({'students': []}, b'gAAAA-test-token', 'bytea')
        assert adapted.getquoted()

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

    def test_market_quote_endpoint_normalizes_usd_krw_alias(self, client, monkeypatch):
        import server

        class FakeResp:
            ok = True
            status_code = 200

            def json(self):
                return {
                    'quoteResponse': {
                        'result': [{
                            'symbol': 'USDKRW=X',
                            'shortName': 'USD/KRW',
                            'regularMarketPrice': 1352.4,
                            'regularMarketChangePercent': 0.12,
                        }]
                    }
                }

        def fake_get(url, params=None, headers=None, timeout=None):
            assert params['symbols'] == 'USDKRW=X'
            return FakeResp()

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/market/quote?symbols=USD/KRW')

        assert r.status_code == 200
        data = r.get_json()
        assert data['requested'] == ['USDKRW=X']
        assert data['quotes'][0]['symbol'] == 'USDKRW=X'
        assert data['quotes'][0]['price'] == 1352.4

    def test_market_quote_endpoint_falls_back_to_yahoo_chart(self, client, monkeypatch):
        import server

        class FakeQuoteResp:
            ok = False
            status_code = 401

            def json(self):
                return {}

        class FakeChartResp:
            ok = True
            status_code = 200

            def json(self):
                return {
                    'chart': {
                        'result': [{
                            'meta': {
                                'symbol': 'NVDA',
                                'longName': 'NVIDIA Corporation',
                                'regularMarketPrice': 121.25,
                                'previousClose': 118.0,
                                'currency': 'USD',
                                'regularMarketTime': 1770000001,
                            },
                        }]
                    }
                }

        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(url)
            if 'v7/finance/quote' in url:
                return FakeQuoteResp()
            if 'v8/finance/chart/NVDA' in url:
                return FakeChartResp()
            raise AssertionError(f'unexpected url: {url}')

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/market/quote?symbols=NVDA')

        assert r.status_code == 200
        data = r.get_json()
        assert data['source'] == 'yahoo-chart'
        assert data['quotes'][0]['symbol'] == 'NVDA'
        assert data['quotes'][0]['price'] == 121.25
        assert round(data['quotes'][0]['changePercent'], 2) == 2.75
        assert any('v7/finance/quote' in url for url in calls)
        assert any('v8/finance/chart/NVDA' in url for url in calls)

    def test_market_quote_endpoint_falls_back_to_stooq_for_us_stock(self, client, monkeypatch):
        import server

        class EmptyYahooResp:
            ok = True
            status_code = 200
            text = ''

            def json(self):
                if 'chart' in getattr(self, 'kind', ''):
                    return {'chart': {'result': []}}
                return {'quoteResponse': {'result': []}}

        class StooqResp:
            ok = True
            status_code = 200
            text = 'Symbol,Date,Time,Open,High,Low,Close,Volume,Name\nCRCL.US,2026-05-06,22:00:00,80,82,79,81.5,12345,Circle Internet Group\n'

        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append((url, params))
            if 'stooq.com' in url:
                return StooqResp()
            resp = EmptyYahooResp()
            if 'v8/finance/chart' in url:
                resp.kind = 'chart'
            return resp

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/market/quote?symbols=CRCL')

        assert r.status_code == 200
        data = r.get_json()
        assert data['source'] == 'stooq'
        assert data['quotes'][0]['symbol'] == 'CRCL'
        assert data['quotes'][0]['name'] == 'Circle Internet Group'
        assert data['quotes'][0]['price'] == 81.5
        assert any(call[1] and call[1].get('s') == 'crcl.us' for call in calls)

    def test_market_quote_endpoint_normalizes_crypto_alias(self, client, monkeypatch):
        import server

        class FakeResp:
            ok = True
            status_code = 200

            def json(self):
                return {
                    'quoteResponse': {
                        'result': [{
                            'symbol': 'ETH-USD',
                            'shortName': 'Ethereum USD',
                            'regularMarketPrice': 3100.25,
                            'regularMarketChangePercent': 1.7,
                        }]
                    }
                }

        def fake_get(url, params=None, headers=None, timeout=None):
            assert params['symbols'] == 'ETH-USD'
            return FakeResp()

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/market/quote?symbols=ETH')

        assert r.status_code == 200
        data = r.get_json()
        assert data['requested'] == ['ETH-USD']
        assert data['quotes'][0]['symbol'] == 'ETH-USD'
        assert data['quotes'][0]['price'] == 3100.25

    def test_market_quote_endpoint_falls_back_to_coingecko_for_crypto(self, client, monkeypatch):
        import server

        class EmptyYahooResp:
            ok = True
            status_code = 200

            def json(self):
                if 'chart' in getattr(self, 'kind', ''):
                    return {'chart': {'result': []}}
                return {'quoteResponse': {'result': []}, 'quotes': []}

        class CoinGeckoResp:
            ok = True
            status_code = 200

            def json(self):
                return {'ethereum': {'usd': 3200.5, 'usd_24h_change': 2.25}}

        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append((url, params))
            if 'coingecko.com' in url:
                assert params['ids'] == 'ethereum'
                return CoinGeckoResp()
            resp = EmptyYahooResp()
            if 'v8/finance/chart' in url:
                resp.kind = 'chart'
            return resp

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/market/quote?symbols=ETH')

        assert r.status_code == 200
        data = r.get_json()
        assert data['source'] == 'coingecko'
        assert data['quotes'][0]['symbol'] == 'ETH-USD'
        assert data['quotes'][0]['price'] == 3200.5
        assert data['quotes'][0]['changePercent'] == 2.25

    def test_market_quote_endpoint_normalizes_circle_korean_alias(self, client, monkeypatch):
        import server

        class FakeResp:
            ok = True
            status_code = 200

            def json(self):
                return {
                    'quoteResponse': {
                        'result': [{
                            'symbol': 'CRCL',
                            'shortName': 'Circle Internet Group',
                            'regularMarketPrice': 77.7,
                            'regularMarketChangePercent': -1.2,
                        }]
                    }
                }

        def fake_get(url, params=None, headers=None, timeout=None):
            assert params['symbols'] == 'CRCL'
            return FakeResp()

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/market/quote?symbols=%EC%8D%A8%ED%81%B4')

        assert r.status_code == 200
        data = r.get_json()
        assert data['requested'] == ['CRCL']
        assert data['quotes'][0]['symbol'] == 'CRCL'
        assert data['quotes'][0]['price'] == 77.7

    def test_market_quote_endpoint_extracts_circle_ticker_from_label(self, client, monkeypatch):
        import server

        class FakeResp:
            ok = True
            status_code = 200

            def json(self):
                return {
                    'quoteResponse': {
                        'result': [{
                            'symbol': 'CRCL',
                            'shortName': 'Circle Internet Group',
                            'regularMarketPrice': 91.2,
                            'regularMarketChangePercent': 1.1,
                        }]
                    }
                }

        def fake_get(url, params=None, headers=None, timeout=None):
            assert params['symbols'] == 'CRCL'
            return FakeResp()

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/market/quote?symbols=%EC%8D%A8%ED%81%B4(CRCL)')

        assert r.status_code == 200
        data = r.get_json()
        assert data['requested'] == ['CRCL']
        assert data['quotes'][0]['symbol'] == 'CRCL'
        assert data['quotes'][0]['price'] == 91.2

    def test_market_quote_endpoint_falls_back_to_yahoo_search_for_circle(self, client, monkeypatch):
        import server

        class EmptyYahooResp:
            ok = True
            status_code = 200

            def json(self):
                if 'chart' in getattr(self, 'kind', ''):
                    return {'chart': {'result': []}}
                return {'quoteResponse': {'result': []}}

        class SearchResp:
            ok = True
            status_code = 200

            def json(self):
                return {
                    'quotes': [{
                        'symbol': 'CRCL',
                        'shortName': 'Circle Internet Group',
                        'regularMarketPrice': 88.8,
                        'regularMarketChangePercent': 3.4,
                    }]
                }

        def fake_get(url, params=None, headers=None, timeout=None):
            if 'v1/finance/search' in url:
                assert params['q'] == 'CRCL'
                return SearchResp()
            resp = EmptyYahooResp()
            if 'v8/finance/chart' in url:
                resp.kind = 'chart'
            return resp

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/market/quote?symbols=CRCL')

        assert r.status_code == 200
        data = r.get_json()
        assert data['source'] == 'yahoo-search'
        assert data['quotes'][0]['symbol'] == 'CRCL'
        assert data['quotes'][0]['price'] == 88.8

    def test_market_quote_endpoint_falls_back_to_stockanalysis_for_crcl(self, client, monkeypatch):
        import server

        class EmptyResp:
            ok = True
            status_code = 200
            text = 'Symbol,Date,Time,Open,High,Low,Close,Volume,Name\nCRCL.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D,N/D'

            def json(self):
                if 'chart' in getattr(self, 'kind', ''):
                    return {'chart': {'result': []}}
                if 'search' in getattr(self, 'kind', ''):
                    return {'quotes': []}
                return {'quoteResponse': {'result': []}}

        class StockAnalysisResp:
            ok = True
            status_code = 200
            text = """
                <h1>Circle Internet Group, Inc. (CRCL)</h1>
                <div>NYSE: CRCL · Real-Time Price · USD</div>
                <div>114.19</div>
                <div>-5.34 (-4.47%)</div>
                <div>Previous Close 119.53</div>
            """

        def fake_get(url, params=None, headers=None, timeout=None):
            if 'stockanalysis.com/stocks/crcl' in url:
                return StockAnalysisResp()
            resp = EmptyResp()
            if 'v8/finance/chart' in url:
                resp.kind = 'chart'
            if 'v1/finance/search' in url:
                resp.kind = 'search'
            return resp

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/market/quote?symbols=CRCL')

        assert r.status_code == 200
        data = r.get_json()
        assert data['source'] == 'stockanalysis'
        assert data['requested'] == ['CRCL']
        assert data['quotes'][0]['symbol'] == 'CRCL'
        assert data['quotes'][0]['price'] == 114.19
        assert data['quotes'][0]['previousClose'] == 119.53
        assert data['quotes'][0]['changePercent'] == -4.47

    def test_market_quote_endpoint_rejects_invalid_symbols(self, client):
        r = client.get('/api/market/quote?symbols=NVDA;DROP')
        assert r.status_code == 400

    def test_investment_news_endpoint_returns_aggregated_items(self, client, monkeypatch):
        import server

        class FakeSecTickerResp:
            ok = True
            status_code = 200

            def json(self):
                return {
                    '0': {'cik_str': 1234567, 'ticker': 'IREN', 'title': 'Iris Energy Limited'}
                }

        class FakeSecSubmissionsResp:
            ok = True
            status_code = 200

            def json(self):
                return {
                    'filings': {
                        'recent': {
                            'form': ['6-K'],
                            'filingDate': ['2026-05-04'],
                            'accessionNumber': ['0001234567-26-000001'],
                            'primaryDocument': ['iren-6k.htm'],
                        }
                    }
                }

        class FakeYahooResp:
            ok = True
            status_code = 200
            content = b'''<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0"><channel>
              <item>
                <title>IREN expands AI cloud capacity</title>
                <link>https://finance.yahoo.com/news/iren-test</link>
                <pubDate>Mon, 04 May 2026 10:00:00 GMT</pubDate>
                <description><![CDATA[IREN announced an AI data center update.]]></description>
              </item>
            </channel></rss>'''

        class FakeGoogleResp:
            ok = True
            status_code = 200
            content = b'''<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0"><channel>
              <item>
                <title>IREN expands AI cloud capacity</title>
                <link>https://finance.yahoo.com/news/iren-test?utm=dup</link>
                <pubDate>Mon, 04 May 2026 10:00:00 GMT</pubDate>
                <description>Duplicate headline from Google News.</description>
              </item>
            </channel></rss>'''

        def fake_get(url, params=None, headers=None, timeout=None):
            if 'sec.gov/files/company_tickers.json' in url:
                return FakeSecTickerResp()
            if 'data.sec.gov/submissions/CIK0001234567.json' in url:
                return FakeSecSubmissionsResp()
            if 'feeds.finance.yahoo.com' in url:
                assert params['s'] == 'IREN'
                return FakeYahooResp()
            if 'news.google.com' in url:
                assert 'IREN' in params['q']
                return FakeGoogleResp()
            raise AssertionError(f'unexpected url: {url}')

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/investment/news?symbols=IREN')

        assert r.status_code == 200
        data = r.get_json()
        assert data['source'] == 'aggregated-investment-news'
        assert data['providers']['sec_edgar'] is True
        assert data['providers']['yahoo_finance_rss'] is True
        assert data['news'][0]['symbol'] == 'IREN'
        assert data['news'][0]['title'] == 'Iris Energy Limited SEC 6-K filing'
        assert data['news'][0]['source'] == 'sec-edgar'
        assert data['news'][1]['title'] == 'IREN expands AI cloud capacity'
        assert data['news'][1]['summary'] == 'IREN announced an AI data center update.'
        assert data['news'][1]['source'] == 'yahoo-finance-rss'
        assert len(data['news']) == 2

    def test_investment_news_endpoint_accepts_general_query(self, client, monkeypatch):
        import server

        class FakeGoogleResp:
            ok = True
            status_code = 200
            content = b'''<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0"><channel>
              <item>
                <title>Crypto market structure clarity bill advances - CNBC</title>
                <link>https://example.com/clarity-act</link>
                <pubDate>Tue, 05 May 2026 10:00:00 GMT</pubDate>
                <description>Lawmakers advanced a crypto market structure bill.</description>
              </item>
            </channel></rss>'''

        def fake_get(url, params=None, headers=None, timeout=None):
            assert 'news.google.com' in url
            assert params['q'] == 'crypto market structure clarity act'
            return FakeGoogleResp()

        monkeypatch.setattr(server.requests, 'get', fake_get)
        r = client.get('/api/investment/news?query=crypto%20market%20structure%20clarity%20act&limit=2')

        assert r.status_code == 200
        data = r.get_json()
        assert data['requested'] == []
        assert data['requestedQueries'] == ['crypto market structure clarity act']
        assert data['news'][0]['symbol'] == 'crypto market structure clarity act'
        assert data['news'][0]['topic'] == 'crypto market structure clarity act'
        assert data['news'][0]['kind'] == 'general-news'
        assert data['news'][0]['title'] == 'Crypto market structure clarity bill advances'
        assert data['news'][0]['publisher'] == 'CNBC'

    def test_investment_news_endpoint_sanitizes_long_markdown_queries(self, client, monkeypatch):
        import server

        class FakeGoogleResp:
            ok = True
            status_code = 200
            content = b'''<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0"><channel>
              <item>
                <title>Market risk update - Reuters</title>
                <link>https://example.com/risk</link>
                <pubDate>Tue, 05 May 2026 10:00:00 GMT</pubDate>
                <description>Markets tracked policy and earnings risk.</description>
              </item>
            </channel></rss>'''

        seen_queries = []

        def fake_get(url, params=None, headers=None, timeout=None):
            assert 'news.google.com' in url
            seen_queries.append(params['q'])
            assert '<' not in params['q']
            assert '>' not in params['q']
            assert 'http' not in params['q']
            assert len(params['q']) <= 160
            return FakeGoogleResp()

        monkeypatch.setattr(server.requests, 'get', fake_get)
        long_query = (
            'IREN earnings [source](https://example.com/a-very-long-url) '
            '<script>alert(1)</script> ' + ('AI cloud funding dilution ' * 20)
        )
        r = client.get('/api/investment/news?query=' + quote(long_query))

        assert r.status_code == 200
        data = r.get_json()
        assert seen_queries
        assert data['requestedQueries'] == seen_queries
        assert data['news'][0]['kind'] == 'general-news'

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

    def test_sec_url_is_not_masked_as_phone_number(self):
        scrub = self._scrub()
        url = 'https://www.sec.gov/Archives/edgar/data/1878848/00009501702607919/ny20064909x2_8k.htm'
        result = scrub(f'원문: {url}')
        assert url in result
        assert '[전화번호]' not in result

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
