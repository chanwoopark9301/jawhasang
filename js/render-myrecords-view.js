/* =============================================
   自畵像 — 나의 기록 상세 렌더링 (본문·보고서·대화)
   의존성: state.js, utils.js, render-session.js (renderMd)
   ============================================= */

// ---------------------------------------------------------------------------
// 나의 기록 — AI 보고서 렌더링
// ---------------------------------------------------------------------------

function renderMyReport(record) {
  const a = record.analysis;
  const sections = [
    { key: 'pattern',      label: '패턴 요약',        cls: 'rpt-blue'   },
    { key: 'strengths',    label: '잘 된 것',           cls: 'rpt-green'  },
    { key: 'improvements', label: '개선점',             cls: 'rpt-red'    },
    { key: 'questions',    label: '다음을 위한 질문',   cls: 'rpt-amber'  },
    { key: 'overall',      label: '종합 평가',          cls: 'rpt-purple' },
  ];
  return `<div class="rpt-date">작성일: ${esc(a.savedAt || '')} · 기간: ${esc(a.period || '')}</div>` +
    sections.map(s => `<div class="rpt-section ${s.cls}">
      <div class="rpt-label" onclick="this.closest('.rpt-section').classList.toggle('rpt-collapsed')">
        <span>${s.label}</span>
        <span class="rpt-chevron">▾</span>
      </div>
      <div class="rpt-body">${(a[s.key] || '—').replace(/\n/g, '<br>').replace(/ (\d+)\)/g, '<br>$1)')}</div>
    </div>`).join('');
}

// ---------------------------------------------------------------------------
// 나의 기록 — AI 대화
// ---------------------------------------------------------------------------

function renderMyDialogue(record) {
  const chat = record.aiChat || [];

  if (!chat.length) {
    return `<div class="chat-start">
      <div class="chat-start-desc">기록을 읽고 AI와 대화를 시작합니다${record.analysis ? '<br><span style="font-size:11px;opacity:.7;">보고서 내용도 함께 참고합니다</span>' : ''}</div>
      <button class="btn-primary-my" onclick="startMyChat()" ${state.myChatLoading ? 'disabled' : ''}>
        ${state.myChatLoading ? '준비 중...' : 'AI와 대화 시작하기'}
      </button>
    </div>`;
  }

  const msgs = chat.map(m => `
    <div class="chat-msg chat-${m.role}">
      <div class="chat-bubble">${m.role === 'ai'
        ? renderMd(m.text)
        : m.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
      }</div>
    </div>`).join('');

  const loading = state.myChatLoading
    ? `<div class="chat-msg chat-ai"><div class="chat-bubble">
        <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
      </div></div>` : '';

  return `<div class="chat-wrap">
    <div class="chat-messages" id="my-chat-messages">${msgs}${loading}</div>
    <div class="chat-input-row">
      <textarea class="chat-input" id="my-chat-input" rows="2"
        placeholder="답변을 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
        ${state.myChatLoading ? 'disabled' : ''}
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMyChatMessage();}"></textarea>
      <button class="chat-send" style="background:#1D9E75;" onclick="sendMyChatMessage()" ${state.myChatLoading ? 'disabled' : ''}>전송</button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
      <span style="font-size:10px;color:var(--color-text-tertiary);">Enter로 전송 · Shift+Enter 줄바꿈</span>
      <button class="btn-danger" style="font-size:11px;" onclick="clearMyChat()">대화 초기화</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 나의 기록 — 기록 상세 (탭 컨테이너)
// ---------------------------------------------------------------------------

function renderRecordDetail(record, totalRecords) {
  const tabs = [
    { id: 'content',  label: '기록 본문' },
    { id: 'report',   label: 'AI 보고서' },
    { id: 'dialogue', label: 'AI 대화'   },
  ];

  const tabBar = tabs.map(t => {
    const dot = (t.id === 'report' && record.analysis) ||
                (t.id === 'dialogue' && record.aiChat?.length)
      ? '<span class="tab-dot my-tab-dot"></span>' : '';
    return `<button class="tab-btn${state.myTab === t.id ? ' active my-tab-active' : ''}"
      onclick="setMyTab('${t.id}')">${t.label}${dot}</button>`;
  }).join('');

  let body = '';
  if (state.myTab === 'content') {
    body = record.content
      ? `<div class="my-content">${renderMd(record.content)}</div>`
      : '<div class="empty-state">내용이 없습니다</div>';
  } else if (state.myTab === 'report') {
    body = record.analysis ? renderMyReport(record) : `<div class="empty-state">
      오른쪽 패널에서 <strong>보고서 생성</strong>을 눌러주세요<br><br>
      <span style="font-size:12px;color:var(--color-text-tertiary);">기간별 기록을 분석해 성찰 보고서를 작성합니다</span>
    </div>`;
  } else {
    body = renderMyDialogue(record);
  }

  const recordTagsHTML = (record.tags && record.tags.length)
    ? `<div class="detail-tags">${record.tags.map(t => `<span class="tag-badge my-tag-badge">${esc(t)}</span>`).join('')}</div>` : '';

  return `
    <div class="detail-meta">
      <span class="record-num">${record.recordNum}번째</span>
      <span style="font-size:12px;color:var(--color-text-secondary);">${record.date}</span>
      ${recordTagsHTML}
      <span style="flex:1;"></span>
      <button class="btn-secondary detail-back" onclick="backFromMyDetail()">← 목록</button>
    </div>
    <div class="session-tabs">${tabBar}</div>
    <div class="tab-content">${body}</div>
    <div class="detail-footer-note">
      <span>전체 ${totalRecords}개 중 ${record.recordNum}번째</span>
      <div style="display:flex;gap:6px;">
        <button class="btn-secondary" onclick="editRecord('${record.id}')">수정</button>
        <button class="btn-danger" onclick="deleteRecord('${record.id}')">삭제</button>
      </div>
    </div>`;
}
