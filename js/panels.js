/* =============================================
   自畵像 — 패널·사이드바·모바일 레이아웃
   의존성: state.js
   (chat.js에서 분리)
   ============================================= */

// ---------------------------------------------------------------------------
// + 버튼 팝업 메뉴
// ---------------------------------------------------------------------------

function openPlusMenu() {
  const existing = document.getElementById('plus-menu');
  if (existing) {
    closePlusMenu();
    return;
  }

  const groups = [
    {
      id: 'daily',
      label: '일상',
      desc: '말을 받아 적고 정리하기',
      open: state.view === 'myrecords',
      modes: [
        { id: 'dictation', label: '받아쓰기', desc: 'AI 응답 없이 쌓기' },
        { id: 'question',  label: '답변',     desc: '내 질문에 바로 답하기' },
        { id: 'summary',   label: '정리',     desc: '여기까지 기록 초안으로' },
        { id: 'advice',    label: '조언',     desc: '딱 하나만 제안받기' },
      ],
    },
    {
      id: 'counseling',
      label: '상담',
      desc: '축어록과 슈퍼비전 중심',
      open: state.view === 'student',
      modes: [
        { id: 'question', label: '질문', desc: '상담 장면을 바로 묻기' },
        { id: 'summary',  label: '정리', desc: '회기 메모처럼 정리하기' },
        { id: 'advice',   label: '개입', desc: '다음 개입 하나 제안받기' },
      ],
    },
    {
      id: 'investment',
      label: '투자',
      desc: '상태·뉴스·원칙·매매 판단',
      open: state.view === 'investment',
      modes: [
        { id: 'invest-status',  label: '상태', desc: '현재가·손익·위험 신호 확인' },
        { id: 'invest-news',    label: '뉴스', desc: '뉴스·공시·시장 동향 조회' },
        { id: 'invest-rules',   label: '원칙', desc: '투자 원칙 세우기·수정' },
        { id: 'invest-trade',   label: '매매', desc: '매수·매도 전 판단 게이트' },
        { id: 'invest-summary', label: '정리', desc: '대화를 투자 기록으로 정돈' },
      ],
    },
  ];
  if (!groups.some(group => group.open)) groups[0].open = true;

  const menu = document.createElement('div');
  menu.id        = 'plus-menu';
  menu.className = 'plus-menu reply-mode-menu plus-accordion-menu open';
  menu.innerHTML = groups.map(group => `
    <details class="pm-group pm-group-${group.id}"${group.open ? ' open' : ''}>
      <summary class="pm-group-summary">
        <span class="pm-group-title">${esc(group.label)}</span>
        <span class="pm-group-desc">${esc(group.desc)}</span>
      </summary>
      <div class="pm-group-body">
        ${group.modes.map(mode => `
          <button class="pm-mode-item${state.replyMode === mode.id ? ' active' : ''}"
            id="reply-mode-${mode.id}" type="button"
            onclick="setReplyMode('${mode.id}');closePlusMenu();">
            <span class="pm-mode-label">${esc(mode.label)}</span>
            <span class="pm-mode-desc">${esc(mode.desc)}</span>
          </button>`).join('')}
      </div>
    </details>`).join('');

  const inputArea = document.getElementById('input-area');
  if (inputArea) inputArea.appendChild(menu);
  else document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener('click', _closePlusMenuOutside);
  }, 0);
}

function closePlusMenu() {
  document.removeEventListener('click', _closePlusMenuOutside);
  document.getElementById('plus-menu')?.remove();
}

function _closePlusMenuOutside(e) {
  if (!document.getElementById('plus-menu')?.contains(e.target)) {
    closePlusMenu();
  }
}

// ---------------------------------------------------------------------------
// 모바일 패널 토글
// ---------------------------------------------------------------------------

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ai = document.getElementById('right-panel');
  const bd = document.getElementById('panel-backdrop');
  if (!sb) return;
  const isOpen = sb.classList.toggle('panel-open');
  if (isOpen && ai) ai.classList.remove('panel-open');
  if (bd) bd.classList.toggle('visible', isOpen || !!(ai?.classList.contains('panel-open')));
}

function toggleAIPanel() {
  const sb = document.getElementById('sidebar');
  const ai = document.getElementById('right-panel');
  const bd = document.getElementById('panel-backdrop');
  if (!ai) return;
  const isOpen = ai.classList.toggle('panel-open');
  if (isOpen && sb) sb.classList.remove('panel-open');
  if (bd) bd.classList.toggle('visible', isOpen || !!(sb?.classList.contains('panel-open')));
}

function closePanels() {
  document.getElementById('sidebar')?.classList.remove('panel-open');
  document.getElementById('right-panel')?.classList.remove('panel-open');
  document.getElementById('panel-backdrop')?.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// iOS Safari 키보드 대응 — Visual Viewport API
// ---------------------------------------------------------------------------

// 앱 높이를 window.innerHeight 기준으로 한 번 고정.
// dvh는 키보드 올라올 때마다 재계산돼 레이아웃 전체가 흔들리므로 사용 금지.
function _lockAppHeight() {
  document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px');
}

function _initVisualViewport() {
  if (!window.visualViewport) return;

  // 최초 1회 고정 + 가로/세로 전환 시만 재측정 (키보드 이벤트에는 반응 안 함)
  _lockAppHeight();
  window.addEventListener('orientationchange', () => {
    setTimeout(_lockAppHeight, 300);
  });

  function _onVVChange() {
    const vv = window.visualViewport;
    // vv.offsetTop: iOS에서 키보드 등장 시 viewport가 위로 이동한 만큼 보정
    const kbHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const hasKeyboard = kbHeight > 50;

    // --kb-offset → CSS에서 input-area transform + chat-messages padding에 사용
    document.documentElement.style.setProperty('--kb-offset', hasKeyboard ? kbHeight + 'px' : '0px');

    // 키보드 완전히 올라온 후 대화창 맨 아래로 (iOS 키보드 애니메이션 ~300ms)
    if (hasKeyboard) {
      setTimeout(() => scrollChatToBottom(), 300);
    }
  }

  window.visualViewport.addEventListener('resize', _onVVChange);
  window.visualViewport.addEventListener('scroll', _onVVChange);
}

// ---------------------------------------------------------------------------
// 모바일 레이아웃 업데이트 (render-main.js에서 호출)
// ---------------------------------------------------------------------------

function updateMobileLayout() {
  // 하단 상태바는 제거됨. 모바일 레이아웃은 CSS와 visualViewport 보정만 사용한다.
}
