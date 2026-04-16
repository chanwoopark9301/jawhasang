# 自畵像 — 프로젝트 문서

> 중등 전문상담교사(기간제)를 위한 상담 기록 + AI 슈퍼비전 웹 앱.
> 만든 사람은 현재 정교사 임용을 준비 중이며, 슈퍼비전 접근이 어려운 환경에서
> AI를 활용해 혼자서 임상 성찰을 이어가는 도구로 사용 중.
> 장기적으로 대학원 연구 재료 + 한국 학교 상담 현실에 맞는 방법론 연구의 기반.

---

## 기술 스택

- **프론트엔드**: 순수 HTML/CSS/JS. 빌드 도구 없음.
- **백엔드**: Python Flask (`server.py`)
- **저장소**: PostgreSQL (Supabase, `DATABASE_URL` 환경변수) 또는 로컬 `data.json` 폴백
- **암호화**: Fernet (PBKDF2-HMAC-SHA256, iterations=200,000)
- **AI**: Anthropic Claude API (`claude-sonnet-4-6`) — 프록시 경유
- **PWA**: Service Worker (`sw.js`) + `manifest.json`

---

## 실행 방법

```bash
# 서버 실행 (AI 기능 포함)
run.bat          # Windows
python server.py # 직접 실행

# 브라우저
http://localhost:5000
```

환경변수는 `ecrk.env`에 저장:
```
ANTHROPIC_API_KEY=sk-ant-...
APP_PASSWORD=비밀번호
DATABASE_URL=postgresql://...  # 선택사항 (없으면 data.json 사용)
```

---

## 파일 구조

```
counselingReport/
├── index.html              ← HTML 구조 (단일 페이지)
├── style.css               ← 스타일 전체
├── app.js                  ← 앱 초기화 + 전역 render() 진입점
├── server.py               ← Flask 서버 (인증, 데이터 암호화, AI 프록시)
├── manifest.json           ← PWA 설정
├── sw.js                   ← Service Worker (Cache First 전략)
├── icons/                  ← PWA 아이콘 (icon.svg, icon-192.png, icon-512.png)
├── ecrk.env                ← 환경변수 (git 제외)
├── data.json               ← 로컬 암호화 저장소 (git 제외)
├── requirements.txt        ← Python 의존성
├── run.bat                 ← 서버 실행 스크립트
├── Procfile                ← Railway 배포용
│
├── js/                     ← 기능별 모듈
│   ├── state.js            ← 전역 상태 (state 객체) + 샘플 데이터
│   ├── utils.js            ← 공통 유틸 (esc, parseJSON, streamAnalyze, 축어록 헬퍼)
│   ├── data.js             ← /api/data 로드/저장 (서버↔localStorage 폴백)
│   ├── nav.js              ← 화면 전환 (setView, showHome, selectStudent 등)
│   ├── crud.js             ← 생성/수정/삭제 (학생, 회기, 주제, 기록)
│   ├── ai-counseling.js    ← 상담 AI 슈퍼비전 (보고서 생성, 슈퍼비전 대화)
│   ├── ai-myrecords.js     ← 나의 기록 AI (기간별 보고서, AI 대화)
│   ├── ai-pattern.js       ← 전체 패턴 분석
│   ├── render-sidebar.js   ← 사이드바 렌더링 (학생/주제 목록)
│   ├── render-calendar.js  ← 홈 캘린더 렌더링 (점 표시, 팝업)
│   ├── modal.js            ← 통합 모달 (폼, 보고서, 모드 선택, 기록/회기 상세 팝업, 블록 에디터 포함)
│   ├── panels.js           ← 패널·사이드바·모바일 레이아웃 (chat.js에서 분리)
│   ├── chat.js             ← 대화창 전용 (renderChatView, startContextChat, sendCurrentChat)
│   ├── render-aipanel.js   ← AI 패널 렌더링 (renderRightPanel)
│   ├── render-main.js      ← 메인 컨텐츠 라우팅 (캘린더/홈/대화창 분기 — 상세 뷰는 팝업으로 분리)
│   ├── verbatim-editor.js  ← 블록 에디터 (텍스트↔블록 모드 전환)
│   ├── render-home.js      ← 홈 화면 렌더링 (그리팅, 최근 7일, 퀵 카드)
│   └── transform-text.js   ← 축어록 AI 정리 클라이언트
│
├── tests/                  ← pytest 테스트
│   ├── conftest.py         ← 공통 픽스처 (Flask 테스트 클라이언트, 샘플 데이터, Playwright live_server)
│   ├── test_server.py      ← 서버 API + PII 스크러빙 + Stage A 테스트
│   ├── test_stage_bc.py    ← Stage B+C 테스트 (찾기/바꾸기, 주석 버튼)
│   ├── test_stage_d.py     ← Stage D 테스트 (블록 에디터)
│   ├── test_stage_e.py     ← Stage E 테스트 (PWA, dvh, 메타태그)
│   ├── test_e2e.py         ← E2E 테스트 (Playwright, 인증·사이드바·CRUD·캘린더)
│   └── test_ui_stage_a.py  ← UI Stage A 테스트 (긴 축어록 UX)
│
└── scripts/
    ├── stage_commit.sh     ← 테스트 후 자동 커밋 (bash)
    └── stage_commit.bat    ← 테스트 후 자동 커밋 (Windows)
```

---

## 데이터 구조

### Student (학생)
```js
{
  id: string,        // 's' + Date.now()
  alias: string,     // 가명 (예: '별-01') — AI 호출 시 실명 대체
  grade: string,     // '중1'~'고3'
  gender: string,    // '남' | '여' | ''
  family: string,    // 가족/가정환경 메모
  peers: string,     // 교우관계 메모
  situation: string, // 현재 상황 메모
  notes: string,     // 기타 메모
  createdAt: string, // 'YYYY-MM-DD'
}
```

### Session (상담 회기)
```js
{
  id: string,              // 'ss' + Date.now()
  studentId: string,       // Student.id 참조
  date: string,            // 'YYYY-MM-DD'
  sessionNum: number,      // 자동 계산 (max + 1)
  verbatim: string,        // 축어록 전문
  verbatimSummary: string, // AI 생성 임상 요약 (긴 축어록 시)
  memo: string,            // 상담사 메모
  tags: string[],          // 태그
  analysis: object|null,   // 슈퍼비전 보고서 JSON
  supervisionChat: array,  // 슈퍼비전 대화 내역
}
```

### Topic (나의 기록 — 주제)
```js
{
  id: string,        // 't' + Date.now()
  title: string,     // 예: '일기', '아쉬운 점', '임용 공부'
  aiPrompt: string,  // AI 역할 자유 설정 (비우면 기본값 적용)
  createdAt: string,
}
```

### Record (나의 기록 — 기록)
```js
{
  id: string,            // 'r' + Date.now()
  topicId: string,       // Topic.id 참조
  date: string,          // 'YYYY-MM-DD'
  recordNum: number,     // 자동 계산 (max + 1)
  content: string,       // 본문 (마크다운 렌더링)
  memo: string,          // 짧은 메모
  tags: string[],        // 태그
  analysis: object|null, // AI 보고서 (기간 묶음 단위)
  aiChat: array,         // AI 대화 내역
}
```

### 저장소 구조 (data.json / PostgreSQL)
```json
{
  "students":   [],
  "sessions":   [],
  "aiResults":  {},
  "my_topics":  [],
  "my_records": []
}
```

---

## 전역 상태 (state 객체)

```js
const state = {
  // 상담 기록
  view:        'student',  // 'student' | 'myrecords'
  students:    [],
  sessions:    [],
  selStudent:  null,       // 선택된 Student.id
  selSession:  null,       // 선택된 Session.id
  mode:        'welcome',  // 'welcome'|'list'|'detail'|'new-student'|'new-session'|'edit-student'|'edit-session'
  sessionTab:  'verbatim', // 'verbatim'|'report'|'dialogue'
  aiLoading:   false,
  chatLoading: false,

  // 나의 기록
  myTopics:        [],
  myRecords:       [],
  selTopic:        null,
  selRecord:       null,
  myMode:          'welcome', // 'welcome'|'list'|'detail'|'new-topic'|'new-record'|'edit-topic'|'edit-record'
  myTab:           'content', // 'content'|'report'|'dialogue'
  myAiLoading:     false,
  myChatLoading:   false,
  myPeriod:        'month',   // 'week'|'month'|'all'

  // 캘린더
  calYear:   number,
  calMonth:  number,
  calDate:   null,
  calPopup:  null,

  // 대화창 통합
  chatMode:            'general',  // 'general' | 'supervision' | 'diary-convert'
  currentChatMessages: [],         // 현재 대화창 메시지 [{role, text, hidden?}]
  attachedVerbatim:    null,       // 첨부된 축어록 텍스트
  currentRole:         'listener', // 현재 AI 역할 ID
  activeModal:         null,       // 현재 열린 모달 ID

  // 공통
  editingId:       null,   // 수정 중인 항목 id
  searchQuery:     '',
  filterTags:      [],
  patternLoading:  false,
  myPatternLoading:false,
};
```

---

## UI 레이아웃 (Claude.ai 스타일 고정 3열 방식)

```
┌─────────────────┬────────────────────────────┬────────────────┐
│   사이드바       │         메인 컨텐츠          │   AI 패널      │
│   220px (고정)  │         flex: 1            │   220px (고정) │
│                 │                            │                │
│ 自畵像 (로고)   │ ┌──── 메인 헤더 ────────┐  │ 현재 주제/학생  │
│ [+ 새 대화]     │ │ [☰] [컨텍스트칩] [✦] │  │ AI 역할 pills  │
│ ─────────────  │ └──────────────────────┘  │ 학생/주제 정보  │
│ 기록 (섹션)     │                            │ ──────────── │
│  ● 나의 기록    │  홈: 그리팅 + 퀵 카드       │ [보고서 생성 ↗] │
│    ├ 일기       │  캘린더: 월별 캘린더        │ [축어록 정리 ↗] │
│    └ 아쉬운 점  │  주제/학생 선택 시: 대화창  │ [패턴 분석 ↗]  │
│  ● 상담 기록    │    (AI 첫 마디 자동 시작)   │                │
│    ├ 별-01      │                            │                │
│    └ + 새 내담자│  [+] → 모달 (축어록/직접쓰기│                │
│  ○ 캘린더       │         /모드/새 항목)      │                │
│ ─────────────  │                            │                │
│ ↓내보내기 로그아웃│                           │                │
└─────────────────┴────────────────────────────┴────────────────┘
│              [목록] [화면] [AI]                               │  ← 모바일 하단 탭
```

### 데스크탑 (≥768px)
- 사이드바·AI 패널: **in-flow flex 자식** (`width: 220px; flex-shrink: 0`)
- 항상 화면에 고정 표시 — 오버레이 없음

### 모바일 (≤767px)
- 사이드바·AI 패널: `position: fixed; transform: translateX(±100%)`로 전환
- `.panel-open` 클래스 → `translateX(0)` 슬라이드인
- 패널 뒤 백드롭: 클릭 시 `closePanels()` 호출
- 하단 탭 `mobile-nav`: 목록(☰) / 화면(◧) / AI(✦)

### 사이드바 구조 (nav-item / sub-items / sub-children)
```
div.sidebar-logo           → 홈으로 (showHome)
button.new-chat-btn        → 새 대화 모달 (openNewChatModal)
nav.sidebar-nav
  ├ .nav-section-label "기록"
  ├ #nav-my.nav-item       → setView('myrecords')
  │   └ #sub-my.sub-items  → 주제 sub-item 목록 + "+ 새 주제" add
  │       └ .sub-children  → 선택된 주제의 기록 목록 (날짜·번호)
  │           └ 각 기록 클릭 → openModal('record-detail', {id})
  ├ #nav-sv.nav-item       → setView('student')
  │   └ #sub-sv.sub-items  → 학생 sub-item 목록 + "+ 새 내담자" add
  │       └ .sub-children  → 선택된 학생의 회기 목록 (날짜·회기번호)
  │           └ 각 회기 클릭 → openModal('session-detail', {id})
  └ #nav-cal.nav-item      → setView('calendar')
div.sidebar-footer         → 내보내기 + 로그아웃
```

### 메인 헤더 요소
- `button.header-panel-btn.mobile-only` (☰) → toggleSidebar
- `div.context-chip#ctx-topic` → openTopicPicker (현재 주제/학생 표시)
- `div#ctx-role-label` → 보조 정보 (기록 수, 회기 수)
- `button#ns-btn` → 숨김 (대화창 구조에서 미사용)
- `button.header-panel-btn.mobile-only` (✦) → toggleAIPanel

### 화면 전환 흐름
1. **홈** (아무것도 선택 안 됨): `renderTodayView()` — 그리팅 + 퀵 카드
2. **주제/학생 선택**: `renderChatView()` — AI 대화창 + 하단 입력창
   - 선택 직후 `startContextChat()` → AI가 첫 마디 자동 시작
3. **캘린더**: `renderCalendar()`
4. **기록/회기 상세**: `openModal('record-detail'/'session-detail')` — 사이드바 트리에서 클릭 시 팝업
   - 내용(마크다운) / 메모 / 축어록 / 날짜 표시
   - 버튼: 삭제 / 수정 / AI 대화(AI 슈퍼비전)
5. **폼 (등록/수정)**: `openModal()` → 통합 모달 오버레이
   - `new-student` / `edit-student` / `new-topic` / `edit-topic`
   - `new-session` / `edit-session` (블록 에디터로 축어록 편집)
   - `edit-record` (블록 에디터로 본문 편집)
   - `verbatim` (축어록 첨부) / `write` (직접 쓰기) / `mode` (대화 모드)

### 색상 테마
- **상담 기록**: teal `#0F6E56`
- **나의 기록**: green `#1D9E75`

### 캘린더 점 표시
- 초록 점: 나의 기록 (my_records)
- 주황 점: 상담 기록 (sessions)
- 최대 3개 표시, 초과 시 `+N`

---

## AI 기능

### 개인정보 보호 원칙
1. API payload에 `student.name` 절대 포함 금지 — `student.alias`만 사용
2. 서버 PII 스크러빙: 전화번호, 주민번호, 이메일 자동 마스킹
3. 축어록 내 실명은 **찾기/바꾸기**로 수동 교체

### 상담 슈퍼비전 보고서 (ai-counseling.js)

#### 긴 축어록 처리 (3000자 이상 자동 전환)
```
1단계: 임상 핵심 추출 → verbatimSummary 저장 (max_tokens: 600)
2단계: 요약 기반 1페이지 보고서 생성 (max_tokens: 2000)
```
- 짧은 축어록(3000자 미만): 단일 호출
- `verbatimSummary`는 슈퍼비전 대화에도 활용 (대화 속도 향상)

#### 보고서 JSON 구조
```json
{
  "clientState":  "내담자 감정·방어기제·핵심 호소 (2문장)",
  "techniques":   "사용 기법과 임상적 적절성 (2문장)",
  "strengths":    "\n1) ...\n2) ...\n3) ...",
  "improvements": "\n1) 장면 + 문제점 + 대안\n2) ...",
  "overall":      "전반적 평가와 다음 회기 과제 (2문장)",
  "savedAt":      "YYYY-MM-DD"
}
```

#### 보고서 UI — 토글 섹션
| 키 | 색상 | 레이블 |
|----|------|--------|
| clientState  | rpt-blue   | 내담자 상태 분석 |
| techniques   | rpt-amber  | 기법 분류 및 평가 |
| strengths    | rpt-green  | 잘한 점 |
| improvements | rpt-red    | 개선 포인트 |
| overall      | rpt-purple | 종합 슈퍼비전 |

### 나의 기록 AI 보고서 (ai-myrecords.js)
- 기간 묶음 단위 (이번 주 / 이번 달 / 전체 / 직접 선택)
- `aiPrompt`에 따라 AI 역할 자율 설정 (일기 친구, 학습 코치, 성찰 코치 등)
- 이전 보고서 요약을 컨텍스트로 포함 (토큰 절약)
- 보고서 항목: pattern, strengths, improvements, questions, overall

### API 타임아웃
- `streamAnalyze`: 2분 (AbortController)
- `server.py` requests.post: 120초

---

## 축어록 편집 기능 (verbatim-editor.js)

### 텍스트 모드 (기본)
- 글자수 카운터 (3000자 초과 시 강조 + 긴 축어록 안내)
- **찾기/바꾸기 패널**: 실명 → 가명 수동 치환
- **빠른 주석 버튼**: 침묵(초 입력), 눈물, 웃음, 끄덕임, 고개젓기, 시선회피, 한숨

### 블록 모드
```
[텍스트] [블록]  ← 탭 전환

[T]  상담자 발화...                    ×
[C]  내담자 발화...                    ×
[비언어]  침묵 4초, 시선 회피         ×

[+ 상담자]  [+ 내담자]  [+ 비언어]
```
- **[T]/[C] 버튼** 클릭: 발화자 토글
- `vtTextToBlocks()`: 기존 축어록 텍스트 → 블록 자동 파싱
- `vtBlocksToText()`: 블록 → `상담자: ...` / `내담자: ...` / `[비언어: ...]` 형식으로 변환
- 저장 시 `syncVtBeforeSave()` 자동 호출 → textarea 동기화

---

## 서버 (server.py)

### 인증
- 세션 기반 로그인 (`APP_PASSWORD`)
- 모든 API 엔드포인트 `@require_auth` 데코레이터

### 엔드포인트
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/POST | `/login` | 로그인 |
| GET | `/logout` | 로그아웃 |
| GET | `/api/data` | 데이터 로드 |
| POST | `/api/data` | 데이터 저장 |
| POST | `/api/analyze` | Anthropic API 프록시 (스트리밍 지원) |
| POST | `/api/summarize-verbatim` | 긴 축어록 임상 요약 (3000자 미만 → skip:true) |
| POST | `/api/transform-text` | 축어록 AI 정리 (`mode: verbatim` / `diary`) |

### PII 스크러빙
AI 호출 전 자동 마스킹:
- 전화번호: `010-1234-5678` → `[전화번호]`
- 주민번호: `990101-1234567` → `[주민번호]`
- 이메일: `abc@school.kr` → `[이메일]`

---

## PWA (sw.js + manifest.json)

### 설치 방법 (아이패드)
사파리 → 공유 버튼 → 홈 화면에 추가 → 自畵像 아이콘

### 캐시 전략
- **정적 파일** (HTML/CSS/JS/아이콘): Cache First → Network Fallback
- **/api/, /login, /logout**: Network Only (서버 필수)
- 오프라인 시 API 실패 → 503 JSON 반환

### 아이패드 레이아웃
- `height: 100dvh` (dynamic viewport height) — 하드 키보드 툴바 대응
- `viewport-fit=cover` — 안전영역(Safe Area) 처리
- `apple-mobile-web-app-capable` — iOS 홈화면 설치 시 브라우저 UI 제거

---

## 테스트 자동화

### 실행
```bash
# 전체 서버 테스트
python -m pytest tests/test_server.py tests/test_stage_bc.py tests/test_stage_d.py tests/test_stage_e.py -v

# 스테이지별 자동 커밋
./scripts/stage_commit.sh A "기능 설명"   # bash
scripts\stage_commit.bat A "기능 설명"    # Windows
```

### 테스트 구성
| 파일 | 내용 | 테스트 수 |
|------|------|----------|
| test_server.py | API, PII 스크러빙, 긴 축어록 엔드포인트 | 15개 |
| test_stage_bc.py | 찾기/바꾸기(utils.js), 주석 버튼, Stage A 회귀 | 15개 |
| test_stage_d.py | 블록 에디터(verbatim-editor.js), 변환 함수, 회귀 | 23개 |
| test_stage_e.py | PWA, dvh CSS, 메타태그, Stage ABCD 회귀 | 30개 |
| test_e2e.py | E2E (Playwright) — 인증·사이드바·CRUD·캘린더 | 19개 |
| test_ui_stage_a.py | 기본 로딩 3개 + 인라인폼 E2E 3개(skip) | 6개 |
| test_tool_panel.py | 도구 패널 E2E — 심층질문·타임라인 버튼·모달·삽입 | 25개 |
| **합계** | **127 통과, 3 실패(서버 미실행), 3 skip** | **133개** |

> **실패 사유**: `test_ui_stage_a.py` 3개 — Playwright가 `localhost:5000`에 연결 실패 (서버 미실행 시 항상 발생, CI에서는 서버 선기동 필요)
> **skip 사유**: 인라인 세션 폼(`#ns-btn` 기반)이 모달+대화창 구조로 전환됨
> **TDD 방침**: 기능 추가 시 Playwright E2E 테스트를 먼저 작성(RED) → 구현 → 통과 확인(GREEN) 순서 준수. 커스텀 JS 함수 호출 테스트는 `wait_for_load_state('networkidle')` 보장 필수 (`app_page` 픽스처 사용)

---

## 개발 이력 (주요 커밋)

| 커밋 | 내용 |
|------|------|
| *(이번)* | Feat: 도구 패널 개편 — 심층 질문·성장 타임라인 버튼 추가, 나의 기록 보고서 버튼 제거, 팝업 모달 2종 |
| *(직전)* | Fix/Style: UX 개선 9종 — 말풍선·스크롤·사이드바·iOS키보드·대화유지·AI역할·삭제버튼 |
| `a4cd8d0` | Docs: PROJECT.md 최신화 |
| `51e4201` | Feat: 기록/회기 팝업 상세 + 블록 에디터 — 사이드바 트리 클릭 시 팝업, 수정 모달 문단 단위 블록 편집 |
| `cbea58c` | Fix: renderChatView 레이스 컨디션 — selRecord/selSession 시 chat이 detail 덮어쓰는 버그 |
| `b253971` | Feat: 사이드바 트리 + 기록/회기 CRUD — 하위 기록·회기 펼치기, new/edit-session, edit-record 모달 |
| `91d76cc` | Feat: 자화상 최종 지시서 반영 — AI_ROLE_PRESETS 교체, startContextChat 최근기록 컨텍스트, sendMyChatMessage 추가, sendChatMessage 동기화 |
| `2dc7092` | Refactor: panels.js 분리 — chat.js에서 레이아웃·패널·모바일 코드 이동 |
| `ca00776` | Revert: 홈 동기부여 기능 전체 제거 (스트릭·통계·성찰질문) |
| `2c4c101` | Feat: 폼 간소화 — 새 주제 textarea 제거, 새 내담자 배경정보 접기/펼치기 |
| `9c97e63` | Style: 폰트 Nanum Myeongjo 통일 + 글자 크기 상향 + 대화 내용 localStorage 유지 |
| `167b40d` | Fix: 채팅 전송 후 AI 무응답 — startContextChat trigger 메시지 히스토리 누락 |
| `e930d30` | Refactor: 미사용 껍데기 함수 제거 |
| `e33c775` | Fix: 지시서 기반 미구현 기능 4종 완성 |
| `6a40065` | Refactor: 나의 기록 패턴분석→대화요약저장, 일기변환→솔로쓰기 모드 |
| `1ea29ba` | 대화창 중심 아키텍처 전환 — render-forms/session/myrecords-view/resize 제거, 모든 폼을 modal.js로 통합, AI 첫 마디 자동 시작(startContextChat) |
| `7838519` | Claude.ai 스타일 고정 3열 레이아웃 전환 |
| `568c0c3` | Stage E: PWA + 아이패드 dvh 레이아웃 |

---

## 알려진 설계 결정 및 주의사항

1. **sessionNum/recordNum**: `length + 1` 아닌 `max + 1` 사용 (삭제 후 재추가 번호 중복 방지)
2. **암호화 마이그레이션**: 구버전 단순 SHA256 키 → 신버전 PBKDF2 자동 마이그레이션 (`_fernet_legacy()`)
3. **블록 에디터 상태**: `_vtBlocks`, `_vtMode`는 전역 모듈 변수 (state 객체 외부). 폼 재렌더 시 초기화됨.
4. **verbatimSummary**: Session 객체에 저장. 재생성 버튼 누르면 기존 summary 재사용 (1단계 재실행 안 함).
5. **스트리밍**: 보고서 생성은 SSE 스트리밍. 대화(`startSupervisionChat`, `sendChatMessage`)는 일반 POST.
6. **Railway 배포**: `Procfile` 존재. `DATABASE_URL` 환경변수 설정 시 PostgreSQL 자동 사용.
7. **dvh 지원**: iOS Safari 15.4+, iPadOS 16+. 그 이하에서는 100vh로 fallback (큰 문제 없음).
8. **대화창 중심 구조**: 주제/학생 선택 시 메인 영역은 항상 `renderChatView()`. 폼(등록/수정)은 전부 `openModal()`. 인라인 폼 렌더링 없음.
9. **startContextChat()**: 주제/학생 선택 직후 AI 첫 마디 자동 생성 (`chat.js`). 상담 기록은 `session.supervisionChat`에서 복원. 나의 기록은 최근 기록 3개를 시스템 프롬프트에 포함해 AI가 연속성 있게 시작. Anthropic API 규칙상 trigger 메시지를 `hidden:true`로 히스토리에 포함.
10. **AI_ROLE_PRESETS**: `listener`(그냥 들어주기) / `coach` / `counselor`(감정 상담사) / `advisor`(조언가) / `companion`(생각 친구) / `custom`(직접 입력) 6종. 각 프리셋은 구체적인 행동 지침 포함.
11. **폰트**: `--font` CSS 변수 = `Nanum Myeongjo` (serif). 自畵像 제목과 동일 폰트 전면 적용. Google Fonts `display=swap`으로 FOUT 방지.
12. **SW 캐시**: `jip-v{n}` 버전 번호 — CSS/JS 변경 시 반드시 버전 올려야 구 캐시 무효화됨. 현재: `jip-v15`.
13. **기록/회기 상세**: 메인 영역 인라인 렌더링 없음. 사이드바 트리에서 클릭 시 `openModal('record-detail'/'session-detail')`로 팝업. AI 대화 버튼은 팝업 닫고 기존 채팅창 복귀.
14. **블록 에디터 (modal.js)**: `renderBlockEditor()` / `collectBlocks()` / `addBlockToEditor()` / `removeBlock()`. verbatim-editor.js의 블록 에디터(축어록 전용)와 별개. edit-record(본문)·edit-session(축어록)에 적용. 문단 구분은 `\n\n`. Enter 두 번 → 새 블록, 빈 블록 Backspace → 위 블록 포커스.
15. **modalDeleteRecord/Session**: crud.js의 deleteRecord/deleteSession은 confirm+render. 팝업 내 삭제 버튼은 modal.js의 래퍼 함수 사용 (confirm 후 closeModal() 추가 호출).
16. **대화 유지 로직**: `selectTopic()`/`selectStudent()`에서 같은 항목 재클릭 시 대화 초기화 안 함. 다른 항목으로 전환 시 `loadChatHistory()`로 localStorage 복원 시도 → 없을 때만 `startContextChat()` 호출.
17. **AI 역할 시스템 프롬프트**: `continueContextChat()`은 매 메시지마다 `_buildChatSysPrompt()`를 호출해 현재 `state.currentRole`을 최신 반영. 대화 중 역할 변경 시 시스템 메시지로 구분선 표시. `selectTopic()` 시 해당 주제의 `selectedRole` 자동 복원 (없으면 `listener`).
18. **iOS 키보드 대응**: `--kb-offset` CSS 변수 방식 — `panels.js`의 `_initVisualViewport()`에서 `document.documentElement.style.setProperty('--kb-offset', ...)` 설정. `.input-area`의 `padding-bottom`에 적용. 키보드 올라올 때 채팅 자동 스크롤도 함께 실행.
19. **사이드바 기록/회기 삭제 버튼**: `.sub-child-actions` CSS는 hover 시 표시. `deleteRecord(id)` / `deleteSession(id)` 함수 직접 호출 (modal.js 래퍼 없음).
20. **심층 질문 버튼** (`rp-deepq-btn`): 나의 기록은 `selTopic`+기록 1개 이상 시 활성. 상담 기록은 축어록(`session.verbatim.trim()`) 있을 때만 활성. 결과는 `showDeepQuestionModal()` — 질문 3개 줄 파싱, `data-q` 속성으로 안전하게 텍스트 저장, 클릭 시 `insertQuestion()`으로 `chat-input-bottom`에 삽입 후 자동 닫힘.
21. **성장 타임라인 버튼** (`rp-timeline-btn`): 나의 기록은 2개 이상 기록, 상담 기록은 2개 이상 회기 시 활성. JSON 5키(`start`/`journey`/`now`/`highlight`/`overall`) 색상별 섹션으로 `showTimelineModal()` 표시. 상담 기록은 `analysis.overall` → `verbatimSummary` → `verbatim.slice(0,200)` 순서로 폴백.
22. **safe 질문 삽입**: `insertQuestion(q)` 내 `data-q` + addEventListener 패턴 — 질문 텍스트에 작은따옴표가 있어도 onclick 인라인 JS 없이 안전하게 처리. `input` 이벤트도 dispatch해 textarea 자동 높이 조절 트리거.
