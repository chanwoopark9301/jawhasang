"""
상담 일지 — Python 서버
- 로그인 (세션 기반, ecrk.env의 APP_PASSWORD)
- 데이터 암호화 저장 (Fernet / APP_PASSWORD로 키 유도)
- Anthropic API 프록시
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
)
from dotenv import load_dotenv
from cryptography.fernet import Fernet, InvalidToken

load_dotenv('ecrk.env')
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
APP_PASSWORD      = os.getenv('APP_PASSWORD', '')
DATA_FILE = 'data.json'

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

def read_data() -> dict:
    empty = {'students': [], 'sessions': [], 'aiResults': {}, 'my_topics': [], 'my_records': []}
    if not os.path.exists(DATA_FILE):
        return empty
    with open(DATA_FILE, 'rb') as f:
        raw = f.read()
    try:
        return _decrypt(raw)
    except (InvalidToken, Exception):
        # 이전 비암호화 포맷이면 읽어서 암호화 재저장
        try:
            data = json.loads(raw.decode())
            data.setdefault('aiResults', {})
            write_data(data)
            return data
        except Exception:
            return empty

def write_data(data: dict):
    with open(DATA_FILE, 'wb') as f:
        f.write(_encrypt(data))

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
    )
    return (resp.content, resp.status_code, {'Content-Type': 'application/json'})

# ---------------------------------------------------------------------------
# 실행
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if not APP_PASSWORD:
        print('경고: APP_PASSWORD가 ecrk.env에 없습니다. 로그인이 불가능합니다.')
    print('상담 일지 서버: http://localhost:5000')
    print('종료: Ctrl+C')
    app.run(port=5000, debug=False)
