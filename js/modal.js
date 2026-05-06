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
  box.className = `modal-box modal-${id}`;
  box.innerHTML = buildModalHTML(id, data);
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  state.activeModal = null;
  document.getElementById('modal-overlay').classList.remove('open');
  const box = document.getElementById('modal-box');
  if (box) {
    box.innerHTML = '';
    box.className = 'modal-box';
  }
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
    case 'record-detail': return renderModalRecordDetail(data);
    case 'session-detail':return renderModalSessionDetail(data);
    case 'new-session':   return renderModalNewSession();
    case 'edit-session':  return renderModalEditSession(data);
    case 'edit-record':   return renderModalEditRecord(data);
    case 'verbatim':      return renderModalVerbatim();
    case 'write':         return renderModalWrite();
    case 'mode':          return renderModalMode();
    case 'reply-mode':    return renderModalReplyMode();
    case 'report':        return renderModalReport(data.analysis);
    case 'diary-result':  return renderModalDiaryResult(data.draft, data.date);
    case 'pattern':       return renderModalPattern(data.result);
    case 'chat-summary':  return renderModalChatSummary(data);
    case 'custom-role':   return renderModalCustomRole(data);
    case 'investment-portfolio': return renderModalInvestmentPortfolio();
    case 'investment-rules':     return renderModalInvestmentRules();
    case 'investment-decisions': return renderModalInvestmentDecisions();
    case 'investment-news':      return renderModalInvestmentNews();
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
      <label class="form-label">AI 역할 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span></label>
      <div class="role-preset-grid">${presetBtns}</div>
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
    <div class="form-collapsible-toggle" onclick="toggleStudentBgInfo(this)">
      배경 정보 추가 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span>
      <span class="collapsible-arrow">▸</span>
    </div>
    <div class="form-collapsible-body" id="student-bg-info" style="display:none;">
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

// ---------------------------------------------------------------------------
// 기록 상세 팝업 (나의 기록)
// ---------------------------------------------------------------------------

function renderModalRecordDetail(data) {
  const record = state.myRecords.find(r => r.id === data.id);
  if (!record) return `<p>기록을 찾을 수 없습니다</p>`;
  const topic = state.myTopics.find(t => t.id === record.topicId);
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">${esc(topic?.title || '')} · ${record.recordNum}번째</div>
    <div style="font-size:12px;color:var(--color-text-tertiary);margin-bottom:16px;">${esc(record.date)}</div>
    <div class="detail-modal-content">${renderMd(record.content)}</div>
    ${record.memo ? `
      <div class="detail-modal-memo-label">메모</div>
      <div class="detail-modal-memo">${esc(record.memo)}</div>` : ''}
    <div class="modal-footer">
      <button class="btn-secondary" style="color:#b94040;" onclick="_showInlineDeleteConfirm('record','${record.id}')">삭제</button>
      <button class="btn-secondary" onclick="closeModal();openModal('edit-record',{id:'${record.id}'})">수정</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// 회기 상세 팝업 (상담 기록)
// ---------------------------------------------------------------------------

function renderModalSessionDetail(data) {
  const session = state.sessions.find(s => s.id === data.id);
  if (!session) return `<p>회기를 찾을 수 없습니다</p>`;
  const student = state.students.find(s => s.id === session.studentId);
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">${esc(student?.alias || '')} · ${session.sessionNum}회기</div>
    <div style="font-size:12px;color:var(--color-text-tertiary);margin-bottom:16px;">${esc(session.date)}</div>
    ${session.verbatim ? `
      <div class="detail-modal-memo-label">축어록</div>
      <div class="detail-modal-verbatim">${esc(session.verbatim)}</div>` :
      '<div style="font-size:13px;color:var(--color-text-tertiary);font-style:italic;">축어록 없음</div>'}
    ${session.memo ? `
      <div class="detail-modal-memo-label" style="margin-top:14px;">메모</div>
      <div class="detail-modal-memo">${esc(session.memo)}</div>` : ''}
    ${session.analysis ? `
      <div class="detail-modal-memo-label" style="margin-top:14px;">슈퍼비전 보고서</div>
      <div style="font-size:13px;">
        <button class="btn-link" onclick="closeModal();openModal('report',{analysis:state.sessions.find(s=>s.id==='${session.id}').analysis})">보고서 보기 →</button>
      </div>` : ''}
    <div class="modal-footer">
      <button class="btn-secondary" style="color:#b94040;" onclick="_showInlineDeleteConfirm('session','${session.id}')">삭제</button>
      <button class="btn-secondary" onclick="closeModal();openModal('edit-session',{id:'${session.id}'})">수정</button>
      <button class="btn-primary" onclick="closeModal()">AI 슈퍼비전</button>
    </div>`;
}

function renderModalNewSession() {
  const today = new Date().toISOString().split('T')[0];
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">새 회기 추가</div>
    <div class="form-group">
      <label class="form-label">날짜</label>
      <input class="form-input" id="fss-date" type="date" value="${today}" />
    </div>
    <div class="form-group">
      <label class="form-label">축어록 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span></label>
      <textarea class="form-textarea" id="fss-verbatim" style="min-height:140px;"
        placeholder="상담 내용을 기록하세요. STT 결과를 붙여넣어도 됩니다."></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">메모 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span></label>
      <textarea class="form-textarea" id="fss-memo" style="min-height:60px;"
        placeholder="짧은 메모"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary" onclick="modalSaveSession()">저장</button>
    </div>`;
}

function renderModalEditSession(data) {
  const session = data.session || state.sessions.find(s => s.id === (data.id || state.editingId));
  if (!session) return `<p>회기를 찾을 수 없습니다</p>`;
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">${session.sessionNum}회기 수정</div>
    <div class="form-group">
      <label class="form-label">날짜</label>
      <input class="form-input" id="fss-date" type="date" value="${esc(session.date)}" />
    </div>
    <div class="form-group">
      <label class="form-label">축어록 <span style="color:var(--color-text-tertiary);font-weight:400;">— 문단 단위로 나뉩니다</span></label>
      <div id="block-editor-verbatim" class="block-editor">${renderBlockEditor(session.verbatim || '', 'verbatim')}</div>
      <button type="button" class="block-add-btn" onclick="addBlockToEditor('block-editor-verbatim','verbatim')">+ 문단 추가</button>
    </div>
    <div class="form-group">
      <label class="form-label">메모</label>
      <textarea class="form-textarea" id="fss-memo" style="min-height:60px;">${esc(session.memo || '')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary" onclick="modalUpdateSession('${esc(session.id)}')">저장</button>
    </div>`;
}

function renderModalEditRecord(data) {
  const record = data.record || state.myRecords.find(r => r.id === (data.id || state.editingId));
  if (!record) return `<p>기록을 찾을 수 없습니다</p>`;
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">${record.recordNum}번째 기록 수정</div>
    <div class="form-group">
      <label class="form-label">날짜</label>
      <input class="form-input" id="frec-date" type="date" value="${esc(record.date)}" />
    </div>
    <div class="form-group">
      <label class="form-label">내용 <span style="color:var(--color-text-tertiary);font-weight:400;">— 문단 단위로 나뉩니다</span></label>
      <div id="block-editor-content" class="block-editor">${renderBlockEditor(record.content || '', 'content')}</div>
      <button type="button" class="block-add-btn" onclick="addBlockToEditor('block-editor-content','content')">+ 문단 추가</button>
    </div>
    <div class="form-group">
      <label class="form-label">메모 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span></label>
      <textarea class="form-textarea" id="frec-memo" style="min-height:60px;">${esc(record.memo || '')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary-my" onclick="modalUpdateRecord('${esc(record.id)}')">저장</button>
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
    { id: 'general',     label: '일반 대화', desc: '자유롭게 이야기하기' },
    { id: 'supervision', label: '슈퍼비전',  desc: '축어록 기반 임상 슈퍼비전' },
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

function renderModalReplyMode() {
  const modes = [
    {
      id: 'dictation',
      label: '받아쓰기',
      desc: 'AI가 답하지 않고, 내가 쓰는 말을 조용히 쌓아둡니다.',
    },
    {
      id: 'question',
      label: '답변',
      desc: '내 질문에 바로 답합니다. 되묻지 않습니다.',
    },
    {
      id: 'summary',
      label: '정리',
      desc: '지금까지의 말을 기록 초안처럼 간단히 정리합니다.',
    },
    {
      id: 'advice',
      label: '조언',
      desc: '의견이나 다음 행동이 필요할 때만 짧게 조언받습니다.',
    },
  ];
  return `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">AI 응답 방식</div>
    <div class="reply-mode-options">
      ${modes.map(m => `
        <button class="reply-mode-option${state.replyMode === m.id ? ' active' : ''}"
          id="reply-mode-${m.id}" onclick="selectReplyModeFromModal('${m.id}')" type="button">
          <span class="reply-mode-option-label">${esc(m.label)}</span>
          <span class="reply-mode-option-desc">${esc(m.desc)}</span>
        </button>`).join('')}
    </div>
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
  // 프리셋이 선택된 경우 해당 preset의 prompt 사용; 없으면 기본값
  const selectedPresetId = document.querySelector('.role-preset-btn.active')?.dataset?.id || 'listener';
  const selectedPreset = AI_ROLE_PRESETS.find(p => p.id === selectedPresetId);
  const topic = {
    id: 't' + Date.now(), title,
    aiPrompt:     selectedPreset?.prompt || '',
    selectedRole: selectedPresetId,
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

function modalSaveSession() {
  if (!state.selStudent) { alert('내담자를 먼저 선택해주세요'); return; }
  const date     = document.getElementById('fss-date')?.value || new Date().toISOString().split('T')[0];
  const verbatim = (document.getElementById('fss-verbatim')?.value || '').trim();
  const memo     = (document.getElementById('fss-memo')?.value || '').trim();
  const session = {
    id:              'ss' + Date.now(),
    studentId:       state.selStudent,
    date,
    sessionNum:      getNextSessionNum(state.selStudent),
    verbatim,
    memo,
    tags:            [],
    analysis:        null,
    supervisionChat: [],
  };
  state.sessions.push(session);
  state.selSession = session.id;
  saveData();
  closeModal();
  render();
  showToast('회기가 추가되었습니다');
}

function modalUpdateSession(id) {
  const session = state.sessions.find(s => s.id === id);
  if (!session) return;
  session.date     = document.getElementById('fss-date')?.value || session.date;
  session.verbatim = collectBlocks('verbatim');
  session.memo     = (document.getElementById('fss-memo')?.value || '').trim();
  saveData();
  closeModal();
  render();
  showToast('회기가 수정되었습니다');
}

function modalUpdateRecord(id) {
  const record = state.myRecords.find(r => r.id === id);
  if (!record) return;
  record.date    = document.getElementById('frec-date')?.value || record.date;
  record.content = collectBlocks('content');
  record.memo    = (document.getElementById('frec-memo')?.value || '').trim();
  saveData();
  closeModal();
  render();
  showToast('기록이 수정되었습니다');
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

// 새 주제 모달 — 프리셋 버튼 활성화
function selectRolePreset(presetId) {
  document.querySelectorAll('.role-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.id === presetId);
  });
}

// 배경 정보 접기/펼치기
function toggleStudentBgInfo(btn) {
  const body = document.getElementById('student-bg-info');
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? '' : 'none';
  const arrow = btn.querySelector('.collapsible-arrow');
  if (arrow) arrow.textContent = open ? '▾' : '▸';
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
// 팝업 내 삭제 — 인라인 확인 방식 (confirm() 대신 사용, iOS 호환)
// ---------------------------------------------------------------------------

function _showInlineDeleteConfirm(type, id) {
  logger.debug('[DELETE] _showInlineDeleteConfirm called', type, id);
  const footer = document.querySelector('#modal-box .modal-footer');
  if (!footer) { logger.error('[DELETE] modal-footer not found'); return; }
  footer.innerHTML = `
    <span style="font-size:12px;color:var(--color-text-secondary);margin-right:auto;">정말 삭제할까요?</span>
    <button class="btn-secondary" onclick="closeModal()">아니오</button>
    <button class="btn-secondary" style="color:#b94040;border-color:rgba(185,64,64,0.3);"
      onclick="_executeModalDelete('${type}','${id}')">삭제</button>
  `;
}

function _executeModalDelete(type, id) {
  logger.debug('[DELETE] _executeModalDelete called', type, id);
  if (type === 'record') {
    state.myRecords = state.myRecords.filter(r => r.id !== id);
    if (state.selRecord === id) {
      state.selRecord = null;
      state.myMode = state.selTopic ? 'list' : 'welcome';
    }
    saveData();
    closeModal();
    render();
    showToast('기록이 삭제되었습니다');
  } else if (type === 'session') {
    state.sessions = state.sessions.filter(s => s.id !== id);
    if (state.selSession === id) {
      state.selSession = null;
      state.mode = state.selStudent ? 'list' : 'welcome';
    }
    saveData();
    closeModal();
    render();
    showToast('회기가 삭제되었습니다');
  }
}

// ---------------------------------------------------------------------------
// 블록 에디터 (문단 단위 편집)
// ---------------------------------------------------------------------------

function renderBlockEditor(content, fieldName) {
  const blocks = (content || '').split(/\n\n+/).map(b => b.trim()).filter(Boolean);
  if (!blocks.length) blocks.push('');
  return blocks.map((block, i) => _renderBlockItem(block, fieldName, i)).join('');
}

function _renderBlockItem(text, fieldName, idx) {
  return `<div class="block-item" data-field="${fieldName}">
    <textarea class="block-textarea" oninput="autoResizeBlock(this)"
      onkeydown="blockKeydown(event,this,'${fieldName}')"
    >${esc(text)}</textarea>
    <div class="block-item-actions">
      <button type="button" class="block-btn block-btn-del"
        onclick="removeBlock(this,'${fieldName}')" title="이 문단 삭제">×</button>
    </div>
  </div>`;
}

function collectBlocks(fieldName) {
  const blocks = document.querySelectorAll(`.block-item[data-field="${fieldName}"] .block-textarea`);
  return Array.from(blocks).map(ta => ta.value.trim()).filter(Boolean).join('\n\n');
}

function addBlockToEditor(editorId, fieldName) {
  const editor = document.getElementById(editorId);
  if (!editor) return;
  const div = document.createElement('div');
  div.innerHTML = _renderBlockItem('', fieldName, Date.now());
  const newItem = div.firstElementChild;
  editor.appendChild(newItem);
  const ta = newItem.querySelector('.block-textarea');
  ta.focus();
  autoResizeBlock(ta);
}

function removeBlock(btn, fieldName) {
  const items = document.querySelectorAll(`.block-item[data-field="${fieldName}"]`);
  if (items.length <= 1) {
    btn.closest('.block-item').querySelector('.block-textarea').value = '';
    return;
  }
  btn.closest('.block-item').remove();
}

function autoResizeBlock(ta) {
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight) + 'px';
}

// Enter 두 번 → 새 블록, Backspace on empty → 위 블록으로 포커스
function blockKeydown(e, ta, fieldName) {
  if (e.key === 'Enter' && !e.shiftKey) {
    const val = ta.value;
    const pos = ta.selectionStart;
    // 커서 앞뒤 두 개 이상의 줄바꿈 = 블록 분리 신호
    if (pos > 0 && val[pos - 1] === '\n') {
      e.preventDefault();
      // 현재 블록 내용을 분리
      const before = val.slice(0, pos - 1).trimEnd();
      const after  = val.slice(pos).trimStart();
      ta.value = before;
      autoResizeBlock(ta);
      const editor = ta.closest('.block-editor');
      const currentItem = ta.closest('.block-item');
      const div = document.createElement('div');
      div.innerHTML = _renderBlockItem(after, fieldName, Date.now());
      const newItem = div.firstElementChild;
      currentItem.after(newItem);
      const newTa = newItem.querySelector('.block-textarea');
      newTa.focus();
      newTa.selectionStart = newTa.selectionEnd = 0;
      autoResizeBlock(newTa);
    }
  } else if (e.key === 'Backspace' && ta.value === '') {
    const items = document.querySelectorAll(`.block-item[data-field="${fieldName}"]`);
    if (items.length <= 1) return;
    e.preventDefault();
    const currentItem = ta.closest('.block-item');
    const prev = currentItem.previousElementSibling;
    currentItem.remove();
    if (prev) {
      const prevTa = prev.querySelector('.block-textarea');
      prevTa.focus();
      prevTa.selectionStart = prevTa.selectionEnd = prevTa.value.length;
    }
  }
}

// ---------------------------------------------------------------------------
// AI 역할 직접 입력 모달
// ---------------------------------------------------------------------------

function renderModalCustomRole(data) {
  const topic = state.myTopics.find(t => t.id === state.selTopic);
  const current = topic?.aiPrompt || '';
  return `
    <div class="modal-header">
      <div class="modal-title" style="color:#1D9E75;">AI 역할 직접 설정</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body" style="padding:20px 24px;">
      <p style="font-size:13px;color:var(--color-text-secondary);margin-bottom:14px;line-height:1.6;">
        이 주제에서 AI가 어떤 역할을 해줬으면 하는지 자유롭게 입력해주세요.
      </p>
      <textarea id="custom-role-input"
        placeholder="예: 나의 하루를 들어주고 감정을 정리하도록 도와주는 친구처럼&#10;예: 임용 공부 중 막히는 지점을 같이 생각해주는 학습 코치처럼"
        style="width:100%;min-height:110px;padding:10px 12px;font-size:13px;font-family:var(--font);
               border:0.5px solid var(--color-border-strong);border-radius:var(--radius-md);
               background:var(--color-bg);color:var(--color-text);resize:vertical;line-height:1.6;
               box-sizing:border-box;"
      >${esc(current)}</textarea>
    </div>
    <div class="modal-footer" style="padding:12px 24px;display:flex;justify-content:flex-end;gap:8px;border-top:0.5px solid var(--color-border);">
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary" style="background:#1D9E75;border-color:#1D9E75;" onclick="saveCustomRole()">적용</button>
    </div>`;
}

function saveCustomRole() {
  const input = document.getElementById('custom-role-input');
  const roleText = input?.value.trim();
  if (roleText === null || roleText === undefined) { closeModal(); return; }

  const topic = state.myTopics.find(t => t.id === state.selTopic);
  if (topic) {
    topic.aiPrompt    = roleText;
    topic.selectedRole = 'custom';
    saveData();
  }
  state.currentRole = 'custom';

  // 대화 중 역할 변경 알림
  if (state.currentChatMessages.length > 0) {
    appendSystemMessage(`— AI 역할이 '직접 입력'으로 변경되었습니다 —`);
  }

  closeModal();
  renderRightPanel();
  updateContextChip();
}

// ---------------------------------------------------------------------------
// 토스트
// ---------------------------------------------------------------------------

function showToast(msg, opts = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  if (el._hideTimer) clearTimeout(el._hideTimer);

  if (opts.action) {
    el.innerHTML = `<span>${msg}</span><button class="toast-action-btn" id="toast-action-btn">${opts.btnLabel || '보기'}</button>`;
    el.classList.add('show', 'toast-has-action');
    el.style.pointerEvents = 'auto';
    document.getElementById('toast-action-btn').onclick = () => {
      el.classList.remove('show', 'toast-has-action');
      el.style.pointerEvents = 'none';
      opts.action();
    };
  } else {
    el.innerHTML = '';
    el.textContent = msg;
    el.classList.remove('toast-has-action');
    el.classList.add('show');
    el.style.pointerEvents = 'none';
    el._hideTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
}
