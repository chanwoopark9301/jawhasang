"""
상담 일지 — Python 서버
- 로그인 (세션 기반, ecrk.env의 APP_PASSWORD)
- 데이터 암호화 저장 (Fernet / APP_PASSWORD로 키 유도)
- Anthropic API 프록시
- 저장소: PostgreSQL (DATABASE_URL) 또는 로컬 data.json 폴백
"""

import os
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

# ---------------------------------------------------------------------------
# 암호화 — APP_PASSWORD로 Fernet 키 유도
# ---------------------------------------------------------------------------

def _fernet():
    key = base64.urlsafe_b64encode(hashlib.sha256(APP_PASSWORD.encode()).digest())
    return Fernet(key)

def _encrypt(data: dict) -> bytes:
    return _fernet().encrypt(json.dumps(data, ensure_ascii=False).encode())

def _decrypt(raw: bytes) -> dict:
    return json.loads(_fernet().decrypt(raw).decode())

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
  <title>상담 일지 — 로그인</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Noto Sans KR',sans-serif;
         background:#f0ece5;height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:#f8f5f0;border:0.5px solid rgba(100,80,55,.15);border-radius:14px;
          padding:38px 34px;width:320px;box-shadow:0 2px 18px rgba(0,0,0,.07)}
    h1{font-size:18px;font-weight:500;color:#2c2820;margin-bottom:4px}
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
    <h1>상담 일지</h1>
    <p class="sub">개인정보 암호화 저장 · 전문상담교사 전용</p>
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
# Anthropic API 프록시
# ---------------------------------------------------------------------------

@app.route('/api/analyze', methods=['POST'])
@require_auth
def analyze():
    if not ANTHROPIC_API_KEY:
        return jsonify({'error': 'ANTHROPIC_API_KEY가 ecrk.env에 없습니다'}), 500
    payload = request.get_json()
    use_stream = payload.get('stream', False)
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
