# 自畵像 — 앱 전체 명세서

> 중등 전문상담교사를 위한 상담 기록 + AI 슈퍼비전 웹 앱.
> 순수 HTML/CSS/Vanilla JS 프론트엔드 + Python Flask 백엔드.

---

## 1. 아키텍처 개요

```
브라우저
  └─ index.html  (진입점)
  └─ style.css   (전역 스타일)
  └─ js/         (모듈 16개, 빌드 도구 없음)
       ├─ state.js            전역 상태 객체
       ├─ data.js             서버 로드/저장/내보내기
       ├─ crud.js             CRUD 전 작업
       ├─ nav.js              화면 전환, 탭 전환
       ├─ utils.js            공통 유틸 (esc, parseJSON, streamAnalyze, renderMd…)
       ├─ resize.js           패널 드래그 리사이즈
       ├─ render-main.js      메인 영역 라우터 + render()
       ├─ render-sidebar.js   사이드바 렌더
       ├─ render-aipanel.js   AI 패널 렌더
       ├─ render-calendar.js  캘린더 + 팝업
       ├─ render-session.js   축어록/보고서/대화 탭
       ├─ render-forms.js     학생/회기/주제/기록 폼
       ├─ render-myrecords-view.js 나의 기록 상세
       ├─ ai-counseling.js    상담 슈퍼비전 AI
       ├─ ai-myrecords.js     나의 기록 AI
       └─ ai-pattern.js       전체 패턴 분석 AI

Flask 서버 (server.py)
  ├─ 로그인/로그아웃 (세션 기반)
  ├─ 정적 파일 서빙 (auth guard)
  ├─ /api/data   GET/POST  (Fernet 암호화 저장)
  └─ /api/analyze POST     (Anthropic API 프록시, 스트리밍)

저장소
  ├─ PostgreSQL (DATABASE_URL 설정 시, Supabase 권장)
  └─ data.json  (로컬 폴백, Fernet 암호화)
```

---

## 2. 데이터 구조

### Student
```js
{
  id: 's{timestamp}',
  alias: string,          // 가명 (예: '별-01') — AI 호출에만 사용
  grade: '중1'|…|'고3',
  gender: '남'|'여'|'',
  family: string,
  peers: string,
  situation: string,
  notes: string,
  createdAt: 'YYYY-MM-DD',
  patternAnalysis: object|null,  // 전체 패턴 분석 결과 (선택)
}
```

### Session
```js
{
  id: 'ss{timestamp}',
  studentId: string,
  date: 'YYYY-MM-DD',
  sessionNum: number,          // 자동 계산 (max + 1, 빈 자리 없음)
  verbatim: string,            // 축어록 전문
  memo: string,
  tags: string[],
  analysis: {                  // AI 슈퍼비전 보고서 (선택)
    clientState, techniques, strengths, improvements, overall,
    savedAt: 'YYYY-MM-DD'
  }|null,
  supervisionChat: {role:'user'|'ai', text:string}[],
}
```

### Topic (나의 기록)
```js
{
  id: 't{timestamp}',
  title: string,
  aiPrompt: string,            // AI 역할 정의 (비워두면 기본값)
  createdAt: 'YYYY-MM-DD',
  patternAnalysis: object|null,
}
```

### Record (나의 기록)
```js
{
  id: 'r{timestamp}',
  topicId: string,
  date: 'YYYY-MM-DD',
  recordNum: number,
  content: string,             // 마크다운 지원
  memo: string,
  tags: string[],
  analysis: {
    pattern, strengths, improvements, questions, overall,
    savedAt: 'YYYY-MM-DD',
    period: 'YYYY-MM-DD ~ YYYY-MM-DD'
  }|null,
  aiChat: {role:'user'|'ai', text:string}[],
}
```

---

## 3. 전역 상태 (state.js)

```js
const state = {
  // 뷰 전환
  view: 'student' | 'myrecords',

  // 상담 기록
  students: Student[],
  sessions: Session[],
  selStudent: string|null,
  selSession: string|null,
  mode: 'welcome'|'list'|'detail'|'new-student'|'new-session'|'edit-student'|'edit-session',
  sessionTab: 'verbatim'|'report'|'dialogue',
  aiLoading: boolean,
  chatLoading: boolean,

  // 나의 기록
  myTopics: Topic[],
  myRecords: Record[],
  selTopic: string|null,
  selRecord: string|null,
  myMode: 'welcome'|'list'|'detail'|'new-topic'|'new-record'|'edit-topic'|'edit-record',
  myTab: 'content'|'report'|'dialogue',
  myAiLoading: boolean,
  myChatLoading: boolean,
  myPeriod: 'week'|'month'|'all',

  // 캘린더
  calYear: number,
  calMonth: number,  // 0-indexed
  calDate: string|null,
  calPopup: string|null,

  // 공통
  editingId: string|null,
  searchQuery: string,
  filterTags: string[],
  patternLoading: boolean,
  myPatternLoading: boolean,
}

let mobilePanel = 'sidebar'|'main'|'ai'
```

---

## 4. 화면 레이아웃

```
┌──────────────┬──────────────────────────┬───────────────┐
│  사이드바    │        메인 영역          │   AI 패널     │
│  (200px기본) │        (flex:1)          │  (255px기본)  │
│              │                          │               │
│  [상담/나의] │  [축어록|보고서|대화]    │  학생/주제 정보│
│  검색창      │                          │  aiPrompt     │
│  목록        │  상세 내용               │               │
│              │                          │  [보고서 생성]│
│  [+ 추가]    │         [+ 회기/기록]    │               │
└──────────────┴──────────────────────────┴───────────────┘
```

### 홈 화면
- 초기 진입 시 `home-view` 오버레이 표시 (캘린더 포함)
- 캘린더 날짜 클릭 → `home-view` 숨김 + 해당 날짜 팝업

### 패널 리사이즈
- 사이드바/AI 패널 경계: 드래그로 너비 조절
- 마지막 너비 `localStorage`에 저장

### 패널 접기/펼치기
- 사이드바 우측 상단 `◀` 버튼 → 접힘 (너비 0, 아이콘만 남음)
- AI 패널 좌측 상단 `▶` 버튼 → 접힘
- 접힘 상태 `localStorage`에 저장 (`sidebar_collapsed`, `aipanel_collapsed`)

---

## 5. API 명세

### 인증
| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/login` | GET | 로그인 폼 |
| `/login` | POST | 비밀번호 검증 → 세션 발급 |
| `/logout` | GET | 세션 초기화 → `/login` 리다이렉트 |

모든 API는 `require_auth` 데코레이터로 보호. 미인증 시 `/login` 리다이렉트.

### 데이터
| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/api/data` | GET | Fernet 복호화 → JSON 반환 |
| `/api/data` | POST | JSON → Fernet 암호화 → DB/파일 저장 |

### AI 프록시
| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/api/analyze` | POST | Anthropic API 중계 (스트리밍 지원) |

**스트리밍 흐름:** `payload.stream=true` → SSE 청크를 그대로 전달 → 프론트에서 청크 누적 후 JSON 파싱

---

## 6. 암호화 / 보안

### 데이터 암호화
- 키 유도: `SHA256(APP_PASSWORD)` → base64 → Fernet 키
- 모든 데이터는 `data.json` 또는 PostgreSQL `BYTEA` 컬럼에 암호화 저장
- 복호화 실패(InvalidToken) 시 EMPTY 구조 반환 (plain JSON 마이그레이션 처리 포함)

### 인증
- Flask 세션 서명 키: `SHA256(APP_PASSWORD + '_sk')`
- 단일 비밀번호 방식 (개인 사용 앱)

### AI 개인정보 보호
- API 호출 페이로드에 `student.alias`만 포함 (`student.name` 없음)
- 호출 전 PII 스크러빙: 전화번호, 주민번호 패턴 자동 제거/마스킹
- 스크러빙 대상: verbatim, memo, family, peers, situation, notes, record content

---

## 7. AI 기능 명세

### 7-1. 상담 슈퍼비전 보고서
**입력:** 학생 alias/grade/배경정보 + 회기 날짜/번호/축어록/메모
**출력 (JSON):**
```json
{
  "clientState": "내담자 감정 흐름, 방어기제, 핵심 호소",
  "techniques": "상담자 기법 + 적절성 평가",
  "strengths": "잘한 개입 3가지 이상",
  "improvements": "개선 장면 2-3개 (인용+문제+대안)",
  "overall": "종합 평가 + 다음 회기 과제",
  "savedAt": "YYYY-MM-DD"
}
```

### 7-2. 슈퍼비전 대화
- 시스템 프롬프트: 학생 배경 + 전체 축어록 + 이전 회기 요약 + 보고서
- 대화 원칙: 소크라테스식 질문, 판단 없이 반영
- 초기 메시지: AI가 핵심 장면 선택 후 질문으로 시작

### 7-3. 나의 기록 보고서
**입력:** topic.aiPrompt + 기간 내 records 전문 (+ 이전 보고서 overall)
**출력 (JSON):**
```json
{
  "pattern": "반복 패턴",
  "strengths": "잘 된 것",
  "improvements": "개선점",
  "questions": "다음 기간 질문 2-3개",
  "overall": "종합 평가",
  "savedAt": "YYYY-MM-DD",
  "period": "YYYY-MM-DD ~ YYYY-MM-DD"
}
```

### 7-4. 전체 패턴 분석
- 상담 기록: 학생의 전체 회기 타임라인 기반
- 나의 기록: 주제의 전체 기록 타임라인 기반

---

## 8. 캘린더

- 월별 42셀 그리드
- 날짜 셀 하단 점: 초록(나의 기록 `#1D9E75`) + 주황(상담 기록 `#EF9F27`), 최대 3개 + `+N`
- 날짜 클릭 → 팝업 (해당 날짜 기록 목록 + 추가 버튼)
- `◀` / `▶` 버튼으로 월 이동

---

## 9. 모바일 레이아웃

- 하단 네비게이션 (`#mobile-nav`): 목록 / 상담 / AI 탭
- 탭 전환 시 해당 패널만 표시 (`mobile-active` 클래스)
- 브레이크포인트: 768px 이하

---

## 10. 색상 테마

| 구분 | 색상 | 용도 |
|------|------|------|
| 상담 기록 포인트 | `#0F6E56` (teal) | 버튼, 탭, 강조 |
| 나의 기록 포인트 | `#1D9E75` (green) | 버튼, 탭, 강조 |
| 캘린더 — 나의 기록 점 | `#1D9E75` | 초록 점 |
| 캘린더 — 상담 기록 점 | `#EF9F27` | 주황 점 |
| 배경 | `#f0ece5` | 전체 배경 |
| 카드 배경 | `#f8f5f0` | 사이드바, 패널 |

---

## 11. 파일 구조

```
counselingReport/
├── CLAUDE.md          ← Claude Code 지시서
├── APP_SPEC.md        ← 이 파일 (앱 전체 명세)
├── TEST_SPEC.md       ← 테스트 명세
├── index.html         ← HTML 구조
├── style.css          ← 전역 스타일
├── js/                ← 모든 JS 로직 (모듈)
├── server.py          ← Python Flask 서버
├── run.bat            ← 로컬 실행 스크립트
├── requirements.txt   ← Python 의존성
├── data.json          ← 로컬 암호화 데이터 (gitignore 권장)
└── ecrk.env           ← 환경변수 (API 키, 비밀번호)
```
