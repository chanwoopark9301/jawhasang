/* =============================================
   自畵像 — 공통 유틸리티
   의존성: 없음

   수정 (버그픽스):
   - esc(): XSS 방지 HTML 이스케이프 추가
   - streamAnalyze(): 2분 타임아웃 + AbortController 추가
   - speakerType(): label null 체크 추가
   ============================================= */

// ---------------------------------------------------------------------------
// HTML 이스케이프 (XSS 방지)
// ---------------------------------------------------------------------------

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// JSON 파싱 (AI 응답용 — literal 줄바꿈 자동 수정)
// ---------------------------------------------------------------------------

function parseJSON(text) {
  const cleaned   = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd   = cleaned.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1)
    throw new Error(`JSON 없음. 응답 일부: ${cleaned.slice(0, 200)}`);
  const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);
  try {
    return JSON.parse(jsonStr);
  } catch {
    // AI가 문자열 안에 literal 줄바꿈을 넣으면 JSON.parse 실패 → 이스케이프 후 재시도
    let fixed = '', inString = false, escape = false;
    for (const c of jsonStr) {
      if (escape)                       { fixed += c; escape = false; }
      else if (c === '\\' && inString)  { fixed += c; escape = true; }
      else if (c === '"')               { fixed += c; inString = !inString; }
      else if (inString && c === '\n')  { fixed += '\\n'; }
      else if (inString && c === '\r')  { fixed += '\\r'; }
      else                              { fixed += c; }
    }
    return JSON.parse(fixed);
  }
}

// ---------------------------------------------------------------------------
// 스트리밍 fetch (AI 보고서 생성용)
// payload를 stream:true 로 전송하고 누적 텍스트를 반환.
// onProgress(accumulated) 로 글자 수 실시간 전달.
// ---------------------------------------------------------------------------

// onProgress 쓰로틀: 100ms 간격으로만 DOM 업데이트
function _throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
  };
}

async function streamAnalyze(payload, onProgress) {
  const _progress = onProgress ? _throttle(onProgress, 100) : null;
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 120_000); // 2분 타임아웃

  let res;
  try {
    res = await fetch('/api/analyze', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...payload, stream: true }),
      signal:  controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error('AI 요청 시간이 초과됐습니다 (2분)');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`AI 분석 실패 (HTTP ${res.status}): ${errBody.slice(0, 150)}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop(); // 마지막 불완전 라인은 다음 청크로
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const ev = JSON.parse(raw);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          accumulated += ev.delta.text;
          _progress && _progress(accumulated);
        }
      } catch { /* SSE 파싱 오류 무시 */ }
    }
  }

  if (!accumulated) throw new Error('AI 응답이 비어 있습니다');
  return accumulated;
}

// ---------------------------------------------------------------------------
// 마크다운 → HTML (채팅 메시지, 기록 본문용 간이 렌더러)
// ---------------------------------------------------------------------------

function renderMd(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')  // XSS 방지 먼저
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---+$/gm, '<hr style="border:none;border-top:0.5px solid var(--color-border);margin:8px 0;">')
    .replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------------------
// 축어록 파싱
// ---------------------------------------------------------------------------

function parseVerbatim(text) {
  if (!text) return [];
  const turns = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(?:\[[\d:]+\]\s*)?([^:：\[\]]{1,20})[：:]\s*(.+)$/);
    if (m && m[2]) {
      turns.push({ speaker: m[1].trim(), text: m[2].trim() });
    } else if (turns.length > 0) {
      turns[turns.length - 1].text += ' ' + t;
    } else {
      turns.push({ speaker: '', text: t });
    }
  }
  return turns;
}

function speakerType(label, allSpeakers) {
  if (!label || typeof label !== 'string') return 'client';
  const ci = ['상담', '교사', '선생', 'T'];
  const cl = ['내담', '학생', 'C', '아동'];
  if (ci.some(k => label.includes(k))) return 'counselor';
  if (cl.some(k => label.includes(k))) return 'client';
  return allSpeakers.indexOf(label) === 0 ? 'counselor' : 'client';
}

function renderVerbatimView(verbatim) {
  const editBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
    <button class="btn-secondary" style="font-size:12px;" onclick="startVtInlineEdit()">편집</button>
  </div>`;

  if (!verbatim) return editBtn + '<div class="empty-state">축어록이 없습니다</div>';
  const turns = parseVerbatim(verbatim);
  if (!turns.length) return editBtn + `<pre class="vt-raw">${esc(verbatim)}</pre>`;

  const allSpeakers = [...new Set(turns.map(t => t.speaker).filter(Boolean))];
  return editBtn + `<div class="vt-container">${turns.map(t => {
    const type = speakerType(t.speaker, allSpeakers);
    return `<div class="vt-turn vt-${type}">
      ${t.speaker ? `<div class="vt-speaker">${esc(t.speaker)}</div>` : ''}
      <div class="vt-text">${esc(t.text).replace(/\n/g, '<br>')}</div>
    </div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// 축어록 글자수 카운터 + 긴 축어록 안내
// ---------------------------------------------------------------------------

const LONG_VERBATIM_THRESHOLD_UI = 3000;

function updateVerbatimCounter(value) {
  const count   = (value || '').length;
  const counter = document.getElementById('vt-char-count');
  const notice  = document.getElementById('vt-long-notice');
  if (counter) {
    counter.textContent = `${count.toLocaleString()}자`;
    counter.style.color = count >= LONG_VERBATIM_THRESHOLD_UI ? 'var(--color-accent)' : '';
  }
  if (notice) {
    notice.style.display = count >= LONG_VERBATIM_THRESHOLD_UI ? 'flex' : 'none';
  }
}

// ---------------------------------------------------------------------------
// 찾기/바꾸기 토글
// ---------------------------------------------------------------------------

function toggleFindReplace() {
  const panel = document.getElementById('vt-find-replace');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) {
    const fi = document.getElementById('vt-find-input');
    if (fi) fi.focus();
  }
}

// ---------------------------------------------------------------------------
// 찾기/바꾸기 실행
// ---------------------------------------------------------------------------

function verbatimFindReplace() {
  const ta      = document.getElementById('fv');
  const findEl  = document.getElementById('vt-find-input');
  const replEl  = document.getElementById('vt-replace-input');
  const result  = document.getElementById('vt-replace-result');
  if (!ta || !findEl || !replEl) return;

  const findVal = findEl.value;
  if (!findVal) { if (result) result.textContent = '찾을 단어를 입력하세요'; return; }

  const replVal = replEl.value;
  const regex   = new RegExp(findVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const matches = (ta.value.match(regex) || []).length;

  if (matches === 0) {
    if (result) result.textContent = `"${findVal}" 없음`;
    return;
  }

  ta.value = ta.value.replace(regex, replVal);
  updateVerbatimCounter(ta.value);

  if (result) {
    result.textContent = `${matches}곳 교체 완료`;
    setTimeout(() => { if (result) result.textContent = ''; }, 3000);
  }
  ta.focus();
}

// ---------------------------------------------------------------------------
// 주석 삽입 (커서 위치에 비언어 주석 삽입)
// ---------------------------------------------------------------------------

function insertAnnotation(text) {
  const ta = document.getElementById('fv');
  if (!ta) return;

  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const before = ta.value.slice(0, start);
  const after  = ta.value.slice(end);

  ta.value = before + text + after;
  updateVerbatimCounter(ta.value);

  // 커서를 삽입된 텍스트 뒤로 이동
  const newPos = start + text.length;
  ta.setSelectionRange(newPos, newPos);
  ta.focus();
}

function insertSilenceAnnotation() {
  const sec = prompt('침묵 시간 (초)', '3');
  if (sec === null) return;
  const num = parseInt(sec, 10);
  insertAnnotation(`[침묵 ${isNaN(num) ? '_' : num}초]`);
}

// ---------------------------------------------------------------------------
// 번호 헬퍼 (삭제 후 재추가 시 번호 중복 방지)
// ---------------------------------------------------------------------------

function getNextSessionNum(studentId) {
  const nums = state.sessions
    .filter(s => s.studentId === studentId)
    .map(s => s.sessionNum);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function getNextRecordNum(topicId) {
  const nums = state.myRecords
    .filter(r => r.topicId === topicId)
    .map(r => r.recordNum);
  return nums.length ? Math.max(...nums) + 1 : 1;
}
