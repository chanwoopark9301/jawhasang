/* =============================================
   自畵像 — 통합 모달
   의존성: state.js, utils.js, crud.js, render-forms.js
   ============================================= */

// ---------------------------------------------------------------------------
// 핵심 open / close
// ---------------------------------------------------------------------------

function openModal(id, data = {}) {
  state.activeModal = id;
  // 보고서 모달: 분석 결과를 전역에 보존 (버튼 onclick 콜백용)
  if (id === 'report' && data.analysis) window._lastAnalysis = data.analysis;
  const box = document.getElementById('modal-box');
  if (!box) return;
  box.innerHTML = buildModalHTML(id, data);
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  state.activeModal = null;
  document.getElementById('modal-overlay').classList.remove('open');
  const box = document.getElementById('modal-box');
  if (box) box.innerHTML = '';
}

// 오버레이 클릭 시 모달 박스 외부 클릭만 닫기
function handleModalOverlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

// ---------------------------------------------------------------------------
// 라우터
// ---------------------------------------------------------------------------

function buildModalHTML(id, data) {
  switch (id) {
    case 'new-topic':     return renderModalNewTopic();
    case 'new-student':   return renderModalNewStudent();
    case 'edit-topic':    return renderModalEditTopic(data);
    case 'edit-student':  return renderModalEditStudent(data);
    case 'verbatim':      return renderModalVerbatim();
    case 'write':         return renderModalWrite();
    case 'mode':          return renderModalMode();
    case 'report':        return renderModalReport(data.analysis);
    case 'diary-result':  return renderModalDiaryResult(data.draft, data.date);
    case 'pattern':       return renderModalPattern(data.result);
    case 'chat-summary':  return renderModalChatSummary(data);
    default:              return `<p>알 수 없는 팝업: ${esc(id)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// 각 모달 렌더러
// ---------------------------------------------------------------------------

function renderModalNewTopic() {
  const presetBtns = AI_ROLE_PRESETS.map(p => `
    <button type="button" class="role-preset-btn" data-id="${p.id}"
      onclick="selectRolePreset('${p.id}')">
      <span class="role-preset-label">${esc(p.label)}</span>
      <span class="role-preset-desc">${esc(p.desc)}</span>
    </button>`).join('');

  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">새 주제 만들기</div>
    <div class="form-group">
      <label class="form-label">주제 이름</label>
      <input class="form-input" id="ft-title" placeholder="예: 일기, 아쉬운 점, 임용 공부" autocomplete="off" />
    </div>
    <div class="form-group">
      <label class="form-label">AI 역할 프리셋 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span></label>
      <div class="role-preset-grid">${presetBtns}</div>
    </div>
    <div class="form-group">
      <label class="form-label">AI 역할 직접 입력</label>
      <textarea class="form-textarea" id="ft-prompt" style="min-height:90px;"
        placeholder="이 주제에서 AI가 어떤 역할을 해줬으면 하는지 자유롭게 입력하세요.
비워두면 기본 성찰 코치로 동작합니다."></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary-my" onclick="modalSaveTopic()">만들기</button>
    </div>`;
}

function renderModalNewStudent() {
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">새 내담자 추가</div>
    <div class="form-notice">
      개인정보 보호 — 실명을 입력하지 마세요. 본인만 알 수 있는 코드를 사용하세요.
    </div>
    <div class="form-group">
      <label class="form-label">식별 코드 (예: 별-01, A03)</label>
      <input class="form-input" id="falias" placeholder="본인만 알 수 있는 코드" autocomplete="off" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">학년</label>
        <select class="form-select" id="fg">
          <option>초1</option><option>초2</option><option>초3</option>
          <option>초4</option><option>초5</option><option>초6</option>
          <option>중1</option><option>중2</option><option>중3</option>
          <option>고1</option><option>고2</option><option>고3</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">성별</label>
        <select class="form-select" id="fgd">
          <option value="">미기재</option>
          <option value="남">남</option>
          <option value="여">여</option>
        </select>
      </div>
    </div>
    <div class="form-section-title">배경 정보 (AI 슈퍼비전에 활용)</div>
    <div class="form-group">
      <label class="form-label">가족관계 / 가정환경</label>
      <textarea class="form-textarea" id="ffamily" style="min-height:50px;"
        placeholder="예: 편부모 가정, 형제 없음, 경제적 어려움"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">교우관계 / 학교생활</label>
      <textarea class="form-textarea" id="fpeers" style="min-height:50px;"
        placeholder="예: 또래 관계 어려움, 학급 내 고립"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">현재 상황 및 배경</label>
      <textarea class="form-textarea" id="fsituation" style="min-height:50px;"
        placeholder="예: 담임 의뢰, 불안 증상, 학폭 피해"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">기타 메모</label>
      <textarea class="form-textarea" id="fnotes" placeholder="기타 특이사항"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary" onclick="modalSaveStudent()">등록</button>
    </div>`;
}

function renderModalEditTopic(data) {
  const topic = data.topic || state.myTopics.find(t => t.id === (data.id || state.editingId));
  if (!topic) return `<p>주제를 찾을 수 없습니다</p>`;
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">주제 수정</div>
    <div class="form-group">
      <label class="form-label">주제 이름</label>
      <input class="form-input" id="ft-title" value="${esc(topic.title)}" autocomplete="off" />
    </div>
    <div class="form-group">
      <label class="form-label">AI 역할 설정</label>
      <textarea class="form-textarea" id="ft-prompt" style="min-height:110px;">${esc(topic.aiPrompt || '')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary-my" onclick="modalUpdateTopic('${esc(topic.id)}')">저장</button>
    </div>`;
}

function renderModalEditStudent(data) {
  const st = data.student || state.students.find(s => s.id === (data.id || state.editingId));
  if (!st) return `<p>내담자를 찾을 수 없습니다</p>`;
  const grades = ['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'];
  const genderOpts = [['', '미기재'], ['남', '남'], ['여', '여']];
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">내담자 정보 수정</div>
    <div class="form-group">
      <label class="form-label">식별 코드</label>
      <input class="form-input" id="falias" value="${esc(st.alias)}" autocomplete="off" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">학년</label>
        <select class="form-select" id="fg">
          ${grades.map(g => `<option${g === st.grade ? ' selected' : ''}>${g}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">성별</label>
        <select class="form-select" id="fgd">
          ${genderOpts.map(([v, l]) => `<option value="${v}"${v === st.gender ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">가족관계 / 가정환경</label>
      <textarea class="form-textarea" id="ffamily" style="min-height:50px;">${esc(st.family || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">교우관계 / 학교생활</label>
      <textarea class="form-textarea" id="fpeers" style="min-height:50px;">${esc(st.peers || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">현재 상황 및 배경</label>
      <textarea class="form-textarea" id="fsituation" style="min-height:50px;">${esc(st.situation || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">기타 메모</label>
      <textarea class="form-textarea" id="fnotes">${esc(st.notes || '')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary" onclick="modalUpdateStudent('${esc(st.id)}')">저장</button>
    </div>`;
}

function renderModalVerbatim() {
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">축어록 첨부</div>
    <div class="form-group">
      <label class="form-label">직접 붙여넣기 또는 파일 불러오기</label>
      <textarea class="form-textarea vt-textarea" id="modal-verbatim-text" style="min-height:200px;"
        placeholder="상담자: 안녕하세요, 오늘은 어땠어요?&#10;내담자: 그냥 그래요...&#10;&#10;클로바 노트 등 STT 결과를 그대로 붙여넣어도 됩니다."></textarea>
    </div>
    <div style="margin-bottom:12px;">
      <label class="file-btn">파일 불러오기 (.txt)
        <input type="file" accept=".txt" style="display:none;" onchange="loadVerbatimToModal(this)" />
      </label>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary" onclick="attachVerbatimFromModal()">첨부</button>
    </div>`;
}

function renderModalWrite() {
  const today = new Date().toISOString().split('T')[0];
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">직접 쓰기</div>
    <div class="form-group">
      <label class="form-label">날짜</label>
      <input class="form-input" id="modal-write-date" type="date" value="${today}" />
    </div>
    <div class="form-group">
      <label class="form-label">내용</label>
      <textarea class="form-textarea my-content-input" id="modal-write-content" style="min-height:180px;"
        placeholder="자유롭게 기록하세요. 마크다운을 지원합니다.&#10;**굵게** · *기울임* · --- (구분선)"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">메모 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span></label>
      <textarea class="form-textarea" id="modal-write-memo" style="min-height:50px;"
        placeholder="짧은 메모"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary-my" onclick="saveWriteRecord()">저장</button>
    </div>`;
}

function renderModalMode() {
  const modes = [
    { id: 'general',        label: '일반 대화',   desc: '자유롭게 이야기하기' },
    { id: 'supervision',    label: '슈퍼비전',    desc: '축어록 기반 임상 슈퍼비전' },
    { id: 'diary-convert',  label: '일기 변환',   desc: '대화를 일기로 요약 저장' },
  ];
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">대화 모드 선택</div>
    ${modes.map(m => `
      <div class="pm-item" onclick="selectChatMode('${m.id}')"
        style="${state.chatMode === m.id ? 'background:var(--color-bg-secondary);' : ''}">
        <div>
          <div style="font-weight:500;">${esc(m.label)}</div>
          <div style="font-size:11px;color:var(--color-text-tertiary);">${esc(m.desc)}</div>
        </div>
        ${state.chatMode === m.id ? '<span style="margin-left:auto;">✓</span>' : ''}
      </div>`).join('')}
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">닫기</button>
    </div>`;
}

function renderModalReport(analysis) {
  if (!analysis) return `<p>보고서가 없습니다</p>`;
  const student = state.students.find(s => s.id === state.selStudent);
  const session = state.sessions.find(s => s.id === state.selSession);
  const sections = [
    { key: 'clientState',  label: '내담자 상태' },
    { key: 'techniques',   label: '기법 평가' },
    { key: 'strengths',    label: '잘한 점' },
    { key: 'improvements', label: '개선 포인트' },
    { key: 'overall',      label: '종합 슈퍼비전' },
  ];
  const meta = student
    ? `${esc(student.alias)}${session ? ` · ${session.sessionNum}회기 · ${session.date}` : ''}`
    : '';
  const body = sections.map(s => analysis[s.key] ? `
    <div style="margin-bottom:14px;">
      <div style="font-size:11px;font-weight:600;color:var(--color-text-tertiary);margin-bottom:4px;">${esc(s.label)}</div>
      <div style="font-size:13px;line-height:1.7;">${esc(analysis[s.key]).replace(/\n/g,'<br>')}</div>
    </div>` : '').join('');

  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">슈퍼비전 보고서</div>
    ${meta ? `<div style="font-size:12px;color:var(--color-text-tertiary);margin-bottom:14px;">${meta}</div>` : ''}
    ${body}
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">닫기</button>
      <button class="btn-secondary" onclick="closeModal();startSupervisionFromReport(window._lastAnalysis)">슈퍼비전 대화 시작</button>
      <button class="btn-primary" onclick="saveReportToSession(window._lastAnalysis)">이 회기에 저장</button>
    </div>`;
}

function renderModalDiaryResult(draft, date) {
  const today = date || new Date().toISOString().split('T')[0];
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">일기 변환 결과</div>
    <div class="form-group">
      <label class="form-label">날짜</label>
      <input class="form-input" id="modal-diary-date" type="date" value="${today}" />
    </div>
    <div class="form-group">
      <label class="form-label">내용 (수정 가능)</label>
      <textarea class="form-textarea my-content-input" id="modal-diary-content"
        style="min-height:200px;">${esc(draft || '')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">닫기</button>
      <button class="btn-primary-my" onclick="saveDiaryRecord()">기록 저장</button>
    </div>`;
}

function renderModalPattern(result) {
  if (!result) return `<p>분석 결과가 없습니다</p>`;
  const sections = Object.entries(result)
    .filter(([k]) => !['savedAt', 'period'].includes(k))
    .map(([k, v]) => `
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:600;color:var(--color-text-tertiary);margin-bottom:4px;">${esc(k)}</div>
        <div style="font-size:13px;line-height:1.7;">${esc(String(v)).replace(/\n/g,'<br>')}</div>
      </div>`).join('');
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">패턴 분석</div>
    ${result.period ? `<div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:12px;">${esc(result.period)}</div>` : ''}
    ${sections}
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">닫기</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// 모달 전용 저장 함수
// ---------------------------------------------------------------------------

function modalSaveTopic() {
  const title = (document.getElementById('ft-title')?.value || '').trim();
  if (!title) { alert('주제 이름을 입력해주세요'); return; }
  const topic = {
    id: 't' + Date.now(), title,
    aiPrompt:  (document.getElementById('ft-prompt')?.value || '').trim(),
    createdAt: new Date().toISOString().split('T')[0],
  };
  state.myTopics.push(topic);
  state.selTopic  = topic.id;
  state.selRecord = null;
  state.myMode    = 'list';
  state.view      = 'myrecords';
  saveData();
  closeModal();
  render();
  showToast('주제가 추가되었습니다');
}

function modalUpdateTopic(id) {
  const topic = state.myTopics.find(t => t.id === id);
  if (!topic) return;
  const title = (document.getElementById('ft-title')?.value || '').trim();
  if (!title) { alert('주제 이름을 입력해주세요'); return; }
  topic.title    = title;
  topic.aiPrompt = (document.getElementById('ft-prompt')?.value || '').trim();
  saveData();
  closeModal();
  render();
  showToast('주제가 수정되었습니다');
}

function modalSaveStudent() {
  const alias = (document.getElementById('falias')?.value || '').trim();
  if (!alias) { alert('식별 코드를 입력해주세요'); return; }
  const student = {
    id: 's' + Date.now(), alias,
    grade:     document.getElementById('fg')?.value || '중1',
    gender:    document.getElementById('fgd')?.value || '',
    family:    (document.getElementById('ffamily')?.value || '').trim(),
    peers:     (document.getElementById('fpeers')?.value || '').trim(),
    situation: (document.getElementById('fsituation')?.value || '').trim(),
    notes:     (document.getElementById('fnotes')?.value || '').trim(),
    createdAt: new Date().toISOString().split('T')[0],
  };
  state.students.push(student);
  state.selStudent = student.id;
  state.selSession = null;
  state.mode       = 'list';
  state.view       = 'student';
  saveData();
  closeModal();
  render();
  showToast('내담자가 추가되었습니다');
}

function modalUpdateStudent(id) {
  const st = state.students.find(s => s.id === id);
  if (!st) return;
  const alias = (document.getElementById('falias')?.value || '').trim();
  if (!alias) { alert('식별 코드를 입력해주세요'); return; }
  st.alias     = alias;
  st.grade     = document.getElementById('fg')?.value || st.grade;
  st.gender    = document.getElementById('fgd')?.value ?? st.gender;
  st.family    = (document.getElementById('ffamily')?.value || '').trim();
  st.peers     = (document.getElementById('fpeers')?.value || '').trim();
  st.situation = (document.getElementById('fsituation')?.value || '').trim();
  st.notes     = (document.getElementById('fnotes')?.value || '').trim();
  saveData();
  closeModal();
  render();
  showToast('내담자 정보가 수정되었습니다');
}

// 축어록 파일 불러오기 (모달 내)
function loadVerbatimToModal(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const ta = document.getElementById('modal-verbatim-text');
    if (ta) ta.value = e.target.result;
  };
  reader.readAsText(file, 'utf-8');
}

// 축어록 첨부 확정
function attachVerbatimFromModal() {
  const text = (document.getElementById('modal-verbatim-text')?.value || '').trim();
  if (!text) { alert('축어록을 입력하거나 파일을 불러와주세요'); return; }
  state.attachedVerbatim = text;
  closeModal();
  showToast('축어록이 첨부되었습니다');
  renderRightPanel();
}

// 직접 쓰기 저장
function saveWriteRecord() {
  if (!state.selTopic) { alert('주제를 먼저 선택해주세요'); return; }
  const date    = document.getElementById('modal-write-date')?.value || new Date().toISOString().split('T')[0];
  const content = (document.getElementById('modal-write-content')?.value || '').trim();
  if (!content) { alert('내용을 입력해주세요'); return; }
  const record = {
    id: 'r' + Date.now(),
    topicId:   state.selTopic,
    date,
    recordNum: getNextRecordNum(state.selTopic),
    content,
    memo:      (document.getElementById('modal-write-memo')?.value || '').trim(),
    tags:      [],
    analysis:  null,
    aiChat:    [],
  };
  state.myRecords.push(record);
  state.selRecord = record.id;
  saveData();
  closeModal();
  render();
  showToast('기록이 저장되었습니다');
}

// 대화 모드 선택
function selectChatMode(mode) {
  state.chatMode = mode;
  closeModal();
  const label = { general: '일반 대화', supervision: '슈퍼비전', 'diary-convert': '일기 변환' }[mode] || mode;
  showToast(`모드: ${label}`);
  renderRightPanel();
}

// 일기 저장 (diary-result 모달에서)
function saveDiaryRecord() {
  if (!state.selTopic) { alert('주제를 먼저 선택해주세요'); return; }
  const date    = document.getElementById('modal-diary-date')?.value || new Date().toISOString().split('T')[0];
  const content = (document.getElementById('modal-diary-content')?.value || '').trim();
  if (!content) { alert('내용을 입력해주세요'); return; }
  const record = {
    id: 'r' + Date.now(),
    topicId:   state.selTopic,
    date,
    recordNum: getNextRecordNum(state.selTopic),
    content,
    memo:      '',
    tags:      [],
    analysis:  null,
    aiChat:    [...(state.currentChatMessages || [])],
  };
  state.myRecords.push(record);
  state.selRecord = record.id;
  saveData();
  closeModal();
  render();
  showToast('기록이 저장되었습니다');
}

// 보고서 → 회기 저장
function saveReportToSession(analysis) {
  if (!analysis) return;
  let session = state.sessions.find(s => s.id === state.selSession);
  if (!session) {
    const studentId = state.selStudent;
    if (!studentId) { showToast('내담자를 먼저 선택해주세요'); return; }
    session = {
      id:          'ss' + Date.now(),
      studentId,
      date:        new Date().toISOString().split('T')[0],
      sessionNum:  getNextSessionNum(studentId),
      verbatim:    state.attachedVerbatim || '',
      memo:        '',
      tags:        [],
      analysis:    null,
      supervisionChat: [],
    };
    state.sessions.push(session);
    state.selSession = session.id;
  }
  session.analysis = analysis;
  if (state.attachedVerbatim) session.verbatim = state.attachedVerbatim;
  saveData();
  closeModal();
  render();
  showToast('보고서가 저장되었습니다');
}

// 슈퍼비전 대화 시작 (보고서 팝업에서)
function startSupervisionFromReport(analysis) {
  closeModal();
  state.chatMode = 'supervision';
  renderRightPanel();
}

// ---------------------------------------------------------------------------
// 대화 요약 모달 (나의 기록 — 오늘 대화 → 기록 저장)
// ---------------------------------------------------------------------------

function renderModalChatSummary(data) {
  const today = new Date().toISOString().split('T')[0];
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">대화 요약 · ${esc(data.topic?.title || '')}</div>
    <div class="form-group">
      <label class="form-label">날짜</label>
      <input class="form-input" id="modal-summary-date" type="date" value="${today}" />
    </div>
    <div class="form-group">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <label class="form-label" style="margin:0;">내용 편집</label>
        <button class="btn-secondary" style="font-size:11px;padding:3px 8px;"
          onclick="toggleSummaryFindReplace()">찾기/바꾸기</button>
      </div>
      <div id="summary-find-replace" style="display:none;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        <input id="summary-find-input" class="form-input" style="flex:1;min-width:80px;" placeholder="찾을 단어" />
        <input id="summary-replace-input" class="form-input" style="flex:1;min-width:80px;" placeholder="바꿀 단어" />
        <button class="btn-secondary" style="font-size:11px;" onclick="applySummaryFindReplace()">바꾸기</button>
      </div>
      <textarea class="form-textarea my-content-input" id="modal-summary-content"
        style="min-height:240px;line-height:1.8;">${esc(data.text || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">메모 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span></label>
      <textarea class="form-textarea" id="modal-summary-memo" style="min-height:50px;"
        placeholder="짧은 메모"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary-my" onclick="saveSummaryAsRecord()">기록으로 저장</button>
    </div>`;
}

function toggleSummaryFindReplace() {
  const el = document.getElementById('summary-find-replace');
  if (!el) return;
  el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
}

function applySummaryFindReplace() {
  const find    = document.getElementById('summary-find-input')?.value;
  const replace = document.getElementById('summary-replace-input')?.value || '';
  const ta      = document.getElementById('modal-summary-content');
  if (!find || !ta) return;
  ta.value = ta.value.split(find).join(replace);
}

function saveSummaryAsRecord() {
  const content = document.getElementById('modal-summary-content')?.value.trim();
  const memo    = document.getElementById('modal-summary-memo')?.value.trim() || '';
  const date    = document.getElementById('modal-summary-date')?.value
                || new Date().toISOString().split('T')[0];
  if (!content) { showToast('내용을 입력해주세요.'); return; }
  if (!state.selTopic) { showToast('주제를 선택해주세요.'); return; }

  const topicRecords = state.myRecords.filter(r => r.topicId === state.selTopic);
  const maxNum = topicRecords.length ? Math.max(...topicRecords.map(r => r.recordNum)) : 0;

  state.myRecords.push({
    id:        'r' + Date.now(),
    topicId:   state.selTopic,
    date,
    recordNum: maxNum + 1,
    content,
    memo,
    tags:      [],
    analysis:  null,
    aiChat:    [],
  });

  saveData();
  closeModal();
  showToast('기록으로 저장됐어요.');
  render();
}

// ---------------------------------------------------------------------------
// 토스트
// ---------------------------------------------------------------------------

function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}
