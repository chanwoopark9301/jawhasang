# Investment Engine Implementation Plan

작성일: 2026-05-11

## 1. 목표

투자 파트너는 종목 추천기가 아니라, 사용자의 계좌 원장과 투자 논리를 기준으로 매일의 핵심 변수를 해석하고 충동 매매를 늦추는 개인 투자 통제 데스크가 된다.

핵심 질문은 세 가지다.

- 내 계좌에서 오늘 가장 위험한 노출은 무엇인가?
- 어떤 증거가 기존 투자 논리를 강화하거나 훼손하는가?
- 지금 하지 말아야 할 행동과, 조건이 충족되면 가능한 행동은 무엇인가?

## 2. 현재 구현 상태

### 완료

- 서버 측 Python 판단 엔진 분리: `investment_desk_engine.py`
- 원장 기준 엔진 API: `/api/investment/desk/engine`
- 종목별 thesis/profile/driver 생성
- 행동 통제 상태 생성
- 증거 등급 분류: A/B/C/D/E
- thesis 증거 분류: bullish/bearish/unconfirmed/neutral
- thesis 상태 계산: supported / under_pressure / needs_confirmation / unproven
- 데스크 스냅샷 저장: `investment.desk.engine`, `investment.theses`, `investment.deskSnapshots`

### 아직 부족한 부분

- 시나리오별 행동 기준
- thesis 변경 이력
- 공식 자료 우선 수집 품질
- 대화형 매매 의도 차단과 예외 기록
- 오늘의 데스크 UI 재구성
- 전체 자산/가계부 원장과 투자 원장의 연결

## 3. 엔진 단계별 계획

### Phase 1. Core Judgement Engine

상태: 완료

역할:

- 보유 종목을 사업 모델/노출 유형별로 분류한다.
- 종목별 thesis, drivers, invalidation rules를 만든다.
- 비중, 이벤트, 최근 매매, 추격매수 위험을 기준으로 행동 통제 상태를 계산한다.

결과:

- `behaviorControls`
- `theses`
- `researchQueue`

### Phase 2. Evidence Pressure Engine

상태: 완료

역할:

- 저장된 뉴스/공시/일정/신호를 thesis driver에 연결한다.
- source 품질을 A/B/C/D/E로 분류한다.
- 증거를 bullish/bearish/unconfirmed/neutral로 나눈다.
- thesis 상태와 pressure score를 계산한다.

결과:

- `thesisEvidence`
- `thesis.status`
- `thesis.pressureScore`

### Phase 3. Scenario Engine

상태: 진행 예정

역할:

- 종목별로 좋은 경우, 애매한 경우, 나쁜 경우의 행동 기준을 만든다.
- 가격 조건만이 아니라 공식 자료 확인, thesis 상태, 이벤트 근접 여부, 출처 품질을 함께 본다.
- 사용자가 "추매할까?", "손절할까?", "브리핑해줘"라고 했을 때 행동 기준의 뼈대가 된다.

결과:

- `scenarios`
- 각 시나리오의 `condition`, `action`, `blockedUntil`, `requiredEvidence`, `rationale`

예시:

```text
CRCL
- Bull case: 법안 공식 일정 확인 + USDC 증가 + 실적콜에서 reserve yield 방어 확인
- Base case: 실적은 무난하지만 정책은 비공식 흐름뿐 → 보유/관망
- Bear case: USDC 감소 + 법안 지연 + 금리 하락으로 수익성 훼손 → 축소 검토
```

### Phase 4. Conversation Gate

상태: 예정

역할:

- 대화 중 매수/추매/손절/재진입 의도를 감지하면 AI 답변 전에 엔진을 실행한다.
- 금지 상태라면 "추천"보다 "차단 이유"를 먼저 말한다.
- 사용자가 예외적으로 진행하려면 예외 사유를 남기게 한다.

결과:

- `pendingTradeIntent`
- `gateResult`
- `overrideReason`
- `reviewItem`

### Phase 5. Thesis Revision History

상태: 예정

역할:

- 새 증거가 들어왔을 때 thesis가 강화/약화/무효화 후보인지 기록한다.
- 이전 thesis와 변경 이력을 남긴다.
- 나중에 "왜 이때 매수/매도했는가"를 복기할 수 있게 한다.

결과:

- `thesisRevisions`
- `changedDrivers`
- `reviewRequired`

### Phase 6. Desk UI Rebuild

상태: 예정

역할:

- 오늘의 데스크를 포트폴리오 요약판이 아니라 판단판으로 바꾼다.

권장 UI:

```text
오늘의 핵심 뷰
Thesis 상태
하지 말아야 할 행동
시나리오별 행동 기준
확인해야 할 공식 자료
```

## 4. 자산/가계부 확장 고려

투자 엔진은 장기적으로 전체 자산 엔진의 하위 모듈이 되어야 한다.

### 원칙

- 투자 포트폴리오는 전체 자산의 일부다.
- 매매로 생긴 현금은 증권 계좌 예수금이며, 전체 자산 원장에서는 brokerage account의 cash balance다.
- 가계부/은행 입출금/저축/세금 예비금은 별도 자산 원장으로 관리하되, 투자 원장과 연결 가능해야 한다.

### 추천 구조

```js
assets: {
  accounts: [],
  transactions: [],
  plans: [],
  imports: [],
  snapshots: []
}
```

### Account 예시

```js
{
  id: "acct-brokerage-main",
  type: "brokerage",
  name: "한국투자 해외주식",
  currency: "USD",
  balance: 42135,
  linkedInvestmentAccountId: "primary"
}
```

### Transaction 예시

```js
{
  id: "asset-tx-...",
  accountId: "acct-brokerage-main",
  date: "2026-05-11",
  direction: "in",
  amount: 71400,
  currency: "USD",
  category: "investment_sell_proceeds",
  linkedInvestmentDecisionId: "tx-iren-sell"
}
```

### 문자/알림 기반 가계부

은행 API가 어렵거나 비용이 들면, 초기에는 문자/알림 붙여넣기로 시작한다.

흐름:

1. 사용자가 입출금 문자나 카드 알림을 대화창에 붙인다.
2. parser가 날짜, 금액, 방향, 계좌, 가맹점, 잔액을 추출한다.
3. 불확실한 값만 사용자에게 질문한다.
4. 확인 후 `assets.transactions`에 저장한다.
5. 계좌 잔액과 전체 자산 스냅샷을 갱신한다.

## 5. 구현 우선순위

1. Scenario Engine
2. Conversation Gate
3. Desk UI Rebuild
4. Thesis Revision History
5. Asset Ledger Skeleton
6. SMS/Notification Parser
7. Broker/Bank API 연동

## 6. 테스트 기준

- 서버 엔진은 외부 API 없이 순수 함수 테스트 가능해야 한다.
- 포트폴리오 원장과 현금은 중복 적용되지 않아야 한다.
- 같은 매매 기록은 idempotency key로 중복 반영되지 않아야 한다.
- D/E 등급 증거는 확정처럼 말하지 않아야 한다.
- 행동 금지 상태에서는 AI 답변보다 통제 메시지가 먼저 나와야 한다.
