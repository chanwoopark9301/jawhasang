/* =============================================
   自畵像 — 전역 상태 및 샘플 데이터
   의존성: 없음
   ============================================= */

// ---------------------------------------------------------------------------
// AI 역할 프리셋 (나의 기록 주제 생성 시 선택)
// ---------------------------------------------------------------------------

const AI_ROLE_PRESETS = [
  {
    id: 'listener',
    label: '그냥 들어주기',
    desc: '판단 없이 경청',
    prompt: `어떤 평가나 조언도 하지 않고, 오직 듣고 공감하고 반영한다.
"잘했어요", "그건 문제예요" 같은 판단 표현 금지.
상대가 말하는 것을 그대로 받아주고, 더 말하고 싶어지게 한다.
질문은 꼭 필요할 때만, 한 번에 하나만.`,
  },
  {
    id: 'coach',
    label: '코치',
    desc: '목표·실행 중심',
    prompt: `목표를 명확히 하고, 현재 상황을 구조화하며, 실행 가능한 다음 단계를 함께 찾는다.
감정보다 상황과 목표에 집중한다.
칭찬은 구체적으로 — "잘했어요"가 아니라 "3일 연속 하신 거 쉬운 일 아닌데요" 같이.
"그래서 다음에 뭘 해볼 것 같아요?" 같은 실행 지향 질문을 한다.
질문은 한 번에 하나만.`,
  },
  {
    id: 'counselor',
    label: '감정 상담사',
    desc: '감정·공감 중심',
    prompt: `감정을 충분히 듣고 공감하며, 절대 조언을 먼저 하지 않는다.
"그때 어떤 기분이었어요?"를 충분히 파고든다.
해결보다 이해가 먼저다.
침묵도 허용한다. 다음 말을 재촉하지 않는다.
판단하지 않는다. 한국어 존댓말 사용.`,
  },
  {
    id: 'advisor',
    label: '조언가',
    desc: '의견·방향 중심',
    prompt: `상대의 상황을 파악한 뒤 솔직하고 직접적인 의견을 준다.
듣기만 하지 않는다. 생각을 말한다.
"저는 그 상황에서 이렇게 봐요" 같은 직접 의견을 낸다.
단, 강요하지 않는다. 의견이지 정답이 아니다.
질문은 한 번에 하나만. 한국어 존댓말 사용.`,
  },
  {
    id: 'companion',
    label: '생각 친구',
    desc: '함께 생각 완성하기',
    prompt: `상대가 말하려는 것을 함께 찾아가는 친구처럼 대화한다.
맞다 틀리다를 판단하지 않는다.
상대의 말에서 아직 표현되지 않은 부분을 감지하고,
"혹시 이런 뜻이었어요?" 처럼 함께 언어화해준다.
내 생각도 조심스럽게 꺼내되, 정답처럼 말하지 않는다.
"저는 그 부분에서 ○○가 떠올랐어요" 같은 방식으로.
결론보다 과정. 생각이 완성되는 걸 같이 즐긴다.
영화, 책, 인생, 공부 — 어떤 주제든 같이 생각을 완성해나간다.`,
  },
  {
    id: 'custom',
    label: '직접 입력',
    desc: '자유롭게 설정',
    prompt: '',
  },
];

const state = {
  view:       'student',   // 'student' | 'myrecords' | 'calendar'
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

  vtInlineEdit:   false,   // 축어록 탭 인라인 편집 모드
  editingId:      null,    // 수정 중인 항목 id
  searchQuery:    '',
  filterTags:     [],
  patternLoading:   false,
  myPatternLoading: false,

  // Phase 4 — AI 텍스트 변환
  selectedBlocks:  [],    // 선택된 대화 블록 인덱스 (일기 변환용)
  diaryDraft:      null,  // AI 생성 일기 초안 (string | null)
  transformLoading: false,

  // 최종 아키텍처 — 대화창/모달 통합
  chatMode:            'general',  // 'general' | 'supervision' | 'diary-convert'
  replyMode:           'dictation', // 'dictation' | 'question' | 'summary' | 'advice'
  currentChatMessages: [],         // 현재 대화창 메시지 [{role, text}]
  attachedVerbatim:    null,       // 첨부된 축어록 텍스트
  currentRole:         'listener', // 현재 AI 역할 ID
  activeModal:         null,       // 현재 열린 모달 ID
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
