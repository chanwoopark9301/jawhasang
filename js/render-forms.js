/* =============================================
   自畵像 — 폼 렌더링 (새로 만들기 + 수정)
   의존성: state.js, utils.js
   ============================================= */

// ---------------------------------------------------------------------------
// 상담 기록 — 새 내담자 폼
// ---------------------------------------------------------------------------

function renderNewStudentForm() {
  return `<div>
    <div class="form-notice">
      개인정보 보호 — 실명을 입력하지 마세요. 본인만 알 수 있는 코드를 사용하세요.<br>
      모든 데이터는 암호화되어 저장됩니다.
    </div>
    <div class="form-group">
      <label class="form-label">식별 코드 (예: 별-01, A03, 파란)</label>
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
    <div class="btn-row">
      <button class="btn-secondary" onclick="cancelForm()">취소</button>
      <button class="btn-primary" onclick="saveStudent()">등록</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 상담 기록 — 내담자 수정 폼
// ---------------------------------------------------------------------------

function renderEditStudentForm(st) {
  const grades = ['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'];
  const genderOpts = [['', '미기재'], ['남', '남'], ['여', '여']];
  return `<div>
    <div class="form-notice">내담자 정보를 수정합니다.</div>
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
    <div class="form-section-title">배경 정보</div>
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
    <div class="btn-row">
      <button class="btn-secondary" onclick="cancelEditStudent()">취소</button>
      <button class="btn-primary" onclick="updateStudent()">저장</button>
    </div>
  </div>`;
}

function cancelEditStudent() {
  state.editingId = null;
  state.mode = state.selStudent ? 'list' : 'welcome';
  render();
}

// ---------------------------------------------------------------------------
// 상담 기록 — 새 회기 폼
// ---------------------------------------------------------------------------

function renderNewSessionForm() {
  const studentSelect = !state.selStudent ? `
    <div class="form-group">
      <label class="form-label">내담자</label>
      <select class="form-select" id="fst">
        ${state.students.map(s => `<option value="${s.id}">${esc(s.alias)} (${esc(s.grade)})</option>`).join('')}
      </select>
    </div>` : '';

  const today = new Date().toISOString().split('T')[0];

  return `<div>
    ${studentSelect}
    <div class="form-group">
      <label class="form-label">날짜</label>
      <input class="form-input" id="fd" type="date" value="${today}" />
    </div>
    <div class="form-group">
      <div class="vt-input-header">
        <label class="form-label" style="margin:0;">축어록</label>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="verbatim-char-count" id="vt-char-count">0자</span>
          <label class="file-btn">
            파일 불러오기 (.txt)
            <input type="file" accept=".txt" style="display:none;" onchange="loadVerbatimFile(this)" />
          </label>
        </div>
      </div>
      <textarea class="form-textarea vt-textarea" id="fv"
        oninput="updateVerbatimCounter(this.value)"
        placeholder="상담자: 안녕하세요, 오늘은 어땠어요?&#10;내담자: 그냥 그래요...&#10;&#10;클로바 노트 등 STT 결과를 그대로 붙여넣어도 됩니다."></textarea>
      <div class="verbatim-long-notice" id="vt-long-notice" style="display:none">
        긴 축어록 모드 — 보고서 생성 시 핵심 장면을 먼저 추출한 뒤 1페이지 보고서를 작성합니다.
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">메모 (선택)</label>
      <textarea class="form-textarea" id="fmemo" style="min-height:50px;"
        placeholder="회기 특이사항, 비언어적 반응 등"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">태그 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택, 쉼표로 구분)</span></label>
      <input class="form-input" id="ftags" placeholder="예: 불안, 가족갈등, CBT" autocomplete="off" />
    </div>
    <div class="btn-row">
      <button class="btn-secondary" onclick="cancelForm()">취소</button>
      <button class="btn-primary" onclick="saveSession()">저장</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 상담 기록 — 회기 수정 폼
// ---------------------------------------------------------------------------

function renderEditSessionForm(session) {
  const tagsVal = esc((session.tags || []).join(', '));
  return `<div>
    <div class="form-group">
      <label class="form-label">날짜</label>
      <input class="form-input" id="fd" type="date" value="${session.date}" />
    </div>
    <div class="form-group">
      <div class="vt-input-header">
        <label class="form-label" style="margin:0;">축어록</label>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="verbatim-char-count" id="vt-char-count">${(session.verbatim || '').length}자</span>
          <label class="file-btn">파일 불러오기 (.txt)
            <input type="file" accept=".txt" style="display:none;" onchange="loadVerbatimFile(this)" />
          </label>
        </div>
      </div>
      <textarea class="form-textarea vt-textarea" id="fv"
        oninput="updateVerbatimCounter(this.value)">${esc(session.verbatim || '')}</textarea>
      <div class="verbatim-long-notice" id="vt-long-notice"
        style="display:${(session.verbatim || '').length >= 3000 ? 'flex' : 'none'}">
        긴 축어록 모드 — 보고서 생성 시 핵심 장면을 먼저 추출한 뒤 1페이지 보고서를 작성합니다.
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">메모 (선택)</label>
      <textarea class="form-textarea" id="fmemo" style="min-height:50px;">${esc(session.memo || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">태그 <span style="color:var(--color-text-tertiary);font-weight:400;">(쉼표로 구분)</span></label>
      <input class="form-input" id="ftags" placeholder="예: 불안, 가족갈등, CBT" value="${tagsVal}" autocomplete="off" />
    </div>
    <div class="btn-row">
      <button class="btn-secondary" onclick="cancelEditSession()">취소</button>
      <button class="btn-primary" onclick="updateSession()">저장</button>
    </div>
  </div>`;
}

function cancelEditSession() {
  state.editingId = null;
  state.mode = state.selSession ? 'detail' : (state.selStudent ? 'list' : 'welcome');
  render();
}

// ---------------------------------------------------------------------------
// 나의 기록 — 새 주제 폼
// ---------------------------------------------------------------------------

function renderNewTopicForm() {
  return `<div>
    <div class="form-notice my-notice">
      주제를 만들고 기록을 누적하세요.<br>AI가 쌓인 기록에서 패턴을 읽어드립니다.
    </div>
    <div class="form-group">
      <label class="form-label">주제 이름</label>
      <input class="form-input" id="ft-title" placeholder="예: 일기, 아쉬운 점, 임용 공부" autocomplete="off" />
    </div>
    <div class="form-group">
      <label class="form-label">AI 역할 설정 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span></label>
      <textarea class="form-textarea" id="ft-prompt" style="min-height:110px;"
        placeholder="이 주제에서 AI가 어떤 역할을 해줬으면 하는지 자유롭게 입력하세요.

예: 나의 하루를 들어주고 감정을 정리하도록 도와주는 친구처럼
예: 임용 공부 중 막히는 지점을 같이 생각해주는 학습 코치처럼
예: 학교 상담 연구자 관점의 동료처럼

비워두면 기본 성찰 코치로 동작합니다."></textarea>
    </div>
    <div class="btn-row">
      <button class="btn-secondary" onclick="cancelMyForm()">취소</button>
      <button class="btn-primary-my" onclick="saveTopic()">만들기</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 나의 기록 — 주제 수정 폼
// ---------------------------------------------------------------------------

function renderEditTopicForm(topic) {
  return `<div>
    <div class="form-group">
      <label class="form-label">주제 이름</label>
      <input class="form-input" id="ft-title" value="${esc(topic.title)}" autocomplete="off" />
    </div>
    <div class="form-group">
      <label class="form-label">AI 역할 설정 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span></label>
      <textarea class="form-textarea" id="ft-prompt" style="min-height:110px;">${esc(topic.aiPrompt || '')}</textarea>
    </div>
    <div class="btn-row">
      <button class="btn-secondary" onclick="cancelEditTopic()">취소</button>
      <button class="btn-primary-my" onclick="updateTopic()">저장</button>
    </div>
  </div>`;
}

function cancelEditTopic() {
  state.editingId = null;
  state.myMode    = state.selTopic ? 'list' : 'welcome';
  render();
}

// ---------------------------------------------------------------------------
// 나의 기록 — 새 기록 폼
// ---------------------------------------------------------------------------

function renderNewRecordForm() {
  const today = new Date().toISOString().split('T')[0];
  return `<div>
    <div class="form-group">
      <label class="form-label">날짜</label>
      <input class="form-input" id="fr-date" type="date" value="${today}" />
    </div>
    <div class="form-group">
      <label class="form-label">내용</label>
      <textarea class="form-textarea my-content-input" id="fr-content"
        placeholder="자유롭게 기록하세요. 마크다운을 지원합니다.
**굵게** · *기울임* · --- (구분선)"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">메모 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span></label>
      <textarea class="form-textarea" id="fr-memo" style="min-height:50px;"
        placeholder="짧은 메모"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">태그 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택, 쉼표로 구분)</span></label>
      <input class="form-input" id="fr-tags" placeholder="예: 감정, 성찰, 수업" autocomplete="off" />
    </div>
    <div class="btn-row">
      <button class="btn-secondary" onclick="cancelMyForm()">취소</button>
      <button class="btn-primary-my" onclick="saveRecord()">저장</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 나의 기록 — 기록 수정 폼
// ---------------------------------------------------------------------------

function renderEditRecordForm(record) {
  const tagsVal = esc((record.tags || []).join(', '));
  return `<div>
    <div class="form-group">
      <label class="form-label">날짜</label>
      <input class="form-input" id="fr-date" type="date" value="${record.date}" />
    </div>
    <div class="form-group">
      <label class="form-label">내용</label>
      <textarea class="form-textarea my-content-input" id="fr-content">${esc(record.content || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">메모 <span style="color:var(--color-text-tertiary);font-weight:400;">(선택)</span></label>
      <textarea class="form-textarea" id="fr-memo" style="min-height:50px;">${esc(record.memo || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">태그 <span style="color:var(--color-text-tertiary);font-weight:400;">(쉼표로 구분)</span></label>
      <input class="form-input" id="fr-tags" placeholder="예: 감정, 성찰, 수업" value="${tagsVal}" autocomplete="off" />
    </div>
    <div class="btn-row">
      <button class="btn-secondary" onclick="cancelEditRecord()">취소</button>
      <button class="btn-primary-my" onclick="updateRecord()">저장</button>
    </div>
  </div>`;
}

function cancelEditRecord() {
  state.editingId = null;
  state.myMode    = state.selRecord ? 'detail' : (state.selTopic ? 'list' : 'welcome');
  render();
}
