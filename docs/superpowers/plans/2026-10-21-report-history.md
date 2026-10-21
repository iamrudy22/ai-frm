# 제공 자료 기반 보고서 추이 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 추가 엑셀 없이 현재 업로드 자료로 산출 가능한 위험지표와 최신 회차의 월별 금액 추이를 HTML에 보여주고, 기존 3쪽 PDF와 선택형 참고자료 출력을 제공한다.

**Architecture:** 실적·계획·기초시재의 의미는 기존 cashflow 도메인의 소형 함수로 정의한다. app의 읽기 모델은 이를 이용해 출처·표시 기간·상태·차트를 구성하고, 기존 위험 산식과 단일월 외부 응답을 재사용한다. 브라우저 메모리 안에서 처리하며 새 애플리케이션 서비스·애그리거트·저장소·외부 기간 API는 만들지 않는다.

**Tech Stack:** Next.js 16.3.4, React 19, TypeScript, Astryx 0.5.4, SheetJS, Vitest. 기존 의존성만 사용한다.

**Spec:** 사용자 요청 ‘준 자료에서 추출할 수 있는 정보만 가지고 추이’, 구현 계획과 논리·DDD 검토를 반영한다. 아래 §1이 상세 명세다. 문서 형식은 `/Users/dong-gyu/Desktop/ai-frm-report.pdf`, 지표 산식은 현재 `ai-frm/src/domain/risk/*/policy.ts`와 기존 정책 문서를 따른다. 18개월 전체 이력 수집·확정 이력 입력·과거 외부 통계 조회는 제외한다. §5에 검토 결과와 설계 판단을 기록한다.

**상태:** 논리·DDD 검토를 반영한 계획이다. 앱 코드 구현·의존성 설치·실제 자료 저장·출력 테스트는 아직 수행하지 않았다.

## Global Constraints

- 추가 엑셀을 필수로 요구하지 않는다. 파일 1개로도 가능한 금액 추이를 제공하며, 위험 산출 조건이 부족하면 해당 지표만 산출불가로 둔다.
- 위험 이력은 기존 최대 18개 달력 월을 유지한다. 금액 참고자료는 기준월을 반드시 포함하는 최대 18개 월열을 표시한다.
- 정상 수치·비율 비적용·결측을 구분한다. 실제 0·음수는 정상 값이며, 보간·0 채움·다른 회차 수정 실적 대체는 하지 않는다.
- 회차별 당시 위험지표와 최신 파일의 월별 실적·계획 금액은 별도 제목·설명·단위로 구분한다.
- 보고월 = 최신 회차 − 1개월. 각 지표의 실적월·기준월·관측월은 기존 규칙을 유지한다.
- 본문의 Gap·시재 선택월을 바꿔도 회차별 위험 이력과 최신 파일 참고자료는 바뀌지 않는다.
- 기준 인쇄환경은 A4 세로·배율 100%·브라우저 머리글/바닥글 끄기다. 기본 PDF 3쪽, 참고자료 포함 PDF 4쪽을 실제 저장으로 검증한다. CSS 선언만으로 페이지 수를 보장했다고 보고하지 않는다.
- 원본 PDF·엑셀·사내 수치·실물 기대값·인증키는 코드·로그·fixture에 넣지 않는다. 자동 테스트와 출력 예시는 합성 자료만 사용한다.
- 새 API·DB·영구 저장·CSV 이력 입력·HWP 변환은 범위에 포함하지 않는다. 현재 브라우저 인쇄의 PDF 저장 방식을 유지한다.
- 구현 시 `ai-frm/AGENTS.md`를 따른다. Next.js 설치 문서와 Astryx CLI의 layout·tokens·사용할 컴포넌트를 확인한다.
- 도메인의 금액은 `Amount`, 달은 `YearMonth`를 유지한다. 파일명·차트 ID·선 스타일·페이지 수는 도메인에 넣지 않는다.

## Review Focus

1. 흐름 항목은 기준월부터 계획이지만 기초시재는 기준월 다음 달부터 계획 잔고인 차이를 공유 규칙으로 검증한다. → Task 1·2.
2. Gap 순유입/균형, 실제 0·음수, 판독 실패, 로딩을 각각 보존하고 잘못된 누락월 집계를 막는다. → Task 3·4.
3. 기준월이 앞쪽인 장기 계획 파일에서도 기준월을 표시하고, 과거 한 점을 현재값으로 부르지 않는다. → Task 2·3·4.
4. 같은 회차·같은 파일명으로 수정본을 업로드해도 값이 갱신되며, 과거 회차나 늦은 외부 응답은 새 자료를 덮어쓰지 않는다. → Task 4·5.
5. 긴 파일명·긴 오류·18개월 자료가 함께 있어도 기준 인쇄환경의 3/4쪽과 마지막 페이지·차트 배치가 맞아야 한다. → Task 5.

---

## 1. 화면·자료 명세

### 1.1 위험지표와 상태

- 대금 회수: 연속 두 회차의 계획·실적이 있는 달만 산출한다.
- Gap·적정 시재: 각 업로드 회차의 원래 기준월 결과만 이력에 사용한다. 최신 파일의 과거 실적을 당시 미래 계획으로 사용하지 않는다.
- 건설경기·조달위험: 현재 확보된 단일월 응답만 사용하며 과거 점을 새로 조회·복제하지 않는다.
- 숫자가 있는 달은 `available`, 정상 순유입·수지 균형처럼 Gap 비율을 적용하지 않는 달은 `not-applicable`, 자료 부족·산출 실패는 `missing`이다. 뒤의 두 상태에는 사유를 보존한다.
- 비적용과 결측은 차트에서 모두 선을 끊되 별도 월수로 집계한다. 비적용월을 누락월에 넣지 않는다. 정상 순유입의 기존 등급은 유지한다.
- 로딩·조회 실패는 기존 지표 상태를 우선 표시한다. 수치가 없다는 이유로 ‘산출 중’을 ‘자료 없음’으로 덮지 않는다. 최신월 실패와 과거월 성공은 함께 표현할 수 있다.
- 수치가 한 달이면 **‘YYYY/MM의 1개월 값 확보’**, 여러 달이면 **‘산출값 N개월 확보’**로 안내한다. 점 수만으로 현재값·상승/하락 추세라고 단정하지 않는다.
- 수치가 없고 비적용만 있으면 ‘비율 비적용 N개월’과 사유를 표시한다. 수치·비적용 모두 없으면 현재 로딩/실패 상태와 결측 사유를 표시한다.
- 적정 시재는 현재시재와 적정시재가 모두 유한한 수일 때만 그 월의 비교가 가능하다. 0·음수는 유효하며 한 계열이라도 없거나 비유한 값이면 결측이다.
- 기존 요약의 등급·본문 값·산식·기준월을 유지한다. 지표 하나의 실패로 다른 지표나 참고자료를 없애지 않는다.

### 1.2 최신 파일의 월별 금액

출처는 최신 업로드 파일 하나다. **같은 최신 Statement와 내용**을 유지하면서 과거 회차를 추가하거나 화면 기준월만 바꾸면 참고 금액은 그대로다. 같은 회차의 수정 파일은 별개 입력이며 즉시 갱신한다. 첫 버전에는 회차 선택 UI를 만들지 않는다.

| 참고 차트 | 항목 | 표시 |
|---|---|---|
| 월별 분양회수액 | `분양회수` | 1계열, 억원 |
| 월별 수입·지출 | `수입`, `지출` | 운영 수입·지출 2계열, 억원 |
| 월별 기초시재 | `기초시재` | 월초 잔고 1계열, 억원 |

- 운영 수입은 기존 `수입`이다. 공사채·차입이 포함되는 `수입계`로 대체하지 않는다.
- 표시 범위는 **기준월까지 최근 최대 18열을 우선 확보하고, 남는 자리만 이후 계획 열로 채운다**. 월열 총수 n, 기준 인덱스 b일 때 start=max(0,b−17), endExclusive=min(n,start+18)이다.
- 18열 이하는 모두 표시한다. 18열을 넘으면 앞/뒤 생략 구간을 각각 안내한다. 이 절단은 화면 정책이며 도메인 자료를 삭제하는 규칙이 아니다.
- 달력 월은 라벨 해석 대신 `calendarOf`로 구하고, 항목별 자료 성격은 Task 1의 도메인 함수를 사용한다.
- 흐름 항목은 기준월 이전 실적, 기준월부터 계획이다. 기초시재는 기준월까지 월초 잔고, 그 이후는 계획 이월 잔고다.
- `beyondPlanYear`는 계획연도 뒤의 일부 작성 가능 구간을 뜻한다. false가 계획 확정·외부 검증을 뜻하지 않는다. 원본에 없는 ‘확정’ 상태를 새로 만들지 않는다.
- 실적·기준월까지 잔고는 실선, 계획·계획 이월 잔고는 점선이다. 경계와 의미를 캡션·범례에도 표시한다.
- 실적에서 계획으로 이어지는 인접 선분은 점선이다. 그 사이 비적용·결측·빠진 달이 있으면 연결하지 않는다.
- 판독기에서 항목 전체가 Unreadable이면 그 계열 전체를 결측으로 남기고 다른 정상 계열을 유지한다. 이번에는 판독기의 월별 복구 기능을 만들지 않는다.
- 모든 참고 항목이 실패해도 세 차트 자리와 실패 사유는 유지한다. 빈 양식에는 참고자료를 만들지 않는다.
- 안내 문구: **“최신 회차에 기재된 월별 금액이며, 회차별 당시 위험지표 이력과 기준이 다릅니다.”**

출처는 현재 업로드 자료 안에서의 파일명·회차·달력 월·월 순번·라벨이다. `Statement.months[i].index`는 소계 제거 후의 월 순번으로, 실제 엑셀 열 번호나 셀 주소가 아니다. 출처 메타는 불변 파일 버전·원본 셀 위치·실적 확정을 보증하지 않는다. 이번에는 원본 좌표 판독 범위를 늘리지 않는다.

### 1.3 HTML·PDF

기존 1~3쪽의 구성과 위험 차트는 유지한다. HTML에는 참고자료 4쪽을 추가하고, 차트 3개·출처·단위·실적/계획 경계 설명을 넣는다.

`FinancialReportPreview`의 `includeReferenceInPrint=false`로 시작한다. ‘월별 금액 참고자료를 PDF에 포함’ 체크는 화면에서만 보인다. 빈 양식에는 체크와 4쪽을 생략한다. 보고서를 닫았다 다시 열면 해제 상태다.

파일을 바꾸면 회차가 같더라도 새 `loaded`/Statement 입력으로 모델을 재구성한다. 회차·파일명만으로 결과를 캐시하지 않는다. 인쇄 체크는 데이터의 버전을 선택하는 상태가 아니다.

인쇄에서는 추가 확보 상태·계획 설명을 차트별 2줄 이내의 요약으로 제공한다. 긴 파일명은 최대 48자로 축약하고, 항목별 긴 결측 사유는 앞 60자와 ‘상세는 HTML 참고’로 요약한다. 수치·단위·기준월·실적/계획 구분·결측/비적용 여부는 생략하지 않는다. 전체 파일명·전체 사유는 HTML 상세 영역에 보존한다. 숨김·축약이 데이터를 덮어쓰지 않도록 전체 모델과 인쇄 문구를 구분한다.

3쪽은 참고자료를 인쇄하지 않을 때 마지막 쪽, 참고자료를 인쇄하면 4쪽이 마지막 쪽이다. 미선택 참고자료는 인쇄에서 `display:none`으로 제거한다. 페이지 수는 정상/최대 길이/결측 자료로 실제 저장해 검증하며, 안 맞으면 레이아웃을 고친 뒤 완료한다.

## 2. DDD 경계와 파일

명령 실행 위치는 `/Users/dong-gyu/Workspaces/temp/ai-frm/ai-frm`다. 아래 경로는 저장소 루트 기준이다.

| 파일 | 책임 |
|---|---|
| 수정 `ai-frm/src/domain/cashflow/statement.ts`, `statement.test.ts` | 자료 성격·계획연도 경계의 도메인 함수 |
| 수정 `ai-frm/src/domain/cashflow/round-entry.ts`, `round-entry.test.ts` | 기존 계획 경계 플래그를 공유 함수로 통일 |
| 수정 `ai-frm/src/domain/risk/adequate-cash/adequate-cash.ts`, `adequate-cash.test.ts` | 기존 isPlan/beyondPlanYear 메타를 공유 규칙으로 통일 |
| 신규 `ai-frm/src/app/aifrm/report-reference.ts`, `report-reference.test.ts` | 최신 자료의 읽기 모델·출처·표시 범위 조립 |
| 신규 `ai-frm/src/app/aifrm/report-chart-view.ts`, `report-chart-view.test.ts` | 상태별 확보 월수와 표시용 선 구간 |
| 수정 `ai-frm/src/app/aifrm/report-model.ts`, `report-model.test.ts` | 기존 산출 결과의 상태/사유 보존·참고자료 연결 |
| 수정 `ai-frm/src/app/aifrm/report-chart.tsx` | SVG 공통화·위험/금액 어댑터 |
| 수정 `ai-frm/src/app/aifrm/report-preview.tsx`, `ai-frm/src/app/globals.css` | 안내·참고 쪽·인쇄 선택·요약 |
| 수정 `ai-frm/README.md` | 자료 범위·상태·출력 설명 |

파일명과 UploadedRound를 app의 읽기 모델이 사용하는 것은 허용한다. 도메인은 이 타입이나 차트를 import하지 않는다. application·업로드 판독기·API·`page.tsx` 호출 구조는 유지한다. 도메인 수정은 의미와 메타의 공유이며 지표 수식·임계값·회차 대응을 바꾸지 않는다.

### 2.1 도메인 계약 — Task 1

```ts
// domain/cashflow/statement.ts
type CashflowNature =
  | 'actual' | 'plan' | 'opening-balance' | 'planned-opening-balance';
function natureOf(
  statement: Statement, item: ItemName, month: Month,
): CashflowNature;
function beyondPlanYearOf(statement: Statement, month: Month): boolean;
```

`natureOf`는 흐름 항목과 기초시재의 경계를 구분한다. 함수는 `calendarOf`와 같은 월 소속 검증을 거쳐 잘못된 월 입력을 거부한다. 파일·CSS·문장은 알지 못한다. 기존 `roundEntryOf`의 계획 플래그, `adequateCashAt`의 isPlan/beyondPlanYear만 같은 규칙을 소비하며 산출 수치는 유지한다.

### 2.2 참고자료 읽기 모델 — Task 2

```ts
type ReferenceItem = '분양회수' | '수입' | '지출' | '기초시재';
type ReferenceChartId = 'sales-recovery' | 'income-expense' | 'opening-cash';
type OmittedRange = { readonly from: YearMonth; readonly to: YearMonth; readonly count: number };
type ReferencePoint = {
  readonly month: YearMonth; readonly nature: CashflowNature; readonly beyondPlanYear: boolean;
  readonly source: {
    readonly file: string; readonly round: YearMonth; readonly item: ReferenceItem;
    readonly statementMonthIndex: number; readonly monthLabel: string;
  };
} & (
  | { readonly kind: 'available'; readonly value: Amount }
  | { readonly kind: 'missing'; readonly value: null; readonly reason: string }
);
type StatementReferenceTrends = {
  readonly sourceRound: YearMonth; readonly sourceFile: string; readonly unit: '억원';
  readonly window: {
    readonly from: YearMonth; readonly to: YearMonth;
    readonly omittedBefore: OmittedRange | null; readonly omittedAfter: OmittedRange | null;
  };
  readonly charts: readonly {
    readonly id: ReferenceChartId;
    readonly series: readonly { readonly item: ReferenceItem; readonly points: readonly ReferencePoint[] }[];
  }[];
  readonly note: string;
};
function buildStatementReferenceTrends(
  latest: UploadedRound | null,
): StatementReferenceTrends | null;
```

금액과 월은 기존 `Amount`·`YearMonth`를 그대로 유지한다. 판독 실패 항목만 missing으로 바꾸고, 알 수 없는 구현 예외를 자료 부족으로 바꾸지 않는다. 입력을 변경하지 않는 readonly 읽기 모델로 반환한다.

### 2.3 표시 상태·선 구간 — Task 3

```ts
type ChartDatum = { month: YearMonth; planned?: boolean } & (
  | { kind: 'available'; value: number }
  | { kind: 'missing' | 'not-applicable'; value: null; reason: string }
);
type HistoryCoverage = {
  from: YearMonth | null; to: YearMonth | null; totalMonths: number;
  availableMonths: readonly YearMonth[];
  missingMonths: readonly YearMonth[];
  notApplicableMonths: readonly YearMonth[];
  kind: 'empty' | 'single' | 'multiple';
};
type ChartSegment = { planned: boolean; indices: readonly number[] };
function summarizeHistory(points: readonly ChartDatum[]): HistoryCoverage;
function splitChartSegments(points: readonly ChartDatum[]): readonly ChartSegment[];
```

`from/to`는 표시 축의 양 끝, kind는 숫자 확보 개수 기준이다. available=0이라도 비적용·로딩·실패를 ‘자료 없음’으로 덮지 않는다. 비유한 available 값은 방어적으로 missing 집계·선 단절 처리한다.

선 구간은 유효한 인접 달 2점 이상이며, 상태 전환에 걸친 인접 선분은 계획 점선에만 속한다. 동일 선분을 실선과 점선에 중복시키지 않는다. 입력은 정렬된 월축이며, 함수도 실제 월의 연속성을 확인해 생략된 달을 건너뛰지 않는다.

### 2.4 기존 보고서 연결 — Task 4·5

- `ReportPoint`는 `ChartDatum`의 월·kind·value·사유와 `secondary?: number | null`을 보존한다. 상태는 Outcome를 읽는 시점에 정하며 마지막에 null에서 추측하지 않는다.
- `ReportMetric.historyCoverage: HistoryCoverage`, `FinancialReport.referenceTrends: StatementReferenceTrends | null`을 추가한다. 빈 양식의 referenceTrends는 null이다.
- 적정 시재는 원천 Outcome가 성공해도 두 계열의 유한성을 확인해 coverage용 point를 만든다. 렌더링과 coverage에 같은 유효성 기준을 사용한다.
- 차트 어댑터에서만 Amount를 일반 number와 표시 문자열로 투영한다. 위험/금액 데이터를 같은 도메인 수치 타입으로 합치지 않는다.
- 기존 `ReportChart({ metric }: { metric: ReportMetric })`와 `FinancialReportPreview({ report })` 호출을 유지한다.
- 새 `StatementReferenceChart({ trend, chart }: { trend: StatementReferenceTrends; chart: StatementReferenceTrends['charts'][number] })`를 같은 차트 파일에서 제공한다. 가짜 cash 지표를 만들지 않는다.

## 3. 구현 작업

### Task 1: 도메인 의미 공유

**Files:** §2의 statement·round-entry·adequate-cash와 각 기존 테스트.
**Interfaces:** §2.1의 natureOf, beyondPlanYearOf를 제공한다.

- [x] **1. 실패 테스트:** 8월 회차의 흐름 7월 actual/8월 plan, 기초시재 8월 opening-balance/9월 planned-opening-balance, 계획연도 끝과 다음 열의 false/true, 소속이 맞지 않는 월 거부를 검증한다.
- [x] **2. 실패 확인:** `npx vitest run src/domain/cashflow/statement.test.ts`.
- [x] **3. 공유 함수 구현:** 값·임계값을 바꾸지 않고, 기존 round-entry의 계획 경계와 adequateCashAt의 메타 계산에서 사용한다.
- [x] **4. 회귀 확인:** `npx vitest run src/domain/cashflow src/domain/risk/adequate-cash src/boundaries.test.ts`. 기존 값·isPlan·beyondPlanYear·회차 배열이 모두 동일해야 한다.
- [x] **5. 해당 변경 검토·커밋:** 미검증 원본 자료는 포함하지 않는다.

### Task 2: 참고 금액과 기준월 포함 범위

**Files:** Create `ai-frm/src/app/aifrm/report-reference.ts`, `ai-frm/src/app/aifrm/report-reference.test.ts`.
**Interfaces:** Task 1을 사용해 §2.2의 buildStatementReferenceTrends와 타입을 제공한다.

- [x] **1. 실패 테스트:** 2026/03 회차·2026/01~2027/10 합성 22열은 표시 2026/01~2027/06, 앞 생략 없음, 뒤 2027/07~10의 4개월 생략이어야 한다. 18열 이하 전체 보존과 기준월이 뒤쪽인 긴 파일의 앞 생략도 검증한다.
- [x] **2. 보존 테스트:** 각 점의 Amount·YearMonth·자료 성격·statementMonthIndex/라벨이 일치하고, 실제 0·음수는 available, 지출 Unreadable은 지출만 missing, 전체 실패는 사유 유지, null 입력은 null을 검증한다.
- [x] **3. 실패 확인:** `npx vitest run src/app/aifrm/report-reference.test.ts`.
- [x] **4. 읽기 모델 구현:** 기존 unreadableItems와 도메인 함수를 사용한다. 원본 셀 주소를 만들어내지 않고 입력을 수정하거나 중간 반올림하지 않는다.
- [x] **5. 통과 확인:** 같은 명령과 Task 1 테스트 통과. 비적용은 위험지표의 개념이므로 참고 금액의 missing과 혼합하지 않는다.
- [x] **6. 해당 변경 검토·커밋한다.**

### Task 3: 상태별 확보 요약·선 구간

**Files:** Create `ai-frm/src/app/aifrm/report-chart-view.ts`, `ai-frm/src/app/aifrm/report-chart-view.test.ts`.
**Interfaces:** §2.3의 summarizeHistory, splitChartSegments와 타입을 제공한다.

- [ ] **1. 확보 상태 테스트:** 빈 배열, 값 0 한 달, 과거 한 달 성공+최신 달 missing, not-applicable 한 달만 있는 경우, missing과 비적용이 섞인 경우를 검증한다. available/missing/notApplicable 세 목록은 중복 없이 전체 월수를 구성해야 한다.
- [ ] **2. 선 구간 테스트:** 아래 사례의 정확한 인덱스를 검증한다. 실제 월도 연속하는 합성 입력을 사용한다.

| 입력(실적/계획/빈값) | 기대 선 구간 |
|---|---|
| 실적 1개 | 없음 |
| 실적 1, 빈값, 실적 2 | 없음 |
| 실적 1, 계획 2 | 점선 [0,1] |
| 실적 1, 실적 2, 계획 3, 계획 4 | 실선 [0,1], 점선 [1,2,3] |
| 실적 1, 빈값, 계획 2, 계획 3 | 점선 [2,3] |
| 실적 1, 계획 2, 빈값, 계획 3 | 점선 [0,1] |

- [ ] **3. 방어 테스트:** 빈값 대신 not-applicable/NaN/Infinity인 경우도 단절, 6월 다음에 8월만 주면 단절, 중복 선분 없음, 0·음수 보존을 검증한다.
- [ ] **4. 실패 확인:** `npx vitest run src/app/aifrm/report-chart-view.test.ts`.
- [ ] **5. 순수 함수 구현 후 통과 확인:** 위 명령과 Task 2 테스트가 통과해야 한다.
- [ ] **6. 해당 변경 검토·커밋한다.**

### Task 4: 보고서 상태 보존·차트 통합

**Files:** Modify `ai-frm/src/app/aifrm/report-model.ts`, `report-model.test.ts`, `report-chart.tsx`.
**Interfaces:** §2.4의 필드와 두 차트 컴포넌트를 제공한다. 기존 buildFinancialReport 입력은 유지한다.

- [ ] **1. 통합 실패 테스트:** 빈 양식은 null, 파일 하나도 참고 3차트 생성, 외부 응답 로딩/실패여도 참고 금액 유지, 연속 두 회차가 없으면 회수율 생성하지 않음을 검증한다.
- [ ] **2. 비적용 회귀:** Gap 순유입/균형은 정상 등급을 유지하고 notApplicableMonths에만 포함돼야 한다. 최신월 실패+과거 한 점에는 ‘현재값’이 아닌 실제 유효월이 표시되는지 모델을 검증한다.
- [ ] **3. 시재 유효성:** (0,-1)은 유효, (0,undefined)·(NaN,0)·(0,Infinity)는 결측이다. 숫자가 없는 로딩·조회 오류는 기존 상태/사유로 남아야 한다.
- [ ] **4. 입력 변경 회귀:** Gap 선택월·과거 회차 추가·업로드 순서만 바꾸면 최신 자료 참고 모델은 동일하다. 같은 회차·같은 파일명의 수정 Statement를 넣으면 sourceRound는 그대로이고 값은 새 내용으로 갱신돼야 한다. 새로운 회차이면 sourceRound도 갱신된다.
- [ ] **5. 실패 확인:** `npx vitest run src/app/aifrm/report-model.test.ts`.
- [ ] **6. 모델 연결:** localHistory와 외부 응답을 읽는 시점에 점별 상태·사유를 보존한다. 최종 점에서 coverage를 계산하고 Task 2의 참고자료를 연결한다. 기존 판정·본문 선택월·늦은 응답 보호를 유지한다.
- [ ] **7. SVG 공통화:** 설치 문서·Astryx CLI 확인 후 위험배경/단위/현재·적정시재 범례는 유지한다. 참고 차트는 억원·정확한 항목명·위험배경 없음·실적 실선/계획 점선으로 표시한다. 두 계열의 결측은 독립 처리한다.
- [ ] **8. 축·접근성 확인:** 0·모든 값 음수·큰 금액이 축 안에 표시되고 SVG title/desc·캡션에서 출처와 실적/계획 의미를 알 수 있어야 한다.
- [ ] **9. 검사:** `npx vitest run src/app/aifrm/report-reference.test.ts src/app/aifrm/report-chart-view.test.ts src/app/aifrm/report-model.test.ts src/boundaries.test.ts`, `npx tsc --noEmit` 통과.
- [ ] **10. 해당 변경 검토·커밋한다.**

### Task 5: HTML 상세·인쇄 요약·출력 검증

**Files:** Modify `ai-frm/src/app/aifrm/report-preview.tsx`, `ai-frm/src/app/globals.css`, `ai-frm/README.md`.
**Interfaces:** Sheet에 className?: string, ReferencePage에 last: boolean을 추가한다. hasReference=report.referenceTrends!==null과 includeReferenceInPrint를 사용한다.

- [ ] **1. 화면 연결:** 실제 Astryx CheckboxInput props를 확인하고 기본 해제 체크를 추가한다. §1.1의 상태 우선순위와 실제 유효월 안내를 표시한다.
- [ ] **2. 참고자료와 상세:** hasReference이면 HTML 4쪽에 차트 3개, 앞/뒤 생략 범위와 실적/계획/계획연도 이후 설명을 표시한다. 전체 출처·오류는 화면 상세 영역에 보존하고 §1.3의 인쇄용 요약을 별도로 만든다.
- [ ] **3. 마지막 쪽:** 3쪽은 last={!hasReference || !includeReferenceInPrint}, 4쪽은 last. 인쇄 포함 상태를 root class/data 속성으로 전달한다.
- [ ] **4. 인쇄 CSS:** 미선택 4쪽과 화면 상세 영역만 print에서 display:none으로 숨긴다. 숫자·단위·기준월·자료 상태는 숨기지 않는다. 기존 A4·차트 break-inside·테마 토큰을 유지한다.
- [ ] **5. 합성 HTML 확인:** 파일 1개, 불연속 회차, 한 항목/전체 참고항목 판독 실패, 외부 로딩/실패, 0·음수, 기준월이 앞인 22열을 모바일·데스크톱에서 확인한다.
- [ ] **6. 상태 전환 확인:** 기준월 변경 시 참고 불변, 건설 재조회 중 이전값 비노출, 같은 회차 수정본 반영, 복귀 시 업로드 유지, 다시 열 때 인쇄 체크 해제를 검증한다.
- [ ] **7. 출력 스트레스 검증:** 18개월·200자 파일명·500자 오류 사유·3개 참고 차트를 함께 가진 합성 보고서를 실제 저장한다. 기준 환경에서 기본 정확히 3쪽, 포함 정확히 4쪽, 체크 해제 후 3쪽이어야 한다. 원래 1~3쪽과 모든 수치·차트·범례를 확인하며 끝의 빈 용지나 잘림이 있으면 레이아웃을 고친다. 출력 조작이 불가능하면 미검증으로 기록한다.
- [ ] **8. 전체 검사:** `npm run verify`, `npx eslint src`, `npm run build`. 기존 환경의 Turbopack 포트 오류가 재현되면 `npm run build -- --webpack` 결과와 기본 빌드 제한을 기록한다. 실물 fixture 스킵은 수치 정답 검증 통과로 보고하지 않는다.
- [ ] **9. README 갱신·검토·커밋:** 추가 엑셀이 필수가 아님, 상태별 의미·기준월 포함 창·월 순번과 셀 좌표의 차이·PDF 선택을 설명한다.

## 4. 진행 순서·완료 기준

Task 1 뒤 Task 2, Task 3은 별도 파일에서 병렬 가능하다. Task 4에서 연결하고 Task 5에서 화면·인쇄를 검증한다. 기존 작업자의 보고서 변경은 되돌리지 않는다.

- 현재 자료에서 가능한 값만 표시하고 정상 비적용·결측·로딩을 구분한다.
- 기준월이 표시 범위에 포함되고, 같은 회차 수정본도 반영된다.
- 도메인은 자료의 의미·단위를 소유하고 app은 표시·출처·인쇄를 소유한다.
- 수식·판정·회차 정책은 바뀌지 않으며, 기존 경계 테스트가 통과한다.
- 기준 환경의 실제 HTML·PDF와 전체 자동 검사가 통과한 범위만 완료로 보고한다.

## 5. 논리·DDD 검토 기록 (2026-10-21)

**검토 범위:** 계획과 현재 소스의 계약 비교다. 앱 오류 재현이나 구현 완료 검증은 아니다.

| 검토 항목 | 문제와 영향 | 반영한 수정 |
|---|---|---|
| 정상 비적용월 집계 | null만 보존하면 정상 순유입도 누락월로 집계됨 | 점별 kind/사유와 비적용 별도 집계 |
| 한 점의 시점 | 과거 한 점도 ‘현재값’으로 표기될 수 있음 | 실제 유효월과 확보 월수 안내 |
| 마지막 18열 | 장기 계획에서 현재월·과거 실적이 모두 잘릴 수 있음 | 기준월 포함 창, 앞/뒤 생략 안내 |
| 동일 회차 수정본 | 월이 같다는 이유로 값이 고정될 수 있음 | 입력 내용 갱신, 회차/파일명 캐시 금지 테스트 |
| 원본 좌표 출처 | Month.index는 실제 엑셀 열 번호가 아님 | statementMonthIndex로 명명, 셀 좌표 보장 제외 |
| 인쇄 페이지 수 | 긴 오류·출처와 break-inside만으로 3/4쪽을 보장할 수 없음 | 인쇄 요약·전체 HTML·최대 길이 실제 출력 검증 |

### ADR: 자료 의미는 도메인, 읽기·표시는 app

**Status:** Proposed. **Date:** 2026-10-21.

현재 계획은 읽기 전용 보고서이므로 app에서 Statement를 조회해 표시 모델을 만드는 경계는 타당하다. 다만 항목별 실적/계획의 경계는 업무 의미이므로 기존 cashflow 도메인의 소형 함수로 공유한다. Amount/YearMonth는 투영 직전까지 유지한다.

선택지는 ① app에서 의미 규칙까지 정의, ② 도메인에 의미 함수만 추가하고 app 읽기 모델 유지, ③ 전체 보고서를 새 application 서비스·애그리거트로 이동이다. **②를 권고안으로 반영했다.** ①의 의미 중복을 줄이면서 ③의 불필요한 계층·저장소를 추가하지 않는다. 기존 메타 소비부만 공유 함수로 바꾸고 기존 수치·회차 정책은 회귀 테스트로 고정한다.

후속 구현은 이 문서의 파일별 변경과 검증 범위 안에서 진행한다.

## 6. 실행 기록·컨텍스트

- 브랜치: `codex/provided-data-report`. 기존 로컬 서버와 미커밋 보고서 작업을 보존해 진행한다.
- 시작 기준: `ef0a7ff`. 기존 HTML/PDF 보고서 작업을 먼저 별도 기준 커밋으로 보존한다.
- 실행 전 검증: `npm run verify` — TypeScript 통과, 448 passed / 30 skipped. 스킵은 실물 fixture·명시적 외부 실호출 테스트이며 정답 일치 검증으로 집계하지 않는다.
- 단계마다 RED/GREEN 증거, QA·독립 검토 결과, 커밋, 다음 작업을 기록한다. 실제 재무수치는 기록하지 않는다.

### Task 1 완료

- 구현 커밋: `10c1b6a` — 도메인 자료 성격과 계획 경계 공유.
- TDD: 신규 의미 계약 RED 9건 → GREEN. 관련 회귀 109 passed, 전체 verify 461 passed / 30 skipped. 관련 ESLint·diff 검사 통과.
- 독립 검토: 명세 준수·코드 품질 Approved, 추가 논리 모순·DDD 경계 위반 없음.
- 컨텍스트: `natureOf`, `beyondPlanYearOf`가 기존 statement에 있으며 round-entry·adequateCashAt이 소비한다. 금액·회차 정책은 유지된다.
- 다음: Task 2, 최신 파일의 월별 금액 읽기 모델과 기준월 포함 표시 범위.

### Task 2 완료

- 구현 커밋: `2781c89` — 최신 Statement의 월별 금액·자료 성격·출처·표시 범위 읽기 모델.
- TDD: null stub에서 RED 14 failed / 1 passed → 신규 GREEN 15 passed. Task 1 포함 회귀 87 passed, 전체 verify 476 passed / 30 skipped. 관련 ESLint 통과.
- 독립 검토: 명세 준수·품질 Approved, 추가 문제 없음. 호출부의 최신 파일 선택과 화면 기준월 독립성은 Task 4에서 연결·검증한다.
- 컨텍스트: `buildStatementReferenceTrends`는 최신 UploadedRound 하나를 받으며 Amount/YearMonth·원본 라벨·정규화된 월 순번을 보존한다. unknown 예외는 숨기지 않는다.
- 다음: Task 3, 상태별 확보 요약과 결측/계획 선 구간.
