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
from functools import wraps
from investment_backend import upsert_position
from flask import (
    Flask, request, jsonify, send_from_directory,
    session, redirect, render_template_string,
    Response, stream_with_context,
)
from dotenv import load_dotenv
from cryptography.fernet import Fernet, InvalidToken

load_dotenv('ecrk.env')
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
APP_PASSWORD      = os.getenv('APP_PASSWORD', '')
DATABASE_URL      = os.getenv('DATABASE_URL', '')
POLYGON_API_KEY   = os.getenv('POLYGON_API_KEY', '')
ALPHA_VANTAGE_API_KEY = os.getenv('ALPHA_VANTAGE_API_KEY', '')
FINNHUB_API_KEY   = os.getenv('FINNHUB_API_KEY', '')
BENZINGA_API_KEY  = os.getenv('BENZINGA_API_KEY', '')
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
            'dailyLossLimit': 3,
            'maxPositionWeight': 30,
            'cooldownMinutes': 30,
            'chaseLimit': 5,
            'strictMode': True,
            'longTermBias': True,
            'antiAveraging': True,
            'coreRules': '',
        },
        'journal': [],
        'events': [],
        'decisions': [],
        'chat': [],
        'market': {
            'indexes': [],
            'fetchedAt': None,
            'source': '',
        },
        'alerts': [],
    }

EMPTY = lambda: {
    'students': [],
    'sessions': [],
    'aiResults': {},
    'my_topics': [],
    'my_records': [],
    'investment': _empty_investment(),
}

def _normalize_data(data: dict) -> dict:
    if not isinstance(data, dict):
        return EMPTY()
    data.setdefault('students', [])
    data.setdefault('sessions', [])
    data.setdefault('aiResults', {})
    data.setdefault('my_topics', [])
    data.setdefault('my_records', [])
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
            'chat': inv.get('chat') if isinstance(inv.get('chat'), list) else [],
            'market': inv.get('market') if isinstance(inv.get('market'), dict) else base['market'],
            'alerts': inv.get('alerts') if isinstance(inv.get('alerts'), list) else [],
        }
    data['investment'] = inv
    return data

def _get_db_conn():
    import psycopg2
    return psycopg2.connect(DATABASE_URL, sslmode='require')

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
            _ensure_table(conn)
            data_type = _storage_data_type(conn)
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
            _ensure_table(conn)
            data_type = _storage_data_type(conn)
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
        write_data(payload)
        return jsonify({'ok': True})
    except Exception as e:
        log.error('POST /api/data 저장 실패: %s', e, exc_info=True)
        return jsonify({'error': '데이터 저장 실패'}), 500

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
        write_data(data)
        after_count = len(inv.get('positions') or [])
        log.info('POST /api/investment/positions [%s] saved symbol=%s id=%s before=%d after=%d', request_id, position.get('symbol'), position.get('id'), before_count, after_count)
        return jsonify({'ok': True, 'investment': inv, 'position': position, 'requestId': request_id})
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

# ---------------------------------------------------------------------------
# 시장 데이터 API — 현재가/지수 조회 프록시
# ---------------------------------------------------------------------------

_MARKET_SYMBOL_RE = re.compile(r'^[A-Za-z0-9.\-^=]{1,16}$')

def _parse_market_symbols(raw: str):
    symbols = []
    for part in (raw or '').split(','):
        sym = part.strip().upper()
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
        try:
            resp = requests.get(
                f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}',
                params={'range': '1d', 'interval': '1d'},
                headers={'User-Agent': 'Mozilla/5.0 jip-investment-partner'},
                timeout=10,
            )
        except requests.RequestException as e:
            log.warning('Yahoo chart 조회 실패(%s): %s', symbol, e)
            continue
        if not resp.ok:
            log.warning('Yahoo chart 오류 응답(%s): HTTP %d', symbol, resp.status_code)
            continue
        try:
            quote = _normalize_yahoo_chart(symbol, resp.json())
        except ValueError:
            log.warning('Yahoo chart 응답 파싱 실패(%s)', symbol)
            continue
        if quote and quote.get('symbol') and quote.get('price') is not None:
            quotes.append(quote)
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

    if not quotes:
        return jsonify({'error': '시장 데이터 조회 실패', 'requested': symbols}), 502

    return jsonify({
        'source': source,
        'requested': symbols,
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

def _news_item(symbol, title, link='', published='', summary='', source='unknown', kind='news', sentiment=None):
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

    return _news_item(
        symbol=symbol,
        title=text('title'),
        link=text('link'),
        published=text('pubDate'),
        summary=text('description'),
        source=source,
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
    try:
        symbols = _parse_market_symbols(request.args.get('symbols', ''))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    limit = request.args.get('limit', '5')
    try:
        per_symbol_limit = max(1, min(10, int(limit)))
    except ValueError:
        per_symbol_limit = 5

    news = []
    for symbol in symbols:
        news.extend(_fetch_news_for_symbol(symbol, per_symbol_limit))

    return jsonify({
        'source': 'aggregated-investment-news',
        'requested': symbols,
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

@app.route('/api/analyze', methods=['POST'])
@require_auth
def analyze():
    if not ANTHROPIC_API_KEY:
        log.error('ANTHROPIC_API_KEY 없음 — AI 기능 불가')
        return jsonify({'error': 'ANTHROPIC_API_KEY가 ecrk.env에 없습니다'}), 500

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        log.warning('POST /api/analyze: 유효하지 않은 페이로드')
        return jsonify({'error': '유효하지 않은 요청 형식'}), 400

    use_stream = payload.get('stream', False)
    model      = payload.get('model', '?')
    max_tok    = payload.get('max_tokens', '?')
    log.info('AI 분석 요청: model=%s, max_tokens=%s, stream=%s', model, max_tok, use_stream)

    # AI 호출 전 PII 스크러빙
    payload = _scrub_payload(payload)

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
        log.error('AI 호출 타임아웃 (120초)')
        return jsonify({'error': 'AI 요청 타임아웃 (120초)'}), 504
    except requests.RequestException as e:
        log.error('AI 네트워크 오류: %s', e, exc_info=True)
        return jsonify({'error': f'네트워크 오류: {e}'}), 502

    if not resp.ok:
        log.warning('AI 오류 응답: HTTP %d', resp.status_code)

    if use_stream:
        log.debug('AI 스트리밍 응답 시작')
        def generate():
            for chunk in resp.iter_content(chunk_size=None):
                yield chunk
        return Response(
            stream_with_context(generate()),
            status=resp.status_code,
            content_type='text/event-stream',
        )

    log.info('AI 분석 완료: HTTP %d', resp.status_code)
    return (resp.content, resp.status_code, {'Content-Type': 'application/json'})

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
