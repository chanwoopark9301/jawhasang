/* =============================================
   상담 일지 — app.js
   ============================================= */

// ---------------------------------------------------------------------------
// 1. 전역 상태
// ---------------------------------------------------------------------------

const state = {
  view: 'student',       // 'student' (상담 기록) | 'myrecords' (나의 기록)
  students: [],
  sessions: [],
  selStudent: null,
  selSession: null,
  mode: 'welcome',
  sessionTab: 'verbatim',
  aiLoading: false,
  chatLoading: false,
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  calDate: null,
  calPopup: null,
  myTopics: [],
  myRecords: [],
  selTopic: null,
  selRecord: null,
  myMode: 'welcome',
  myTab: 'content',
  myAiLoading: false,
  myChatLoading: false,
  myPeriod: 'month',  // 'week' | 'month' | 'all'
};

let mobilePanel = 'sidebar'; // 'sidebar' | 'main' | 'ai'

// ---------------------------------------------------------------------------
// 2. 샘플 데이터 (모두 익명)
// ---------------------------------------------------------------------------

const SAMPLE_STUDENTS = [
  {
    id: 's1', alias: '별-01', grade: '중2', gender: '남',
    family: '편부모 가정(모). 외동. 경제적 어려움.',
    peers: '학급 내 친밀한 친구 없음. 주로 혼자 지냄.',
    situation: '담임 의뢰. 짝꿍과 마찰, 등교 거부 의사.',
    notes: '1회기 라포 형성 단계.',
    createdAt: '2026-03-01',
  },
  {
    id: 's2', alias: '달-02', grade: '중1', gender: '여',
    family: '양부모. 고학력 전문직. 학업 기대 높음.',
    peers: '경쟁적 관계의 친구들. 진정한 친밀감 낮음.',
    situation: '자발 내방. 시험 전 극심한 불안, 두통.',
    notes: '완벽주의 성향.',
    createdAt: '2026-03-05',
  },
];

const SAMPLE_SESSIONS = [
  {
    id: 'ss1', studentId: 's1', date: '2026-03-10', sessionNum: 1,
    verbatim: `내담자: 안 오고 싶었는데요.
상담자: 그래도 와줬네. 오늘 어땠어?
내담자: 그냥요. 학교 오기 싫어요.
상담자: 학교 오기 싫구나. 요즘 학교 어때?
내담자: 짝이 저를 계속 무시해요. 같이 앉기 싫어요.
상담자: 짝이 무시해서 힘들겠다. 어떻게 무시해?
내담자: 제가 말 걸면 딴 데 보거나 대답을 안 해요.
상담자: 그럴 때 어떤 기분이야?
내담자: 모르겠어요... (침묵)
상담자: 괜찮아, 천천히 해도 돼.
내담자: 그냥 없어지고 싶다는 생각이 들어요.
상담자: 없어지고 싶다는 게 어떤 의미야?
내담자: 이 상황에서요. 죽고 싶다는 건 아니에요.
상담자: 알려줘서 고마워. 이 상황이 정말 힘들구나.`,
    memo: '자살 사고 여부 확인 완료. 라포 형성 중.',
    analysis: null,
    supervisionChat: [],
  },
  {
    id: 'ss3', studentId: 's2', date: '2026-03-15', sessionNum: 1,
    verbatim: `내담자: 시험이 이틀 남았는데 손이 떨려요.
상담자: 많이 긴장되는구나. 어떤 과목이 제일 걱정돼?
내담자: 다요. 근데 수학이 특히요. 틀리면 안 될 것 같아서.
상담자: 틀리면 안 된다고 생각하는 이유가 뭐야?
내담자: 엄마가 이번엔 꼭 100점 맞아야 한다고 했어요.
상담자: 엄마가 그런 기대를 갖고 있구나.
내담자: 근데 저도 100점이어야 한다고 생각해요.
상담자: 100점이 아니면 어떻게 될 것 같아?
내담자: 저는 그냥 못난 사람인 거죠.
상담자: 100점이 아니면 못난 사람이 된다고 느끼는구나.
내담자: 네. 맞아요. (눈물)
상담자: 많이 힘들었겠다. 그 생각이 언제부터 있었어?`,
    memo: '자기가치감 이슈. 자동적 사고 패턴 확인.',
    analysis: null,
    supervisionChat: [],
  },
];

const SAMPLE_TOPICS = [
  {
    id: 't1', title: '일기',
    aiPrompt: '나의 하루를 들어주고 감정을 정리하도록 도와주는 친구처럼',
    createdAt: '2026-03-01',
  },
  {
    id: 't2', title: '아쉬운 점',
    aiPrompt: '성장을 돕는 성찰 코치처럼. 실수 패턴을 발견하고 재발 방지를 함께 생각해줘.',
    createdAt: '2026-03-05',
  },
];

const SAMPLE_RECORDS = [
  {
    id: 'r1', topicId: 't1', date: '2026-03-10', recordNum: 1,
    content: `오늘 처음으로 별-01 학생과 상담을 했다. 생각보다 말이 없었지만, 마지막에 "그냥 없어지고 싶다"는 말에 순간 심장이 내려앉았다. 죽고 싶다는 건 아니라고 했지만, 그 감각은 오래 남았다.

상담을 마치고 나서 내가 너무 평온하게 반응했던 건 아닐까 생각했다. 당황하지 않으려고 애쓴 게 오히려 거리감을 만들지는 않았는지.`,
    memo: '', analysis: null, aiChat: [],
  },
  {
    id: 'r2', topicId: 't2', date: '2026-03-15', recordNum: 1,
    content: `달-02 학생과 대화 중 "100점이 아니면 못난 사람"이라는 자동적 사고를 발견했는데, 거기서 더 파고들지 못하고 공감만 하다가 끝냈다.

소크라테스식 질문을 써야 했는데 — "100점을 못 맞은 친구가 있다면, 그 친구도 못난 사람인가요?" — 이런 질문을 했더라면 스스로 모순을 발견하게 도울 수 있었을 것 같다.`,
    memo: '인지재구조화 시도 필요', analysis: null, aiChat: [],
  },
];

// ---------------------------------------------------------------------------
// 3. 데이터 영속성
// ---------------------------------------------------------------------------

async function loadData() {
  try {
    const res = await fetch('/api/data');
    if (res.ok) {
      const data = await res.json();
      state.students  = data.students && data.students.length ? data.students : SAMPLE_STUDENTS;
      state.sessions  = data.sessions && data.sessions.length ? data.sessions : SAMPLE_SESSIONS;
      state.myTopics  = data.my_topics  && data.my_topics.length  ? data.my_topics  : SAMPLE_TOPICS;
      state.myRecords = data.my_records && data.my_records.length ? data.my_records : SAMPLE_RECORDS;
      if (!data.students || !data.students.length) saveData();
    } else {
      state.students  = SAMPLE_STUDENTS;
      state.sessions  = SAMPLE_SESSIONS;
      state.myTopics  = SAMPLE_TOPICS;
      state.myRecords = SAMPLE_RECORDS;
      saveData();
    }
  } catch {
    state.students  = SAMPLE_STUDENTS;
    state.sessions  = SAMPLE_SESSIONS;
    state.myTopics  = SAMPLE_TOPICS;
    state.myRecords = SAMPLE_RECORDS;
  }
  render();
  showHome();
}

function saveData() {
  fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      students:   state.students,
      sessions:   state.sessions,
      my_topics:  state.myTopics,
      my_records: state.myRecords,
    }),
  }).catch(e => console.error('저장 실패:', e));
}

// ---------------------------------------------------------------------------
// 4. 네비게이션
// ---------------------------------------------------------------------------

function setView(view) {
  state.view = view;
  state.selStudent = null;
  state.selSession = null;
  state.mode = 'welcome';
  document.getElementById('btn-sv').classList.toggle('active', view === 'student');
  document.getElementById('btn-dv').classList.toggle('active', view === 'myrecords');
  document.getElementById('add-btn').textContent =
    view === 'student' ? '+ 새 내담자 추가' : '+ 새 주제';
  render();
}

function handleAdd() {
  if (state.view === 'myrecords') {
    state.myMode = 'new-topic';
  } else {
    state.mode = 'new-student';
  }
  mobilePanel = 'main';
  render();
}

function selectStudent(id) {
  state.selStudent = id;
  state.selSession = null;
  state.mode = 'list';
  mobilePanel = 'main';
  render();
}

function selectSession(id) {
  state.selSession = id;
  state.mode = 'detail';
  state.sessionTab = 'verbatim';
  mobilePanel = 'main';
  render();
}

function selectDateSession(sessionId) {
  const s = state.sessions.find(s => s.id === sessionId);
  if (!s) return;
  state.selSession = sessionId;
  state.selStudent = s.studentId;
  state.mode = 'detail';
  state.sessionTab = 'verbatim';
  mobilePanel = 'main';
  render();
}

function selectCalDate(date) {
  openCalPopup(date);
}

function navCal(dir) {
  state.calMonth += dir;
  if (state.calMonth < 0)  { state.calMonth = 11; state.calYear--; }
  if (state.calMonth > 11) { state.calMonth = 0;  state.calYear++; }
  // 홈 화면이 보이면 홈 캘린더를, 아니면 메인 캘린더를 갱신
  const hv = document.getElementById('home-view');
  if (hv && hv.style.display !== 'none') renderHomeCalendar();
  else renderMain();
}

function showNewSessionForm() {
  state.mode = 'new-session';
  mobilePanel = 'main';
  render();
}

function handleNsBtn() {
  if (state.view === 'myrecords') showNewRecordForm();
  else showNewSessionForm();
}

function cancelForm() {
  state.mode = state.selStudent ? 'list' : 'welcome';
  mobilePanel = state.selStudent ? 'main' : 'sidebar';
  render();
}

// -- 나의 기록 네비게이션 --

function selectTopic(id) {
  state.selTopic  = id;
  state.selRecord = null;
  state.myMode    = 'list';
  mobilePanel     = 'main';
  render();
}

function selectRecord(id) {
  state.selRecord = id;
  state.myMode    = 'detail';
  state.myTab     = 'content';
  mobilePanel     = 'main';
  render();
}

function showNewRecordForm() {
  state.myMode = 'new-record';
  mobilePanel  = 'main';
  render();
}

function cancelMyForm() {
  state.myMode = state.selTopic ? 'list' : 'welcome';
  mobilePanel  = state.selTopic ? 'main' : 'sidebar';
  render();
}

function backFromMyDetail() {
  state.selRecord = null;
  state.myMode    = 'list';
  mobilePanel     = 'main';
  render();
}

function setMyTab(tab) {
  state.myTab = tab;
  renderMain();
  renderAIPanel();
}

function backFromDetail() {
  state.selSession = null;
  state.mode = state.view === 'student' ? 'list' : 'welcome';
  mobilePanel = 'main';
  render();
}

function setMobilePanel(panel) {
  mobilePanel = panel;
  updateMobileLayout();
}

function updateMobileLayout() {
  const map = { sidebar: 'sidebar', main: 'main', ai: 'ai-panel' };
  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('mobile-active', key === mobilePanel);
  });
  ['mnav-list', 'mnav-main', 'mnav-ai'].forEach((id, i) => {
    const key = ['sidebar', 'main', 'ai'][i];
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('active', key === mobilePanel);
  });
}

function setSessionTab(tab) {
  state.sessionTab = tab;
  renderMain();
  renderAIPanel();
  if (tab === 'dialogue') {
    requestAnimationFrame(() => {
      const el = document.getElementById('chat-messages');
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}

// ---------------------------------------------------------------------------
// 5. CRUD
// ---------------------------------------------------------------------------

function saveStudent() {
  const alias = document.getElementById('falias').value.trim();
  if (!alias) { alert('식별 코드를 입력해주세요'); return; }

  const student = {
    id: 's' + Date.now(), alias,
    grade:     document.getElementById('fg').value,
    gender:    document.getElementById('fgd').value,
    family:    document.getElementById('ffamily').value.trim(),
    peers:     document.getElementById('fpeers').value.trim(),
    situation: document.getElementById('fsituation').value.trim(),
    notes:     document.getElementById('fnotes').value.trim(),
    createdAt: new Date().toISOString().split('T')[0],
  };

  state.students.push(student);
  state.selStudent = student.id;
  state.mode = 'list';
  saveData();
  render();
}

function saveSession() {
  const date     = document.getElementById('fd').value;
  const verbatim = document.getElementById('fv').value.trim();
  if (!date || !verbatim) { alert('날짜와 축어록을 입력해주세요'); return; }

  let studentId = state.selStudent;
  if (!state.selStudent) {
    const el = document.getElementById('fst');
    if (el) studentId = el.value;
  }
  if (!studentId) { alert('내담자를 선택해주세요'); return; }

  const sessionNum = state.sessions.filter(s => s.studentId === studentId).length + 1;

  const session = {
    id: 'ss' + Date.now(), studentId, date, sessionNum,
    verbatim,
    memo:             document.getElementById('fmemo').value.trim(),
    analysis:         null,
    supervisionChat:  [],
  };

  state.sessions.push(session);
  state.selSession = session.id;
  state.selStudent = studentId;
  state.mode = 'detail';
  state.sessionTab = 'verbatim';
  saveData();
  render();
}

function loadVerbatimFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { document.getElementById('fv').value = e.target.result; };
  reader.readAsText(file, 'UTF-8');
}

function deleteStudent(id) {
  const s = state.students.find(s => s.id === id);
  if (!confirm(`'${s ? s.alias : '내담자'}'와 모든 회기 기록을 삭제할까요?`)) return;
  state.students = state.students.filter(s => s.id !== id);
  state.sessions = state.sessions.filter(s => s.studentId !== id);
  if (state.selStudent === id) {
    state.selStudent = null; state.selSession = null; state.mode = 'welcome';
  }
  saveData(); render();
}

function deleteSession(id) {
  if (!confirm('이 회기 기록을 삭제할까요?')) return;
  state.sessions = state.sessions.filter(s => s.id !== id);
  if (state.selSession === id) {
    state.selSession = null;
    state.mode = state.selStudent ? 'list' : 'welcome';
  }
  saveData(); render();
}

// -- 나의 기록 CRUD --

function saveTopic() {
  const title = document.getElementById('ft-title').value.trim();
  if (!title) { alert('주제 이름을 입력해주세요'); return; }
  const topic = {
    id: 't' + Date.now(), title,
    aiPrompt:  document.getElementById('ft-prompt').value.trim(),
    createdAt: new Date().toISOString().split('T')[0],
  };
  state.myTopics.push(topic);
  state.selTopic = topic.id;
  state.myMode   = 'list';
  saveData(); render();
}

function saveRecord() {
  const date    = document.getElementById('fr-date').value;
  const content = document.getElementById('fr-content').value.trim();
  if (!date || !content) { alert('날짜와 내용을 입력해주세요'); return; }
  const recordNum = state.myRecords.filter(r => r.topicId === state.selTopic).length + 1;
  const record = {
    id: 'r' + Date.now(),
    topicId: state.selTopic, date, recordNum, content,
    memo:     document.getElementById('fr-memo').value.trim(),
    analysis: null, aiChat: [],
  };
  state.myRecords.push(record);
  state.selRecord = record.id;
  state.myMode    = 'detail';
  state.myTab     = 'content';
  saveData(); render();
}

function deleteTopic(id) {
  const t = state.myTopics.find(t => t.id === id);
  if (!confirm(`'${t ? t.title : '주제'}'와 모든 기록을 삭제할까요?`)) return;
  state.myTopics  = state.myTopics.filter(t => t.id !== id);
  state.myRecords = state.myRecords.filter(r => r.topicId !== id);
  if (state.selTopic === id) {
    state.selTopic  = null;
    state.selRecord = null;
    state.myMode    = 'welcome';
  }
  saveData(); render();
}

function deleteRecord(id) {
  if (!confirm('이 기록을 삭제할까요?')) return;
  state.myRecords = state.myRecords.filter(r => r.id !== id);
  if (state.selRecord === id) {
    state.selRecord = null;
    state.myMode    = state.selTopic ? 'list' : 'welcome';
  }
  saveData(); render();
}

// ---------------------------------------------------------------------------
// 6. AI — 슈퍼비전 보고서
// ---------------------------------------------------------------------------

function buildReportPrompt(session, student) {
  const alias     = student?.alias     || '내담자';
  const grade     = student?.grade     || '';
  const family    = student?.family    || '정보 없음';
  const peers     = student?.peers     || '정보 없음';
  const situation = student?.situation || '정보 없음';

  return `당신은 학교상담 임상 슈퍼바이저입니다. 아래 축어록을 검토하고 슈퍼비전 보고서를 JSON으로 작성하세요.

【내담 학생 (익명)】 ${alias} (${grade}) | 가정: ${family} | 교우: ${peers} | 상황: ${situation}

【${session.sessionNum}회기 축어록 (${session.date})】
${session.verbatim}
${session.memo ? `\n【메모】 ${session.memo}` : ''}

규칙:
- 각 항목은 핵심만 2-4문장으로 간결하게
- 발화 인용은 꼭 필요한 것 1개만
- 번호 목록 앞에 \\n 포함
- JSON으로만 응답 (다른 텍스트 없이)

{
  "clientState": "내담자 감정·방어기제·핵심 호소를 2-3문장으로 요약. 발화 1개 인용.",
  "techniques": "사용 기법과 임상적 적절성을 2-3문장으로.",
  "strengths": "\\n1) 잘한 개입 첫 번째\\n2) 잘한 개입 두 번째\\n3) 잘한 개입 세 번째",
  "improvements": "\\n1) 장면 인용 + 문제점 + 대안 응답\\n2) 장면 인용 + 문제점 + 대안 응답",
  "overall": "전반적 평가와 다음 회기 핵심 과제를 2-3문장으로."
}`;
}

async function runAI() {
  const session = state.sessions.find(s => s.id === state.selSession);
  if (!session || state.aiLoading) return;

  const student = state.students.find(s => s.id === session.studentId);

  state.aiLoading = true;
  renderAIPanel();

  try {
    const text = await streamAnalyze(
      { model: 'claude-sonnet-4-6', max_tokens: 8000,
        messages: [{ role: 'user', content: buildReportPrompt(session, student) }] },
      (acc) => {
        const lbl = document.querySelector('#ai-content .ai-loading-label');
        if (lbl) lbl.textContent = `작성 중... ${acc.length}자`;
      }
    );
    const result = parseJSON(text);
    result.savedAt = new Date().toISOString().split('T')[0];

    session.analysis = result;
    saveData();
    state.sessionTab = 'report';

  } catch (e) {
    console.error('보고서 생성 오류:', e);
    alert('보고서 생성 오류:\n' + e.message);
  }

  state.aiLoading = false;
  render();
}

// -- 나의 기록 AI --

function setMyPeriod(period) {
  state.myPeriod = period;
  renderAIPanel();
}

async function runMyAI() {
  if (!state.selTopic || !state.selRecord) {
    alert('기록을 먼저 선택해주세요.');
    return;
  }
  if (state.myAiLoading) return;

  const topic = state.myTopics.find(t => t.id === state.selTopic);
  if (!topic) return;

  // 기간 계산
  const today = new Date().toISOString().split('T')[0];
  let periodStart = null;
  if (state.myPeriod === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
    periodStart = d.toISOString().split('T')[0];
  } else if (state.myPeriod === 'month') {
    const now = new Date();
    periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }

  // 기간 내 기록 수집
  const records = state.myRecords
    .filter(r => r.topicId === state.selTopic)
    .filter(r => !periodStart || r.date >= periodStart)
    .filter(r => r.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!records.length) {
    alert('선택한 기간에 기록이 없습니다.');
    return;
  }

  // 이전 보고서 요약 (기간 이전에 analysis가 있는 기록 중 가장 최근)
  const prevReport = state.myRecords
    .filter(r => r.topicId === state.selTopic && r.analysis && (!periodStart || r.date < periodStart))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const prevSummary = prevReport ? prevReport.analysis.overall : null;

  // 프롬프트 구성
  const aiRole = topic.aiPrompt || '따뜻하게 경청하고 성찰을 돕는 코치';
  const periodLabel = periodStart ? `${periodStart} ~ ${today}` : `전체 ~ ${today}`;
  const recordsText = records.map(r =>
    `${r.recordNum}번째 기록 (${r.date}):\n${r.content}${r.memo ? '\n메모: ' + r.memo : ''}`
  ).join('\n\n');

  const prompt = `당신은 ${aiRole} 역할입니다.
${prevSummary ? `지난 분석 요약: ${prevSummary}\n` : ''}
'${topic.title}' 기록 (${periodLabel}):

${recordsText}

위 기록을 분석해 보고서를 작성하세요.
규칙: 각 항목은 핵심만 2-4문장으로 간결하게. 기록 인용은 꼭 필요한 것만. JSON으로만 응답.

{
  "pattern": "이 기간 반복된 패턴을 2-3문장으로.",
  "strengths": "잘 된 것 또는 성장한 부분을 2-3문장으로.",
  "improvements": "개선이 필요한 부분을 2-3문장으로.",
  "questions": "다음을 위한 질문 2개를 간결하게.",
  "overall": "전반적 평가와 방향을 2-3문장으로."
}`;

  state.myAiLoading = true;
  renderAIPanel();

  try {
    const text = await streamAnalyze(
      { model: 'claude-sonnet-4-6', max_tokens: 6000,
        messages: [{ role: 'user', content: prompt }] },
      (acc) => {
        const lbl = document.querySelector('#ai-content .ai-loading-label');
        if (lbl) lbl.textContent = `작성 중... ${acc.length}자`;
      }
    );
    const result = parseJSON(text);
    result.savedAt = today;
    result.period  = periodLabel;

    const record = state.myRecords.find(r => r.id === state.selRecord);
    if (record) {
      record.analysis = result;
      saveData();
      state.myTab = 'report';
    }
  } catch (e) {
    console.error('보고서 생성 오류:', e);
    alert('보고서 생성 오류:\n' + e.message);
  }

  state.myAiLoading = false;
  render();
}

// ---------------------------------------------------------------------------
// 7. AI — 슈퍼비전 대화
// ---------------------------------------------------------------------------

function buildSupervisorContext(session, student) {
  const alias     = student?.alias     || '내담자';
  const grade     = student?.grade     || '';
  const family    = student?.family    || '정보 없음';
  const peers     = student?.peers     || '정보 없음';
  const situation = student?.situation || '정보 없음';

  const prevSessions = state.sessions
    .filter(s => s.studentId === session.studentId && s.id !== session.id && s.analysis)
    .sort((a, b) => a.sessionNum - b.sessionNum)
    .map(s => `${s.sessionNum}회기(${s.date}): ${s.analysis.overall}`);

  const prevPart = prevSessions.length
    ? `\n【이전 회기 흐름】\n${prevSessions.join('\n')}`
    : '';

  let reportPart = '';
  if (session.analysis) {
    const a = session.analysis;
    reportPart = `
【슈퍼비전 보고서 (${a.savedAt})】
- 내담자 상태: ${a.clientState}
- 기법 평가: ${a.techniques}
- 강점: ${a.strengths}
- 개선 필요: ${a.improvements}
- 종합: ${a.overall}`;
  }

  return `당신은 20년 경력의 학교상담 임상 슈퍼바이저입니다.
인간중심, 인지행동, 정신역동, 해결중심 등 다양한 이론에 정통하며, 실제 임상 원전에 근거해 슈퍼비전합니다.

【내담 학생 배경 (익명)】
- 식별: ${alias} (${grade})
- 가족/가정: ${family}
- 교우관계: ${peers}
- 현재 상황: ${situation}

【상담 축어록 — ${session.sessionNum}회기 (${session.date})】
${session.verbatim}
${session.memo ? `\n【상담사 메모】\n${session.memo}` : ''}
${prevPart}
${reportPart}

【슈퍼비전 대화 원칙】
- 상담자의 성찰을 이끄는 질문 중심
- 구체적인 축어록 장면을 인용하며 대화
- 이론은 자연스럽게, 시험 공부가 아닌 임상적 이해를 위해
- 답을 주기보다 상담자 스스로 발견하도록 안내
- 따뜻하되 날카로운 임상적 시각 유지
- 한국어 존댓말 사용`;
}

async function startSupervisionChat() {
  const session = state.sessions.find(s => s.id === state.selSession);
  if (!session) return;

  session.supervisionChat = [];
  state.chatLoading = true;
  renderMain();

  const student  = state.students.find(s => s.id === session.studentId);
  const sysCtx   = buildSupervisorContext(session, student);

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        system: [{ type: 'text', text: sysCtx, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: '슈퍼비전을 시작해주세요. 이 회기에서 가장 탐색할 가치가 있는 순간을 하나 선택해서, 상담자가 자신의 개입을 성찰할 수 있는 첫 번째 질문을 해주세요.',
        }],
      }),
    });

    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const text = data.content.map(c => c.text || '').join('').trim();
    session.supervisionChat = [{ role: 'ai', text }];
    saveData();

  } catch (e) {
    console.error('대화 시작 오류:', e);
    session.supervisionChat = [{ role: 'ai', text: '오류가 발생했습니다. 다시 시도해주세요.' }];
  }

  state.chatLoading = false;
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || state.chatLoading) return;

  const session = state.sessions.find(s => s.id === state.selSession);
  if (!session) return;

  input.value = '';
  if (!session.supervisionChat) session.supervisionChat = [];
  session.supervisionChat.push({ role: 'user', text });

  state.chatLoading = true;
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });

  const student = state.students.find(s => s.id === session.studentId);
  const sysCtx  = buildSupervisorContext(session, student);

  // Build Anthropic messages from chat history
  const messages = session.supervisionChat.map(m => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: m.text,
  }));

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: [{ type: 'text', text: sysCtx, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });

    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const aiText = data.content.map(c => c.text || '').join('').trim();
    session.supervisionChat.push({ role: 'ai', text: aiText });
    saveData();

  } catch (e) {
    console.error('대화 오류:', e);
    session.supervisionChat.push({ role: 'ai', text: '오류가 발생했습니다. 다시 시도해주세요.' });
  }

  state.chatLoading = false;
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function clearSupervisionChat() {
  if (!confirm('슈퍼비전 대화를 초기화할까요?')) return;
  const session = state.sessions.find(s => s.id === state.selSession);
  if (!session) return;
  session.supervisionChat = [];
  saveData();
  renderMain();
}

// ---------------------------------------------------------------------------
// 7-2. AI — 나의 기록 대화
// ---------------------------------------------------------------------------

function buildMyRecordContext(record, topic) {
  const aiRole = topic?.aiPrompt || '따뜻하게 경청하고 성찰을 돕는 코치';
  let reportPart = '';
  if (record.analysis) {
    const a = record.analysis;
    reportPart = `\n【분석 보고서 요약】\n- 패턴: ${a.pattern}\n- 잘 된 것: ${a.strengths}\n- 개선점: ${a.improvements}\n- 종합: ${a.overall}`;
  }
  return `당신은 ${aiRole} 역할입니다.

아래는 '${topic?.title || '기록'}' 주제로 작성된 기록입니다.
날짜: ${record.date}

【기록 본문】
${record.content}
${record.memo ? `\n【메모】\n${record.memo}` : ''}
${reportPart}

대화 원칙:
- 상대방의 말을 충분히 듣고 반영하기
- 판단하지 않기
- 스스로 답을 찾도록 질문으로 안내하기
- 한국어 존댓말 사용`;
}

async function startMyChat() {
  const record = state.myRecords.find(r => r.id === state.selRecord);
  if (!record || state.myChatLoading) return;

  record.aiChat = [];
  state.myChatLoading = true;
  renderMain();

  const topic  = state.myTopics.find(t => t.id === record.topicId);
  const sysCtx = buildMyRecordContext(record, topic);

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: [{ type: 'text', text: sysCtx, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: '이 기록을 읽었어요. 지금 이 순간 가장 마음에 걸리는 게 뭔지 먼저 물어봐주세요.' }],
      }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const text = data.content.map(c => c.text || '').join('').trim();
    record.aiChat = [{ role: 'ai', text }];
    saveData();
  } catch (e) {
    console.error('대화 시작 오류:', e);
    record.aiChat = [{ role: 'ai', text: '오류가 발생했습니다. 다시 시도해주세요.' }];
  }

  state.myChatLoading = false;
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('my-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function sendMyChatMessage() {
  const input = document.getElementById('my-chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || state.myChatLoading) return;

  const record = state.myRecords.find(r => r.id === state.selRecord);
  if (!record) return;

  input.value = '';
  if (!record.aiChat) record.aiChat = [];
  record.aiChat.push({ role: 'user', text });

  state.myChatLoading = true;
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('my-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });

  const topic    = state.myTopics.find(t => t.id === record.topicId);
  const sysCtx   = buildMyRecordContext(record, topic);
  const messages = record.aiChat.map(m => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: m.text,
  }));

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: [{ type: 'text', text: sysCtx, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const aiText = data.content.map(c => c.text || '').join('').trim();
    record.aiChat.push({ role: 'ai', text: aiText });
    saveData();
  } catch (e) {
    console.error('대화 오류:', e);
    record.aiChat.push({ role: 'ai', text: '오류가 발생했습니다. 다시 시도해주세요.' });
  }

  state.myChatLoading = false;
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('my-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function clearMyChat() {
  if (!confirm('대화를 초기화할까요?')) return;
  const record = state.myRecords.find(r => r.id === state.selRecord);
  if (!record) return;
  record.aiChat = [];
  saveData();
  renderMain();
}

// ---------------------------------------------------------------------------
// 8. 렌더링
// ---------------------------------------------------------------------------

function render() {
  // AI 패널 헤더 텍스트
  const aiHeaderEl = document.querySelector('.ai-header span:first-child');
  if (aiHeaderEl) aiHeaderEl.textContent = state.view === 'myrecords' ? '주제 정보' : '학생 정보';

  renderSidebar();
  renderMain();
  renderAIPanel();
  updateMobileLayout();
}

// -- 사이드바 --

function renderSidebar() {
  const el = document.getElementById('sidebar-list');

  if (state.view === 'myrecords') {
    if (!state.myTopics.length) {
      el.innerHTML = '<p class="ai-placeholder">주제가 없어요<br><span style="font-size:10px;opacity:.6;">+ 새 주제 추가로 시작하세요</span></p>';
      return;
    }
    el.innerHTML = state.myTopics.map(t => {
      const cnt    = state.myRecords.filter(r => r.topicId === t.id).length;
      const active = state.selTopic === t.id;
      return `<div class="list-item${active ? ' active my-active' : ''}">
        <div class="list-item-info" onclick="selectTopic('${t.id}')">
          <div class="list-item-name">${t.title}</div>
          <div class="list-item-sub">${cnt}개 기록</div>
        </div>
        <button class="list-item-del" onclick="event.stopPropagation();deleteTopic('${t.id}')" title="삭제">×</button>
      </div>`;
    }).join('');
    return;
  }

  // view === 'student'
  if (!state.students.length) {
    el.innerHTML = '<p class="ai-placeholder">내담자가 없어요</p>';
    return;
  }
  el.innerHTML = state.students.map(st => {
    const cnt    = state.sessions.filter(s => s.studentId === st.id).length;
    const active = state.selStudent === st.id;
    return `<div class="list-item${active ? ' active' : ''}">
      <div class="list-item-info" onclick="selectStudent('${st.id}')">
        <div class="list-item-name">${st.alias}</div>
        <div class="list-item-sub">${st.grade} · ${cnt}회기</div>
      </div>
      <button class="list-item-del" onclick="event.stopPropagation();deleteStudent('${st.id}')" title="삭제">×</button>
    </div>`;
  }).join('');
}

// -- 메인 컨텐츠 --

function renderMain() {
  const titleEl = document.getElementById('main-title');
  const subEl   = document.getElementById('main-sub');
  const content = document.getElementById('main-content');
  const nsBtn   = document.getElementById('ns-btn');

  if (state.mode === 'new-student') {
    titleEl.textContent = '새 내담자 등록';
    subEl.textContent = '';
    nsBtn.style.display = 'none';
    content.innerHTML = renderNewStudentForm();
    return;
  }

  if (state.mode === 'new-session') {
    const st = state.students.find(s => s.id === state.selStudent);
    titleEl.textContent = '새 회기 기록';
    subEl.textContent = st ? st.alias : '';
    nsBtn.style.display = 'none';
    content.innerHTML = renderNewSessionForm();
    return;
  }

  if (state.mode === 'detail' && state.selSession) {
    const session = state.sessions.find(s => s.id === state.selSession);
    if (session) {
      const st  = state.students.find(s => s.id === session.studentId);
      const all = state.sessions.filter(s => s.studentId === session.studentId);
      titleEl.textContent = st ? st.alias : '';
      subEl.textContent   = st ? `${st.grade} · ${all.length}회기` : '';
      nsBtn.style.display = 'block';
      content.innerHTML   = renderSessionDetail(session, all.length);
      return;
    }
  }

  if (state.view === 'myrecords') {
    // 새 주제 폼
    if (state.myMode === 'new-topic') {
      titleEl.textContent = '새 주제 만들기';
      subEl.textContent   = '';
      nsBtn.style.display = 'none';
      content.innerHTML   = renderNewTopicForm();
      return;
    }
    // 새 기록 폼
    if (state.myMode === 'new-record' && state.selTopic) {
      const t = state.myTopics.find(t => t.id === state.selTopic);
      titleEl.textContent = '새 기록';
      subEl.textContent   = t ? t.title : '';
      nsBtn.style.display = 'none';
      content.innerHTML   = renderNewRecordForm();
      return;
    }
    // 기록 상세
    if (state.myMode === 'detail' && state.selRecord) {
      const rec = state.myRecords.find(r => r.id === state.selRecord);
      if (rec) {
        const t   = state.myTopics.find(t => t.id === rec.topicId);
        const all = state.myRecords.filter(r => r.topicId === rec.topicId);
        titleEl.textContent = t ? t.title : '';
        subEl.textContent   = `${all.length}개 기록`;
        nsBtn.style.display = 'block';
        nsBtn.textContent   = '+ 기록 추가';
        content.innerHTML   = renderRecordDetail(rec, all.length);
        return;
      }
    }
    // 주제 없이 welcome
    if (!state.selTopic) {
      titleEl.textContent = '나의 기록';
      subEl.textContent   = '';
      nsBtn.style.display = 'none';
      content.innerHTML   = '<div class="empty-state">왼쪽에서 주제를 선택하거나<br>새 주제를 추가해보세요</div>';
      return;
    }
    // 주제 선택 → 기록 목록
    const t   = state.myTopics.find(t => t.id === state.selTopic);
    const all = state.myRecords.filter(r => r.topicId === state.selTopic)
      .sort((a, b) => b.date.localeCompare(a.date));
    titleEl.textContent = t ? t.title : '';
    subEl.textContent   = `${all.length}개 기록`;
    nsBtn.style.display = 'block';
    nsBtn.textContent   = '+ 기록 추가';
    if (!all.length) {
      content.innerHTML = `<div class="empty-state">아직 기록이 없어요<br><br>
        <button class="btn-primary-my" onclick="showNewRecordForm()">첫 기록 쓰기</button>
      </div>`;
      return;
    }
    content.innerHTML = all.map(r => {
      const firstLine = r.content ? r.content.split('\n')[0].substring(0, 60) : '';
      const hasRpt    = !!r.analysis;
      const hasDlg    = r.aiChat && r.aiChat.length > 0;
      return `<div class="record-card${r.id === state.selRecord ? ' active' : ''}" onclick="selectRecord('${r.id}')">
        <div class="session-meta">
          <span class="record-num">${r.recordNum}번째</span>
          <span style="display:flex;gap:5px;align-items:center;">
            ${hasRpt ? '<span class="session-badge my-badge">보고서</span>' : ''}
            ${hasDlg ? '<span class="session-badge my-badge-dlg">대화</span>' : ''}
            <span class="session-date">${r.date}</span>
          </span>
        </div>
        <div class="session-preview">${firstLine || r.memo || '—'}</div>
      </div>`;
    }).join('');
    return;
  }

  if (!state.selStudent) {
    titleEl.textContent = '상담 기록';
    subEl.textContent   = '';
    nsBtn.style.display = 'none';
    content.innerHTML   = '<div class="empty-state">왼쪽에서 내담자를 선택하거나<br>새 내담자를 추가해보세요</div>';
    return;
  }

  const st  = state.students.find(s => s.id === state.selStudent);
  const all = state.sessions.filter(s => s.studentId === state.selStudent)
    .sort((a, b) => b.date.localeCompare(a.date));

  titleEl.textContent = st ? st.alias : '';
  subEl.textContent   = st ? `${st.grade} · ${all.length}회기` : '';
  nsBtn.style.display = 'block';

  if (!all.length) {
    content.innerHTML = `<div class="empty-state">아직 상담 기록이 없어요<br><br>
      <button class="btn-secondary" onclick="showNewSessionForm()">첫 회기 기록하기</button>
    </div>`;
    return;
  }

  content.innerHTML = all.map(s => {
    const firstLine = s.verbatim ? s.verbatim.split('\n')[0].substring(0, 60) : '';
    const hasRpt    = !!s.analysis;
    const hasDlg    = s.supervisionChat && s.supervisionChat.length > 0;
    return `<div class="session-card${s.id === state.selSession ? ' active' : ''}" onclick="selectSession('${s.id}')">
      <div class="session-meta">
        <span class="session-num">${s.sessionNum}회기</span>
        <span style="display:flex;gap:5px;align-items:center;">
          ${hasRpt ? '<span class="session-badge">보고서</span>' : ''}
          ${hasDlg ? '<span class="session-badge session-badge-dialogue">대화</span>' : ''}
          <span class="session-date">${s.date}</span>
        </span>
      </div>
      <div class="session-preview">${firstLine || s.memo || '—'}</div>
    </div>`;
  }).join('');
}

// -- 홈 화면 --

function showHome() {
  const hv = document.getElementById('home-view');
  if (hv) hv.style.display = '';
  renderHomeCalendar();
}

function hideHome() {
  const hv = document.getElementById('home-view');
  if (hv) hv.style.display = 'none';
}

function renderHomeCalendar() {
  const wrap = document.getElementById('home-cal-wrap');
  if (wrap) wrap.innerHTML = renderCalendar();
}

// -- 캘린더 --

function renderCalendar() {
  const year  = state.calYear;
  const month = state.calMonth;
  const today = new Date().toISOString().split('T')[0];
  const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();

  // 날짜별 카운트
  const sessionCnt = {};
  state.sessions.forEach(s => { sessionCnt[s.date] = (sessionCnt[s.date] || 0) + 1; });
  const recordCnt = {};
  state.myRecords.forEach(r => { recordCnt[r.date] = (recordCnt[r.date] || 0) + 1; });

  const days = [];
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i, m2 = month === 0 ? 11 : month - 1, y2 = month === 0 ? year - 1 : year;
    days.push({ day: d, ds: `${y2}-${String(m2+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ day: d, ds: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: false });
  }
  const rem = 42 - days.length;
  for (let d = 1; d <= rem; d++) {
    const m2 = month === 11 ? 0 : month + 1, y2 = month === 11 ? year + 1 : year;
    days.push({ day: d, ds: `${y2}-${String(m2+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: true });
  }

  const daysHTML = days.map(d => {
    const sc = sessionCnt[d.ds] || 0;
    const rc = recordCnt[d.ds]  || 0;
    let dotsHTML = '';
    if (sc > 0 || rc > 0) {
      const rDots  = Array(Math.min(rc, 3)).fill('<div class="cal-dot cal-dot-record"></div>').join('');
      const rExtra = rc > 3 ? `<span class="cal-dot-extra">+${rc-3}</span>` : '';
      const sDots  = Array(Math.min(sc, 3)).fill('<div class="cal-dot cal-dot-session"></div>').join('');
      const sExtra = sc > 3 ? `<span class="cal-dot-extra">+${sc-3}</span>` : '';
      dotsHTML = `<div class="cal-day-dots">${rDots}${rExtra}${sDots}${sExtra}</div>`;
    }
    return `<div class="cal-day${d.other?' other-month':''}${d.ds===today?' today':''}${d.ds===state.calDate?' selected':''}"
      onclick="openCalPopup('${d.ds}')">
      <div class="cal-day-num">${d.day}</div>${dotsHTML}
    </div>`;
  }).join('');

  return `<div class="calendar">
    <div class="cal-header">
      <button class="cal-nav" onclick="navCal(-1)">‹</button>
      <span class="cal-title">${year}년 ${MONTHS[month]}</span>
      <button class="cal-nav" onclick="navCal(1)">›</button>
    </div>
    <div class="cal-weekdays">${['일','월','화','수','목','금','토'].map(d=>`<div class="cal-weekday">${d}</div>`).join('')}</div>
    <div class="cal-grid">${daysHTML}</div>
  </div>`;
}

// -- 캘린더 팝업 --

function openCalPopup(date) {
  state.calDate  = date;
  state.calPopup = date;
  const overlay = document.getElementById('cal-popup-overlay');
  const modal   = document.getElementById('cal-popup-modal');
  if (!overlay || !modal) return;
  modal.innerHTML = buildCalPopupHTML(date);
  overlay.style.display = '';
  modal.style.display   = '';
}

function closeCalPopup() {
  state.calPopup = null;
  const overlay = document.getElementById('cal-popup-overlay');
  const modal   = document.getElementById('cal-popup-modal');
  if (overlay) overlay.style.display = 'none';
  if (modal)   modal.style.display   = 'none';
  // 홈 캘린더 하이라이트 갱신
  const hv = document.getElementById('home-view');
  if (hv && hv.style.display !== 'none') renderHomeCalendar();
}

function buildCalPopupHTML(date) {
  const [, m, d]    = date.split('-');
  const label       = `${parseInt(m)}월 ${parseInt(d)}일`;
  const daySessions = state.sessions.filter(s => s.date === date);
  const dayRecords  = state.myRecords.filter(r => r.date === date);

  // 범례 점
  const sDots = Array(Math.min(daySessions.length, 3)).fill('<span class="popup-dot popup-dot-session"></span>').join('');
  const rDots = Array(Math.min(dayRecords.length,  3)).fill('<span class="popup-dot popup-dot-record"></span>').join('');
  const sExtra = daySessions.length > 3 ? `<span class="popup-dot-extra">+${daySessions.length-3}</span>` : '';
  const rExtra = dayRecords.length  > 3 ? `<span class="popup-dot-extra">+${dayRecords.length-3}</span>`  : '';

  // 상담 기록 목록
  const sessionItems = daySessions.length
    ? daySessions.map(s => {
        const st = state.students.find(st => st.id === s.studentId);
        return `<div class="popup-item popup-item-session" onclick="calPopupGoSession('${s.id}')">· ${st ? st.alias : '?'} · ${s.sessionNum}회기</div>`;
      }).join('')
    : '<div class="popup-item-empty">없음</div>';

  // 나의 기록 목록
  const recordItems = dayRecords.length
    ? dayRecords.map(r => {
        const topic = state.myTopics.find(t => t.id === r.topicId);
        return `<div class="popup-item popup-item-record" onclick="calPopupGoRecord('${r.id}')">· &lt;${topic ? topic.title : '?'}&gt; ${r.recordNum}번째</div>`;
      }).join('')
    : '<div class="popup-item-empty">없음</div>';

  return `
    <div class="popup-header">
      <span class="popup-date-label">${label}</span>
      <button class="popup-close-btn" onclick="closeCalPopup()">×</button>
    </div>
    <div class="popup-legend">
      <div class="popup-legend-item popup-legend-record">나의 기록&nbsp;${rDots}${rExtra}</div>
      <div class="popup-legend-item popup-legend-session">상담 기록&nbsp;${sDots}${sExtra}</div>
    </div>
    <div class="popup-body">
      <div class="popup-col">
        <div class="popup-col-label">나의 기록</div>
        ${recordItems}
      </div>
      <div class="popup-col">
        <div class="popup-col-label">상담 기록</div>
        ${sessionItems}
      </div>
    </div>
    <div class="popup-footer">
      <button class="popup-add-btn popup-add-record" onclick="calPopupAddRecord('${date}')">+ 나의 기록</button>
      <button class="popup-add-btn popup-add-session" onclick="calPopupAddSession('${date}')">+ 상담 기록</button>
    </div>`;
}

function calPopupGoSession(id) {
  closeCalPopup();
  hideHome();
  const s = state.sessions.find(s => s.id === id);
  if (!s) return;
  state.view       = 'student';
  state.selStudent = s.studentId;
  state.selSession = id;
  state.mode       = 'detail';
  state.sessionTab = 'verbatim';
  mobilePanel      = 'main';
  document.getElementById('btn-sv').classList.add('active');
  document.getElementById('btn-dv').classList.remove('active');
  document.getElementById('add-btn').textContent = '+ 새 내담자 추가';
  render();
}

function calPopupGoRecord(id) {
  closeCalPopup();
  hideHome();
  const r = state.myRecords.find(r => r.id === id);
  if (!r) return;
  state.view       = 'myrecords';
  state.selTopic   = r.topicId;
  state.selRecord  = id;
  state.myMode     = 'detail';
  state.myTab      = 'content';
  mobilePanel      = 'main';
  document.getElementById('btn-sv').classList.remove('active');
  document.getElementById('btn-dv').classList.add('active');
  document.getElementById('add-btn').textContent = '+ 새 주제';
  render();
}

function calPopupAddSession(date) {
  closeCalPopup();
  hideHome();
  state.view = 'student';
  state.mode = 'new-session';
  document.getElementById('btn-sv').classList.add('active');
  document.getElementById('btn-dv').classList.remove('active');
  document.getElementById('add-btn').textContent = '+ 새 내담자 추가';
  mobilePanel = 'main';
  render();
  requestAnimationFrame(() => {
    const el = document.getElementById('fd');
    if (el) el.value = date;
  });
}

function calPopupAddRecord(date) {
  closeCalPopup();
  hideHome();
  state.view   = 'myrecords';
  state.myMode = 'new-topic';
  document.getElementById('btn-sv').classList.remove('active');
  document.getElementById('btn-dv').classList.add('active');
  document.getElementById('add-btn').textContent = '+ 새 주제';
  mobilePanel = 'main';
  render();
}

// -- 축어록 파싱 및 렌더링 --

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
  const ci = ['상담', '교사', '선생', 'T'];
  const cl = ['내담', '학생', 'C', '아동'];
  if (ci.some(k => label.includes(k))) return 'counselor';
  if (cl.some(k => label.includes(k))) return 'client';
  return allSpeakers.indexOf(label) === 0 ? 'counselor' : 'client';
}

function renderVerbatimView(verbatim) {
  if (!verbatim) return '<div class="empty-state">축어록이 없습니다</div>';
  const turns = parseVerbatim(verbatim);
  if (!turns.length) return `<pre class="vt-raw">${verbatim}</pre>`;

  const allSpeakers = [...new Set(turns.map(t => t.speaker).filter(Boolean))];
  return `<div class="vt-container">${turns.map(t => {
    const type = t.speaker ? speakerType(t.speaker, allSpeakers) : 'client';
    return `<div class="vt-turn vt-${type}">
      ${t.speaker ? `<div class="vt-speaker">${t.speaker}</div>` : ''}
      <div class="vt-text">${t.text.replace(/\n/g, '<br>')}</div>
    </div>`;
  }).join('')}</div>`;
}

// -- 슈퍼비전 보고서 --

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
  return `<div class="rpt-date">작성일: ${a.savedAt || ''}</div>` +
    sections.map(s => `<div class="rpt-section ${s.cls}">
      <div class="rpt-label" onclick="this.closest('.rpt-section').classList.toggle('rpt-collapsed')">
        <span>${s.label}</span>
        <span class="rpt-chevron">▾</span>
      </div>
      <div class="rpt-body">${(a[s.key] || '—').replace(/\n/g, '<br>').replace(/ (\d+)\)/g, '<br>$1)')}</div>
    </div>`).join('');
}

// -- 스트리밍 fetch 헬퍼 --
// payload를 stream:true 로 전송하고 누적 텍스트를 반환.
// onProgress(accumulated) 로 글자 수 실시간 전달.

async function streamAnalyze(payload, onProgress) {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: true }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
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
      } catch {}
    }
  }

  if (!accumulated) throw new Error('AI 응답 텍스트가 비어 있습니다');
  return accumulated;
}

// -- JSON 파싱 헬퍼 --

function parseJSON(text) {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd   = cleaned.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1)
    throw new Error(`JSON 없음. 응답 일부: ${cleaned.slice(0, 200)}`);
  const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);
  try {
    return JSON.parse(jsonStr);
  } catch {
    // AI가 문자열 값 안에 literal 줄바꿈을 넣으면 JSON.parse 실패 → 이스케이프 후 재시도
    let fixed = '', inString = false, escape = false;
    for (const c of jsonStr) {
      if (escape)                      { fixed += c; escape = false; }
      else if (c === '\\' && inString) { fixed += c; escape = true; }
      else if (c === '"')              { fixed += c; inString = !inString; }
      else if (inString && c === '\n') { fixed += '\\n'; }
      else if (inString && c === '\r') { fixed += '\\r'; }
      else                             { fixed += c; }
    }
    return JSON.parse(fixed);
  }
}

// -- 마크다운 → HTML (채팅용 간이 렌더러) --

function renderMd(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')  // XSS 방지
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')  // **굵게**
    .replace(/\*(.+?)\*/g, '<em>$1</em>')               // *기울임*
    .replace(/^---+$/gm, '<hr style="border:none;border-top:0.5px solid var(--color-border);margin:8px 0;">')  // ---
    .replace(/\n/g, '<br>');
}

// -- 슈퍼비전 대화 --

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
      <div class="chat-bubble">${m.role === 'ai' ? renderMd(m.text) : m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
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

// -- 회기 상세 --

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
  if (state.sessionTab === 'verbatim')  body = renderVerbatimView(session.verbatim);
  else if (state.sessionTab === 'report')   body = renderSupervisionReport(session);
  else                                   body = renderSupervisionDialogue(session);

  return `
    <div class="detail-meta">
      <span class="session-num">${session.sessionNum}회기</span>
      <span style="font-size:12px;color:var(--color-text-secondary);">${session.date}</span>
      <span style="flex:1;"></span>
      <button class="btn-secondary detail-back" onclick="backFromDetail()">← 목록</button>
    </div>
    <div class="session-tabs">${tabBar}</div>
    <div class="tab-content">${body}</div>
    <div class="detail-footer-note">
      <span>전체 ${totalSessions}회기 중 ${session.sessionNum}회기</span>
      <button class="btn-danger" onclick="deleteSession('${session.id}')">삭제</button>
    </div>`;
}

// -- 새 내담자 폼 --

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

// -- 새 회기 폼 --

function renderNewSessionForm() {
  const studentSelect = !state.selStudent ? `
    <div class="form-group">
      <label class="form-label">내담자</label>
      <select class="form-select" id="fst">
        ${state.students.map(s => `<option value="${s.id}">${s.alias} (${s.grade})</option>`).join('')}
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
        <label class="file-btn">
          파일 불러오기 (.txt)
          <input type="file" accept=".txt" style="display:none;" onchange="loadVerbatimFile(this)" />
        </label>
      </div>
      <textarea class="form-textarea vt-textarea" id="fv"
        placeholder="상담자: 안녕하세요, 오늘은 어땠어요?&#10;내담자: 그냥 그래요...&#10;&#10;클로바 노트 등 STT 결과를 그대로 붙여넣어도 됩니다."></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">메모 (선택)</label>
      <textarea class="form-textarea" id="fmemo" style="min-height:50px;"
        placeholder="회기 특이사항, 비언어적 반응 등"></textarea>
    </div>
    <div class="btn-row">
      <button class="btn-secondary" onclick="cancelForm()">취소</button>
      <button class="btn-primary" onclick="saveSession()">저장</button>
    </div>
  </div>`;
}

// -- 나의 기록 — 새 주제 폼 --

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

// -- 나의 기록 — 새 기록 폼 --

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
    <div class="btn-row">
      <button class="btn-secondary" onclick="cancelMyForm()">취소</button>
      <button class="btn-primary-my" onclick="saveRecord()">저장</button>
    </div>
  </div>`;
}

// -- 나의 기록 — AI 대화 --

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

// -- 나의 기록 — AI 보고서 렌더링 --

function renderMyReport(record) {
  const a = record.analysis;
  const sections = [
    { key: 'pattern',      label: '패턴 요약',        cls: 'rpt-blue'   },
    { key: 'strengths',    label: '잘 된 것',           cls: 'rpt-green'  },
    { key: 'improvements', label: '개선점',             cls: 'rpt-red'    },
    { key: 'questions',    label: '다음을 위한 질문',   cls: 'rpt-amber'  },
    { key: 'overall',      label: '종합 평가',          cls: 'rpt-purple' },
  ];
  return `<div class="rpt-date">작성일: ${a.savedAt || ''} · 기간: ${a.period || ''}</div>` +
    sections.map(s => `<div class="rpt-section ${s.cls}">
      <div class="rpt-label" onclick="this.closest('.rpt-section').classList.toggle('rpt-collapsed')">
        <span>${s.label}</span>
        <span class="rpt-chevron">▾</span>
      </div>
      <div class="rpt-body">${(a[s.key] || '—').replace(/\n/g, '<br>').replace(/ (\d+)\)/g, '<br>$1)')}</div>
    </div>`).join('');
}

// -- 나의 기록 — 기록 상세 --

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

  return `
    <div class="detail-meta">
      <span class="record-num">${record.recordNum}번째</span>
      <span style="font-size:12px;color:var(--color-text-secondary);">${record.date}</span>
      <span style="flex:1;"></span>
      <button class="btn-secondary detail-back" onclick="backFromMyDetail()">← 목록</button>
    </div>
    <div class="session-tabs">${tabBar}</div>
    <div class="tab-content">${body}</div>
    <div class="detail-footer-note">
      <span>전체 ${totalRecords}개 중 ${record.recordNum}번째</span>
      <button class="btn-danger" onclick="deleteRecord('${record.id}')">삭제</button>
    </div>`;
}

// -- 나의 기록 — AI 패널 --

function renderMyAIPanel() {
  const content    = document.getElementById('ai-content');
  const analyzeBtn = document.getElementById('analyze-btn');

  analyzeBtn.style.background = '#1D9E75';
  analyzeBtn.setAttribute('onclick', 'runMyAI()');

  const record = state.selRecord ? state.myRecords.find(r => r.id === state.selRecord) : null;
  const topic  = record
    ? state.myTopics.find(t => t.id === record.topicId)
    : (state.selTopic ? state.myTopics.find(t => t.id === state.selTopic) : null);

  if (state.myAiLoading) {
    analyzeBtn.disabled    = true;
    analyzeBtn.textContent = '분석 중...';
    content.innerHTML = `<div class="ai-loading">
      <div class="ai-loading-label">보고서 작성 중...</div>
      <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    </div>`;
    return;
  }

  analyzeBtn.disabled    = !record;
  analyzeBtn.textContent = record?.analysis ? '보고서 재생성 ↗' : '보고서 생성 ↗';

  if (!topic) {
    content.innerHTML = '<p class="ai-placeholder">주제를 선택하면<br>정보가 표시됩니다</p>';
    return;
  }

  const periods = [
    { key: 'week', label: '이번 주' },
    { key: 'month', label: '이번 달' },
    { key: 'all', label: '전체' },
  ];
  const periodBtns = periods.map(p =>
    `<button class="period-btn${state.myPeriod === p.key ? ' active' : ''}" onclick="setMyPeriod('${p.key}')">${p.label}</button>`
  ).join('');

  content.innerHTML = `
    <div class="ctx-alias" style="color:#1D9E75;">${topic.title}</div>
    <div class="ctx-meta">${state.myRecords.filter(r => r.topicId === topic.id).length}개 기록</div>
    ${topic.aiPrompt ? `<div class="ctx-block">
      <div class="ctx-lbl">AI 역할</div>
      <div class="ctx-txt">${topic.aiPrompt}</div>
    </div>` : `<div class="ctx-block">
      <div class="ctx-lbl">AI 역할</div>
      <div class="ctx-txt" style="color:var(--color-text-tertiary);">기본 성찰 코치</div>
    </div>`}
    ${record ? `<div class="ctx-done" style="background:#e0f5ec;color:#0F6E56;">${record.recordNum}번째 기록 · ${record.date}</div>` : ''}
    <div class="ctx-block" style="margin-top:10px;">
      <div class="ctx-lbl">보고서 기간</div>
      <div class="period-btns">${periodBtns}</div>
    </div>`;
}

// -- AI 패널 (학생 정보 + 보고서 생성) --

function renderAIPanel() {
  if (state.view === 'myrecords') { renderMyAIPanel(); return; }

  const content    = document.getElementById('ai-content');
  const analyzeBtn = document.getElementById('analyze-btn');

  analyzeBtn.style.background = '';  // 상담 기록 기본 색 복원
  analyzeBtn.setAttribute('onclick', 'runAI()');

  const session   = state.selSession ? state.sessions.find(s => s.id === state.selSession) : null;
  const student   = session ? state.students.find(s => s.id === session.studentId) : null;
  const hasVerbatim = !!(session?.verbatim?.trim());

  analyzeBtn.disabled    = !hasVerbatim || state.aiLoading;
  analyzeBtn.textContent = state.aiLoading ? '분석 중...'
    : (session?.analysis ? '보고서 재생성 ↗' : '슈퍼비전 보고서 생성 ↗');

  if (state.aiLoading) {
    content.innerHTML = `<div class="ai-loading">
      <div class="ai-loading-label">슈퍼비전 보고서 작성 중...</div>
      <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    </div>`;
    return;
  }

  if (!session || !student) {
    content.innerHTML = '<p class="ai-placeholder">회기를 선택하면<br>내담자 정보가 표시됩니다</p>';
    return;
  }

  content.innerHTML = `
    <div class="ctx-alias">${student.alias}</div>
    <div class="ctx-meta">${student.grade}${student.gender ? ' · ' + student.gender : ''}</div>
    ${student.family ? `<div class="ctx-block"><div class="ctx-lbl">가족/가정</div><div class="ctx-txt">${student.family}</div></div>` : ''}
    ${student.peers ? `<div class="ctx-block"><div class="ctx-lbl">교우관계</div><div class="ctx-txt">${student.peers}</div></div>` : ''}
    ${student.situation ? `<div class="ctx-block"><div class="ctx-lbl">현재 상황</div><div class="ctx-txt">${student.situation}</div></div>` : ''}
    ${student.notes ? `<div class="ctx-block"><div class="ctx-lbl">메모</div><div class="ctx-txt">${student.notes}</div></div>` : ''}
    ${session.analysis ? `<div class="ctx-done">보고서 작성됨 · ${session.analysis.savedAt}</div>` : ''}`;
}

// ---------------------------------------------------------------------------
// 9. 리사이즈
// ---------------------------------------------------------------------------

function initResize() {
  const rh1 = document.getElementById('rh-1');
  const rh2 = document.getElementById('rh-2');
  const sb  = document.getElementById('sidebar');
  const ai  = document.getElementById('ai-panel');
  let dr    = null;

  function onDown(e, tgt, hdl, inv) {
    dr = { tgt, hdl, inv, sx: e.clientX, sw: tgt.offsetWidth };
    hdl.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  rh1.addEventListener('mousedown', e => onDown(e, sb, rh1, false));
  rh2.addEventListener('mousedown', e => onDown(e, ai, rh2, true));

  document.addEventListener('mousemove', e => {
    if (!dr) return;
    const delta = dr.inv ? dr.sx - e.clientX : e.clientX - dr.sx;
    const w = Math.max(140, Math.min(480, dr.sw + delta));
    document.documentElement.style.setProperty(dr.tgt === sb ? '--sidebar-width' : '--ai-width', w + 'px');
  });

  document.addEventListener('mouseup', () => {
    if (!dr) return;
    dr.hdl.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    dr = null;
  });

  window.addEventListener('resize', updateMobileLayout);
}

// ---------------------------------------------------------------------------
// 10. 초기화
// ---------------------------------------------------------------------------

loadData();
initResize();
