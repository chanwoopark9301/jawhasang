/* =============================================
   自畵像 — 전역 상태 및 샘플 데이터
   의존성: 없음
   ============================================= */

const state = {
  view:       'student',   // 'student' | 'myrecords'
  students:   [],
  sessions:   [],
  selStudent: null,
  selSession: null,
  mode:       'welcome',   // 'welcome'|'list'|'detail'|'new-student'|'new-session'|'edit-student'|'edit-session'
  sessionTab: 'verbatim',  // 'verbatim'|'report'|'dialogue'
  aiLoading:      false,
  chatLoading:    false,
  calYear:    new Date().getFullYear(),
  calMonth:   new Date().getMonth(),
  calDate:    null,
  calPopup:   null,

  myTopics:   [],
  myRecords:  [],
  selTopic:   null,
  selRecord:  null,
  myMode:     'welcome',   // 'welcome'|'list'|'detail'|'new-topic'|'new-record'|'edit-topic'|'edit-record'
  myTab:      'content',   // 'content'|'report'|'dialogue'
  myAiLoading:    false,
  myChatLoading:  false,
  myPeriod:   'month',     // 'week'|'month'|'all'

  editingId:      null,    // 수정 중인 항목 id
  searchQuery:    '',
  filterTags:     [],
  patternLoading:   false,
  myPatternLoading: false,
};

let mobilePanel = 'sidebar'; // 'sidebar'|'main'|'ai'

// ---------------------------------------------------------------------------
// 샘플 데이터 (모두 익명)
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
    tags: [], analysis: null, supervisionChat: [],
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
    tags: [], analysis: null, supervisionChat: [],
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
    memo: '', tags: [], analysis: null, aiChat: [],
  },
  {
    id: 'r2', topicId: 't2', date: '2026-03-15', recordNum: 1,
    content: `달-02 학생과 대화 중 "100점이 아니면 못난 사람"이라는 자동적 사고를 발견했는데, 거기서 더 파고들지 못하고 공감만 하다가 끝냈다.

소크라테스식 질문을 써야 했는데 — "100점을 못 맞은 친구가 있다면, 그 친구도 못난 사람인가요?" — 이런 질문을 했더라면 스스로 모순을 발견하게 도울 수 있었을 것 같다.`,
    memo: '인지재구조화 시도 필요', tags: [], analysis: null, aiChat: [],
  },
];
