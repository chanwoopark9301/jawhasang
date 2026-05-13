# 시장 판단·포트폴리오 조절 엔진 구현 계획

작성일: 2026-05-13

## 1. 핵심 원칙

이 기능의 목적은 종목 추천을 잘하는 AI가 아니라, 계좌 원장과 시장 국면을 기준으로 사용자의 위험 노출을 조절하는 투자 통제 데스크를 만드는 것이다.

역할 분담은 명확히 나눈다.

- DB/서버 엔진: 시장 국면, 목표 현금 비중, 레버리지 제한, 고변동 노출, 이벤트 방어 모드를 판정한다.
- LLM: 최신 정보 탐색, 뉴스/공시 요약, 사용자가 이해할 수 있는 대화문 작성, 불확실한 데이터 질문을 담당한다.
- UI: 엔진 판정을 먼저 보여주고, 사용자가 충동적으로 행동하지 않도록 다음 행동을 좁혀준다.

LLM은 판단의 최종 결정권자가 아니다. LLM 응답이 엔진 판정과 충돌하면 엔진 판정이 우선한다.

## 2. 현재 구현 상태

### 완료

- `market_regime_engine.py` 추가
- 상승장/횡보장/하락장 분류 함수 추가
- 목표 현금 비중 계산
- 5일 내 빅 이벤트 감지
- 이벤트 방어 모드 계산
- 포트폴리오 현금/위험자산/레버리지/고변동 노출 계산
- 조절 행동 생성
  - `raise_cash`
  - `deploy_cash_selectively`
  - `hold_cash_band`
  - `cap_leverage`
  - `trim_event_risk`
- `investment_desk_engine.py`가 `marketRegime` 결과를 포함하도록 연결
- 서버 테스트 추가

### 아직 부족한 부분

- 실제 시장 데이터 기반 점수 산출
- 장세 판정 근거를 DB에 저장하는 구조
- 오늘의 데스크 UI 재구성
- 빅 이벤트 사전 알림
- 포트폴리오 리밸런싱 후보 생성
- 엔진 판정과 대화창 AI 응답 연결
- 주간/월간 장세·비중 조절 복기

## 3. 개발 순서

### Phase 1. Market Signal Schema

상태: 1차 구현 완료

목표:

시장 국면 판정에 필요한 신호를 `investment.market.regimeMetrics`에 안정적으로 저장한다.

필요 데이터:

- `indexTrend`: 나스닥/S&P500/QQQ 추세 점수
- `breadth`: 시장 폭 점수
- `volatility`: VIX 또는 변동성 점수
- `ratesPressure`: 금리/달러/채권금리 압력
- `cryptoRisk`: BTC/ETH 위험선호 점수
- `semiconductorMomentum`: 반도체 섹터 강도
- `updatedAt`: 갱신 시각
- `sources`: 사용한 데이터 출처

구현:

- 서버 함수 `build_market_regime_metrics(investment, today_value)` 추가
- 시장 데이터가 부족하면 `dataQuality=insufficient`로 표시
- `updatedAt/fetchedAt`이 2일 이상 오래되면 `dataQuality=stale`로 표시
- 데이터가 부족하거나 오래된 상태에서는 risk score를 -0.15~0.15로 제한해 강한 상승/하락 판정을 하지 않도록 처리

테스트:

- 데이터 충분 시 점수 계산
- 데이터 부족 시 보수 판정
- 오래된 데이터는 stale 처리

### Phase 2. Big Event Risk Calendar

상태: 예정

목표:

CPI, FOMC, 실적, 정책 법안, 지정학 이벤트가 가까워지면 자동으로 이벤트 방어 모드를 켠다.

구현:

- `investment.events`에서 빅 이벤트를 분류
- 이벤트 중요도 계산
  - macro: CPI/FOMC/Fed/고용/금리
  - earnings: 보유 종목 실적
  - policy: 법안/규제/SEC/의회 일정
  - geopolitical: 전쟁/호르무즈/미중 회담
- 5일 이내 이벤트는 `eventDefense=true`
- 1일 이내 이벤트는 `eventDefenseLevel=high`

테스트:

- CPI D-1이면 high
- 보유 종목 실적 D-3이면 medium 이상
- 비보유 종목 뉴스는 낮은 중요도

### Phase 3. Portfolio Allocation Policy

상태: 예정

목표:

시장 국면별 목표 현금 비중과 위험 노출 제한을 명확히 만든다.

초기 정책:

| 국면 | 목표 현금 | 레버리지 | 고변동 개별주 | 행동 |
|---|---:|---:|---:|---|
| 상승장 | 10~25% | 제한적 허용 | 선택적 허용 | 현금 과다 시 분할 투입 후보 |
| 횡보장 | 25~40% | 축소/신규 금지 | 이벤트 중심 | 돌파 확인 전 전액 진입 금지 |
| 하락장 | 40~65% | 금지 | 축소 우선 | 현금 보존, 물타기 금지 |
| 이벤트 방어 | 30~45% 이상 | 신규 금지 | 시나리오 전 추격 금지 | 발표 전 노출 점검 |

구현:

- `allocationPolicy` 테이블/객체 추가
- 사용자가 나중에 정책을 수정할 수 있게 구조화
- 기본 정책은 서버 엔진에 내장하되 DB 값이 있으면 DB 값 우선

테스트:

- 상승장 현금 60%면 `deploy_cash_selectively`
- 하락장 현금 10%면 `raise_cash`
- 이벤트 방어 중 QLD 보유면 `cap_leverage`

### Phase 4. Desk UI Integration

상태: 예정

목표:

오늘의 데스크를 포트폴리오 요약판이 아니라 시장 판단판으로 바꾼다.

상단 구성:

```text
오늘의 장세
- 국면: 횡보장 / 이벤트 방어
- 목표 현금: 30~45%
- 현재 현금: 33%
- 판정: 목표 범위 안

이번 주 빅 이벤트
- CPI D-1
- CRCL 실적 D-0
- FOMC D-3

포트폴리오 조절
- QLD 신규 추가 금지
- CRCL 추격매수 금지
- 현금은 이벤트 후 재평가 전까지 유지
```

구현:

- `renderInvestmentDesk()`가 `engine.marketRegime`을 우선 렌더링
- 포트폴리오 세부 숫자는 포트폴리오 팝업으로 이동
- 오늘의 데스크에는 판단, 금지 행동, 확인할 데이터만 남긴다.

테스트:

- desk engine 결과에 따라 장세 카드 표시
- 이벤트 방어 모드 표시
- 목표 현금 범위와 현재 현금 표시

### Phase 5. Chat Integration

상태: 예정

목표:

사용자가 “브리핑해줘”, “지금 QLD 사도 돼?”, “현금 너무 많은가?”라고 물으면 대화창 AI가 엔진 판정을 먼저 읽고 답하게 한다.

규칙:

- AI 답변 전 `marketRegime`을 프롬프트 상단에 넣는다.
- AI가 엔진 판정과 반대되는 매수/매도 권유를 하지 못하게 한다.
- 매수/추매 의도는 기존 trade gate와 함께 평가한다.

예시:

```text
엔진 판정:
- 국면: 이벤트 방어 횡보장
- 목표 현금: 30~45%
- 현재 현금: 33%
- 금지: QLD 이벤트 전 추가매수
```

테스트:

- 브리핑 프롬프트에 marketRegime 포함
- trade gate와 market allocation이 동시에 적용

### Phase 6. Morning Batch

상태: 예정

목표:

아침 9시에 시장 데이터, 계좌 원장, 빅 이벤트, 뉴스 신호를 모아 오늘의 데스크를 준비한다.

처리 순서:

1. KIS 잔고 동기화
2. 현재가/환율 갱신
3. 시장 지표 갱신
4. 일정/빅 이벤트 동기화
5. 시장 국면 엔진 실행
6. 포트폴리오 조절 엔진 실행
7. 오늘의 데스크 스냅샷 저장
8. 알림 생성

테스트:

- 배치가 중간 실패해도 가능한 단계까지 저장
- 사용자가 볼 필요 없는 내부 단계는 UI에서 숨김
- 실패는 로그와 진단 패널에만 남김

### Phase 7. Review Loop

상태: 예정

목표:

시장 국면 판단과 실제 포트폴리오 행동을 나중에 복기한다.

저장할 것:

- 당시 국면
- 목표 현금 비중
- 실제 현금 비중
- 엔진이 금지한 행동
- 사용자가 실제로 한 행동
- 결과

구현:

- `investment.deskSnapshots`에 `marketRegime` 포함
- 주간 리포트에서 “엔진 경고를 무시했는가/따랐는가” 분석

## 4. 앞으로의 작업 원칙

- 새 기능은 테스트를 먼저 추가한다.
- 엔진 판단은 Python 순수 함수로 만든다.
- UI는 서버 엔진 결과를 렌더링한다.
- LLM 프롬프트는 엔진 결과를 입력으로 받되, 엔진 판단을 대체하지 않는다.
- 계좌 원장과 시장 신호는 DB에 남긴다.
- 완료한 단계는 이 문서의 상태를 갱신한다.

## 5. 다음 커밋 후보

1. Phase 1: `investment.market.regimeMetrics` 정규화 및 stale/dataQuality 처리
2. Phase 2: 빅 이벤트 중요도 분류 고도화
3. Phase 4: 오늘의 데스크 UI에 `marketRegime` 카드 표시
4. Phase 5: 투자 대화 프롬프트에 `marketRegime` 삽입
5. Phase 6: 아침 배치가 marketRegime 스냅샷 저장
## 2026-05-13 Update - Phase 6 Morning Batch 1차 구현 완료

- `/api/investment/desk/engine`가 생성하는 `investment.deskSnapshots`에 `marketRegime`을 최상위 필드로 저장한다.
- 스냅샷에 `regime`, `eventDefenseLevel`, `targetCashRange`, `cashGap`을 별도로 저장해 주간 리뷰/행동 복기에서 엔진 전체를 다시 파싱하지 않아도 되게 했다.
- 데스크 스냅샷은 같은 날짜 기준으로 교체 저장되고 최근 20개만 유지한다.
- 기존 엔진 전체도 `snapshot.engine`에 유지해 세부 분석이 필요할 때 원본 판단을 추적할 수 있다.
- 서버 테스트로 데스크 엔진 실행 후 스냅샷의 시장 구간/이벤트 방어/현금 밴드/현금 갭이 엔진 결과와 일치하는지 검증했다.

## 2026-05-13 Update - Phase 5 Chat Integration 1차 구현 완료

- 투자 대화 프롬프트가 `renderDailyDeskBrief()`를 통해 `Market regime`, `eventDefenseLevel`, `targetCash`, `cashGap`, allocation action을 포함하도록 검증했다.
- 대화 브리핑은 포트폴리오 표 반복보다 시장 구간, 이벤트 방어, 금지 행동을 먼저 읽는다.
- 서버 `evaluate_trade_intent_gate()`가 시장 조절 엔진의 `allocation.actions`를 함께 평가한다.
- 이벤트 방어 중 QLD 같은 레버리지 상품 추가매수는 `cap_leverage`로 차단된다.
- `raise_cash`, `trim_event_risk` 같은 allocation action도 매수/추가매수 게이트의 이유와 확인 조건으로 합류할 수 있게 했다.
- E2E로 투자 프롬프트의 market regime 포함을, 서버 테스트로 QLD 이벤트 방어 매수 차단을 검증했다.

## 2026-05-13 Update - Phase 4 Desk UI Integration 1차 구현 완료

- 오늘의 데스크 팝업에 `Market Regime` 카드를 추가했다.
- 서버 데스크 엔진의 `marketRegime.regime`, `targetCashRange`, `eventDefenseLevel`, `cashGap`, `bigEvents`, `allocation.actions`, `doNotDo`를 UI에 렌더링한다.
- 데스크 브리핑 텍스트에도 market regime 요약을 포함해 AI 프롬프트가 계좌 숫자 반복보다 시장 구간과 행동 통제 규칙을 먼저 읽게 했다.
- `applyInvestmentServerDeskEngine()`이 서버의 market allocation 액션을 금지 행동 목록에도 합쳐서 데스크 상단 판단과 행동 통제가 같은 엔진 결과를 공유한다.
- 첫 화면 로딩 직후 자동 데스크 준비가 UI 초기화를 방해하지 않도록 startup background prepare를 더 늦춰 실행한다.
- 정적 캐시 버전을 `20260513-01`, 서비스워커 캐시를 `jip-v140`으로 갱신했다.
- E2E 테스트는 `#investment-desk-market-regime` 카드, 목표 현금 밴드, 이벤트 방어 레벨, allocation action 표시를 검증하도록 추가했다.

## 2026-05-13 Update - Phase 3 Portfolio Allocation Policy 1차 구현 완료

- 서버 엔진에 기본 `allocationPolicy`를 추가했다.
- 기본 현금 밴드는 `uptrend 10~25%`, `sideways 25~40%`, `downtrend 40~65%`, `eventDefense 30~45%`다.
- `investment.allocationPolicy.cashRanges`가 있으면 DB/사용자 정책을 기본값보다 우선한다.
- `maxLeverageWeight`, `maxVolatileWeight`를 정책으로 분리해 레버리지/고변동 노출 제한을 숫자 정책으로 판단한다.
- `allocation.policy`, `allocation.riskLimits`를 반환해 UI/데스크가 같은 정책 원장을 읽게 했다.
- TDD로 커스텀 정책 override와 상승장 현금 과다 시 `deploy_cash_selectively` 액션을 검증했다.

## 2026-05-13 Update - Phase 2 Big Event Risk Calendar 1차 구현 완료

- `investment.events`의 일정/뉴스를 계좌 보유 종목과 연결해 `bigEvents`로 선별한다.
- 이벤트는 `category`(`macro`, `earnings`, `policy`, `geopolitical`, `news`, `other`), `importance`(`low`, `medium`, `high`), `heldExposure`를 가진다.
- CPI/FOMC/Fed/금리/고용/물가 같은 거시 이벤트는 보유 종목이 있으면 계좌 전체 노출로 본다.
- 보유 종목 실적 D-3은 최소 `medium`, CPI D-1은 `high` 방어로 분류한다.
- 비보유 종목의 일반 뉴스는 방어 이벤트에서 제외하거나 `low`로만 취급한다.
- `classify_market_regime()`은 `eventDefenseLevel`(`none`, `low`, `medium`, `high`)을 반환한다.
- 기존 현금 방어 정책과 호환되도록 이벤트 방어 시 목표 현금 범위는 `30~45%` 하한을 유지한다.
## 2026-05-13 Update - Phase 8 Desk Review Loop UI complete

- The daily desk modal now renders a `Review Loop` card from `desk.marketRegimeReview`.
- The card shows review score, snapshot count, decision count, violation count, and recent violation reasons.
- `renderDailyDeskBrief()` now includes review-loop context so AI briefing prompts can see whether recent actions contradicted prior desk warnings.
- Static asset cache was bumped to `20260513-02` and service worker cache to `jip-v141`.
- E2E coverage verifies the review loop card appears beside the market-regime card.

## 2026-05-13 Update - Phase 7 Review Loop 1st pass complete

- Added `marketRegimeReview` to the Python desk engine.
- The review loop reads recent `investment.deskSnapshots` and `investment.decisions` over a 7-day window.
- If a desk snapshot had medium/high event defense, low cash, or a leverage cap, and a same-day decision still bought/added risk, the engine records a control violation.
- Violations include date, symbol, action, severity, event-defense level, cash status, and a reusable reason for weekly review UI/reporting.
- The review score is negative when behavior contradicts the prior desk warning.
- TDD coverage now verifies QLD buy/add after a high event-defense warning is detected as `event_defense_buy`.
