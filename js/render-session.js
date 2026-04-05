/* =============================================
   自畵像 — 회기 상세 렌더링 (축어록·보고서·대화)
   의존성: state.js, utils.js
   ============================================= */

// ---------------------------------------------------------------------------
// 마크다운 → HTML (채팅용 간이 렌더러)
// ---------------------------------------------------------------------------

function renderMd(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---+$/gm, '<hr style="border:none;border-top:0.5px solid var(--color-border);margin:8px 0;">')
    .replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------------------
// 축어록 파싱 및 렌더링
// ---------------------------------------------------------------------------

function parseVerbatim(text) {
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
    const type = t.speaker ? speakerType(t.speaker, allSpeakers) : 'client';
    return `<div class="vt-turn vt-${type}">
      ${t.speaker ? `<div class="vt-speaker">${esc(t.speaker)}</div>` : ''}
      <div class="vt-text">${esc(t.text).replace(/\n/g, '<br>')}</div>
    </div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// 슈퍼비전 보고서
// ---------------------------------------------------------------------------

function renderSupervisionReport(session) {
  if (!session.analysis) {
    return `<div class="empty-state">
      오른쪽 패널에서 <strong>슈퍼비전 보고서 생성</strong>을 눌러주세요<br><br>
      <span style="font-size:12px;color:var(--color-text-tertiary);">축어록을 분석해 임상 보고서를 작성합니다</span>
    </div>`;
  }
  const a = session.analysis;
  const sections = [
    { key: 'clientState',  label: '내담자 상태 분석', cls: 'rpt-blue'   },
    { key: 'techniques',   label: '기법 분류 및 평가', cls: 'rpt-amber'  },
    { key: 'strengths',    label: '잘한 점',           cls: 'rpt-green'  },
    { key: 'improvements', label: '개선 포인트',       cls: 'rpt-red'    },
    { key: 'overall',      label: '종합 슈퍼비전',     cls: 'rpt-purple' },
  ];
  return `<div class="rpt-date">작성일: ${esc(a.savedAt || '')}</div>` +
    sections.map(s => `<div class="rpt-section ${s.cls}">
      <div class="rpt-label" onclick="this.closest('.rpt-section').classList.toggle('rpt-collapsed')">
        <span>${s.label}</span>
        <span class="rpt-chevron">▾</span>
      </div>
      <div class="rpt-body">${(a[s.key] || '—').replace(/\n/g, '<br>').replace(/ (\d+)\)/g, '<br>$1)')}</div>
    </div>`).join('');
}

// ---------------------------------------------------------------------------
// 슈퍼비전 대화
// ---------------------------------------------------------------------------

function renderSupervisionDialogue(session) {
  const chat = session.supervisionChat || [];

  if (!chat.length) {
    if (!session.analysis) {
      return `<div class="empty-state">
        슈퍼비전 보고서를 먼저 생성해주세요<br>
        <span style="font-size:12px;color:var(--color-text-tertiary);">보고서를 참고해서 깊이 있는 대화를 나눕니다</span>
      </div>`;
    }
    return `<div class="chat-start">
      <div class="chat-start-desc">슈퍼비전 보고서를 바탕으로<br>슈퍼바이저와 대화를 시작합니다</div>
      <button class="btn-primary" onclick="startSupervisionChat()" ${state.chatLoading ? 'disabled' : ''}>
        ${state.chatLoading ? '준비 중...' : '슈퍼비전 대화 시작하기'}
      </button>
    </div>`;
  }

  const msgs = chat.map(m => `
    <div class="chat-msg chat-${m.role}">
      <div class="chat-bubble">${m.role === 'ai'
        ? renderMd(m.text)
        : m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')
      }</div>
    </div>`).join('');

  const loading = state.chatLoading
    ? `<div class="chat-msg chat-ai"><div class="chat-bubble">
        <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
      </div></div>` : '';

  return `<div class="chat-wrap">
    <div class="chat-messages" id="chat-messages">${msgs}${loading}</div>
    <div class="chat-input-row">
      <textarea class="chat-input" id="chat-input" rows="2"
        placeholder="답변을 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
        ${state.chatLoading ? 'disabled' : ''}
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage();}"></textarea>
      <button class="chat-send" onclick="sendChatMessage()" ${state.chatLoading ? 'disabled' : ''}>전송</button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
      <span style="font-size:10px;color:var(--color-text-tertiary);">Enter로 전송 · Shift+Enter 줄바꿈</span>
      <button class="btn-danger" style="font-size:11px;" onclick="clearSupervisionChat()">대화 초기화</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 회기 상세 (탭 컨테이너)
// ---------------------------------------------------------------------------

function renderSessionDetail(session, totalSessions) {
  const tabs = [
    { id: 'verbatim',  label: '축어록' },
    { id: 'report',    label: '슈퍼비전 보고서' },
    { id: 'dialogue',  label: '슈퍼비전 대화' },
  ];

  const tabBar = tabs.map(t => {
    const dot = (t.id === 'report' && session.analysis) ||
                (t.id === 'dialogue' && session.supervisionChat?.length)
      ? '<span class="tab-dot"></span>' : '';
    return `<button class="tab-btn${state.sessionTab === t.id ? ' active' : ''}"
      onclick="setSessionTab('${t.id}')">${t.label}${dot}</button>`;
  }).join('');

  let body = '';
  if (state.sessionTab === 'verbatim')      body = renderVerbatimView(session.verbatim);
  else if (state.sessionTab === 'report')   body = renderSupervisionReport(session);
  else                                      body = renderSupervisionDialogue(session);

  const sessionTagsHTML = (session.tags && session.tags.length)
    ? `<div class="detail-tags">${session.tags.map(t => `<span class="tag-badge">${esc(t)}</span>`).join('')}</div>` : '';

  return `
    <div class="detail-meta">
      <span class="session-num">${session.sessionNum}회기</span>
      <span style="font-size:12px;color:var(--color-text-secondary);">${session.date}</span>
      ${sessionTagsHTML}
      <span style="flex:1;"></span>
      <button class="btn-secondary detail-back" onclick="backFromDetail()">← 목록</button>
    </div>
    <div class="session-tabs">${tabBar}</div>
    <div class="tab-content">${body}</div>
    <div class="detail-footer-note">
      <span>전체 ${totalSessions}회기 중 ${session.sessionNum}회기</span>
      <div style="display:flex;gap:6px;">
        <button class="btn-secondary" onclick="editSession('${session.id}')">수정</button>
        <button class="btn-danger" onclick="deleteSession('${session.id}')">삭제</button>
      </div>
    </div>`;
}
