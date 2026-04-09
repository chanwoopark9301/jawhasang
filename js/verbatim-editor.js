/* =============================================
   自畵像 — 블록 에디터 (축어록)
   의존성: utils.js (parseVerbatim, speakerType)

   블록 구조:
     { id, type: 'speech'|'nonverbal', speaker: 'T'|'C', text }

   모드:
     'text'  — 기존 textarea (#fv)
     'block' — 구조화된 블록 UI
   ============================================= */

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

let _vtBlocks = [];        // 현재 블록 배열
let _vtMode   = 'text';    // 현재 모드

function _genId() {
  return 'b' + Date.now() + Math.random().toString(36).slice(2, 6);
}

// ---------------------------------------------------------------------------
// 모드 전환
// ---------------------------------------------------------------------------

function switchVtMode(mode) {
  const ta       = document.getElementById('fv');
  const textWrap = document.getElementById('vt-text-wrap');
  const blockWrap= document.getElementById('vt-block-editor');
  const tabs     = document.querySelectorAll('.vt-mode-tab');

  // 필요한 DOM 요소 없으면 중단 (폼 재렌더 타이밍 등)
  if (!ta || !textWrap || !blockWrap) return;

  if (mode === 'block') {
    _vtBlocks = vtTextToBlocks(ta.value);
    textWrap.style.display  = 'none';
    blockWrap.style.display = 'block';
  } else {
    const converted = vtBlocksToText(_vtBlocks);
    ta.value = converted;
    updateVerbatimCounter(converted);
    textWrap.style.display  = 'block';
    blockWrap.style.display = 'none';
  }

  _vtMode = mode;
  tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });

  if (mode === 'block') _renderBlocks();
}

// ---------------------------------------------------------------------------
// 블록 CRUD
// ---------------------------------------------------------------------------

function addVtBlock(type) {
  // type: 'T' | 'C' | 'nonverbal'
  const block = {
    id:      _genId(),
    type:    type === 'nonverbal' ? 'nonverbal' : 'speech',
    speaker: type === 'nonverbal' ? null : type,  // 'T' or 'C'
    text:    '',
  };
  _vtBlocks.push(block);
  _renderBlocks();
  // 새 블록 입력창에 포커스
  requestAnimationFrame(() => {
    const inp = document.getElementById('bi-' + block.id);
    if (inp) inp.focus();
  });
}

function deleteVtBlock(id) {
  _vtBlocks = _vtBlocks.filter(b => b.id !== id);
  _syncTextarea();
  _renderBlocks();
}

function toggleVtSpeaker(id) {
  const block = _vtBlocks.find(b => b.id === id);
  if (!block || block.type !== 'speech') return;
  block.speaker = block.speaker === 'T' ? 'C' : 'T';
  _syncTextarea();
  // 해당 버튼만 업데이트
  const btn = document.getElementById('bs-' + id);
  if (btn) {
    btn.textContent = block.speaker;
    btn.className   = `speaker-btn speaker-${block.speaker}`;
  }
}

function updateVtBlockText(id, text) {
  const block = _vtBlocks.find(b => b.id === id);
  if (block) block.text = text;
  _syncTextarea();
}

// ---------------------------------------------------------------------------
// 변환 함수
// ---------------------------------------------------------------------------

function vtBlocksToText(blocks) {
  return blocks
    .filter(b => b.text.trim() !== '')
    .map(b => {
      if (b.type === 'nonverbal') return `[비언어: ${b.text}]`;
      // _rawLabel이 있으면 원래 발화자 레이블 보존, 없으면 기본값
      const label = b._rawLabel || (b.speaker === 'T' ? '상담자' : '내담자');
      return `${label}: ${b.text}`;
    })
    .join('\n');
}

function vtTextToBlocks(text) {
  if (!text || !text.trim()) return [];

  const lines  = text.split('\n');
  const blocks = [];
  let   cur    = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // 비언어 블록 패턴: [비언어: ...] 또는 [...]
    const nvMatch = line.match(/^\[비언어:\s*(.+)\]$/) ||
                    line.match(/^\[(.{1,30})\]$/);
    if (nvMatch) {
      if (cur) { blocks.push(cur); cur = null; }
      blocks.push({ id: _genId(), type: 'nonverbal', speaker: null, text: nvMatch[1].trim() });
      continue;
    }

    // 발화 블록: "발화자: 내용"
    const spMatch = line.match(/^([^:：\[\]]{1,20})[：:]\s*(.+)$/);
    if (spMatch) {
      if (cur) blocks.push(cur);
      const label   = spMatch[1].trim();
      const content = spMatch[2].trim();
      // 발화자 판별 (utils.js speakerType 활용)
      // allSpeakers에 지금까지 나온 레이블을 전달해야 첫 번째 발화자를 상담자로 인식
      const allLabels = blocks.map(b => b._rawLabel).filter(Boolean);
      const sType = speakerType(label, allLabels);
      cur = {
        id:        _genId(),
        type:      'speech',
        speaker:   sType === 'counselor' ? 'T' : 'C',
        text:      content,
        _rawLabel: label,  // speakerType 판별용 임시 필드 (저장 안 함)
      };
    } else if (cur) {
      // 이어지는 줄은 현재 블록에 병합
      cur.text += ' ' + line;
    } else {
      // 발화자 없는 단독 줄
      cur = { id: _genId(), type: 'speech', speaker: 'C', text: line };
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

// ---------------------------------------------------------------------------
// 내부 렌더링
// ---------------------------------------------------------------------------

function _syncTextarea() {
  const ta = document.getElementById('fv');
  if (!ta || _vtMode !== 'block') return;
  const text = vtBlocksToText(_vtBlocks);
  ta.value = text;
  updateVerbatimCounter(text);
}

function _renderBlocks() {
  const wrap = document.getElementById('vt-block-editor');
  if (!wrap) return;

  const blocksHtml = _vtBlocks.map(b => {
    if (b.type === 'nonverbal') {
      return `
        <div class="vt-block vt-block-nonverbal" data-id="${b.id}">
          <span class="speaker-btn speaker-nv">비언어</span>
          <input class="block-text" id="bi-${b.id}"
            value="${esc(b.text)}"
            placeholder="침묵 3초, 눈물, 고개 저음..."
            oninput="updateVtBlockText('${b.id}', this.value)" />
          <button class="block-del" onclick="deleteVtBlock('${b.id}')" type="button">×</button>
        </div>`;
    }
    return `
      <div class="vt-block" data-id="${b.id}">
        <button class="speaker-btn speaker-${b.speaker}" id="bs-${b.id}"
          onclick="toggleVtSpeaker('${b.id}')" type="button">${b.speaker}</button>
        <textarea class="block-text" id="bi-${b.id}"
          oninput="updateVtBlockText('${b.id}', this.value)"
          rows="1"
          placeholder="${b.speaker === 'T' ? '상담자 발화...' : '내담자 발화...'}"
          >${esc(b.text)}</textarea>
        <button class="block-del" onclick="deleteVtBlock('${b.id}')" type="button">×</button>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="vt-block-list" id="vt-block-list">
      ${blocksHtml || '<div class="vt-block-empty">블록을 추가하세요</div>'}
    </div>
    <div class="vt-block-add-row">
      <button class="add-block-btn add-t" onclick="addVtBlock('T')" type="button">+ 상담자</button>
      <button class="add-block-btn add-c" onclick="addVtBlock('C')" type="button">+ 내담자</button>
      <button class="add-block-btn add-nv" onclick="addVtBlock('nonverbal')" type="button">+ 비언어</button>
    </div>`;

  // textarea 자동 높이 조절
  wrap.querySelectorAll('textarea.block-text').forEach(el => {
    el.style.height = 'auto';
    el.style.height = Math.max(32, el.scrollHeight) + 'px';
  });
}

// ---------------------------------------------------------------------------
// 폼 저장 전 블록→텍스트 동기화 (crud.js saveSession 호출 전 실행)
// ---------------------------------------------------------------------------

function syncVtBeforeSave() {
  if (_vtMode === 'block') {
    const ta = document.getElementById('fv');
    if (ta) ta.value = vtBlocksToText(_vtBlocks);
  }
  _resetVtEditor();
}

// 블록 에디터 상태 초기화 (저장/취소/화면 전환 시 공통 호출)
function _resetVtEditor() {
  _vtMode   = 'text';
  _vtBlocks = [];
}
