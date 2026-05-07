# 자산 데스크 전환 구현 계획서

작성일: 2026-05-07

## 1. 결론

투자 파트너를 더 크게 키우는 방향보다, 앱의 세 번째 축을 `투자`에서 `자산`으로 확장하는 방향이 맞다.

자산 데스크는 단순 가계부가 아니라, 은행 계좌, 현금, 저축, 투자 계좌, 증권 예수금, 대출, 세금 예비금을 한 화면에서 보고 사용자가 오늘 돈을 어떻게 움직여야 하는지 판단하게 돕는 개인 재무 통제 시스템이다.

초기 구현은 은행 API 직접 연동이 아니라 수동 입력, 문자/알림 내역 붙여넣기, CSV 업로드를 우선한다. 은행 API는 이용기관 심사, OAuth, 계좌등록, 보안 요건이 크므로 마지막 단계의 선택지로 둔다.

## 2. 제품 정의

### 기존 투자 파트너

- 보유 종목, 현금, 매매 기록, 뉴스, 원칙을 기반으로 충동 매매를 줄이는 도구
- 핵심 질문: "지금 이 매매가 내 원칙을 위반하는가?"

### 전환 후 자산 데스크

- 생활비, 현금흐름, 저축, 투자, 세금, 비상금까지 포함한 전체 자산 관리 도구
- 핵심 질문: "지금 이 돈의 이동이 내 전체 자산 계획을 해치지 않는가?"

## 3. 메뉴 구조 방향

현재 메뉴를 더 늘리지 않는다. 최종 목표는 상위 메뉴를 아래처럼 단순화하는 것이다.

```text
일상 / 상담 / 자산
```

`자산` 안의 하위 허브:

```text
오늘의 데스크
계좌·자산
가계부
투자
계획
```

단, 한 번에 UI를 크게 갈아엎지 않는다. 초기에는 현재 `투자` 화면 안의 `계좌·포트폴리오`를 `자산·계좌`로 확장하고, 검증 후 상위 메뉴명을 `투자`에서 `자산`으로 바꾼다.

## 4. 데이터 구조 초안

기존 `investment` 키는 유지한다. 새 데이터는 `assets` 키로 추가한다.

```js
{
  assets: {
    accounts: [],
    transactions: [],
    budgets: [],
    plans: [],
    categories: {},
    imports: [],
    sync: {}
  }
}
```

### Account

```js
{
  id: "acct" + Date.now(),
  type: "bank" | "cash" | "brokerage" | "savings" | "loan" | "credit_card" | "tax_reserve",
  name: "생활비 통장",
  institution: "카카오뱅크",
  currency: "KRW",
  balance: 1200000,
  manualBalance: true,
  linkedInvestment: false,
  createdAt: "YYYY-MM-DD",
  updatedAt: "YYYY-MM-DD"
}
```

### Transaction

```js
{
  id: "tx" + Date.now(),
  accountId: "acct...",
  date: "YYYY-MM-DD",
  direction: "in" | "out" | "transfer",
  amount: 45000,
  currency: "KRW",
  category: "식비",
  merchant: "배달의민족",
  memo: "저녁",
  source: "manual" | "sms" | "csv" | "api" | "investment",
  rawText: "",
  linkedTransactionId: null,
  linkedInvestmentDecisionId: null,
  createdAt: "ISO"
}
```

### Plan

```js
{
  id: "plan" + Date.now(),
  type: "monthly_budget" | "saving_goal" | "tax_reserve" | "investment_allocation" | "debt_repayment",
  title: "IREN 익절금 배분",
  rules: {
    taxReservePercent: 22,
    emergencyCashTarget: 3000000,
    monthlyInvestmentLimit: 1000000
  },
  status: "active",
  createdAt: "ISO"
}
```

## 5. 투자 데이터와의 관계

투자 모듈은 자산 데스크의 하위 계좌가 된다.

```text
assets.accounts(type=brokerage)
  └─ investment.positions
  └─ investment.decisions
  └─ investment.account.totalCapital
```

초기에는 중복 저장을 피하기 위해 `investment`를 그대로 두고, 자산 데스크에서 투자 계좌를 읽어 요약한다. 이후 안정화되면 `investment.account`를 `assets.accounts`의 brokerage 계좌와 연결한다.

### 매도/매수 반영 원칙

- 매도: 증권 예수금 계좌에 매도대금 전체가 입금된다.
- 실현손익: 거래 성과로 별도 기록된다.
- 매수: 증권 예수금 계좌에서 매수대금이 출금되고 보유 종목 평가액으로 이동한다.
- 증권사에서 은행으로 출금: brokerage 계좌 감소, bank 계좌 증가의 이체 거래로 기록한다.

## 6. 문자/알림 내역 붙여넣기 기능

은행 API를 바로 붙이지 않는 대신, 사용자가 채팅창에 문자나 앱 알림 내역을 붙여넣으면 자동으로 거래를 생성한다.

예시 입력:

```text
[카카오뱅크] 05/07 12:31 체크카드 8,900원 스타벅스 잔액 1,242,100원
[신한은행] 입금 2,500,000원 급여 05/25 09:01 잔액 3,120,000원
[한국투자] 해외주식 매도 IREN 1,190주 61.07USD 체결
```

처리 흐름:

1. 사용자가 자산/가계부 모드에서 문자 내역을 붙여넣는다.
2. 파서가 날짜, 기관, 입출금 방향, 금액, 가맹점, 잔액, 통화를 추출한다.
3. 확신도가 낮으면 AI가 사용자에게 필요한 값만 묻는다.
4. 사용자가 확인하면 `assets.transactions`에 저장한다.
5. 연결 계좌 잔액이 갱신된다.
6. 투자 체결 문자라면 `investment.decisions` 또는 `investment.positions`와 연결한다.

초기 파서는 정규식 기반으로 만들고, 애매한 내역만 AI 보정에 맡긴다.

## 7. 디렉토리 구조 방향

현재는 빌드 도구 없는 순수 JS 구조이므로, 큰 폴더 이동은 하지 않는다. 대신 기능 축 단위로 파일을 추가한다.

```text
js/
  asset-state.js       # assets 기본값, normalize, migration
  asset-ledger.js      # 계좌/거래/잔액 계산
  asset-parser.js      # 문자/알림/CSV 거래 추출
  asset-desk.js        # 오늘의 자산 데스크 계산
  asset-api.js         # 서버 API 호출
  render-asset.js      # 자산 화면/모달 렌더링

asset_backend.py       # 자산 저장/정규화, 추후 은행 연동 공통 레이어
bank_sync.py           # 은행 API/CSV/문자 import adapter
```

투자 파일은 그대로 유지한다.

```text
js/investment-*.js
investment_backend.py
investment_broker.py
kis_broker.py
investment_calendar.py
```

## 8. 단계별 구현 계획

### Phase 0. 설계와 정리

- 이 문서로 자산 데스크 방향 확정
- 레거시 투자 메뉴 훅, 사라진 selector, 중복 현금 함수 같은 잔가지 제거
- `investment`는 유지하고 `assets` 추가 준비

### Phase 1. 수동 자산 장부

- `assets.accounts`, `assets.transactions` 기본 구조 추가
- 은행/현금/저축/대출/증권 예수금 계좌 수동 등록
- 입금/출금/이체 수동 기록
- 월별 거래 목록과 계좌별 잔액 표시

### Phase 2. 채팅 기반 거래 반영

- 자산 대화 모드 추가
- 문자/알림 붙여넣기 파서 구현
- "이거 가계부에 기록해줘", "생활비 통장 입금으로 반영해줘" 흐름 구현
- 애매한 내역은 AI가 계좌/카테고리/방향만 질문

### Phase 3. 자산 데스크

- 오늘의 현금 상태
- 이번 달 지출 속도
- 저축률
- 세금 예비금
- 투자 가능 현금
- 비상금 부족 여부
- 투자 계좌 집중도

이 정보를 한 화면에서 보여준다.

### Phase 4. 투자와 자산 연결

- 투자 매도/매수 기록을 증권 예수금 거래로 연결
- 은행 출금/증권 입금/증권 출금/은행 입금의 이체 모델 추가
- 전체 자산에서 투자 비중, 현금 비중, 저축 비중 계산

### Phase 5. CSV 업로드

- 은행/카드 앱에서 내려받은 CSV를 붙여넣거나 업로드
- 날짜/금액/가맹점/잔액 컬럼 매핑
- 중복 거래 감지

### Phase 6. 은행 API 검토

- 금융결제원 오픈뱅킹 샌드박스 검토
- 이용기관/보안/심사 가능성 검토
- 개인 앱 운영 기준에서는 API 직접연동보다 CSV/문자 기반이 우선

## 9. AI 역할

자산 AI는 투자 추천가가 아니라 현금흐름 통제자다.

해야 할 일:

- 입출금 문자에서 거래 추출
- 불분명한 내역을 사용자에게 질문
- 소비 패턴 요약
- 저축/투자 가능 금액 계산
- 세금 예비금 분리 제안
- 투자 전 전체 자산 관점의 경고

하지 말아야 할 일:

- 카드/은행 비밀번호 요구
- 실제 송금 지시
- 은행 API 인증 정보를 채팅에 입력하라고 요구
- 과도한 투자 권유

## 10. 테스트 계획

- `normalizeAssetState()`가 빈 데이터와 구버전 데이터를 안전하게 보정하는지 테스트
- 문자 파서가 대표 입금/출금/카드/이체 문자를 거래로 변환하는지 테스트
- 같은 문자 내역을 두 번 붙여넣어도 중복 저장하지 않는지 테스트
- 투자 매도 후 증권 예수금과 전체 자산이 맞는지 E2E 테스트
- 자산 메뉴가 기존 일상/상담/투자 기록에 영향을 주지 않는지 회귀 테스트

## 11. 다음 실제 구현 시 첫 작업

1. `state.js`와 `server.py`에 `assets` 빈 구조 추가
2. `js/asset-state.js`, `js/asset-ledger.js`, `js/asset-parser.js` 작성
3. 문자 파서 테스트부터 작성
4. 자산 허브 모달을 만들되 입력 폼은 접힘 상태로 숨김
5. 투자 예수금은 읽기 전용으로 자산 데스크에 표시
