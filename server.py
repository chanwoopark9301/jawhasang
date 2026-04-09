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
import requests
from functools import wraps
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
DATA_FILE         = 'data.json'

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

EMPTY = lambda: {'students': [], 'sessions': [], 'aiResults': {}, 'my_topics': [], 'my_records': []}

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

def read_data() -> dict:
    if DATABASE_URL:
        try:
            conn = _get_db_conn()
            _ensure_table(conn)
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM app_storage WHERE id = 1")
                row = cur.fetchone()
            conn.close()
            if not row:
                return EMPTY()
            return _decrypt(bytes(row[0]))
        except Exception as e:
            print(f'DB read error: {e}')
            return EMPTY()
    # 로컬 파일 폴백
    if not os.path.exists(DATA_FILE):
        return EMPTY()
    with open(DATA_FILE, 'rb') as f:
        raw = f.read()
    try:
        return _decrypt(raw)
    except (InvalidToken, Exception):
        try:
            data = json.loads(raw.decode())
            data.setdefault('aiResults', {})
            write_data(data)
            return data
        except Exception:
            return EMPTY()

def write_data(data: dict):
    encrypted = _encrypt(data)
    if DATABASE_URL:
        try:
            conn = _get_db_conn()
            _ensure_table(conn)
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO app_storage (id, data) VALUES (1, %s)
                    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
                """, (encrypted,))
            conn.commit()
            conn.close()
            return
        except Exception as e:
            print(f'DB write error: {e}')
    # 로컬 파일 폴백
    with open(DATA_FILE, 'wb') as f:
        f.write(encrypted)

# ---------------------------------------------------------------------------
# 로그인
# ---------------------------------------------------------------------------

_LOGIN_HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>自畵像</title>
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
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form.get('password', '') == APP_PASSWORD:
            session['auth'] = True
            return redirect('/')
        return render_template_string(_LOGIN_HTML, error='비밀번호가 올바르지 않습니다')
    if session.get('auth'):
        return redirect('/')
    return render_template_string(_LOGIN_HTML, error=None)

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/login')

# ---------------------------------------------------------------------------
# 정적 파일
# ---------------------------------------------------------------------------

@app.route('/')
@require_auth
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
@require_auth
def static_files(filename):
    return send_from_directory('.', filename)

# ---------------------------------------------------------------------------
# 데이터 API
# ---------------------------------------------------------------------------

@app.route('/api/data', methods=['GET'])
@require_auth
def get_data():
    return jsonify(read_data())

@app.route('/api/data', methods=['POST'])
@require_auth
def save_data_route():
    write_data(request.get_json())
    return jsonify({'ok': True})

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
    for pattern, replacement in _PII_PATTERNS:
        text = pattern.sub(replacement, text)
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
    if not resp.ok:
        return jsonify({'error': f'AI 오류: {resp.status_code}', 'detail': resp.text[:200]}), 502

    try:
        data    = resp.json()
        summary = ''.join(c.get('text', '') for c in data.get('content', []))
        if not summary.strip():
            return jsonify({'error': 'AI 응답이 비어 있습니다'}), 502
        return jsonify({'summary': summary.strip()})
    except Exception as e:
        return jsonify({'error': f'응답 파싱 실패: {str(e)}'}), 502


# ---------------------------------------------------------------------------
# Anthropic API 프록시
# ---------------------------------------------------------------------------

@app.route('/api/analyze', methods=['POST'])
@require_auth
def analyze():
    if not ANTHROPIC_API_KEY:
        return jsonify({'error': 'ANTHROPIC_API_KEY가 ecrk.env에 없습니다'}), 500
    payload = request.get_json()
    use_stream = payload.get('stream', False)

    # AI 호출 전 PII 스크러빙
    payload = _scrub_payload(payload)

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
    if use_stream:
        def generate():
            for chunk in resp.iter_content(chunk_size=None):
                yield chunk
        return Response(
            stream_with_context(generate()),
            status=resp.status_code,
            content_type='text/event-stream',
        )
    return (resp.content, resp.status_code, {'Content-Type': 'application/json'})

# ---------------------------------------------------------------------------
# 실행
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if not APP_PASSWORD:
        print('경고: APP_PASSWORD가 ecrk.env에 없습니다. 로그인이 불가능합니다.')
    if DATABASE_URL:
        print('저장소: PostgreSQL (Supabase)')
    else:
        print('저장소: 로컬 data.json')
    print('상담 일지 서버: http://localhost:5000')
    print('종료: Ctrl+C')
    app.run(port=5000, debug=False)
