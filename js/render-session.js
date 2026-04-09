/* =============================================
   自畵像 — 회기 상세 렌더링 (축어록·보고서·대화)
   의존성: state.js, utils.js
   (renderMd, parseVerbatim, speakerType, renderVerbatimView → utils.js)
   ============================================= */

// ---------------------------------------------------------------------------
// 축어록 인라인 에디터
// ---------------------------------------------------------------------------

function renderVerbatimEditor(session) {
  const charLen = (session.verbatim || '').length;
  return `
    <div class="vt-inline-editor">
      <div class="vt-input-header">
        <span class="verbatim-char-count" id="vt-char-count">${charLen.toLocaleString()}자</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="vt-tool-btn" onclick="toggleFindReplace()" type="button">찾기/바꾸기</button>
        </div>
      </div>
      <div class="vt-find-replace" id="vt-find-replace" style="display:none">
        <input class="vt-find-input" id="vt-find-input" placeholder="찾기..." autocomplete="off" />
        <span class="vt-find-arrow">→</span>
        <input class="vt-find-input" id="vt-replace-input" placeholder="바꾸기..." autocomplete="off" />
        <button class="vt-replace-btn" onclick="verbatimFindReplace()" type="button">전체 교체</button>
        <span class="vt-replace-result" id="vt-replace-result"></span>
      </div>
      <div class="vt-mode-tabs">
        <button class="vt-mode-tab active" data-mode="text" onclick="switchVtMode('text')" type="button">텍스트</button>
        <button class="vt-mode-tab" data-mode="block" onclick="switchVtMode('block')" type="button">블록</button>
      </div>
      <div id="vt-text-wrap">
        <div class="vt-annotation-bar" id="vt-annotation-bar">
          <button class="ann-btn" onclick="insertSilenceAnnotation()" type="button" title="침묵 (초 입력)">침묵 _초</button>
          <button class="ann-btn" onclick="insertAnnotation('[눈물]')" type="button">눈물</button>
          <button class="ann-btn" onclick="insertAnnotation('[웃음]')" type="button">웃음</button>
          <button class="ann-btn" onclick="insertAnnotation('[고개 끄덕임]')" type="button">끄덕임</button>
          <button class="ann-btn" onclick="insertAnnotation('[고개 저음]')" type="button">고개젓기</button>
          <button class="ann-btn" onclick="insertAnnotation('[시선 회피]')" type="button">시선회피</button>
          <button class="ann-btn" onclick="insertAnnotation('[한숨]')" type="button">한숨</button>
        </div>
        <textarea class="form-textarea vt-textarea" id="fv"
          oninput="updateVerbatimCounter(this.value)"
          >${esc(session.verbatim || '')}</textarea>
        <div class="verbatim-long-notice" id="vt-long-notice"
          style="display:${charLen >= 3000 ? 'flex' : 'none'}">
          긴 축어록 모드 — 보고서 생성 시 핵심 장면을 먼저 추출한 뒤 1페이지 보고서를 작성합니다.
        </div>
      </div>
      <div id="vt-block-editor" style="display:none"></div>
      <div class="btn-row" style="margin-top:8px;">
        <button class="btn-secondary" onclick="cancelVtInlineEdit()">취소</button>
        <button class="btn-primary" onclick="saveVtInline()">저장</button>
      </div>
    </div>`;
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
      <div class="rpt-body">${esc(a[s.key] || '—').replace(/\n/g, '<br>').replace(/ (\d+)\)/g, '<br>$1)')}</div>
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
  if (state.sessionTab === 'verbatim') {
    body = state.vtInlineEdit
      ? renderVerbatimEditor(session)
      : renderVerbatimView(session.verbatim);
  } else if (state.sessionTab === 'report') {
    body = renderSupervisionReport(session);
  } else {
    body = renderSupervisionDialogue(session);
  }

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
