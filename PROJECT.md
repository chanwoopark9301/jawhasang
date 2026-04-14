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
│   ├── render-forms.js     ← 폼 렌더링 (학생/회기/주제/기록 등록·수정)
│   ├── render-session.js   ← 회기 상세 렌더링 (축어록, 보고서, 대화 탭)
│   ├── render-myrecords-view.js ← 나의 기록 화면 렌더링
│   ├── render-aipanel.js   ← AI 패널 렌더링
│   ├── render-main.js      ← 메인 컨텐츠 라우팅
│   ├── verbatim-editor.js  ← 블록 에디터 (텍스트↔블록 모드 전환)
│   ├── render-home.js      ← 홈 화면 렌더링 (캘린더 + 오늘 카드)
│   ├── transform-text.js   ← 축어록 AI 정리 클라이언트
│   └── resize.js           ← 오버레이 패널 토글 (toggleSidebar, toggleAIPanel, closePanels)
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
│  ● 나의 기록    │  홈: 그리팅 화면            │ [보고서 생성 ↗] │
│    ├ 일기       │  캘린더: 월별 캘린더        │ [축어록 정리 ↗] │
│    └ 아쉬운 점  │  상담: 회기 목록/상세       │ [패턴 분석 ↗]  │
│  ● 상담 기록    │  나의 기록: 기록 목록/상세  │                │
│    ├ 별-01      │                            │                │
│    └ + 새 내담자│                            │                │
│  ○ 캘린더       │                            │                │
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

### 사이드바 구조 (nav-item / sub-items)
```
div.sidebar-logo           → 홈으로 (showHome)
button.new-chat-btn        → 새 대화 모달 (openNewChatModal)
nav.sidebar-nav
  ├ .nav-section-label "기록"
  ├ #nav-my.nav-item       → setView('myrecords')
  │   └ #sub-my.sub-items  → 주제 sub-item 목록 + "+ 새 주제" add
  ├ #nav-sv.nav-item       → setView('student')
  │   └ #sub-sv.sub-items  → 학생 sub-item 목록 + "+ 새 내담자" add
  └ #nav-cal.nav-item      → setView('calendar')
div.sidebar-footer         → 내보내기 + 로그아웃
```

### 메인 헤더 요소
- `button.header-panel-btn.mobile-only` (☰) → toggleSidebar
- `div.context-chip#ctx-topic` → openTopicPicker (현재 주제/학생 표시)
- `div#ctx-role-label` → 보조 정보 (기록 수, 회기 수)
- `button#ns-btn` → + 회기 추가 / + 기록 추가
- `button.header-panel-btn.mobile-only` (✦) → toggleAIPanel

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
| test_stage_bc.py | 찾기/바꾸기, 주석 버튼, Stage A 회귀 | 15개 |
| test_stage_d.py | 블록 에디터 구조, 변환 함수, Stage ABC 회귀 | 23개 |
| test_stage_e.py | PWA, dvh CSS, 메타태그, Stage ABCD 회귀 | 30개 |
| **합계** | | **83개** |

---

## 개발 이력 (주요 커밋)

| 커밋 | 내용 |
|------|------|
| (현재) | 오버레이 패널 UX, 홈 캘린더 뷰, 축어록 AI 정리, 헤더 대칭 레이아웃 |
| `cea795d` | 축어록 탭 인라인 편집 기능 |
| `568c0c3` | Stage E: PWA + 아이패드 dvh 레이아웃 |
| `167decd` | Stage D: 블록 에디터 |
| `066413f` | Stage B+C: 찾기/바꾸기 + 주석 버튼 |
| `e652942` | Stage A: 긴 축어록 2단계 처리 + 테스트 인프라 |
| `8d94193` | 버그 수정 + 보안 패치 |
| `f15fc7b` | 패널 접기/펼치기, 나의 기록 AI 역할 기반 자유화 |
| `f77375f` | app.js → js/ 모듈 분리 |
| `8133c69` | 수정, 검색, 태그, 패턴분석, 내보내기 구현 |

---

## 알려진 설계 결정 및 주의사항

1. **sessionNum/recordNum**: `length + 1` 아닌 `max + 1` 사용 (삭제 후 재추가 번호 중복 방지)
2. **암호화 마이그레이션**: 구버전 단순 SHA256 키 → 신버전 PBKDF2 자동 마이그레이션 (`_fernet_legacy()`)
3. **블록 에디터 상태**: `_vtBlocks`, `_vtMode`는 전역 모듈 변수 (state 객체 외부). 폼 재렌더 시 초기화됨.
4. **verbatimSummary**: Session 객체에 저장. 재생성 버튼 누르면 기존 summary 재사용 (1단계 재실행 안 함).
5. **스트리밍**: 보고서 생성은 SSE 스트리밍. 대화(`startSupervisionChat`, `sendChatMessage`)는 일반 POST.
6. **Railway 배포**: `Procfile` 존재. `DATABASE_URL` 환경변수 설정 시 PostgreSQL 자동 사용.
7. **dvh 지원**: iOS Safari 15.4+, iPadOS 16+. 그 이하에서는 100vh로 fallback (큰 문제 없음).
