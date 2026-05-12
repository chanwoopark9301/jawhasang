"""
상담 일지 — Python 서버
- 로그인 (세션 기반, ecrk.env의 APP_PASSWORD)
- 데이터 암호화 저장 (Fernet / APP_PASSWORD로 키 유도)
- Anthropic API 프록시
- 저장소: PostgreSQL (DATABASE_URL) 또는 로컬 data.json 폴백
"""

import os
import re
import json
import hashlib
import base64
import logging
import logging.handlers
import time
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
from functools import wraps
from investment_backend import normalize_position, upsert_position
from investment_broker import build_order_intent
from investment_calendar import sync_investment_calendar
from investment_desk_engine import build_investment_desk_engine, evaluate_chat_trade_gate, evaluate_trade_intent_gate
from kis_broker import sync_kis_account
from flask import (
    Flask, request, jsonify, send_from_directory,
    session, redirect, render_template_string,
    Response, stream_with_context,
)
from dotenv import load_dotenv
from cryptography.fernet import Fernet, InvalidToken

load_dotenv('ecrk.env')
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
ANTHROPIC_FALLBACK_MODEL = os.getenv('ANTHROPIC_FALLBACK_MODEL', 'claude-sonnet-4-5-20250929')
OPENAI_API_KEY    = os.getenv('OPENAI_API_KEY', '')
OPENAI_MODEL      = os.getenv('OPENAI_MODEL', 'gpt-4o-mini')
APP_PASSWORD      = os.getenv('APP_PASSWORD', '')
DATABASE_URL      = os.getenv('DATABASE_URL', '')
POLYGON_API_KEY   = os.getenv('POLYGON_API_KEY', '')
ALPHA_VANTAGE_API_KEY = os.getenv('ALPHA_VANTAGE_API_KEY', '')
FINNHUB_API_KEY   = os.getenv('FINNHUB_API_KEY', '')
BENZINGA_API_KEY  = os.getenv('BENZINGA_API_KEY', '')
X_BEARER_TOKEN    = os.getenv('X_BEARER_TOKEN', '')
DATA_FILE         = 'data.json'
SEC_USER_AGENT    = os.getenv('SEC_USER_AGENT', 'jip-investment-partner contact@example.com')

# ---------------------------------------------------------------------------
# 로깅 설정
# ---------------------------------------------------------------------------

def _setup_logger() -> logging.Logger:
    """구조화 로거 초기화. StreamHandler + RotatingFileHandler 병행."""
    _logger = logging.getLogger('jwhwa')
    if _logger.handlers:          # 중복 핸들러 방지 (pytest 재임포트 시)
        return _logger
    _logger.setLevel(logging.DEBUG)

    fmt = logging.Formatter(
        '%(asctime)s [%(levelname)-5s] %(name)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )

    # 콘솔 출력 (INFO 이상)
    sh = logging.StreamHandler()
    sh.setLevel(logging.INFO)
    sh.setFormatter(fmt)
    _logger.addHandler(sh)

    # 파일 출력 (DEBUG 이상, 최대 2MB × 3개 롤링)
    try:
        fh = logging.handlers.RotatingFileHandler(
            'server.log', maxBytes=2_097_152, backupCount=3, encoding='utf-8',
        )
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(fmt)
        _logger.addHandler(fh)
    except OSError as e:
        _logger.warning('로그 파일 생성 실패 (콘솔만 사용): %s', e)

    return _logger

log = _setup_logger()

app = Flask(__name__, static_folder='.')
app.secret_key = hashlib.sha256((APP_PASSWORD + '_sk').encode()).hexdigest()
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
# HTTPS 환경에서만 Secure 플래그 활성화 (로컬 개발 호환)
app.config['SESSION_COOKIE_SECURE'] = bool(os.getenv('DATABASE_URL'))

# ---------------------------------------------------------------------------
# 암호화 — APP_PASSWORD로 Fernet 키 유도 (PBKDF2 강화)
# ---------------------------------------------------------------------------

# 솔트: APP_PASSWORD 기반 고정값 (단일 사용자 앱 — 키 변경 없이 일관성 유지)
_SALT = hashlib.sha256(b'jwhwa_salt_v1').digest()

def _fernet():
    """PBKDF2-HMAC-SHA256 기반 키 유도 (iterations=200_000)"""
    key_bytes = hashlib.pbkdf2_hmac(
        'sha256',
        APP_PASSWORD.encode(),
        _SALT,
        iterations=200_000,
    )
    return Fernet(base64.urlsafe_b64encode(key_bytes))

def _fernet_legacy():
    """구버전 단순 SHA256 키 — 마이그레이션 폴백용"""
    key = base64.urlsafe_b64encode(hashlib.sha256(APP_PASSWORD.encode()).digest())
    return Fernet(key)

def _encrypt(data: dict) -> bytes:
    return _fernet().encrypt(json.dumps(data, ensure_ascii=False).encode())

def _decrypt(raw: bytes) -> dict:
    try:
        return json.loads(_fernet().decrypt(raw).decode())
    except InvalidToken:
        # 구버전 키로 복호화 후 신버전으로 재암호화 (자동 마이그레이션)
        data = json.loads(_fernet_legacy().decrypt(raw).decode())
        write_data(data)   # 신버전 키로 다시 저장
        return data

# ---------------------------------------------------------------------------
# 저장소 — PostgreSQL 또는 로컬 파일 폴백
# ---------------------------------------------------------------------------

def _empty_investment():
    return {
        'positions': [],
        'rules': {
            'dailyLossLimit': 2,
            'maxPositionWeight': 25,
            'cooldownMinutes': 45,
            'chaseLimit': 3,
            'strictMode': True,
            'longTermBias': True,
            'antiAveraging': True,
            'coreRules': (
                '1. 계획 없이 매수하지 않는다. 매수 전에는 종목, 이유, 수량, 손절가, 목표가를 먼저 적는다.\n'
                '2. 급등 뉴스를 본 직후에는 최소 45분을 기다린다. 기다리는 동안 현재가, 평단, 비중, 손절가를 확인한다.\n'
                '3. 손실 직후 물타기는 기본 금지다. 추가매수는 최초 투자 논리가 유지되고, 사전에 정한 분할매수 조건이 있을 때만 한다.\n'
                '4. 한 종목 비중은 기본 25%를 넘기지 않는다. 넘기려면 왜 예외인지 기록한다.\n'
                '5. 손절가를 정하지 못한 거래는 하지 않는다. 장기보유도 손절가 대신 투자 논리 훼손 조건을 적는다.\n'
                '6. 목표가에 근접하면 익절을 미루는 이유를 기록한다. 근거가 없으면 일부 익절을 우선 검토한다.'
            ),
            'tradingStyle': 'swing',
            'riskPerTrade': 0.5,
            'maxDailyTrades': 2,
            'minRiskReward': 2.5,
            'noTradeAfterLoss': True,
            'entryChecklist': (
                '- 이 종목을 지금 사야 하는 이유가 가격 상승 기대 말고도 분명한가?\n'
                '- 현재가가 최근 급등 후 추격매수 구간은 아닌가?\n'
                '- 손절가와 목표가를 적었고 최소 손익비 2.5:1을 만족하는가?\n'
                '- 이 거래 후 종목 비중이 25%를 넘지 않는가?\n'
                '- 오늘 이미 손실 직후 재진입하거나 충동 매매를 한 적은 없는가?'
            ),
            'exitChecklist': (
                '- 손절가에 닿으면 변명하지 않고 정리한다.\n'
                '- 투자 논리가 훼손되면 가격이 아쉬워도 정리한다.\n'
                '- 목표가 90% 이상에 접근하면 일부 익절 또는 손절가 상향을 검토한다.\n'
                '- 장기보유 종목은 가격 하락과 투자 논리 훼손을 구분해서 기록한다.'
            ),
            'bannedSetups': (
                '- 뉴스 제목만 보고 즉시 시장가 매수\n'
                '- 손실 직후 만회 목적의 추가매수\n'
                '- 손절가 없는 진입\n'
                '- 목표가 도달 후 근거 없이 더 버티기\n'
                '- 한 종목 비중 25% 초과를 기록 없이 방치'
            ),
            'reviewRoutine': (
                '- 매일: 보유 종목 현재가, 손절가, 목표가 근접 여부 확인\n'
                '- 매주: 가장 큰 비중 종목의 투자 논리 재점검\n'
                '- 매월: 반복 실수 1개와 다음 달 금지 행동 1개 정리'
            ),
        },
        'journal': [],
        'events': [],
        'decisions': [],
        'orderIntents': [],
        'chat': [],
        'chatSessions': [],
        'activeChatSessionId': None,
        'market': {
            'indexes': [],
            'fetchedAt': None,
            'source': '',
        },
        'alerts': [],
        'usdKrwRate': 1350,
        'broker': {
            'status': 'not_connected',
            'provider': 'manual',
            'orderIntentOnly': True,
            'lastSyncedAt': None,
        },
        'calendar': {
            'lastSyncedAt': None,
            'lookaheadDays': 45,
            'symbols': [],
            'missingProviders': [],
            'eventsSynced': 0,
        },
        'signals': {
            'watchlist': [
                {'handle': 'elonmusk', 'label': 'Elon Musk', 'theme': 'AI/전력/시장 심리', 'trust': 'narrative'},
                {'handle': 'CathieDWood', 'label': 'Cathie Wood', 'theme': '성장주/AI', 'trust': 'investor'},
                {'handle': 'thetechinvest', 'label': 'The Tech Investor', 'theme': '테크/AI 인프라', 'trust': 'trader'},
            ],
            'lastSyncedAt': None,
            'keywords': ['IREN', 'CRCL', 'AI', 'data center', 'Microsoft', 'Anthropic', 'Bitcoin', 'GPU', 'power', 'earnings'],
        },
        'notifications': {
            'enabled': False,
            'dailyTime': '08:30',
            'notifyDesk': True,
            'notifyEvents': True,
            'notifyRisks': True,
            'lastDeskNotifiedDate': None,
        },
        'desk': {
            'autoPrepare': True,
            'prepareTime': '09:00',
            'lastPreparedDate': None,
            'lastPreparedAt': None,
            'status': 'idle',
            'steps': [],
            'errors': [],
            'engine': None,
        },
        'theses': {},
        'deskSnapshots': [],
    }

EMPTY = lambda: {
    'students': [],
    'sessions': [],
    'aiResults': {},
    'my_topics': [],
    'my_records': [],
    'investment': _empty_investment(),
    'app_settings': {
        'reminders': {
            'enabled': False,
            'dailyTime': '21:30',
            'remindMyRecords': True,
            'remindCounseling': True,
            'onlyWhenEmpty': True,
            'lastSentDate': None,
            'lastSentAt': None,
            'lastPermissionAt': None,
        }
    },
}

def _normalize_data(data: dict) -> dict:
    if not isinstance(data, dict):
        return EMPTY()
    data.setdefault('students', [])
    data.setdefault('sessions', [])
    data.setdefault('aiResults', {})
    data.setdefault('my_topics', [])
    data.setdefault('my_records', [])
    app_settings = data.get('app_settings')
    base_settings = EMPTY()['app_settings']
    if not isinstance(app_settings, dict):
        app_settings = base_settings
    else:
        reminders = app_settings.get('reminders') if isinstance(app_settings.get('reminders'), dict) else {}
        app_settings = {
            'reminders': {**base_settings['reminders'], **reminders},
        }
    data['app_settings'] = app_settings
    inv = data.get('investment')
    if not isinstance(inv, dict):
        inv = _empty_investment()
    else:
        base = _empty_investment()
        rules = inv.get('rules') if isinstance(inv.get('rules'), dict) else {}
        inv = {
            'positions': inv.get('positions') if isinstance(inv.get('positions'), list) else [],
            'rules': {**base['rules'], **rules},
            'journal': inv.get('journal') if isinstance(inv.get('journal'), list) else [],
            'events': inv.get('events') if isinstance(inv.get('events'), list) else [],
            'decisions': inv.get('decisions') if isinstance(inv.get('decisions'), list) else [],
            'orderIntents': inv.get('orderIntents') if isinstance(inv.get('orderIntents'), list) else [],
            'chat': inv.get('chat') if isinstance(inv.get('chat'), list) else [],
            'chatSessions': inv.get('chatSessions') if isinstance(inv.get('chatSessions'), list) else [],
            'activeChatSessionId': inv.get('activeChatSessionId'),
            'market': inv.get('market') if isinstance(inv.get('market'), dict) else base['market'],
            'alerts': inv.get('alerts') if isinstance(inv.get('alerts'), list) else [],
            'usdKrwRate': inv.get('usdKrwRate') or base['usdKrwRate'],
            'broker': {**base['broker'], **(inv.get('broker') if isinstance(inv.get('broker'), dict) else {})},
            'calendar': {**base['calendar'], **(inv.get('calendar') if isinstance(inv.get('calendar'), dict) else {})},
            'signals': {**base['signals'], **(inv.get('signals') if isinstance(inv.get('signals'), dict) else {})},
            'notifications': {**base.get('notifications', {}), **(inv.get('notifications') if isinstance(inv.get('notifications'), dict) else {})},
            'desk': {**base.get('desk', {}), **(inv.get('desk') if isinstance(inv.get('desk'), dict) else {})},
            'theses': inv.get('theses') if isinstance(inv.get('theses'), (dict, list)) else base['theses'],
            'deskSnapshots': inv.get('deskSnapshots') if isinstance(inv.get('deskSnapshots'), list) else [],
        }
    data['investment'] = inv
    return data

def _get_db_conn():
    import psycopg2
    return psycopg2.connect(DATABASE_URL, sslmode='require')

_STORAGE_READY = False
_STORAGE_DATA_TYPE_CACHE = None

def _ensure_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS app_storage (
                id INTEGER PRIMARY KEY DEFAULT 1,
                data BYTEA
            )
        """)
    conn.commit()

def _storage_data_type(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT data_type, udt_name
            FROM information_schema.columns
            WHERE table_name = 'app_storage'
              AND column_name = 'data'
            LIMIT 1
        """)
        row = cur.fetchone()
    if not row:
        return 'unknown'
    data_type, udt_name = row
    if data_type == 'USER-DEFINED' and udt_name:
        return udt_name
    return udt_name or data_type or 'unknown'

def _ensure_storage_ready(conn):
    global _STORAGE_READY, _STORAGE_DATA_TYPE_CACHE
    if not _STORAGE_READY:
        _ensure_table(conn)
        _STORAGE_READY = True
    if not _STORAGE_DATA_TYPE_CACHE:
        _STORAGE_DATA_TYPE_CACHE = _storage_data_type(conn)
    return _STORAGE_DATA_TYPE_CACHE

_INVESTMENT_TABLES_READY = False

def _ensure_investment_tables(conn):
    global _INVESTMENT_TABLES_READY
    if _INVESTMENT_TABLES_READY:
        return
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS investment_accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT 'Primary',
                base_currency TEXT NOT NULL DEFAULT 'USD',
                cash_balance NUMERIC NOT NULL DEFAULT 0,
                total_capital NUMERIC,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS investment_positions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
                symbol TEXT NOT NULL,
                name TEXT,
                asset_type TEXT NOT NULL DEFAULT 'stock',
                quantity NUMERIC NOT NULL DEFAULT 0,
                avg_price NUMERIC NOT NULL DEFAULT 0,
                current_price NUMERIC NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'USD',
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(account_id, symbol)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS investment_transactions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
                position_id TEXT REFERENCES investment_positions(id) ON DELETE SET NULL,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                quantity NUMERIC NOT NULL DEFAULT 0,
                price NUMERIC NOT NULL DEFAULT 0,
                fee NUMERIC NOT NULL DEFAULT 0,
                tax NUMERIC NOT NULL DEFAULT 0,
                proceeds NUMERIC NOT NULL DEFAULT 0,
                realized_gain NUMERIC NOT NULL DEFAULT 0,
                trade_date DATE NOT NULL DEFAULT CURRENT_DATE,
                idempotency_key TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'manual',
                memo TEXT,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(account_id, idempotency_key)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS investment_cash_ledger (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
                transaction_id TEXT REFERENCES investment_transactions(id) ON DELETE SET NULL,
                entry_type TEXT NOT NULL,
                amount NUMERIC NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'USD',
                balance_after NUMERIC NOT NULL DEFAULT 0,
                memo TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS investment_events (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
                symbol TEXT,
                event_type TEXT NOT NULL DEFAULT 'event',
                title TEXT NOT NULL,
                body TEXT,
                source TEXT,
                source_url TEXT,
                event_date DATE,
                severity TEXT,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
    conn.commit()
    _INVESTMENT_TABLES_READY = True

def _investment_account_id(inv=None):
    account = (inv or {}).get('account') if isinstance(inv, dict) else {}
    return str((account or {}).get('id') or 'primary')

def _num(value, default=0.0):
    try:
        if value in (None, ''):
            return default
        return float(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return default

def _upsert_investment_account(cur, inv):
    account_id = _investment_account_id(inv)
    cash = 0.0
    for position in inv.get('positions') or []:
        if str(position.get('assetType') or '').lower() == 'cash' or str(position.get('symbol') or '').upper() == 'CASH':
            cash += _num(position.get('cashAmount'), _num(position.get('shares')))
    total_capital = _num((inv.get('account') or {}).get('totalCapital'), None)
    cur.execute("""
        INSERT INTO investment_accounts (id, name, base_currency, cash_balance, total_capital)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            cash_balance = EXCLUDED.cash_balance,
            total_capital = COALESCE(EXCLUDED.total_capital, investment_accounts.total_capital),
            updated_at = NOW()
    """, (account_id, 'Primary', (inv.get('account') or {}).get('baseCurrency') or 'USD', cash, total_capital))
    return account_id

def _upsert_investment_position_row(cur, account_id, position):
    import psycopg2.extras
    pos = dict(position or {})
    pos_id = str(pos.get('id') or f"ip-{str(pos.get('symbol') or 'asset').lower()}-{int(time.time() * 1000)}")
    symbol = str(pos.get('symbol') or '').upper()
    asset_type = str(pos.get('assetType') or 'stock').lower()
    quantity = _num(pos.get('shares') if asset_type != 'cash' else pos.get('cashAmount'), 0)
    avg_price = _num(pos.get('avgPrice'), 1 if asset_type == 'cash' else 0)
    current_price = _num(pos.get('currentPrice'), 1 if asset_type == 'cash' else 0)
    cur.execute("""
        INSERT INTO investment_positions
            (id, account_id, symbol, name, asset_type, quantity, avg_price, current_price, currency, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (account_id, symbol) DO UPDATE SET
            id = EXCLUDED.id,
            name = EXCLUDED.name,
            asset_type = EXCLUDED.asset_type,
            quantity = EXCLUDED.quantity,
            avg_price = EXCLUDED.avg_price,
            current_price = EXCLUDED.current_price,
            currency = EXCLUDED.currency,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
    """, (
        pos_id, account_id, symbol, pos.get('name') or symbol, asset_type,
        quantity, avg_price, current_price, pos.get('currency') or 'USD',
        psycopg2.extras.Json(pos),
    ))
    return {**pos, 'id': pos_id, 'symbol': symbol}

def _mirror_investment_position_to_tables(position, inv):
    if not DATABASE_URL:
        return False
    conn = _get_db_conn()
    try:
        _ensure_investment_tables(conn)
        with conn.cursor() as cur:
            account_id = _upsert_investment_account(cur, inv)
            _upsert_investment_position_row(cur, account_id, position)
        conn.commit()
        return True
    finally:
        conn.close()

def _mirror_investment_snapshot_to_tables(data):
    if not DATABASE_URL:
        return False
    inv = _normalize_data(data).get('investment') or {}
    conn = _get_db_conn()
    try:
        _ensure_investment_tables(conn)
        with conn.cursor() as cur:
            account_id = _upsert_investment_account(cur, inv)
            for position in inv.get('positions') or []:
                if position.get('symbol'):
                    _upsert_investment_position_row(cur, account_id, position)
            for decision in inv.get('decisions') or []:
                _upsert_investment_transaction_row(cur, account_id, decision)
            for event in inv.get('events') or []:
                _upsert_investment_event_row(cur, account_id, event)
        conn.commit()
        return True
    finally:
        conn.close()

def _upsert_investment_transaction_row(cur, account_id, decision):
    import psycopg2.extras
    d = dict(decision or {})
    symbol = str(d.get('symbol') or '').upper()
    action = str(d.get('action') or d.get('type') or '').lower()
    quantity = _num(d.get('tradeShares') or d.get('quantity'), 0)
    price = _num(d.get('tradePrice') or d.get('price'), 0)
    if not symbol or action not in {'buy', 'add', 'sell'} or quantity <= 0 or price <= 0:
        return False
    tx_id = str(d.get('transactionId') or d.get('id') or f"tx-{int(time.time() * 1000)}")
    idempotency_key = str(d.get('idempotencyKey') or d.get('tradeKey') or tx_id)
    proceeds = _num(d.get('proceeds'), quantity * price if action == 'sell' else 0)
    realized_gain = _num(d.get('realizedGain'), 0)
    trade_date = str(d.get('tradeDate') or d.get('date') or d.get('createdAt') or '')[:10] or datetime.now().date().isoformat()
    cur.execute("""
        INSERT INTO investment_transactions
            (id, account_id, position_id, symbol, action, quantity, price, fee, tax, proceeds,
             realized_gain, trade_date, idempotency_key, source, memo, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (account_id, idempotency_key) DO UPDATE SET
            memo = COALESCE(EXCLUDED.memo, investment_transactions.memo),
            metadata = investment_transactions.metadata || EXCLUDED.metadata
    """, (
        tx_id, account_id, d.get('positionId'), symbol, 'buy' if action == 'add' else action,
        quantity, price, _num(d.get('fee'), 0), _num(d.get('tax'), 0), proceeds,
        realized_gain, trade_date, idempotency_key, d.get('source') or d.get('context') or 'app',
        d.get('summary') or d.get('reason') or '', psycopg2.extras.Json(d),
    ))
    if _num(d.get('cashDelta'), 0) != 0 or proceeds:
        amount = _num(d.get('cashDelta'), proceeds if action == 'sell' else -(quantity * price))
        balance_after = 0
        cur.execute("SELECT cash_balance FROM investment_accounts WHERE id = %s", (account_id,))
        row = cur.fetchone()
        if row:
            balance_after = _num(row[0], 0) + amount
        ledger_id = f"cash-{idempotency_key}"[:120]
        cur.execute("""
            INSERT INTO investment_cash_ledger
                (id, account_id, transaction_id, entry_type, amount, currency, balance_after, memo)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
        """, (ledger_id, account_id, tx_id, action, amount, d.get('currency') or 'USD', balance_after, d.get('summary') or ''))
    return True

def _upsert_investment_event_row(cur, account_id, event):
    import psycopg2.extras
    e = dict(event or {})
    title = str(e.get('title') or '').strip()
    if not title:
        return False
    event_id = str(e.get('id') or f"event-{int(time.time() * 1000)}")
    event_date = str(e.get('date') or e.get('eventDate') or e.get('createdAt') or '')[:10] or None
    cur.execute("""
        INSERT INTO investment_events
            (id, account_id, symbol, event_type, title, body, source, source_url, event_date, severity, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            symbol = EXCLUDED.symbol,
            event_type = EXCLUDED.event_type,
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            source = EXCLUDED.source,
            source_url = EXCLUDED.source_url,
            event_date = EXCLUDED.event_date,
            severity = EXCLUDED.severity,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
    """, (
        event_id, account_id, str(e.get('symbol') or '').upper(), e.get('type') or 'event',
        title, e.get('body') or e.get('summary') or '', e.get('source') or '',
        e.get('sourceUrl') or e.get('url') or '', event_date, e.get('severity') or '',
        psycopg2.extras.Json(e),
    ))
    return True

def _position_from_ledger_row(row):
    if not row:
        return None
    (pos_id, symbol, name, asset_type, quantity, avg_price, current_price,
     currency, metadata, updated_at) = row
    meta = metadata if isinstance(metadata, dict) else {}
    position = dict(meta or {})
    asset_type = str(asset_type or position.get('assetType') or 'stock').lower()
    quantity = _num(quantity, 0)
    position.update({
        'id': str(pos_id or position.get('id') or f"ip-{str(symbol or 'asset').lower()}"),
        'symbol': str(symbol or position.get('symbol') or '').upper(),
        'name': name or position.get('name') or str(symbol or '').upper(),
        'assetType': asset_type,
        'shares': quantity,
        'avgPrice': _num(avg_price, 1 if asset_type == 'cash' else 0),
        'currentPrice': _num(current_price, 1 if asset_type == 'cash' else 0),
        'currency': currency or position.get('currency') or 'USD',
        'ledgerUpdatedAt': updated_at.isoformat() if hasattr(updated_at, 'isoformat') else str(updated_at or ''),
        'ledgerSource': 'investment_positions',
    })
    if asset_type == 'cash' or position['symbol'] == 'CASH':
        position['assetType'] = 'cash'
        position['symbol'] = 'CASH'
        position['cashAmount'] = quantity
        position['avgPrice'] = 1.0
        position['currentPrice'] = 1.0
    return position

def _read_investment_snapshot_from_tables(inv=None):
    if not DATABASE_URL:
        return None
    conn = _get_db_conn()
    try:
        _ensure_investment_tables(conn)
        account_id = _investment_account_id(inv)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, name, base_currency, cash_balance, total_capital, updated_at
                FROM investment_accounts
                WHERE id = %s
            """, (account_id,))
            account_row = cur.fetchone()
            cur.execute("""
                SELECT id, symbol, name, asset_type, quantity, avg_price, current_price,
                       currency, metadata, updated_at
                FROM investment_positions
                WHERE account_id = %s
                ORDER BY CASE WHEN symbol = 'CASH' THEN 1 ELSE 0 END, symbol
            """, (account_id,))
            position_rows = cur.fetchall()

        if not account_row and not position_rows:
            return None

        positions = [_position_from_ledger_row(row) for row in position_rows]
        positions = [p for p in positions if p and p.get('symbol')]
        account = {}
        if account_row:
            account = {
                'id': account_row[0],
                'name': account_row[1],
                'baseCurrency': account_row[2],
                'cashBalance': _num(account_row[3], 0),
                'totalCapital': _num(account_row[4], 0) if account_row[4] is not None else None,
                'ledgerUpdatedAt': account_row[5].isoformat() if hasattr(account_row[5], 'isoformat') else str(account_row[5] or ''),
            }
            has_cash = any(str(p.get('symbol') or '').upper() == 'CASH' or str(p.get('assetType') or '').lower() == 'cash' for p in positions)
            if not has_cash and account['cashBalance'] > 0:
                positions.append({
                    'id': 'ip-cash-ledger',
                    'assetType': 'cash',
                    'symbol': 'CASH',
                    'name': 'Cash',
                    'shares': account['cashBalance'],
                    'cashAmount': account['cashBalance'],
                    'avgPrice': 1.0,
                    'currentPrice': 1.0,
                    'currency': account['baseCurrency'] or 'USD',
                    'ledgerSource': 'investment_accounts',
                    'ledgerUpdatedAt': account.get('ledgerUpdatedAt') or '',
                })
        return {
            'account': account,
            'positions': positions,
            'ledgerSource': 'normalized-tables',
        }
    finally:
        conn.close()

def _decode_stored_data(raw):
    if raw is None:
        return EMPTY()
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, memoryview):
        raw = raw.tobytes()
    if isinstance(raw, bytearray):
        raw = bytes(raw)
    if isinstance(raw, bytes):
        return _decrypt(raw)
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return EMPTY()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return _decrypt(text.encode())
    return raw

def _adapt_data_for_storage(data, encrypted, data_type):
    data_type = str(data_type or '').lower()
    if data_type in ('json', 'jsonb'):
        from psycopg2.extras import Json
        return Json(data)
    if data_type == 'bytea':
        import psycopg2
        return psycopg2.Binary(encrypted)
    if data_type in ('text', 'character varying', 'varchar'):
        return encrypted.decode()
    return encrypted

def _safe_error_detail(e):
    text = str(e) or e.__class__.__name__
    for key in ('password=', 'apikey=', 'api_key=', 'DATABASE_URL=', 'postgres://', 'postgresql://'):
        idx = text.lower().find(key.lower())
        if idx >= 0:
            text = text[:idx] + '[redacted]'
            break
    return text[:300]

def read_data() -> dict:
    if DATABASE_URL:
        try:
            conn = _get_db_conn()
            data_type = _ensure_storage_ready(conn)
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM app_storage WHERE id = 1")
                row = cur.fetchone()
            conn.close()
            if not row:
                log.info('DB: 데이터 없음 → 빈 구조 반환')
                return EMPTY()
            data = _normalize_data(_decode_stored_data(row[0]))
            log.debug('DB: app_storage.data type=%s', data_type)
            log.debug('DB: 데이터 로드 완료 (학생 %d명, 회기 %d건)',
                      len(data.get('students', [])), len(data.get('sessions', [])))
            return data
        except Exception as e:
            log.error('DB 읽기 실패: %s', e, exc_info=True)
            return EMPTY()
    # 로컬 파일 폴백
    if not os.path.exists(DATA_FILE):
        log.info('data.json 없음 → 빈 구조 반환')
        return EMPTY()
    try:
        with open(DATA_FILE, 'rb') as f:
            raw = f.read()
    except OSError as e:
        log.error('data.json 읽기 실패: %s', e, exc_info=True)
        return EMPTY()
    try:
        data = _normalize_data(_decrypt(raw))
        log.debug('파일: 데이터 로드 완료 (학생 %d명)', len(data.get('students', [])))
        return data
    except InvalidToken:
        log.warning('복호화 실패 (InvalidToken) — JSON 평문 폴백 시도')
        try:
            data = _normalize_data(json.loads(raw.decode()))
            write_data(data)
            log.info('평문 데이터 → 암호화 마이그레이션 완료')
            return data
        except Exception as e2:
            log.error('평문 파싱도 실패: %s', e2, exc_info=True)
            return EMPTY()
    except Exception as e:
        log.error('데이터 로드 중 예외: %s', e, exc_info=True)
        return EMPTY()

def write_data(data: dict):
    try:
        encrypted = _encrypt(data)
    except Exception as e:
        log.error('데이터 암호화 실패: %s', e, exc_info=True)
        raise

    if DATABASE_URL:
        try:
            conn = _get_db_conn()
            data_type = _ensure_storage_ready(conn)
            stored_data = _adapt_data_for_storage(data, encrypted, data_type)
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO app_storage (id, data) VALUES (1, %s)
                    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
                """, (stored_data,))
            conn.commit()
            conn.close()
            log.debug('DB: app_storage.data type=%s', data_type)
            log.debug('DB: 데이터 저장 완료')
            return
        except Exception as e:
            log.error('DB 저장 실패: %s', e, exc_info=True)
            # DB 실패 시 로컬 파일로 폴백하지 않음 (데이터 일관성 유지)
            raise
    # 로컬 파일
    try:
        with open(DATA_FILE, 'wb') as f:
            f.write(encrypted)
        log.debug('파일: 데이터 저장 완료 (%d bytes)', len(encrypted))
    except OSError as e:
        log.error('data.json 저장 실패: %s', e, exc_info=True)
        raise

# ---------------------------------------------------------------------------
# 로그인
# ---------------------------------------------------------------------------

_LOGIN_HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>自畵像</title>
  <!-- iOS PWA: 로그인 페이지에서 홈 화면 추가해도 standalone 모드로 실행되도록 -->
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#8c7b6b">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="自畵像">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Noto Sans KR',sans-serif;
         background:#f0ece5;height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:#f8f5f0;border:0.5px solid rgba(100,80,55,.15);border-radius:14px;
          padding:38px 34px;width:320px;box-shadow:0 2px 18px rgba(0,0,0,.07)}
    h1{font-size:22px;font-weight:600;color:#2c2820;margin-bottom:2px}
    h2{font-size:13px;font-weight:400;color:#6a5f58;margin-bottom:22px}
    .sub{font-size:12px;color:#9a908a;margin-bottom:28px}
    label{font-size:12px;color:#7a706a;display:block;margin-bottom:5px}
    input{width:100%;padding:9px 11px;font-size:13px;
          border:0.5px solid rgba(100,80,55,.25);border-radius:8px;
          background:#fff;margin-bottom:16px;outline:none;font-family:inherit}
    input:focus{border-color:#8c7b6b;box-shadow:0 0 0 2px rgba(140,123,107,.12)}
    button{width:100%;padding:10px;background:#8c7b6b;color:#fff;border:none;
           border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit}
    button:hover{opacity:.88}
    .err{font-size:12px;color:#b94040;background:rgba(185,64,64,.07);
         padding:8px 11px;border-radius:6px;margin-bottom:14px}
    .lock{text-align:center;font-size:22px;margin-bottom:18px;opacity:.45}
  </style>
</head>
<body>
  <div class="card">
    <div class="lock">🔒</div>
    <h1>自畵像</h1>
    <h2>기록에 관한 앱</h2>
    <p class="sub">개인정보 암호화 저장.</p>
    {% if error %}<div class="err">{{ error }}</div>{% endif %}
    <form method="post">
      <label>비밀번호</label>
      <input type="password" name="password" placeholder="비밀번호 입력" autofocus />
      <button type="submit">로그인 →</button>
    </form>
  </div>
</body>
</html>"""

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('auth'):
            if request.path.startswith('/api/'):
                log.debug('인증 없는 API 접근 → 401 JSON: %s', request.path)
                return jsonify({'error': 'auth_required'}), 401
            log.debug('인증 없는 접근 → 로그인 리다이렉트: %s', request.path)
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form.get('password', '') == APP_PASSWORD:
            session['auth'] = True
            log.info('로그인 성공 (IP: %s)', request.remote_addr)
            return redirect('/')
        log.warning('로그인 실패 (IP: %s)', request.remote_addr)
        return render_template_string(_LOGIN_HTML, error='비밀번호가 올바르지 않습니다')
    if session.get('auth'):
        return redirect('/')
    return render_template_string(_LOGIN_HTML, error=None)

@app.route('/logout')
def logout():
    log.info('로그아웃 (IP: %s)', request.remote_addr)
    session.clear()
    return redirect('/login')

# ---------------------------------------------------------------------------
# 정적 파일
# ---------------------------------------------------------------------------

@app.route('/')
@require_auth
def index():
    return send_from_directory('.', 'index.html')

# PWA 필수 파일 — 인증 없이 서빙 (홈 화면 추가 시 iOS가 읽어야 함)
_PUBLIC_FILES = {'manifest.json', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg'}

# 정적 에셋 확장자 — 소스코드/스타일은 인증 없이 서빙 (SW가 캐시할 수 있어야 함)
# 민감 데이터는 /api/* 에만 있으므로 JS/CSS 공개는 안전
_PUBLIC_EXTENSIONS = {'.js', '.css', '.png', '.svg', '.ico', '.webp', '.woff', '.woff2'}

@app.route('/<path:filename>')
def static_files(filename):
    is_public_ext = any(filename.endswith(ext) for ext in _PUBLIC_EXTENSIONS)
    if not is_public_ext and filename not in _PUBLIC_FILES and not session.get('auth'):
        log.debug('인증 없는 접근 → 로그인 리다이렉트: /%s', filename)
        return redirect('/login')
    return send_from_directory('.', filename)

# ---------------------------------------------------------------------------
# 데이터 API
# ---------------------------------------------------------------------------

@app.route('/api/data', methods=['GET'])
@require_auth
def get_data():
    try:
        data = read_data()
        return jsonify(data)
    except Exception as e:
        log.error('GET /api/data 처리 실패: %s', e, exc_info=True)
        return jsonify({'error': '데이터 로드 실패'}), 500

@app.route('/api/data', methods=['POST'])
@require_auth
def save_data_route():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        log.warning('POST /api/data: 유효하지 않은 페이로드')
        return jsonify({'error': '유효하지 않은 데이터 형식'}), 400
    try:
        payload = _normalize_data(payload)
        mirrored = _mirror_investment_snapshot_to_tables(payload)
        write_data(payload)
        return jsonify({'ok': True, 'investmentNormalized': mirrored})
    except Exception as e:
        log.error('POST /api/data 저장 실패: %s', e, exc_info=True)
        return jsonify({'error': '데이터 저장 실패'}), 500

@app.route('/api/investment/ledger', methods=['GET'])
@require_auth
def investment_ledger_snapshot_route():
    request_id = f"iledger-{int(time.time() * 1000)}"
    try:
        data = _normalize_data(read_data())
        inv = data['investment']
        ledger = _read_investment_snapshot_from_tables(inv)
        if ledger and ledger.get('positions'):
            inv = _normalize_data({
                'investment': {
                    **inv,
                    'account': { **(inv.get('account') or {}), **(ledger.get('account') or {}) },
                    'positions': ledger['positions'],
                    'ledgerSource': ledger.get('ledgerSource'),
                    'ledgerSyncedAt': datetime.now().isoformat(),
                }
            })['investment']
            log.info('GET /api/investment/ledger [%s] normalized positions=%d source=%s',
                     request_id, len(inv.get('positions') or []), ledger.get('ledgerSource'))
            return jsonify({
                'ok': True,
                'investment': inv,
                'positions': inv.get('positions') or [],
                'source': ledger.get('ledgerSource'),
                'requestId': request_id,
            })
        log.info('GET /api/investment/ledger [%s] fallback positions=%d',
                 request_id, len(inv.get('positions') or []))
        return jsonify({
            'ok': True,
            'investment': inv,
            'positions': inv.get('positions') or [],
            'source': 'app-storage',
            'requestId': request_id,
        })
    except Exception as e:
        log.error('GET /api/investment/ledger [%s] failed: %s', request_id, e, exc_info=True)
        return jsonify({
            'ok': False,
            'error': 'investment ledger snapshot failed',
            'requestId': request_id,
            'errorDetail': _safe_error_detail(e),
        }), 500

@app.route('/api/investment/desk/engine', methods=['POST'])
@require_auth
def investment_desk_engine_route():
    request_id = f"idesk-{int(time.time() * 1000)}"
    payload = request.get_json(silent=True) or {}
    try:
        data = _normalize_data(read_data())
        inv = data['investment']
        ledger = _read_investment_snapshot_from_tables(inv)
        if ledger and ledger.get('positions'):
            inv = _normalize_data({
                'investment': {
                    **inv,
                    'account': { **(inv.get('account') or {}), **(ledger.get('account') or {}) },
                    'positions': ledger['positions'],
                    'ledgerSource': ledger.get('ledgerSource'),
                    'ledgerSyncedAt': datetime.now().isoformat(),
                }
            })['investment']
            data['investment'] = inv

        today = str(payload.get('date') or '')[:10] or None
        engine = build_investment_desk_engine(inv, today)
        inv['theses'] = {item['symbol']: item for item in engine.get('theses') or [] if item.get('symbol')}
        inv['desk'] = {
            **(inv.get('desk') if isinstance(inv.get('desk'), dict) else {}),
            'engine': engine,
            'status': 'ready',
            'lastEngineAt': engine.get('generatedAt'),
            'lastPreparedDate': engine.get('date'),
            'lastPreparedAt': datetime.now().isoformat(),
        }
        snapshots = inv.get('deskSnapshots') if isinstance(inv.get('deskSnapshots'), list) else []
        snapshot = {
            'id': f"desk-{engine.get('date')}-{request_id}",
            'date': engine.get('date'),
            'generatedAt': engine.get('generatedAt'),
            'topLine': (engine.get('marketView') or {}).get('topLine'),
            'engine': engine,
        }
        snapshots = [s for s in snapshots if str(s.get('date')) != str(engine.get('date'))]
        snapshots.append(snapshot)
        inv['deskSnapshots'] = snapshots[-20:]
        data['investment'] = inv
        write_data(data)
        log.info('POST /api/investment/desk/engine [%s] generated positions=%d controls=%d',
                 request_id, len(inv.get('positions') or []), len(engine.get('behaviorControls') or []))
        return jsonify({'ok': True, 'investment': inv, 'engine': engine, 'requestId': request_id})
    except Exception as e:
        log.error('POST /api/investment/desk/engine [%s] failed: %s', request_id, e, exc_info=True)
        return jsonify({
            'ok': False,
            'error': 'investment desk engine failed',
            'requestId': request_id,
            'errorDetail': _safe_error_detail(e),
        }), 500

@app.route('/api/investment/positions', methods=['POST'])
@require_auth
def save_investment_position_route():
    request_id = f"ipos-{int(time.time() * 1000)}"
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get('position'), dict):
        log.warning('POST /api/investment/positions [%s] invalid payload keys=%s', request_id, list(payload.keys()) if isinstance(payload, dict) else type(payload).__name__)
        return jsonify({'error': 'position 데이터가 필요합니다.', 'requestId': request_id}), 400

    try:
        raw_position = payload['position']
        raw_symbol = str(raw_position.get('symbol') or '').strip().upper()
        data = read_data()
        before_count = len(((data.get('investment') or {}).get('positions') or []))
        log.info('POST /api/investment/positions [%s] start symbol=%s before=%d', request_id, raw_symbol or '-', before_count)
        data, inv, position = upsert_position(data, raw_position, _normalize_data, _MARKET_SYMBOL_RE)
        mirrored = _mirror_investment_position_to_tables(position, inv)
        write_data(data)
        after_count = len(inv.get('positions') or [])
        log.info('POST /api/investment/positions [%s] saved symbol=%s id=%s before=%d after=%d normalized=%s', request_id, position.get('symbol'), position.get('id'), before_count, after_count, mirrored)
        return jsonify({'ok': True, 'investment': inv, 'position': position, 'requestId': request_id, 'normalized': mirrored})
    except ValueError as e:
        log.warning('POST /api/investment/positions [%s] validation failed: %s', request_id, e, exc_info=True)
        return jsonify({'error': str(e), 'requestId': request_id}), 400
    except Exception as e:
        log.error('POST /api/investment/positions [%s] save failed: %s', request_id, e, exc_info=True)
        storage_type = 'local'
        if DATABASE_URL:
            try:
                conn = _get_db_conn()
                storage_type = _storage_data_type(conn)
                conn.close()
            except Exception as type_error:
                storage_type = f'unknown:{type_error.__class__.__name__}'
        return jsonify({
            'error': '투자 종목 저장 실패',
            'requestId': request_id,
            'errorType': e.__class__.__name__,
            'errorDetail': _safe_error_detail(e),
            'storageType': storage_type,
        }), 500

@app.route('/api/investment/transactions', methods=['POST'])
@require_auth
def create_investment_transaction_route():
    request_id = f"itx-{int(time.time() * 1000)}"
    payload = request.get_json(silent=True)
    tx = payload.get('transaction') if isinstance(payload, dict) else None
    if not isinstance(tx, dict):
        return jsonify({'error': 'transaction data is required', 'requestId': request_id}), 400
    try:
        data = _normalize_data(read_data())
        inv = data['investment']
        result = _apply_transaction_to_investment_snapshot(inv, tx)
        if result.get('duplicate'):
            return jsonify({'ok': True, 'duplicate': True, 'investment': inv, 'transaction': result['decision'], 'requestId': request_id})
        _mirror_investment_snapshot_to_tables(data)
        write_data(data)
        log.info('POST /api/investment/transactions [%s] saved %s %s %s@%s',
                 request_id, result['decision'].get('symbol'), result['decision'].get('action'),
                 result['decision'].get('tradeShares'), result['decision'].get('tradePrice'))
        return jsonify({'ok': True, 'investment': inv, 'transaction': result['decision'], 'requestId': request_id})
    except ValueError as e:
        log.warning('POST /api/investment/transactions [%s] validation failed: %s', request_id, e, exc_info=True)
        return jsonify({'error': str(e), 'requestId': request_id}), 400
    except Exception as e:
        log.error('POST /api/investment/transactions [%s] failed: %s', request_id, e, exc_info=True)
        return jsonify({'error': 'investment transaction save failed', 'requestId': request_id, 'errorDetail': _safe_error_detail(e)}), 500

def _apply_transaction_to_investment_snapshot(inv, tx):
    symbol = str(tx.get('symbol') or '').strip().upper()
    action = str(tx.get('action') or '').strip().lower()
    if action == 'add':
        action = 'buy'
    shares = _num(tx.get('tradeShares') or tx.get('quantity') or tx.get('shares'), 0)
    price = _num(tx.get('tradePrice') or tx.get('price'), 0)
    if not symbol or not _MARKET_SYMBOL_RE.match(symbol):
        raise ValueError('valid symbol is required')
    if action not in {'buy', 'sell'}:
        raise ValueError('action must be buy or sell')
    if shares <= 0 or price <= 0:
        raise ValueError('quantity and price must be greater than zero')

    positions = inv.setdefault('positions', [])
    decisions = inv.setdefault('decisions', [])
    idempotency_key = str(tx.get('idempotencyKey') or tx.get('tradeKey') or f"{symbol}|{action}|{shares:.6f}|{price:.4f}")
    existing = next((d for d in decisions if str(d.get('idempotencyKey') or d.get('tradeKey') or d.get('id')) == idempotency_key), None)
    if existing:
        return {'duplicate': True, 'decision': existing}

    idx = next((i for i, p in enumerate(positions) if str(p.get('symbol') or '').upper() == symbol and str(p.get('assetType') or '').lower() != 'cash'), -1)
    if idx < 0:
        if action == 'sell':
            raise ValueError('cannot sell a position that does not exist')
        positions.append(normalize_position({
            'id': tx.get('positionId') or f"ip-{symbol.lower()}-{int(time.time() * 1000)}",
            'symbol': symbol,
            'name': tx.get('name') or symbol,
            'shares': 0,
            'avgPrice': price,
            'currentPrice': price,
        }, _MARKET_SYMBOL_RE))
        idx = len(positions) - 1

    position = dict(positions[idx])
    old_shares = _num(position.get('shares'), 0)
    old_avg = _num(position.get('avgPrice'), 0)
    old_cost = old_shares * old_avg
    realized_gain = 0.0
    cash_delta = 0.0
    applied_shares = shares
    if action == 'buy':
        next_shares = old_shares + shares
        next_avg = (old_cost + shares * price) / next_shares if next_shares else price
        cash_delta = -(shares * price)
    else:
        applied_shares = min(shares, old_shares)
        if applied_shares <= 0:
            raise ValueError('sell quantity exceeds current position')
        next_shares = old_shares - applied_shares
        next_avg = old_avg if next_shares > 0 else 0
        cash_delta = applied_shares * price
        realized_gain = (price - old_avg) * applied_shares

    position.update({
        'shares': next_shares,
        'avgPrice': next_avg,
        'currentPrice': price,
        'manualPrice': True,
        'marketUpdatedAt': datetime.now().isoformat(),
    })
    positions[idx] = position
    _adjust_investment_cash_position(inv, cash_delta)
    decision = {
        **tx,
        'id': tx.get('id') or f"id{int(time.time() * 1000)}",
        'createdAt': tx.get('createdAt') or datetime.now().isoformat(),
        'symbol': symbol,
        'action': action,
        'tradeShares': applied_shares,
        'tradePrice': price,
        'cashDelta': cash_delta,
        'proceeds': cash_delta if action == 'sell' else 0,
        'realizedGain': realized_gain,
        'portfolioApplied': True,
        'cashApplied': True,
        'idempotencyKey': idempotency_key,
        'tradeKey': idempotency_key,
    }
    decisions.append(decision)
    return {'duplicate': False, 'decision': decision}

def _adjust_investment_cash_position(inv, delta):
    if not delta:
        return
    positions = inv.setdefault('positions', [])
    idx = next((i for i, p in enumerate(positions) if str(p.get('assetType') or '').lower() == 'cash' or str(p.get('symbol') or '').upper() == 'CASH'), -1)
    current = _num(positions[idx].get('cashAmount') if idx >= 0 else 0, _num(positions[idx].get('shares') if idx >= 0 else 0, 0))
    amount = max(0, current + delta)
    cash = {
        **(positions[idx] if idx >= 0 else {}),
        'id': (positions[idx].get('id') if idx >= 0 else 'ip-cash-auto'),
        'assetType': 'cash',
        'symbol': 'CASH',
        'name': (positions[idx].get('name') if idx >= 0 else 'Cash'),
        'shares': amount,
        'cashAmount': amount,
        'avgPrice': 1.0,
        'currentPrice': 1.0,
        'currency': 'USD',
        'manualPrice': True,
        'marketUpdatedAt': datetime.now().isoformat(),
    }
    if idx >= 0:
        positions[idx] = cash
    else:
        positions.append(cash)

# ---------------------------------------------------------------------------
# 시장 데이터 API — 현재가/지수 조회 프록시
# ---------------------------------------------------------------------------

@app.route('/api/investment/order-intent', methods=['POST'])
@require_auth
def investment_order_intent_route():
    payload = request.get_json(silent=True)
    try:
        intent = build_order_intent(payload or {})
        data = read_data()
        data = _normalize_data(data)
        inv = data['investment']
        inv.setdefault('orderIntents', [])
        inv['orderIntents'].append(intent)
        inv['broker'] = {
            **_empty_investment()['broker'],
            **(inv.get('broker') if isinstance(inv.get('broker'), dict) else {}),
            'status': 'not_connected',
            'orderIntentOnly': True,
        }
        data['investment'] = inv
        write_data(data)
        return jsonify({
            'ok': True,
            'intent': intent,
            'investment': inv,
            'brokerReady': False,
            'message': 'order intent only; broker execution adapter is not connected',
        })
    except ValueError as e:
        return jsonify({'ok': False, 'error': str(e)}), 400
    except Exception as e:
        log.error('POST /api/investment/order-intent failed: %s', e, exc_info=True)
        return jsonify({'ok': False, 'error': 'order intent failed'}), 500

@app.route('/api/investment/trade-gate', methods=['POST'])
@require_auth
def investment_trade_gate_route():
    request_id = f"igate-{int(time.time() * 1000)}"
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'ok': False, 'error': 'trade gate payload must be an object', 'requestId': request_id}), 400
    try:
        data = _normalize_data(read_data())
        inv = data['investment']
        ledger = _read_investment_snapshot_from_tables(inv)
        if ledger and ledger.get('positions'):
            inv = _normalize_data({
                'investment': {
                    **inv,
                    'account': { **(inv.get('account') or {}), **(ledger.get('account') or {}) },
                    'positions': ledger['positions'],
                    'ledgerSource': ledger.get('ledgerSource'),
                    'ledgerSyncedAt': datetime.now().isoformat(),
                }
            })['investment']
        gate = evaluate_trade_intent_gate(inv, payload, payload.get('date'))
        log.info('POST /api/investment/trade-gate [%s] %s %s -> %s',
                 request_id, gate.get('symbol'), gate.get('action'), gate.get('status'))
        return jsonify({'ok': True, 'gate': gate, 'requestId': request_id})
    except Exception as e:
        log.error('POST /api/investment/trade-gate [%s] failed: %s', request_id, e, exc_info=True)
        return jsonify({
            'ok': False,
            'error': 'investment trade gate failed',
            'requestId': request_id,
            'errorDetail': _safe_error_detail(e),
        }), 500

@app.route('/api/investment/chat-gate', methods=['POST'])
@require_auth
def investment_chat_gate_route():
    request_id = f"ichatgate-{int(time.time() * 1000)}"
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'ok': False, 'error': 'chat gate payload must be an object', 'requestId': request_id}), 400
    try:
        data = _normalize_data(read_data())
        inv = data['investment']
        ledger = _read_investment_snapshot_from_tables(inv)
        if ledger and ledger.get('positions'):
            inv = _normalize_data({
                'investment': {
                    **inv,
                    'account': { **(inv.get('account') or {}), **(ledger.get('account') or {}) },
                    'positions': ledger['positions'],
                    'ledgerSource': ledger.get('ledgerSource'),
                    'ledgerSyncedAt': datetime.now().isoformat(),
                }
            })['investment']
        result = evaluate_chat_trade_gate(inv, payload.get('text'), payload.get('date'))
        intent = result.get('intent') or {}
        gate = result.get('gate') or {}
        log.info('POST /api/investment/chat-gate [%s] detected=%s %s %s -> %s',
                 request_id, result.get('intentDetected'), intent.get('symbol'), intent.get('action'), gate.get('status'))
        return jsonify({'ok': True, **result, 'requestId': request_id})
    except Exception as e:
        log.error('POST /api/investment/chat-gate [%s] failed: %s', request_id, e, exc_info=True)
        return jsonify({
            'ok': False,
            'error': 'investment chat gate failed',
            'requestId': request_id,
            'errorDetail': _safe_error_detail(e),
        }), 500

@app.route('/api/investment/broker/sync', methods=['POST'])
@require_auth
def investment_broker_sync_route():
    payload = request.get_json(silent=True) or {}
    days = payload.get('days', 30) if isinstance(payload, dict) else 30
    try:
        data = _normalize_data(read_data())
        result = sync_kis_account(data.get('investment') or {}, days=days)
        if not result.get('ok'):
            return jsonify(result), 400
        data['investment'] = _normalize_data({'investment': result['investment']})['investment']
        write_data(data)
        return jsonify({
            'ok': True,
            'investment': data['investment'],
            'positionsSynced': result.get('positionsSynced', 0),
            'tradesSynced': result.get('tradesSynced', 0),
            'brokerReady': True,
        })
    except Exception as e:
        log.error('POST /api/investment/broker/sync failed: %s', e, exc_info=True)
        return jsonify({'ok': False, 'error': 'KIS sync failed', 'errorDetail': _safe_error_detail(e)}), 500

@app.route('/api/investment/calendar/sync', methods=['POST'])
@require_auth
def investment_calendar_sync_route():
    payload = request.get_json(silent=True) or {}
    days = payload.get('days', 45) if isinstance(payload, dict) else 45
    try:
        data = _normalize_data(read_data())
        result = sync_investment_calendar(data.get('investment') or {}, days=days)
        data['investment'] = _normalize_data({'investment': result['investment']})['investment']
        write_data(data)
        return jsonify({
            'ok': True,
            'investment': data['investment'],
            'eventsSynced': result.get('eventsSynced', 0),
            'missingProviders': result.get('missingProviders', []),
        })
    except Exception as e:
        log.error('POST /api/investment/calendar/sync failed: %s', e, exc_info=True)
        return jsonify({'ok': False, 'error': 'investment calendar sync failed', 'errorDetail': _safe_error_detail(e)}), 500

def _x_headers():
    return {'Authorization': f'Bearer {X_BEARER_TOKEN}', 'User-Agent': 'jip-investment-signal'}

def _x_get_user_id(handle):
    resp = requests.get(
        f'https://api.x.com/2/users/by/username/{handle}',
        headers=_x_headers(),
        params={'user.fields': 'username,name,verified'},
        timeout=12,
    )
    if not resp.ok:
        return None
    return (resp.json().get('data') or {}).get('id')

def _x_recent_posts(handle, limit=5):
    user_id = _x_get_user_id(handle)
    if not user_id:
        return []
    resp = requests.get(
        f'https://api.x.com/2/users/{user_id}/tweets',
        headers=_x_headers(),
        params={
            'max_results': max(5, min(int(limit or 5), 10)),
            'tweet.fields': 'created_at,public_metrics,entities',
            'exclude': 'replies,retweets',
        },
        timeout=12,
    )
    if not resp.ok:
        return []
    return resp.json().get('data') or []

@app.route('/api/investment/x/sync', methods=['POST'])
@require_auth
def investment_x_sync_route():
    if not X_BEARER_TOKEN:
        return jsonify({'ok': False, 'configured': False, 'missing': ['X_BEARER_TOKEN'], 'message': 'X API bearer token is not configured'}), 400
    payload = request.get_json(silent=True) or {}
    try:
        data = _normalize_data(read_data())
        inv = data['investment']
        signals = inv.get('signals') if isinstance(inv.get('signals'), dict) else _empty_investment()['signals']
        watchlist = payload.get('watchlist') if isinstance(payload.get('watchlist'), list) else signals.get('watchlist', [])
        keywords = [str(k).lower() for k in (signals.get('keywords') or []) if str(k).strip()]
        events = inv.get('events') if isinstance(inv.get('events'), list) else []
        added = 0
        for account in watchlist[:20]:
            handle = str(account.get('handle') if isinstance(account, dict) else account).strip().lstrip('@')
            if not re.fullmatch(r'[A-Za-z0-9_]{1,15}', handle):
                continue
            for post in _x_recent_posts(handle, limit=5):
                text = str(post.get('text') or '')
                haystack = text.lower()
                if keywords and not any(k in haystack for k in keywords):
                    continue
                post_id = str(post.get('id') or '')
                created = str(post.get('created_at') or '')
                date = created[:10] if re.match(r'\d{4}-\d{2}-\d{2}', created) else datetime.utcnow().date().isoformat()
                event = {
                    'id': f'x-signal-{handle.lower()}-{post_id}',
                    'date': date,
                    'type': 'signal',
                    'severity': 'watch',
                    'symbol': '',
                    'title': f'@{handle} 시장 신호',
                    'body': f"X 계정 @{handle} 게시글입니다.\n\n{text}\n\n원칙: 공식 확인 전 매수 근거가 아니라 관찰/검증 신호로만 사용.",
                    'source': 'x-api',
                    'sourceUrl': f'https://x.com/{handle}/status/{post_id}' if post_id else f'https://x.com/{handle}',
                    'handle': handle,
                    'trust': account.get('trust') if isinstance(account, dict) else '',
                }
                if not any(str(e.get('id')) == event['id'] for e in events):
                    events.append(event)
                    added += 1
        signals['watchlist'] = watchlist
        signals['lastSyncedAt'] = datetime.utcnow().isoformat() + 'Z'
        inv['signals'] = signals
        inv['events'] = events
        data['investment'] = inv
        write_data(data)
        return jsonify({'ok': True, 'investment': inv, 'signalsSynced': added})
    except Exception as e:
        log.error('POST /api/investment/x/sync failed: %s', e, exc_info=True)
        return jsonify({'ok': False, 'error': 'X signal sync failed', 'errorDetail': _safe_error_detail(e)}), 500
_MARKET_SYMBOL_RE = re.compile(r'^[A-Za-z0-9.\-^=]{1,16}$')
_NEWS_QUERY_RE = re.compile(r'^[^<>]{2,160}$')
_MARKET_SYMBOL_ALIASES = {
    'CIRCLE': 'CRCL',
    'CIRCLEINTERNETGROUP': 'CRCL',
    '써클': 'CRCL',
    '써클인터넷그룹': 'CRCL',
    'CRCL': 'CRCL',
    'ETH': 'ETH-USD',
    'ETHEREUM': 'ETH-USD',
    '이더리움': 'ETH-USD',
    'BTC': 'BTC-USD',
    'BITCOIN': 'BTC-USD',
    '비트코인': 'BTC-USD',
    'SOL': 'SOL-USD',
    'SOLANA': 'SOL-USD',
    'XRP': 'XRP-USD',
    'USDKRW': 'USDKRW=X',
    'USD/KRW': 'USDKRW=X',
    'USDKRW=X': 'USDKRW=X',
    'KRW': 'USDKRW=X',
}
_COINGECKO_IDS = {
    'BTC-USD': 'bitcoin',
    'ETH-USD': 'ethereum',
    'SOL-USD': 'solana',
    'XRP-USD': 'ripple',
    'DOGE-USD': 'dogecoin',
    'ADA-USD': 'cardano',
}

def _canonical_market_symbol(symbol: str) -> str:
    raw = str(symbol or '').strip()
    parenthesized = re.search(r'\(([A-Za-z0-9.\-^=]{1,16})\)', raw)
    candidate = parenthesized.group(1) if parenthesized else raw
    sym = re.sub(r'\s+', '', candidate).upper()
    return _MARKET_SYMBOL_ALIASES.get(sym, _MARKET_SYMBOL_ALIASES.get(raw, sym))

def _parse_market_symbols(raw: str):
    symbols = []
    for part in (raw or '').split(','):
        sym = _canonical_market_symbol(part)
        if not sym:
            continue
        if not _MARKET_SYMBOL_RE.match(sym):
            raise ValueError(f'유효하지 않은 심볼: {sym}')
        if sym not in symbols:
            symbols.append(sym)
    if not symbols:
        raise ValueError('symbols 파라미터가 필요합니다')
    if len(symbols) > 30:
        raise ValueError('한 번에 최대 30개까지만 조회할 수 있습니다')
    return symbols

def _parse_news_queries(raw: str):
    queries = []
    parts = re.split(r'\|\||[\r\n]+', raw or '')
    for part in parts:
        query = re.sub(r'\s+', ' ', part).strip()
        if not query:
            continue
        query = re.sub(r'https?://\S+', ' ', query)
        query = re.sub(r'[<>]', ' ', query)
        query = re.sub(r'\s+', ' ', query).strip()[:160].strip()
        if not query:
            continue
        if not _NEWS_QUERY_RE.match(query):
            log.warning('invalid news query skipped: %s', query[:80])
            continue
        if query.lower() not in [q.lower() for q in queries]:
            queries.append(query)
    if len(queries) > 8:
        raise ValueError('news query is limited to 8 items')
    return queries

def _normalize_yahoo_quote(item: dict):
    price = item.get('regularMarketPrice')
    if price is None:
        price = item.get('postMarketPrice') or item.get('preMarketPrice')
    return {
        'symbol': item.get('symbol', ''),
        'name': item.get('shortName') or item.get('longName') or item.get('symbol', ''),
        'price': price,
        'change': item.get('regularMarketChange'),
        'changePercent': item.get('regularMarketChangePercent'),
        'previousClose': item.get('regularMarketPreviousClose'),
        'currency': item.get('currency', 'USD'),
        'marketState': item.get('marketState'),
        'marketTime': item.get('regularMarketTime'),
    }

def _normalize_yahoo_chart(symbol: str, body: dict):
    result = (body.get('chart', {}).get('result') or [None])[0]
    if not result:
        return None
    meta = result.get('meta') or {}
    price = meta.get('regularMarketPrice')
    previous = meta.get('previousClose') or meta.get('chartPreviousClose')
    change = None
    change_percent = None
    if price is not None and previous:
        change = price - previous
        change_percent = (change / previous) * 100
    return {
        'symbol': meta.get('symbol') or symbol,
        'name': meta.get('longName') or meta.get('shortName') or meta.get('symbol') or symbol,
        'price': price,
        'change': change,
        'changePercent': change_percent,
        'previousClose': previous,
        'currency': meta.get('currency', 'USD'),
        'marketState': meta.get('marketState'),
        'marketTime': meta.get('regularMarketTime'),
    }

def _fetch_yahoo_chart_quotes(symbols):
    quotes = []
    for symbol in symbols:
        for host in ('query1.finance.yahoo.com', 'query2.finance.yahoo.com'):
            try:
                resp = requests.get(
                    f'https://{host}/v8/finance/chart/{symbol}',
                    params={'range': '1d', 'interval': '1d'},
                    headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
                    timeout=10,
                )
            except requests.RequestException as e:
                log.warning('Yahoo chart 조회 실패(%s, %s): %s', host, symbol, e)
                continue
            if not resp.ok:
                log.warning('Yahoo chart 오류 응답(%s, %s): HTTP %d', host, symbol, resp.status_code)
                continue
            try:
                quote = _normalize_yahoo_chart(symbol, resp.json())
            except ValueError:
                log.warning('Yahoo chart 응답 파싱 실패(%s, %s)', host, symbol)
                continue
            if quote and quote.get('symbol') and quote.get('price') is not None:
                quotes.append(quote)
                break
    return quotes

def _fetch_yahoo_search_quotes(symbols):
    quotes = []
    for symbol in symbols:
        try:
            resp = requests.get(
                'https://query1.finance.yahoo.com/v1/finance/search',
                params={'q': symbol, 'quotesCount': 6, 'newsCount': 0, 'lang': 'en-US', 'region': 'US'},
                headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
                timeout=10,
            )
        except requests.RequestException as e:
            log.warning('Yahoo search 조회 실패(%s): %s', symbol, e)
            continue
        if not resp.ok:
            log.warning('Yahoo search 오류 응답(%s): HTTP %d', symbol, resp.status_code)
            continue
        try:
            items = resp.json().get('quotes') or []
        except ValueError:
            continue
        match = None
        for item in items:
            item_symbol = str(item.get('symbol') or '').upper()
            if item_symbol == symbol or item_symbol.replace('.', '-') == symbol:
                match = item
                break
        if not match:
            continue
        quote = _normalize_yahoo_quote(match)
        if quote.get('price') is not None:
            quote['symbol'] = symbol
            quotes.append(quote)
            continue
        chart_quotes = _fetch_yahoo_chart_quotes([match.get('symbol') or symbol])
        if chart_quotes:
            chart_quotes[0]['symbol'] = symbol
            quotes.append(chart_quotes[0])
    return quotes

def _fetch_coingecko_crypto_quotes(symbols):
    crypto_symbols = [sym for sym in symbols if sym in _COINGECKO_IDS]
    if not crypto_symbols:
        return []
    ids = [_COINGECKO_IDS[sym] for sym in crypto_symbols]
    try:
        resp = requests.get(
            'https://api.coingecko.com/api/v3/simple/price',
            params={
                'ids': ','.join(ids),
                'vs_currencies': 'usd',
                'include_24hr_change': 'true',
            },
            headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
            timeout=10,
        )
    except requests.RequestException as e:
        log.warning('CoinGecko quote 조회 실패: %s', e)
        return []
    if not resp.ok:
        log.warning('CoinGecko quote 오류 응답: HTTP %d', resp.status_code)
        return []
    try:
        data = resp.json()
    except ValueError:
        return []
    quotes = []
    reverse = {v: k for k, v in _COINGECKO_IDS.items()}
    for coin_id, row in data.items():
        symbol = reverse.get(coin_id)
        price = row.get('usd')
        if not symbol or price is None:
            continue
        quotes.append({
            'symbol': symbol,
            'name': symbol.replace('-USD', ''),
            'price': price,
            'change': None,
            'changePercent': row.get('usd_24h_change'),
            'previousClose': None,
            'currency': 'USD',
            'marketState': 'CRYPTO',
            'marketTime': None,
        })
    return quotes

def _stooq_symbol(symbol: str) -> str:
    sym = str(symbol or '').strip().lower()
    if not sym or sym.startswith('^') or '-' in sym or '=' in sym:
        return ''
    if '.' in sym:
        return sym
    return f'{sym}.us'

def _fetch_stooq_quotes(symbols):
    stooq_map = {symbol: _stooq_symbol(symbol) for symbol in symbols}
    stooq_symbols = [sym for sym in stooq_map.values() if sym]
    if not stooq_symbols:
        return []
    try:
        resp = requests.get(
            'https://stooq.com/q/l/',
            params={'s': ','.join(stooq_symbols), 'f': 'sd2t2ohlcvn', 'h': '', 'e': 'csv'},
            headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
            timeout=10,
        )
    except requests.RequestException as e:
        log.warning('Stooq quote 조회 실패: %s', e)
        return []
    if not resp.ok:
        log.warning('Stooq quote 오류 응답: HTTP %d', resp.status_code)
        return []
    lines = [line for line in resp.text.splitlines() if line.strip()]
    if len(lines) < 2:
        return []
    import csv
    rows = csv.DictReader(lines)
    reverse = {v.upper(): k for k, v in stooq_map.items() if v}
    quotes = []
    for row in rows:
        raw_symbol = str(row.get('Symbol') or '').upper()
        requested = reverse.get(raw_symbol)
        close = row.get('Close')
        if not requested or not close or str(close).upper() == 'N/D':
            continue
        try:
            price = float(close)
            previous = float(row.get('Open') or 0) or None
        except (TypeError, ValueError):
            continue
        change_percent = ((price - previous) / previous) * 100 if previous else None
        quotes.append({
            'symbol': requested,
            'name': row.get('Name') or requested,
            'price': price,
            'change': price - previous if previous else None,
            'changePercent': change_percent,
            'previousClose': previous,
            'currency': 'USD',
            'marketState': 'REGULAR',
            'marketTime': None,
        })
    return quotes

def _fetch_stockanalysis_quotes(symbols):
    stock_symbols = [
        sym for sym in symbols
        if sym and not sym.startswith('^') and '-' not in sym and '=' not in sym and _MARKET_SYMBOL_RE.match(sym)
    ]
    quotes = []
    for symbol in stock_symbols:
        try:
            resp = requests.get(
                f'https://stockanalysis.com/stocks/{symbol.lower()}/',
                headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
                timeout=10,
            )
        except requests.RequestException as e:
            log.warning('StockAnalysis quote 조회 실패(%s): %s', symbol, e)
            continue
        if not resp.ok:
            log.warning('StockAnalysis quote 오류 응답(%s): HTTP %d', symbol, resp.status_code)
            continue
        import html as html_lib
        text = html_lib.unescape(re.sub(r'<[^>]+>', '\n', resp.text))
        lines = [re.sub(r'\s+', ' ', line).strip() for line in text.splitlines()]
        lines = [line for line in lines if line]
        price = None
        change_percent = None
        previous = None
        name = symbol
        for idx, line in enumerate(lines):
            if f': {symbol}' in line.upper() or line.upper().endswith(f'({symbol})'):
                if idx > 0 and len(lines[idx - 1]) <= 80:
                    name = lines[idx - 1]
                for candidate in lines[idx + 1:idx + 8]:
                    if re.fullmatch(r'\d+(?:,\d{3})*(?:\.\d+)?', candidate):
                        price = float(candidate.replace(',', ''))
                        break
                break
        for line in lines:
            if line.startswith('Previous Close'):
                match = re.search(r'(\d+(?:,\d{3})*(?:\.\d+)?)', line)
                if match:
                    previous = float(match.group(1).replace(',', ''))
                    break
        for line in lines:
            match = re.search(r'([+-]?\d+(?:\.\d+)?)%', line)
            if match:
                change_percent = float(match.group(1))
                break
        if price is None:
            continue
        quotes.append({
            'symbol': symbol,
            'name': name,
            'price': price,
            'change': price - previous if previous else None,
            'changePercent': change_percent,
            'previousClose': previous,
            'currency': 'USD',
            'marketState': 'REGULAR',
            'marketTime': None,
        })
    return quotes

@app.route('/api/market/quote', methods=['GET'])
@require_auth
def market_quote():
    try:
        symbols = _parse_market_symbols(request.args.get('symbols', ''))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    quotes = []
    source = 'yahoo-finance'
    try:
        resp = requests.get(
            'https://query1.finance.yahoo.com/v7/finance/quote',
            params={'symbols': ','.join(symbols)},
            headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
            timeout=10,
        )
    except requests.Timeout:
        log.warning('Yahoo quote 요청 타임아웃, chart fallback 시도')
        resp = None
    except requests.RequestException as e:
        log.warning('Yahoo quote 요청 실패, chart fallback 시도: %s', e)
        resp = None

    if resp is not None and resp.ok:
        try:
            body = resp.json()
            items = body.get('quoteResponse', {}).get('result', [])
            quotes = [_normalize_yahoo_quote(item) for item in items if item.get('symbol')]
        except ValueError:
            log.warning('Yahoo quote 응답 파싱 실패, chart fallback 시도')
    elif resp is not None:
        log.warning('Yahoo quote 오류 응답, chart fallback 시도: HTTP %d', resp.status_code)

    found = {str(q.get('symbol', '')).upper() for q in quotes}
    missing = [sym for sym in symbols if sym not in found]
    if missing:
        fallback_quotes = _fetch_yahoo_chart_quotes(missing)
        if fallback_quotes:
            source = 'yahoo-chart' if not quotes else 'yahoo-finance+chart'
            quotes.extend(fallback_quotes)
            found = {str(q.get('symbol', '')).upper() for q in quotes}
            missing = [sym for sym in symbols if sym not in found]

    if missing:
        search_quotes = _fetch_yahoo_search_quotes(missing)
        if search_quotes:
            source = 'yahoo-search' if not quotes else f'{source}+search'
            quotes.extend(search_quotes)
            found = {str(q.get('symbol', '')).upper() for q in quotes}
            missing = [sym for sym in symbols if sym not in found]

    if missing:
        crypto_quotes = _fetch_coingecko_crypto_quotes(missing)
        if crypto_quotes:
            source = 'coingecko' if not quotes else f'{source}+coingecko'
            quotes.extend(crypto_quotes)
            found = {str(q.get('symbol', '')).upper() for q in quotes}
            missing = [sym for sym in symbols if sym not in found]

    if missing:
        stooq_quotes = _fetch_stooq_quotes(missing)
        if stooq_quotes:
            source = 'stooq' if not quotes else f'{source}+stooq'
            quotes.extend(stooq_quotes)
            found = {str(q.get('symbol', '')).upper() for q in quotes}
            missing = [sym for sym in symbols if sym not in found]

    if missing:
        stockanalysis_quotes = _fetch_stockanalysis_quotes(missing)
        if stockanalysis_quotes:
            source = 'stockanalysis' if not quotes else f'{source}+stockanalysis'
            quotes.extend(stockanalysis_quotes)
            found = {str(q.get('symbol', '')).upper() for q in quotes}
            missing = [sym for sym in symbols if sym not in found]

    if not quotes:
        return jsonify({'error': '시장 데이터 조회 실패', 'requested': symbols}), 502

    return jsonify({
        'source': source,
        'requested': symbols,
        'missing': missing,
        'fetchedAt': int(time.time()),
        'quotes': quotes,
    })

_NEWS_SOURCE_RANK = {
    'sec-edgar': 100,
    'company-ir': 95,
    'benzinga': 88,
    'polygon': 84,
    'alpha-vantage': 80,
    'finnhub': 76,
    'yahoo-finance-rss': 58,
    'google-news-rss': 52,
}

def _news_item(symbol, title, link='', published='', summary='', source='unknown', kind='news', sentiment=None, publisher=None):
    title = (title or '').strip()
    if not title:
        return None
    return {
        'symbol': symbol,
        'title': title,
        'link': (link or '').strip(),
        'published': (published or '').strip(),
        'summary': re.sub(r'<[^>]+>', '', summary or '').strip(),
        'source': source,
        'publisher': (publisher or '').strip(),
        'kind': kind,
        'sentiment': sentiment,
        'rank': _NEWS_SOURCE_RANK.get(source, 40),
    }

def _dedupe_news(items):
    seen = set()
    out = []
    for item in sorted([i for i in items if i], key=lambda x: x.get('rank', 0), reverse=True):
        key = (item.get('link') or item.get('title') or '').strip().lower()
        key = re.sub(r'\?.*$', '', key)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out

def _normalize_rss_item(item, symbol: str, source: str):
    def text(tag):
        found = item.find(tag)
        return (found.text or '').strip() if found is not None else ''

    title = text('title')
    publisher = ''
    if source == 'google-news-rss':
        match = re.match(r'(.+?)\s+-\s+([^-]+)$', title)
        if match:
            title = match.group(1).strip()
            publisher = match.group(2).strip()

    return _news_item(
        symbol=symbol,
        title=title,
        link=text('link'),
        published=text('pubDate'),
        summary=text('description'),
        source=source,
        publisher=publisher,
        kind='news',
    )

def _fetch_yahoo_rss_news(symbol: str, limit: int):
    resp = requests.get(
        'https://feeds.finance.yahoo.com/rss/2.0/headline',
        params={'s': symbol, 'region': 'US', 'lang': 'en-US'},
        headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
        timeout=10,
    )
    if not resp.ok:
        log.warning('Yahoo 뉴스 오류 응답(%s): HTTP %d', symbol, resp.status_code)
        return []
    root = ET.fromstring(resp.content)
    items = root.findall('./channel/item')
    return [_normalize_rss_item(item, symbol, 'yahoo-finance-rss') for item in items][:limit]

def _fetch_google_rss_news(symbol: str, limit: int):
    resp = requests.get(
        'https://news.google.com/rss/search',
        params={'q': f'{symbol} stock OR earnings OR shares', 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'},
        headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
        timeout=10,
    )
    if not resp.ok:
        log.warning('Google 뉴스 오류 응답(%s): HTTP %d', symbol, resp.status_code)
        return []
    root = ET.fromstring(resp.content)
    items = root.findall('./channel/item')
    return [_normalize_rss_item(item, symbol, 'google-news-rss') for item in items][:limit]

def _fetch_google_rss_query_news(query: str, limit: int):
    resp = requests.get(
        'https://news.google.com/rss/search',
        params={'q': query, 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'},
        headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
        timeout=10,
    )
    if not resp.ok:
        log.warning('Google general news error (%s): HTTP %d', query, resp.status_code)
        return []
    root = ET.fromstring(resp.content)
    items = root.findall('./channel/item')
    out = []
    for item in items[:limit]:
        normalized = _normalize_rss_item(item, query, 'google-news-rss')
        if normalized:
            normalized['kind'] = 'general-news'
            normalized['topic'] = query
            out.append(normalized)
    return out

def _fetch_polygon_news(symbol: str, limit: int):
    if not POLYGON_API_KEY:
        return []
    resp = requests.get(
        'https://api.polygon.io/v2/reference/news',
        params={'ticker': symbol, 'limit': limit, 'order': 'desc', 'apiKey': POLYGON_API_KEY},
        headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
        timeout=10,
    )
    if not resp.ok:
        log.warning('Polygon 뉴스 오류 응답(%s): HTTP %d', symbol, resp.status_code)
        return []
    rows = resp.json().get('results', [])
    return [_news_item(
        symbol=symbol,
        title=row.get('title'),
        link=row.get('article_url') or row.get('amp_url'),
        published=row.get('published_utc'),
        summary=row.get('description') or '',
        source='polygon',
        kind='news',
        sentiment=(row.get('insights') or [{}])[0].get('sentiment') if row.get('insights') else None,
    ) for row in rows[:limit]]

def _fetch_alpha_vantage_news(symbol: str, limit: int):
    if not ALPHA_VANTAGE_API_KEY:
        return []
    resp = requests.get(
        'https://www.alphavantage.co/query',
        params={'function': 'NEWS_SENTIMENT', 'tickers': symbol, 'limit': limit, 'apikey': ALPHA_VANTAGE_API_KEY},
        headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
        timeout=10,
    )
    if not resp.ok:
        log.warning('Alpha Vantage 뉴스 오류 응답(%s): HTTP %d', symbol, resp.status_code)
        return []
    rows = resp.json().get('feed', [])
    return [_news_item(
        symbol=symbol,
        title=row.get('title'),
        link=row.get('url'),
        published=row.get('time_published'),
        summary=row.get('summary') or '',
        source='alpha-vantage',
        kind='news',
        sentiment=row.get('overall_sentiment_label'),
    ) for row in rows[:limit]]

def _fetch_finnhub_news(symbol: str, limit: int):
    if not FINNHUB_API_KEY:
        return []
    today = time.strftime('%Y-%m-%d')
    resp = requests.get(
        'https://finnhub.io/api/v1/company-news',
        params={'symbol': symbol, 'from': today, 'to': today, 'token': FINNHUB_API_KEY},
        headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
        timeout=10,
    )
    if not resp.ok:
        log.warning('Finnhub 뉴스 오류 응답(%s): HTTP %d', symbol, resp.status_code)
        return []
    return [_news_item(
        symbol=symbol,
        title=row.get('headline'),
        link=row.get('url'),
        published=str(row.get('datetime') or ''),
        summary=row.get('summary') or '',
        source='finnhub',
        kind='news',
    ) for row in resp.json()[:limit]]

def _fetch_benzinga_news(symbol: str, limit: int):
    if not BENZINGA_API_KEY:
        return []
    resp = requests.get(
        'https://api.benzinga.com/api/v2/news',
        params={'token': BENZINGA_API_KEY, 'tickers': symbol, 'pagesize': limit, 'displayOutput': 'full'},
        headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
        timeout=10,
    )
    if not resp.ok:
        log.warning('Benzinga 뉴스 오류 응답(%s): HTTP %d', symbol, resp.status_code)
        return []
    return [_news_item(
        symbol=symbol,
        title=row.get('title'),
        link=row.get('url'),
        published=row.get('created') or '',
        summary=row.get('teaser') or row.get('body') or '',
        source='benzinga',
        kind='news',
    ) for row in resp.json()[:limit]]

def _fetch_sec_filings(symbol: str, limit: int):
    headers = {'User-Agent': SEC_USER_AGENT, 'Accept-Encoding': 'gzip, deflate'}
    tickers_resp = requests.get(
        'https://www.sec.gov/files/company_tickers.json',
        headers=headers,
        timeout=10,
    )
    if not tickers_resp.ok:
        log.warning('SEC ticker map 오류 응답(%s): HTTP %d', symbol, tickers_resp.status_code)
        return []
    symbol_upper = symbol.upper()
    match = None
    for row in tickers_resp.json().values():
        if str(row.get('ticker', '')).upper() == symbol_upper:
            match = row
            break
    if not match:
        return []
    cik = str(match.get('cik_str')).zfill(10)
    sub_resp = requests.get(
        f'https://data.sec.gov/submissions/CIK{cik}.json',
        headers=headers,
        timeout=10,
    )
    if not sub_resp.ok:
        log.warning('SEC submissions 오류 응답(%s): HTTP %d', symbol, sub_resp.status_code)
        return []
    recent = sub_resp.json().get('filings', {}).get('recent', {})
    forms = recent.get('form', [])
    dates = recent.get('filingDate', [])
    accession = recent.get('accessionNumber', [])
    primary_docs = recent.get('primaryDocument', [])
    company = match.get('title') or symbol
    items = []
    for idx, form in enumerate(forms[:limit]):
        acc = accession[idx].replace('-', '') if idx < len(accession) else ''
        doc = primary_docs[idx] if idx < len(primary_docs) else ''
        link = f'https://www.sec.gov/Archives/edgar/data/{int(match.get("cik_str"))}/{acc}/{doc}' if acc and doc else ''
        items.append(_news_item(
            symbol=symbol,
            title=f'{company} SEC {form} filing',
            link=link,
            published=dates[idx] if idx < len(dates) else '',
            summary='SEC EDGAR official filing. Treat this as source material, not market commentary.',
            source='sec-edgar',
            kind='filing',
        ))
    return items

def _fetch_news_for_symbol(symbol: str, limit: int):
    providers = [
        _fetch_sec_filings,
        _fetch_benzinga_news,
        _fetch_polygon_news,
        _fetch_alpha_vantage_news,
        _fetch_finnhub_news,
        _fetch_yahoo_rss_news,
        _fetch_google_rss_news,
    ]
    items = []
    for provider in providers:
        try:
            items.extend(provider(symbol, limit))
        except (requests.RequestException, ET.ParseError, ValueError, TypeError) as e:
            log.warning('뉴스 provider 실패(%s, %s): %s', provider.__name__, symbol, e)
    return _dedupe_news(items)[:limit]

@app.route('/api/investment/news', methods=['GET'])
@require_auth
def investment_news():
    raw_symbols = request.args.get('symbols', '')
    raw_query = request.args.get('query', '')
    try:
        symbols = _parse_market_symbols(raw_symbols) if raw_symbols.strip() else []
        queries = _parse_news_queries(raw_query)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not symbols and not queries:
        return jsonify({'error': 'symbols or query parameter is required'}), 400

    limit = request.args.get('limit', '5')
    try:
        per_symbol_limit = max(1, min(10, int(limit)))
    except ValueError:
        per_symbol_limit = 5

    news = []
    for symbol in symbols:
        news.extend(_fetch_news_for_symbol(symbol, per_symbol_limit))
    for query in queries:
        try:
            news.extend(_fetch_google_rss_query_news(query, per_symbol_limit))
        except (requests.RequestException, ET.ParseError, ValueError, TypeError) as e:
            log.warning('general news provider failed(%s): %s', query, e)
    news = _dedupe_news(news)

    return jsonify({
        'source': 'aggregated-investment-news',
        'requested': symbols,
        'requestedQueries': queries,
        'fetchedAt': int(time.time()),
        'providers': {
            'sec_edgar': True,
            'benzinga': bool(BENZINGA_API_KEY),
            'polygon': bool(POLYGON_API_KEY),
            'alpha_vantage': bool(ALPHA_VANTAGE_API_KEY),
            'finnhub': bool(FINNHUB_API_KEY),
            'yahoo_finance_rss': True,
            'google_news_rss': True,
        },
        'news': news,
    })

# ---------------------------------------------------------------------------
# PII 스크러빙 — AI 호출 전 개인식별정보 마스킹
# ---------------------------------------------------------------------------

# 마스킹 패턴 (한국 기준)
_PII_PATTERNS = [
    # 주민등록번호: 000000-0000000
    (re.compile(r'\d{6}-[1-4]\d{6}'), '[주민번호]'),
    # 전화번호: 010-0000-0000, 010 0000 0000, 01000000000
    (re.compile(r'01[016789][-\s]?\d{3,4}[-\s]?\d{4}'), '[전화번호]'),
    # 일반 전화: 02-0000-0000, 031-000-0000 등
    (re.compile(r'0\d{1,2}[-\s]\d{3,4}[-\s]\d{4}'), '[전화번호]'),
    # 이메일
    (re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}'), '[이메일]'),
    # 학교명 + 학생 실명 패턴 방어: "홍길동 학생" 형식은 alias로 대체하도록 프롬프트에서 처리
]

def _scrub_pii(text: str) -> str:
    """텍스트에서 개인식별정보 패턴을 마스킹한다."""
    if not isinstance(text, str):
        return text
    urls = []

    def keep_url(match):
        urls.append(match.group(0))
        return f'__URL_{len(urls) - 1}__'

    text = re.sub(r'https?://[^\s)\]]+', keep_url, text)
    for pattern, replacement in _PII_PATTERNS:
        text = pattern.sub(replacement, text)
    for idx, url in enumerate(urls):
        text = text.replace(f'__URL_{idx}__', url)
    return text

def _scrub_payload(payload: dict) -> dict:
    """AI 요청 페이로드의 모든 텍스트 필드에 PII 스크러빙 적용."""
    if not isinstance(payload, dict):
        return payload

    result = dict(payload)

    # system 프롬프트 스크러빙
    if isinstance(result.get('system'), str):
        result['system'] = _scrub_pii(result['system'])
    elif isinstance(result.get('system'), list):
        result['system'] = [
            {**item, 'text': _scrub_pii(item['text'])}
            if isinstance(item, dict) and 'text' in item else item
            for item in result['system']
        ]

    # messages 배열 스크러빙
    if isinstance(result.get('messages'), list):
        scrubbed_messages = []
        for msg in result['messages']:
            if not isinstance(msg, dict):
                scrubbed_messages.append(msg)
                continue
            content = msg.get('content')
            if isinstance(content, str):
                scrubbed_messages.append({**msg, 'content': _scrub_pii(content)})
            elif isinstance(content, list):
                new_content = [
                    {**blk, 'text': _scrub_pii(blk['text'])}
                    if isinstance(blk, dict) and 'text' in blk else blk
                    for blk in content
                ]
                scrubbed_messages.append({**msg, 'content': new_content})
            else:
                scrubbed_messages.append(msg)
        result['messages'] = scrubbed_messages

    return result

def _anthropic_payload_stats(payload: dict) -> dict:
    """Return compact diagnostics for AI proxy logging without leaking content."""
    if not isinstance(payload, dict):
        return {}
    system = payload.get('system')
    if isinstance(system, str):
        system_chars = len(system)
        system_blocks = 1
    elif isinstance(system, list):
        system_chars = sum(len(str(item.get('text') or '')) for item in system if isinstance(item, dict))
        system_blocks = len(system)
    else:
        system_chars = 0
        system_blocks = 0
    messages = payload.get('messages') if isinstance(payload.get('messages'), list) else []
    message_chars = 0
    roles = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        roles.append(str(msg.get('role') or '?'))
        content = msg.get('content')
        if isinstance(content, str):
            message_chars += len(content)
        elif isinstance(content, list):
            message_chars += sum(len(str(block.get('text') or '')) for block in content if isinstance(block, dict))
    return {
        'systemBlocks': system_blocks,
        'systemChars': system_chars,
        'messageCount': len(messages),
        'messageChars': message_chars,
        'rolesTail': roles[-6:],
    }

def _anthropic_api_payload(payload: dict) -> dict:
    """Drop local-only diagnostics before forwarding to Anthropic."""
    allowed = {'model', 'max_tokens', 'messages', 'system', 'metadata', 'stop_sequences', 'temperature', 'top_k', 'top_p', 'tools', 'tool_choice', 'stream'}
    return {key: value for key, value in dict(payload or {}).items() if key in allowed}

def _anthropic_error_text(resp) -> str:
    try:
        return (resp.text or '')[:1200]
    except Exception:
        return ''

def _should_retry_anthropic_model(resp, body: str) -> bool:
    if resp.status_code != 400 or not ANTHROPIC_FALLBACK_MODEL:
        return False
    lowered = (body or '').lower()
    return 'model' in lowered and ('not found' in lowered or 'invalid' in lowered or 'does not exist' in lowered)

def _is_anthropic_credit_error(body: str) -> bool:
    lowered = (body or '').lower()
    return 'credit balance' in lowered or 'insufficient credit' in lowered or 'billing' in lowered

def _should_fallback_to_openai(resp, body: str, use_stream: bool) -> bool:
    if use_stream or not OPENAI_API_KEY:
        return False
    if _is_anthropic_credit_error(body):
        return True
    return resp.status_code in {402, 429, 529}

# ---------------------------------------------------------------------------
# 축어록 요약 엔드포인트 (긴 축어록 2단계 처리용)
# ---------------------------------------------------------------------------

LONG_VERBATIM_THRESHOLD = 3000  # JS 와 동일한 기준

@app.route('/api/summarize-verbatim', methods=['POST'])
@require_auth
def summarize_verbatim():
    """
    긴 축어록을 임상 핵심 요약으로 압축.
    - verbatim 이 3000자 미만이면 skip:true 반환 (AI 호출 없음)
    - 3000자 이상이면 Anthropic API 로 요약 생성
    """
    payload = request.get_json()
    if not payload or 'verbatim' not in payload:
        return jsonify({'error': 'verbatim 필드가 필요합니다'}), 400

    verbatim = payload['verbatim']
    student  = payload.get('student', {})

    if len(verbatim) < LONG_VERBATIM_THRESHOLD:
        return jsonify({'skip': True, 'reason': f'축어록이 {LONG_VERBATIM_THRESHOLD}자 미만입니다'})

    if not ANTHROPIC_API_KEY:
        return jsonify({'error': 'ANTHROPIC_API_KEY가 없습니다'}), 500

    alias     = student.get('alias', '내담자')
    grade     = student.get('grade', '')
    session_num = payload.get('sessionNum', '')

    prompt = f"""당신은 학교상담 임상 슈퍼바이저입니다.
아래 축어록({len(verbatim)}자)에서 슈퍼비전에 필요한 핵심만 추출하세요.

【내담 학생 (익명)】 {alias} ({grade})

【축어록】
{verbatim}

아래 항목을 800자 이내 산문으로 추출하세요:
1. 내담자 감정 흐름 (시작 → 전환점 → 마지막)
2. 상담자 주요 개입 3-5개 (발화 인용 포함)
3. 가장 임상적으로 의미 있는 순간 1개
4. 미완결된 주제 또는 저항 순간

텍스트만 반환 (JSON 아님)."""

    ai_payload = {
        'model': 'claude-sonnet-4-6',
        'max_tokens': 600,
        'messages': [{'role': 'user', 'content': prompt}],
    }
    ai_payload = _scrub_payload(ai_payload)

    log.info('축어록 요약 요청: %d자 → AI 호출', len(verbatim))
    try:
        resp = requests.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
            },
            json=ai_payload,
            timeout=60,
        )
    except requests.Timeout:
        log.error('축어록 요약 AI 호출 타임아웃 (60초)')
        return jsonify({'error': 'AI 요청 타임아웃'}), 504
    except requests.RequestException as e:
        log.error('축어록 요약 AI 네트워크 오류: %s', e, exc_info=True)
        return jsonify({'error': f'네트워크 오류: {e}'}), 502

    if not resp.ok:
        log.warning('축어록 요약 AI 오류 응답: HTTP %d', resp.status_code)
        return jsonify({'error': f'AI 오류: {resp.status_code}', 'detail': resp.text[:200]}), 502

    try:
        data    = resp.json()
        summary = ''.join(c.get('text', '') for c in data.get('content', []))
        if not summary.strip():
            log.warning('축어록 요약 AI 응답이 비어 있음')
            return jsonify({'error': 'AI 응답이 비어 있습니다'}), 502
        log.info('축어록 요약 완료: %d자', len(summary))
        return jsonify({'summary': summary.strip()})
    except Exception as e:
        log.error('축어록 요약 응답 파싱 실패: %s', e, exc_info=True)
        return jsonify({'error': f'응답 파싱 실패: {str(e)}'}), 502


# ---------------------------------------------------------------------------
# Anthropic API 프록시
# ---------------------------------------------------------------------------

def _system_to_text(system):
    if isinstance(system, str):
        return system
    if isinstance(system, list):
        return '\n\n'.join(
            str(item.get('text') or '')
            for item in system
            if isinstance(item, dict)
        ).strip()
    return ''

def _messages_for_openai(messages):
    out = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        role = msg.get('role')
        mapped_role = 'assistant' if role == 'assistant' else 'user'
        content = msg.get('content', '')
        if isinstance(content, list):
            content = '\n'.join(
                str(part.get('text') or '')
                for part in content
                if isinstance(part, dict)
            )
        out.append({'role': mapped_role, 'content': str(content)})
    return out

def _extract_anthropic_text(data):
    return ''.join(c.get('text', '') for c in data.get('content', []) if isinstance(c, dict)).strip()

def _extract_openai_text(data):
    choices = data.get('choices') or []
    if not choices:
        return ''
    msg = choices[0].get('message') or {}
    return str(msg.get('content') or '').strip()

def _call_anthropic_for_compare(payload):
    if not ANTHROPIC_API_KEY:
        return {'ok': False, 'provider': 'claude', 'error': 'ANTHROPIC_API_KEY missing'}
    clean = _scrub_payload({
        'model': payload.get('claudeModel') or payload.get('model') or 'claude-sonnet-4-6',
        'max_tokens': int(payload.get('max_tokens') or 700),
        'system': payload.get('system') or [],
        'messages': payload.get('messages') or [],
    })
    resp = requests.post(
        'https://api.anthropic.com/v1/messages',
        headers={
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'prompt-caching-2024-07-31',
            'Content-Type': 'application/json',
        },
        json=clean,
        timeout=90,
    )
    if not resp.ok:
        return {'ok': False, 'provider': 'claude', 'status': resp.status_code, 'error': resp.text[:300]}
    data = resp.json()
    return {'ok': True, 'provider': 'claude', 'model': clean['model'], 'text': _extract_anthropic_text(data)}

def _call_openai_for_compare(payload):
    if not OPENAI_API_KEY:
        return {'ok': False, 'provider': 'openai', 'error': 'OPENAI_API_KEY missing'}
    system_text = _system_to_text(payload.get('system') or '')
    messages = _messages_for_openai(payload.get('messages') or [])
    if system_text:
        messages = [{'role': 'system', 'content': system_text}] + messages
    clean = _scrub_payload({
        'model': payload.get('openaiModel') or OPENAI_MODEL,
        'messages': messages,
        'max_tokens': int(payload.get('max_tokens') or 700),
    })
    resp = requests.post(
        'https://api.openai.com/v1/chat/completions',
        headers={
            'Authorization': f'Bearer {OPENAI_API_KEY}',
            'Content-Type': 'application/json',
        },
        json=clean,
        timeout=90,
    )
    if not resp.ok:
        return {'ok': False, 'provider': 'openai', 'status': resp.status_code, 'error': resp.text[:300]}
    data = resp.json()
    return {'ok': True, 'provider': 'openai', 'model': clean['model'], 'text': _extract_openai_text(data)}

@app.route('/api/investment/ai-compare', methods=['POST'])
@require_auth
def investment_ai_compare():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid payload'}), 400
    messages = payload.get('messages') or []
    if not isinstance(messages, list) or not messages:
        return jsonify({'error': 'messages required'}), 400

    payload = _scrub_payload(payload)
    results = []
    for caller in (_call_anthropic_for_compare, _call_openai_for_compare):
        provider = 'claude' if caller == _call_anthropic_for_compare else 'openai'
        try:
            results.append(caller(payload))
        except requests.Timeout:
            results.append({'ok': False, 'provider': provider, 'error': 'timeout'})
        except requests.RequestException as e:
            results.append({'ok': False, 'provider': provider, 'error': str(e)[:300]})

    return jsonify({
        'ok': any(r.get('ok') for r in results),
        'mode': 'investment-ai-compare',
        'results': results,
    })
@app.route('/api/analyze', methods=['POST'])
@require_auth
def analyze():
    request_id = f"ai-{int(time.time() * 1000)}"
    if not ANTHROPIC_API_KEY:
        log.error('POST /api/analyze [%s] ANTHROPIC_API_KEY 없음 — AI 기능 불가', request_id)
        return jsonify({'error': 'ANTHROPIC_API_KEY가 ecrk.env에 없습니다', 'requestId': request_id}), 500

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        log.warning('POST /api/analyze [%s]: 유효하지 않은 페이로드', request_id)
        return jsonify({'error': '유효하지 않은 요청 형식', 'requestId': request_id}), 400

    use_stream = payload.get('stream', False)
    client_request_id = str(payload.get('clientRequestId') or request.headers.get('X-Client-Request-Id') or '')
    model      = payload.get('model', '?')
    max_tok    = payload.get('max_tokens', '?')
    stats      = _anthropic_payload_stats(payload)
    log.info('POST /api/analyze [%s] request client=%s model=%s max_tokens=%s stream=%s stats=%s',
             request_id, client_request_id or '-', model, max_tok, use_stream, stats)

    # AI 호출 전 PII 스크러빙
    payload = _anthropic_api_payload(_scrub_payload(payload))

    try:
        resp = requests.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'prompt-caching-2024-07-31',
                'Content-Type': 'application/json',
            },
            json=payload,
            timeout=120,
            stream=use_stream,
        )
    except requests.Timeout:
        log.error('POST /api/analyze [%s] AI 호출 타임아웃 (120초)', request_id)
        return jsonify({'error': 'AI 요청 타임아웃 (120초)', 'requestId': request_id}), 504
    except requests.RequestException as e:
        log.error('POST /api/analyze [%s] AI 네트워크 오류: %s', request_id, e, exc_info=True)
        return jsonify({'error': f'네트워크 오류: {e}', 'requestId': request_id, 'errorDetail': _safe_error_detail(e)}), 502

    if not resp.ok:
        error_body = _anthropic_error_text(resp)
        log.warning('POST /api/analyze [%s] AI 오류 응답: HTTP %d model=%s body=%s',
                    request_id, resp.status_code, payload.get('model'), error_body)
        if _should_retry_anthropic_model(resp, error_body) and payload.get('model') != ANTHROPIC_FALLBACK_MODEL:
            retry_payload = {**payload, 'model': ANTHROPIC_FALLBACK_MODEL}
            log.warning('POST /api/analyze [%s] retrying with fallback model=%s', request_id, ANTHROPIC_FALLBACK_MODEL)
            try:
                resp = requests.post(
                    'https://api.anthropic.com/v1/messages',
                    headers={
                        'x-api-key': ANTHROPIC_API_KEY,
                        'anthropic-version': '2023-06-01',
                        'anthropic-beta': 'prompt-caching-2024-07-31',
                        'Content-Type': 'application/json',
                    },
                    json=retry_payload,
                    timeout=120,
                    stream=use_stream,
                )
                if not resp.ok:
                    error_body = _anthropic_error_text(resp)
                    log.warning('POST /api/analyze [%s] fallback AI 오류 응답: HTTP %d model=%s body=%s',
                                request_id, resp.status_code, retry_payload.get('model'), error_body)
            except requests.Timeout:
                log.error('POST /api/analyze [%s] fallback AI 호출 타임아웃 (120초)', request_id)
                return jsonify({'error': 'AI 요청 타임아웃 (120초)', 'requestId': request_id}), 504
            except requests.RequestException as e:
                log.error('POST /api/analyze [%s] fallback AI 네트워크 오류: %s', request_id, e, exc_info=True)
                return jsonify({'error': f'네트워크 오류: {e}', 'requestId': request_id, 'errorDetail': _safe_error_detail(e)}), 502
        if not resp.ok and _should_fallback_to_openai(resp, error_body, use_stream):
            log.warning('POST /api/analyze [%s] Anthropic unavailable, trying OpenAI fallback. status=%d reason=%s',
                        request_id, resp.status_code, 'credit' if _is_anthropic_credit_error(error_body) else 'provider')
            openai_result = _call_openai_for_compare({
                'system': payload.get('system') or [],
                'messages': payload.get('messages') or [],
                'max_tokens': payload.get('max_tokens') or 700,
                'openaiModel': OPENAI_MODEL,
            })
            if openai_result.get('ok') and openai_result.get('text'):
                log.info('POST /api/analyze [%s] OpenAI fallback complete model=%s chars=%d',
                         request_id, openai_result.get('model'), len(openai_result.get('text') or ''))
                return jsonify({
                    'content': [{'type': 'text', 'text': openai_result['text']}],
                    'provider': 'openai',
                    'model': openai_result.get('model'),
                    'fallbackFrom': 'anthropic',
                    'requestId': request_id,
                }), 200
            log.warning('POST /api/analyze [%s] OpenAI fallback failed: %s',
                        request_id, openai_result.get('error') or openai_result)

    if use_stream:
        log.debug('POST /api/analyze [%s] AI 스트리밍 응답 시작 status=%d', request_id, resp.status_code)
        def generate():
            for chunk in resp.iter_content(chunk_size=None):
                yield chunk
        return Response(
            stream_with_context(generate()),
            status=resp.status_code,
            content_type='text/event-stream',
        )

    log.info('AI 분석 완료: HTTP %d', resp.status_code)
    if not resp.ok:
        return jsonify({
            'error': 'AI provider error',
            'requestId': request_id,
            'status': resp.status_code,
            'model': payload.get('model'),
            'providerReason': 'anthropic_credit' if _is_anthropic_credit_error(_anthropic_error_text(resp)) else 'anthropic_error',
            'errorDetail': _anthropic_error_text(resp),
        }), resp.status_code
    return (resp.content, resp.status_code, {'Content-Type': 'application/json', 'X-Request-Id': request_id})

# ---------------------------------------------------------------------------
# AI 텍스트 변환 (축어록 정리 / 일기 변환)
# ---------------------------------------------------------------------------

@app.route('/api/transform-text', methods=['POST'])
@require_auth
def transform_text():
    """
    mode='verbatim': 상담 축어록 서식 정리 (내용 보존, 화자·문단 정돈)
    mode='diary'   : 대화 블록을 1인칭 일기체로 재구성
    """
    if not ANTHROPIC_API_KEY:
        log.error('ANTHROPIC_API_KEY 없음 — transform-text 불가')
        return jsonify({'error': 'ANTHROPIC_API_KEY가 ecrk.env에 없습니다'}), 500

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': '유효하지 않은 요청 형식'}), 400

    mode = payload.get('mode', 'verbatim')

    if mode == 'verbatim':
        text = (payload.get('text') or '').strip()
        if not text:
            return jsonify({'error': 'text 필드가 필요합니다'}), 400

        prompt = (
            "아래 상담 축어록을 읽기 쉽게 정리해 주세요.\n\n"
            "규칙:\n"
            "- 내용과 발화는 절대 바꾸거나 삭제하지 마세요. 있는 내용 그대로 유지.\n"
            "- 화자 표기를 일관되게 정리하세요 (예: '상담자:', '내담자:')\n"
            "- 문단 구분을 자연스럽게 정리하세요\n"
            "- 명백한 오타만 수정하고, 구어체는 유지하세요\n"
            "- 비언어적 주석([침묵], [눈물] 등)은 그대로 유지하세요\n\n"
            "【원본 축어록】\n"
            f"{text}\n\n"
            "위 축어록을 정리한 결과만 반환하세요. 설명이나 주석 없이 정리된 텍스트만."
        )
        ai_payload = {
            'model':      'claude-sonnet-4-6',
            'max_tokens': 4000,
            'messages':   [{'role': 'user', 'content': prompt}],
        }
        log.info('축어록 정리 요청: %d자', len(text))

    elif mode == 'diary':
        blocks = payload.get('blocks') or []
        if not blocks:
            return jsonify({'error': 'blocks 필드가 필요합니다'}), 400

        blocks_text = '\n'.join(
            f"{b.get('speaker', '')}: {b.get('text', '')}"
            for b in blocks if isinstance(b, dict)
        )
        prompt = (
            "아래 대화 블록을 바탕으로 1인칭 일기체로 재구성해 주세요.\n\n"
            "규칙:\n"
            "- 자연스러운 한국어 일기체로 작성\n"
            "- 감정과 경험을 중심으로 서술\n"
            "- 대화의 핵심 내용을 담되, 말투는 일기처럼 자연스럽게\n"
            "- 존댓말 없이 일반체로 작성\n\n"
            "【대화 블록】\n"
            f"{blocks_text}\n\n"
            "일기 형식의 텍스트만 반환하세요."
        )
        ai_payload = {
            'model':      'claude-sonnet-4-6',
            'max_tokens': 2000,
            'messages':   [{'role': 'user', 'content': prompt}],
        }
        log.info('일기 변환 요청: 블록 %d개', len(blocks))

    else:
        log.warning('transform-text: 알 수 없는 mode=%s', mode)
        return jsonify({'error': f'알 수 없는 mode: {mode}'}), 400

    ai_payload = _scrub_payload(ai_payload)

    try:
        resp = requests.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key':          ANTHROPIC_API_KEY,
                'anthropic-version':  '2023-06-01',
                'Content-Type':       'application/json',
            },
            json=ai_payload,
            timeout=90,
        )
    except requests.Timeout:
        log.error('transform-text AI 호출 타임아웃 (90초)')
        return jsonify({'error': 'AI 요청 타임아웃 (90초)'}), 504
    except requests.RequestException as e:
        log.error('transform-text AI 네트워크 오류: %s', e, exc_info=True)
        return jsonify({'error': f'네트워크 오류: {e}'}), 502

    if not resp.ok:
        log.warning('transform-text AI 오류 응답: HTTP %d', resp.status_code)
        return jsonify({'error': f'AI 오류: {resp.status_code}', 'detail': resp.text[:200]}), 502

    try:
        data   = resp.json()
        result = ''.join(c.get('text', '') for c in data.get('content', []))
        if not result.strip():
            log.warning('transform-text AI 응답이 비어 있음')
            return jsonify({'error': 'AI 응답이 비어 있습니다'}), 502
        log.info('transform-text 완료 (mode=%s): %d자', mode, len(result))
        return jsonify({'result': result.strip()})
    except Exception as e:
        log.error('transform-text 응답 파싱 실패: %s', e, exc_info=True)
        return jsonify({'error': f'응답 파싱 실패: {str(e)}'}), 502


# ---------------------------------------------------------------------------
# 실행
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if not APP_PASSWORD:
        log.warning('APP_PASSWORD가 ecrk.env에 없습니다. 로그인이 불가능합니다.')
    if not ANTHROPIC_API_KEY:
        log.warning('ANTHROPIC_API_KEY가 없습니다. AI 기능이 비활성화됩니다.')
    storage = 'PostgreSQL (Supabase)' if DATABASE_URL else '로컬 data.json'
    log.info('自畵像 서버 시작: http://localhost:5000 | 저장소: %s', storage)
    app.run(port=5000, debug=False)
