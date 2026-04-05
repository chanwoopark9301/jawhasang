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

async function streamAnalyze(payload, onProgress) {
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
          onProgress && onProgress(accumulated);
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
  if (!verbatim) return '<div class="empty-state">축어록이 없습니다</div>';
  const turns = parseVerbatim(verbatim);
  if (!turns.length) return `<pre class="vt-raw">${esc(verbatim)}</pre>`;

  const allSpeakers = [...new Set(turns.map(t => t.speaker).filter(Boolean))];
  return `<div class="vt-container">${turns.map(t => {
    const type = speakerType(t.speaker, allSpeakers);
    return `<div class="vt-turn vt-${type}">
      ${t.speaker ? `<div class="vt-speaker">${esc(t.speaker)}</div>` : ''}
      <div class="vt-text">${esc(t.text).replace(/\n/g, '<br>')}</div>
    </div>`;
  }).join('')}</div>`;
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
