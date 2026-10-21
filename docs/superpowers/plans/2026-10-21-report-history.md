# 제공 자료 기반 보고서 추이 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 추가 엑셀 없이 현재 업로드 자료로 산출 가능한 위험지표와 최신 회차의 월별 금액 추이를 HTML에 보여주고, 기존 3쪽 PDF와 선택형 참고자료 출력을 제공한다.

**Architecture:** 실적·계획·기초시재의 의미는 기존 cashflow 도메인의 소형 함수로 정의한다. app의 읽기 모델은 이를 이용해 출처·표시 기간·상태·차트를 구성하고, 기존 위험 산식과 단일월 외부 응답을 재사용한다. 브라우저 메모리 안에서 처리하며 새 애플리케이션 서비스·애그리거트·저장소·외부 기간 API는 만들지 않는다.

**Tech Stack:** Next.js 16.3.4, React 19, TypeScript, Astryx 0.5.4, SheetJS, Vitest. 기존 의존성만 사용한다.

**Spec:** 사용자 요청 ‘준 자료에서 추출할 수 있는 정보만 가지고 추이’, 구현 계획과 논리·DDD 검토를 반영한다. 아래 §1이 상세 명세다. 문서 형식은 `/Users/dong-gyu/Desktop/ai-frm-report.pdf`, 지표 산식은 현재 `ai-frm/src/domain/risk/*/policy.ts`와 기존 정책 문서를 따른다. 18개월 전체 이력 수집·확정 이력 입력·과거 외부 통계 조회는 제외한다. §5에 검토 결과와 설계 판단을 기록한다.

**상태:** Task 1~5 구현·독립 검토·합성 HTML/PDF QA는 완료했다. 남은 실제 수치 대조와 전체 린트 정리는 §7 후속 계획으로 진행한다.

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

- [x] **1. 확보 상태 테스트:** 빈 배열, 값 0 한 달, 과거 한 달 성공+최신 달 missing, not-applicable 한 달만 있는 경우, missing과 비적용이 섞인 경우를 검증한다. available/missing/notApplicable 세 목록은 중복 없이 전체 월수를 구성해야 한다.
- [x] **2. 선 구간 테스트:** 아래 사례의 정확한 인덱스를 검증한다. 실제 월도 연속하는 합성 입력을 사용한다.

| 입력(실적/계획/빈값) | 기대 선 구간 |
|---|---|
| 실적 1개 | 없음 |
| 실적 1, 빈값, 실적 2 | 없음 |
| 실적 1, 계획 2 | 점선 [0,1] |
| 실적 1, 실적 2, 계획 3, 계획 4 | 실선 [0,1], 점선 [1,2,3] |
| 실적 1, 빈값, 계획 2, 계획 3 | 점선 [2,3] |
| 실적 1, 계획 2, 빈값, 계획 3 | 점선 [0,1] |

- [x] **3. 방어 테스트:** 빈값 대신 not-applicable/NaN/Infinity인 경우도 단절, 6월 다음에 8월만 주면 단절, 중복 선분 없음, 0·음수 보존을 검증한다.
- [x] **4. 실패 확인:** `npx vitest run src/app/aifrm/report-chart-view.test.ts`.
- [x] **5. 순수 함수 구현 후 통과 확인:** 위 명령과 Task 2 테스트가 통과해야 한다.
- [x] **6. 해당 변경 검토·커밋한다.**

### Task 4: 보고서 상태 보존·차트 통합

**Files:** Modify `ai-frm/src/app/aifrm/report-model.ts`, `report-model.test.ts`, `report-chart.tsx`.
**Interfaces:** §2.4의 필드와 두 차트 컴포넌트를 제공한다. 기존 buildFinancialReport 입력은 유지한다.

- [x] **1. 통합 실패 테스트:** 빈 양식은 null, 파일 하나도 참고 3차트 생성, 외부 응답 로딩/실패여도 참고 금액 유지, 연속 두 회차가 없으면 회수율 생성하지 않음을 검증한다.
- [x] **2. 비적용 회귀:** Gap 순유입/균형은 정상 등급을 유지하고 notApplicableMonths에만 포함돼야 한다. 최신월 실패+과거 한 점에는 ‘현재값’이 아닌 실제 유효월이 표시되는지 모델을 검증한다.
- [x] **3. 시재 유효성:** (0,-1)은 유효, (0,undefined)·(NaN,0)·(0,Infinity)는 결측이다. 숫자가 없는 로딩·조회 오류는 기존 상태/사유로 남아야 한다.
- [x] **4. 입력 변경 회귀:** Gap 선택월·과거 회차 추가·업로드 순서만 바꾸면 최신 자료 참고 모델은 동일하다. 같은 회차·같은 파일명의 수정 Statement를 넣으면 sourceRound는 그대로이고 값은 새 내용으로 갱신돼야 한다. 새로운 회차이면 sourceRound도 갱신된다.
- [x] **5. 실패 확인:** `npx vitest run src/app/aifrm/report-model.test.ts`.
- [x] **6. 모델 연결:** localHistory와 외부 응답을 읽는 시점에 점별 상태·사유를 보존한다. 최종 점에서 coverage를 계산하고 Task 2의 참고자료를 연결한다. 기존 판정·본문 선택월·늦은 응답 보호를 유지한다.
- [x] **7. SVG 공통화:** 설치 문서·Astryx CLI 확인 후 위험배경/단위/현재·적정시재 범례는 유지한다. 참고 차트는 억원·정확한 항목명·위험배경 없음·실적 실선/계획 점선으로 표시한다. 두 계열의 결측은 독립 처리한다.
- [x] **8. 축·접근성 확인:** 0·모든 값 음수·큰 금액이 축 안에 표시되고 SVG title/desc·캡션에서 출처와 실적/계획 의미를 알 수 있어야 한다.
- [x] **9. 검사:** `npx vitest run src/app/aifrm/report-reference.test.ts src/app/aifrm/report-chart-view.test.ts src/app/aifrm/report-model.test.ts src/boundaries.test.ts`, `npx tsc --noEmit` 통과.
- [x] **10. 해당 변경 검토·커밋한다.**

### Task 5: HTML 상세·인쇄 요약·출력 검증

**Files:** Modify `ai-frm/src/app/aifrm/report-preview.tsx`, `ai-frm/src/app/globals.css`, `ai-frm/README.md`, `ai-frm/vitest.config.mts`, `ai-frm/src/app/aifrm/report-chart.tsx` (SVG title의 단일 문자열 수정); Create `ai-frm/src/app/aifrm/report-preview.test.tsx`.
**Interfaces:** Sheet에 className?: string, ReferencePage에 last: boolean을 추가한다. hasReference=report.referenceTrends!==null과 includeReferenceInPrint를 사용한다.

- [x] **0. UI TDD:** 기존 `react-dom/server`의 `renderToStaticMarkup`으로 빈 양식의 기본 3쪽·참고자료 없음, 자료가 있는 보고서의 참고 차트·실제 출처·전체 오류와 인쇄 요약·기본 해제 체크를 검증하는 실패 테스트를 먼저 작성한다. `npx vitest run src/app/aifrm/report-preview.test.tsx`의 RED를 확인한 뒤 구현하고 GREEN을 확인한다. 인쇄 선택의 실제 동작과 페이지 수는 아래 UI·PDF QA에서 검증한다. 새 테스트 라이브러리는 설치하지 않는다.
- [x] **0a. 실행기 설정:** 기존 Vitest include가 `.test.ts`만 포함하므로 `.test.tsx`도 발견하도록 패턴만 확장한다. UI 테스트가 명시 실행과 전체 verify에 실제로 포함되는지 확인한다.
- [x] **1. 화면 연결:** 실제 Astryx CheckboxInput props를 확인하고 기본 해제 체크를 추가한다. §1.1의 상태 우선순위와 실제 유효월 안내를 표시한다.
- [x] **2. 참고자료와 상세:** hasReference이면 HTML 4쪽에 차트 3개, 앞/뒤 생략 범위와 실적/계획/계획연도 이후 설명을 표시한다. 전체 출처·오류는 화면 상세 영역에 보존하고 §1.3의 인쇄용 요약을 별도로 만든다.
- [x] **3. 마지막 쪽:** 3쪽은 last={!hasReference || !includeReferenceInPrint}, 4쪽은 last. 인쇄 포함 상태를 root class/data 속성으로 전달한다.
- [x] **4. 인쇄 CSS:** 미선택 4쪽과 화면 상세 영역만 print에서 display:none으로 숨긴다. 숫자·단위·기준월·자료 상태는 숨기지 않는다. 기존 A4·차트 break-inside·테마 토큰을 유지한다.
- [x] **5. 합성 HTML 확인:** 파일 1개, 불연속 회차, 한 항목/전체 참고항목 판독 실패, 외부 로딩/실패, 0·음수, 기준월이 앞인 22열을 모바일·데스크톱에서 확인한다.
- [x] **6. 상태 전환 확인:** 기준월 변경 시 참고 불변, 건설 재조회 중 이전값 비노출, 같은 회차 수정본 반영, 복귀 시 업로드 유지, 다시 열 때 인쇄 체크 해제를 검증한다.
- [x] **7. 출력 스트레스 검증:** 18개월·200자 파일명·500자 오류 사유·3개 참고 차트를 함께 가진 합성 보고서를 실제 저장한다. 기준 환경에서 기본 정확히 3쪽, 포함 정확히 4쪽, 체크 해제 후 3쪽이어야 한다. 원래 1~3쪽과 모든 수치·차트·범례를 확인하며 끝의 빈 용지나 잘림이 있으면 레이아웃을 고친다. 출력 조작이 불가능하면 미검증으로 기록한다.
- [x] **8. 전체 검사:** `npm run verify`, `npx eslint src`, `npm run build`. 기존 환경의 Turbopack 포트 오류가 재현되면 `npm run build -- --webpack` 결과와 기본 빌드 제한을 기록한다. 실물 fixture 스킵은 수치 정답 검증 통과로 보고하지 않는다.
- [x] **9. README 갱신·검토·커밋:** 추가 엑셀이 필수가 아님, 상태별 의미·기준월 포함 창·월 순번과 셀 좌표의 차이·PDF 선택을 설명한다.

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

**Status:** Accepted and implemented. **Date:** 2026-10-21.

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

### Task 3 완료

- 구현 커밋: `99febf3` — 세 상태의 확보 요약·실제 인접 달의 선 구간 계산.
- TDD: RED 22 failed / 5 passed → 관련 GREEN 42 passed. 전체 verify 503 passed / 30 skipped, 관련 ESLint·diff 검사 통과.
- 독립 검토: 명세 준수·품질 Approved, 발견 사항 없음. 실제 보고서/SVG 연결은 Task 4에서 검증한다.
- 컨텍스트: `ChartDatum`은 available/missing/not-applicable을 구분한다. `summarizeHistory`, `splitChartSegments`가 순수 표시 함수이며 교차 선분은 점선에만 속한다.
- 다음: Task 4, 점별 상태·참고자료를 최종 보고서와 SVG에 연결. Task 5에는 기존 React DOM 서버 렌더 기반 UI TDD도 추가했다.

### Task 4 완료

- 구현 커밋: `e465d1e` — 점별 상태/사유·coverage·참고자료와 공통 SVG 연결.
- TDD: 신규 통합 요구 RED 14 failed / 20 passed → GREEN 34 passed. 긴 외부 사유 보존 회귀도 RED 1건을 확인 후 수정했다. 통합 97 passed, 전체 verify 518 passed / 30 skipped, tsc·ESLint·diff 검사 통과.
- 독립 검토: 명세 준수·품질 Approved, Critical/Important/Minor 없음.
- 컨텍스트: 기존 위험지표의 값/등급·선택월·외부 늦은 응답 보호를 유지하며 `referenceTrends`와 `StatementReferenceChart`가 연결 준비됐다. HTML/PDF 참고자료 배치는 다음 단계다.
- 다음: Task 5의 SSR RED/GREEN, 화면·인쇄 포함 선택·실제 PDF 3/4쪽 및 긴 자료 QA.


### Task 5 완료

- 구현 커밋: `6546fd7` — HTML 월별 참고자료 4쪽, PDF 포함 선택, 전체 화면 상세와 인쇄 요약, 토큰 기반 A4 밀도.
- TDD: SSR RED 6 failed / 1 passed → GREEN 7 passed. SVG 제목 배열 경고 회귀 RED 1건 → 최종 GREEN 8 passed. 전체 verify 526 passed / 30 skipped, TypeScript·ESLint 통과.
- 빌드: 샌드박스에서는 Turbopack 포트 제한이 재현됐고 webpack 대체 빌드는 성공했다. root가 승인된 권한으로 기본 `npm run build`를 재실행해 Turbopack 컴파일·타입·정적 6개 페이지 생성을 모두 확인했다.
- 독립 코드 검토: 명세의 코드 요건·품질 Approved, 코드 결함 없음. 실제 출력 QA는 별도 완료 조건이다.
- 실제 UI: 합성 3개 불연속 회차와 단일 지출 결측 파일 산출, 0·음수, 독립 수입 계열 유지, 선택월과 최신 참고자료의 독립성, 복귀 시 업로드 보존, 재열기 시 체크 해제를 확인했다. 모바일 390px에서 가로 넘침 없음, 정상 보고서 콘솔 오류 없음.
- 실제 출력: 정상 자료의 기본 미리보기 5쪽 문제를 발견해 인쇄 밀도를 수정했다. Chrome 사용 전환으로 저장 QA가 중단됐다가 사용자 승인 후 재개했다. 최종 코드로 정상·스트레스 PDF 각각 기본 3쪽/참고 포함 4쪽을 저장했고, 체크 해제 후 3쪽 복귀를 확인했다. A4·빈 페이지 없음·본문/차트/범례·월 라벨·수치 대응을 렌더링해 검사했다.
- 추가 실제 UI: 전체 참고항목 실패, 순유입 정상 비적용, 22열의 기준월 포함 18열, 같은 회차·같은 파일명 수정본의 즉시 갱신을 확인했다. 건설 기준월 재선택 시 새 기준월 결과를 확인했다. 응답이 빨라 로딩 중간 화면은 포착하지 못했으며, 로딩/실패·늦은 응답 보호는 자동 회귀 근거다.
- 다음: 이 범위의 구현·검토·QA는 완료됐다. 실물 재무수치 정답 일치는 원본 검증 fixture가 없는 상태이므로 검증 통과로 취급하지 않는다.

### 실행 중 결정과 비용

1. 기존 보고서와 서버를 보존하도록 현재 체크아웃의 전용 브랜치에서 순차 구현했다. 잘못 판단하면 동시 작업과 충돌할 수 있어 파일 소유권을 분리했다.
2. 위험지표의 현재·적정 시재 비교는 두 값이 함께 유효해야 한다. 수입·지출 참고 차트에는 계열별 실패를 적용한다. 잘못 판단하면 유효한 일부 시재가 숨겨질 수 있어 회귀 테스트로 고정했다.
3. 기존 react-dom/server로 실제 UI SSR 테스트를 추가했다. 잘못 판단하면 테스트 유지비가 늘지만 새 의존성은 없다.
4. Vitest 검색 패턴에 TSX를 포함했다. 잘못 판단하면 추가 테스트가 실행될 수 있어 전체 verify로 검증했다.
5. 실제 SSR 경고를 해결하도록 SVG title의 단일 문자열 수정 한 줄을 Task 5에 포함했다. 잘못 판단하면 접근성 제목이 바뀔 수 있어 동일 제목과 경고 없는 렌더를 검증했다.


6. 단일 최종 수정 파동 뒤 실물 QA에서 새로 드러난 라벨 역전에 한해 추가 TDD 수정·차분 재검토를 허용했다. 오독을 해결하기 위한 결정이며, 잘못 판단하면 검토 반복 비용이 늘어난다. 추가 전체 리뷰나 무관한 변경은 하지 않았다.

### 전체 브랜치 최종 리뷰·수정·QA 완료

- 전체 리뷰 범위: `ef0a7ff..87abd6a`. 독립 리뷰에서 Important 2건(과거 결측 사유 무제한 인쇄, 월·수치 라벨 충돌)과 Minor 2건(%p 소수 셋째 자리, 과거 월초 잔고 명칭)을 찾았다.
- 통합 수정: `6ca8779`. 실제 SSR RED 9건을 확인한 뒤 수정했고, 전체 538 passed / 30 skipped. 차분 재검토에서 4건 모두 ADDRESSED, 새 Critical/Important 없음.
- 실물 QA 후속 수정: `c2c40b6`. 실제 PDF에서 근접한 수입·지출의 숫자 라벨 높이 순서가 뒤집히는 문제를 발견했다. 실제 점 높이와 계열색으로 대응을 고정했다. 추가 SSR RED 후 관련 104 passed, 최종 전체 546 passed / 30 skipped. 좁은 차분 재검토에서 ADDRESSED, 새 결함 없음.
- 최종 `npm run build`(기본 Turbopack), TypeScript, `npx eslint src`, diff 검사 성공. 별도로 넓혀 실행한 `npm run lint`는 기존 생성 파일 `ai-frm/my-theme.d.ts:9`의 triple-slash-reference 오류 1건이 있다. 생성 파일은 변경하지 않았고 소스 린트 성공과 구분한다.
- 최종 실제 저장 환경: macOS Chrome 154, PDF 저장/A4, CSS @page 여백, 머리글·바닥글 끔, 배경 그래픽 켬. 정상 자료와 18회차 스트레스 자료 모두 3→4→3쪽 전환을 확인했다. 스트레스는 17개의 서로 다른 500자 이상 오류·최신 22열 중 18열·200자 이상 파일명·참고 차트 3개를 함께 포함했다.
- `pypdf`로 최종 저장 파일의 3/4쪽·A4·빈 페이지 없음·참고 포함 여부와 무관한 원래 1~3쪽의 텍스트 동일성을 확인했다. `pdftoppm`으로 모든 정상 쪽과 스트레스 1·2·4쪽을 시각 확인했다. 추가 설명은 두 줄 이내이며 숫자·범례·실적/계획·생략 범위를 보존한다.
- 합성 QA 산출물(비밀·실물 재무수치 없음): `/private/tmp/aifrm-report-qa/qa-normal-final.pdf`, `qa-normal-final-with-reference.pdf`, `qa-stress-final.pdf`, `qa-stress-final-with-reference.pdf`. 임시 산출물이므로 Git에 포함하지 않는다.
- 화면 증거: `/private/tmp/aifrm-report-qa/qa-reference-final.jpg`(합성 자료의 최종 HTML 참고 쪽). QA 탭과 합성 입력은 사용자 작업 화면과 분리해 검사했다.
- 기존 관찰: Astryx my-theme 런타임 스타일 주입의 성능 경고가 있었고 이번 변경에서는 테마 빌드를 바꾸지 않았다. 최종 정상 보고서의 콘솔 오류는 0건이다.
- 검증 한계: 스킵 30건의 실물 fixture·명시적 실호출 결과는 통과로 집계하지 않는다. 골든 PDF와 실물 엑셀 간 수치 동일성은 미검증이다. HWP 출력은 이번 PDF 선택 범위에 포함하지 않았다.


## 7. 골든 수치 대조와 전체 린트 후속 계획 (2026-10-21)

**Goal:** 전체 린트를 정상화하고, 실물 골든 검증의 입력 부재·검증 범위를 명시해 자료 없이 통과로 해석되는 상황을 막는다. 대응 자료가 제공되면 동일 기준월·정책의 독립 기대값으로 실제 수치를 대조한다.

**Architecture:** 린트는 생성 파일 하나에만 예외를 적용하며 생성 산출물은 직접 편집하지 않는다. 골든 입력 점검은 기존 Node의 파일 메타데이터만 읽는 개발용 CLI로 둔다. 도메인·산식·보고서·외부 API는 유지한다. 자료 확보 후 Task 9에서 원본만으로 가능한 검증과 독립 기대값이 필요한 검증의 스킵 조건을 분리했다.

**Tech Stack:** 기존 Node.js, ESLint 9 flat config, Vitest. 새 의존성 없음.

**Spec:** 사용자의 ‘남은 작업 계획을 세우고 진행’ 요청과 위 §1~2. 기존 fixture 테스트가 요구하는 경로는 아래 계약의 근거이며, 전체 PDF 수치 정답을 대신하지 않는다.

### 확인한 입력과 제약

- 후속 작업 시작 때는 `fixtures/` 자체가 없고 골든 PDF만 존재했다. 이후 사용자가 자료 폴더를 제공해 Task 8에서 로컬 대조를 수행했다. 아래 스킵 30건은 자료 확보 전 기준이다.
- 현재 스킵 30건: 최신 실물 11, 예측오차 15, 건설경기 3, KOFIA 명시적 실호출 1. 회차 폴더 판독은 파일 0개일 때 케이스도 0개다.
- 건설경기 추출기는 CSV 세 개만 만든다. 네 번째 독립 기대값은 인계 자료의 `fixture_expected.csv`를 별도로 준비해야 한다. 앱 출력으로 기대값을 생성하면 순환 검증이다.
- 예측오차의 현행 앱 정의와 구 엑셀 정의가 다르므로 PDF와의 차이를 무조건 산식 버그로 판정하지 않는다. 기준월·외부 통계 시점·정책 버전을 먼저 맞춘다.
- 실물·미공개 수치·키는 로그나 커밋에 넣지 않는다. 익명화한 자료의 경로를 사용자에게 요청했으며 답변과 독립적으로 가능한 작업은 진행한다.

### 후속 Review Focus

1. 생성 파일 예외가 다른 소스의 린트까지 끄지 않아야 한다. → Task 6 실제 ESLint 파일 판정 및 소스 오류 탐지 확인.
2. `.xlsx` 이름의 디렉터리·빈 파일이 준비 완료가 되면 안 된다. → Task 7 CLI 통합 테스트.
3. 일부 CSV 또는 8개 미만 회차는 해당 검증군을 준비 미완료로 표시해야 한다. → Task 7 그룹별 테스트.
4. 성공 종료라도 파일 내용·수치 정답·필요한 회차 구성까지 검증했다고 주장하면 안 된다. → Task 7 CLI 고정 범위·검증 미실행 표지 테스트.
5. 경로·파일 내용·오류 메시지에 포함될 수 있는 민감값이 출력되면 안 된다. → Task 7 합성 비밀 표지 비노출 및 오류 요약 테스트. 실제 대조는 Task 8의 로컬 요약 방식으로만 수행.

### Task 6: 생성 파일의 전체 린트 오류 정리

**Files:** Modify `ai-frm/eslint.config.mjs` only.
**Interfaces:** `globalIgnores`에 Astryx가 만든 `my-theme.d.ts` 한 파일을 추가한다. 기존 생성 파일·소스·타입 설정은 수정하지 않는다.

- [x] **1. RED 재현:** `npm run lint`가 my-theme.d.ts:9의 triple-slash-reference 1건으로 실패함을 확인한다. 현재 실행에서 재현했다.
- [x] **2. 최소 수정:** 정확한 생성 파일만 제외한다. `.d.ts` 전체나 해당 규칙 전체를 끄지 않는다.
- [x] **3. GREEN·범위 검증:** `npm run lint`와 TypeScript가 통과해야 한다. ESLint API로 생성 파일만 ignored, src 파일은 active임을 확인하고, 임시 합성 소스의 명시적 `any` 오류가 탐지되는지 확인한다. 이 가역적 설정 변경을 복제하는 별도 영구 테스트는 추가하지 않는다.
- [x] **4. 커밋:** 설정 파일만 커밋하고 RED/GREEN 결과를 기록한다.

### Task 7: 골든 입력 준비 상태 점검과 절차 문서

**Files:** Create `ai-frm/scripts/check-golden-inputs.mjs`, `ai-frm/src/infrastructure/validation/golden-inputs.test.ts`; Modify `ai-frm/package.json`, `ai-frm/README.md`.
**Interfaces:** `npm run check:golden-inputs`는 앱의 현재 작업 폴더를 기준으로 메타데이터 JSON을 출력한다. `inputsReady`와 검증군별 준비 여부를 내며, 미준비 exit 2 / 모든 메타데이터 준비 exit 0 / 예기치 않은 실패 exit 1이다. `numericValidation`과 `pdfGoldenComparison`은 항상 `not-run`이고 `scope`는 `fixture-input-metadata`다.

검사 경로는 `fixtures/자금수지표-최신회차.xlsx`, `fixtures/자금수지표/` 및 `fixtures/건설경기인식지수-원값.csv`, `fixtures/분양회수-오차율-엑셀.csv`, `fixtures/건설경기인식지수-엑셀결과.csv`, `fixtures/건설경기인식지수-기대값.csv`다. 파일은 읽을 수 있는 비어 있지 않은 regular file이어야 한다. 회차는 기존 가드와 같이 소문자 `.xlsx`만 대상으로 하되 디렉터리·빈 파일을 빼고 센다. 최신 실물, 회차 판독(1개 이상), 예측오차(8개 이상+오차율 CSV), 건설경기(4CSV)를 구분한다. 8개라는 개수는 필요한 실제 회차 구성을 보장하지 않는다. KOFIA 실호출은 이 명령에서 실행하지 않는다.

- [x] **1. RED:** 실제 CLI를 임시 합성 디렉터리에서 실행하는 Vitest 통합 검사를 먼저 작성한다. 전체 부재, 전체 메타 준비, 빈 파일, 파일명 디렉터리, 소문자 확장자/regular file 회차 수, 7개 회차, 독립 기대값 CSV 누락, 내용 비노출, 예기치 않은 메타 오류의 비노출을 검증한다. CLI 부재만의 import 에러로 끝내지 않고 최소 미구현 stub의 잘못된 준비 판정으로 실패를 확인한다.
- [x] **2. GREEN:** Node 표준 라이브러리로 구현한다. 파일 내용을 읽거나 실제 파일명 목록·예외 원문·실물 수치를 출력하지 않는다. 고정된 필수 경로와 집계·상태만 출력한다. 손상 내용·CSV 헤더·기준월·정책·수치 일치는 이 점검의 범위 밖이다.
- [x] **3. 문서:** 세 개 추출 CSV와 별도 기대값을 구분하고, 같은 월·정책·관측 시점의 PDF와 엑셀을 짝짓는 절차를 안내한다. 자료가 없을 때 exit 2가 올바른 차단 결과임을 설명한다. 일반 verify와 실물 정답 검증을 구별하고 민감값 없는 로컬 실행을 안내한다.
- [x] **4. 검사·커밋:** 집중 테스트 → 전체 verify·전체 lint를 실행한다. 현재 자료 부재에 실제 CLI가 exit 2 및 검증 미실행을 반환하는지 확인하고 해당 파일만 커밋한다.

### Task 8: 대응 자료의 실제 수치 대조와 최종 정리

**Files:** Modify this plan's execution record; fixture는 `ai-frm/fixtures/`의 기존 Git 제외 영역만 사용한다.
**Interfaces:** 사용자가 제공한 로컬 자료 경로와 원본의 독립 기대값. 실제 수치는 기기 안에서만 처리한다. OCR 판독과 사람이 확인한 기대값을 구별하며, 자료·기준이 미확정인 항목은 대조 미완료로 유지한다.

- [ ] **1. 입력 정합 — 부분 완료:** 회차 1~8월과 최신 0818 수정본을 준비했다. PDF의 7월 표기와 8월 최신 회차가 앱의 7월 보고서와 대응한다. PDF에는 연도·금리 관측일/평가사 집계 방식이 명시되지 않았고, 별도 독립 기대값 CSV가 없어 전체 정합 확정은 남았다. 재무수치는 도구 출력에 노출하지 않는다.
- [ ] **2. 실제 대조 — 부분 완료:** 실제 자료가 있는 기존 fixture 검증 36건이 통과했다. PDF 주요 지표 4개·현재/적정시재 2개는 표시 단위·정밀도에서 일치한다. 금리 본문과 전체 PDF 수치·서술·과거 차트의 정답 대조는 미완료다. 아래 실행 기록에 원본 문서의 내부 불일치를 남겼으며, 앱 출력으로 기대값을 만들지 않았다.
- [x] **3. 최종 QA·독립 리뷰·컨텍스트 커밋:** 실제 구현 diff의 독립 검토를 완료하고, 확인된 범위·자료 대기 항목·커밋을 기록했다. UI를 바꾸지 않아 기존 3/4쪽 PDF QA는 반복하지 않았다. 위 1~2의 미완료 범위는 유지한다.


### Task 9: 자료 확보 후 검증군의 불필요한 스킵 분리

**발견:** 제공 폴더에서 1~8월 회차와 건설경기 원본을 확보했다. 0818 수정본을 우선 골라 한 달 한 파일씩 NFC 중립 이름으로 Git 제외 fixtures에 로컬 복사했다. 원본은 수정하지 않았다. 세 CSV 추출도 성공했다. 실제 fixture 실행은 34 passed / 3 skipped였으나, 건설경기의 독립 인계 기대값 CSV 하나가 없어 원본 엑셀만으로 가능한 2건까지 막힌다. 기대값을 앱 결과나 다른 CSV 복사로 만들어 스킵을 없애지 않는다.

**Files:** Modify `ai-frm/src/domain/risk/construction-perception/construction-perception.fixture.test.ts`, `ai-frm/scripts/check-golden-inputs.mjs`, `ai-frm/src/infrastructure/validation/golden-inputs.test.ts`, `ai-frm/README.md`.
**Interfaces:** 건설경기 원본 대조는 raw/errorRates/results 세 CSV가 있을 때 실행한다. 인계 기대값 대조 한 건만 expected CSV가 추가로 있어야 실행한다. CLI는 constructionPerception(기존 4CSV 전체 준비)을 유지하고 `constructionWorkbook`(3CSV만 준비) 검증군을 추가하여 현재 실행 가능한 부분을 보인다. inputsReady는 여전히 전체 준비가 필요하므로 expected 부재시 exit2다.

- [x] **1. RED:** root 실제 로컬 fixture 검증 요약에서 건설경기 workbook-only 2건 실행 기대 대비 0건으로 실패를 확인했다. 합성 CLI 통합에도 3CSV 존재/expected 부재일 때 constructionWorkbook true, constructionPerception false 및 전체 exit2 검사를 추가해 실패를 본다.
- [x] **2. 최소 수정:** shared beforeAll은 유지하며 outer guard는 raw/errorRates/results, 첫 it만 it.skipIf(!expected)로 제한한다. 실제 자료의 수치/기대값은 코드에 넣지 않는다. CLI와 문서 검증군 설명을 맞춘다.
- [x] **3. 검증·커밋:** 작업자는 합성 CLI 집중 검사·소스 린트·타입 검사만 실행한다. root가 실물 테스트를 비공개 로컬 로그로 캡처하고 건수만 읽어 원본 대조 2건 통과/독립 기대값 1건 스킵을 확인한다. 일반 전체 verify도 같은 방법으로 수행한다. 해당 파일만 커밋한다.


### 후속 실행 결과·인계 (2026-10-21)

- 작업 범위: 앞선 Task 1~5는 완료·최종 검토된 상태를 유지하고, `8e4f820` 이후 Task 6~9의 린트·검증 도구·실물 대조만 진행했다. 제품 UI·수치 정책·외부 API는 변경하지 않았다.
- Task 6 `1de359f`: 전체 린트 RED 1건 → GREEN. 생성 파일 하나만 제외하며 소스의 명시적 any 탐지와 TypeScript가 유지됨을 확인했다. 독립 검토 Approved.
- Task 7 `9528de8`: CLI stub에서 RED 15건 → GREEN 15건. 자료 확보 전 전체 verify 561 passed / 30 skipped, 전체 lint·TypeScript 통과. 독립 검토 Approved.
- Task 9 `c8785f2`: 세 추출 CSV만으로 가능한 2건을 스킵에서 분리했다. 합성 CLI RED 5 failed / 13 passed → GREEN 18 passed. 기존 수치 단언·shared beforeAll은 유지했으며 독립 검토 Approved.
- 사용자 제공 폴더: `~/Downloads/260909 1차 교육 회의 (3)/`. 1~8월의 8개 회차를 Git 제외 fixtures로 로컬 복사했다. 8월의 0818 수정본을 먼저 사용하고 0812 대안은 별도 보존했다. 중복 회차를 제외하고 테스트 이름 판독을 위해 NFC 중립 파일명으로 복사했다. 원본은 수정하지 않았다.
- 건설경기 원본에서 기존 추출기로 세 CSV를 만들었다. 별도 인계 기대값인 `fixture_expected.csv`는 제공 폴더에 없으며 임의 생성하지 않았다. 그 결과 `check:golden-inputs`는 최신/회차/예측오차/원본 대조 준비 true, 독립 기대값 대조 false, 전체 exit 2를 올바르게 반환한다. 이 명령은 여전히 수치·PDF 검증 not-run이다.
- 최종 일반 `npm run verify`: **600 passed / 2 skipped / 0 failed**. 실물 자료 검증은 최신 판독 11, 회차 판독 8, 예측오차 15, 건설경기 원본 대조 2건이다. 남은 스킵은 건설경기 독립 기대값 1건과 명시적 KOFIA 실호출 1건이다. 스킵을 통과로 집계하지 않는다.
- KOFIA 실호출을 별도로 명시 실행해 **1 passed**를 확인했다. 네트워크 제한으로 첫 시도는 실패했고 승인된 네트워크 권한 재실행이 통과했다. 현재 앱의 전월 마지막 평가일·1년물 3사 평균 기준이 기존 녹화 응답과 일치했다. 일반 verify의 기본 스킵 조건은 바꾸지 않았다.
- 최종 전체 `npm run lint`·TypeScript 통과. 기본 Turbopack 빌드는 승인 권한 재시도에서도 포트 생성 `Operation not permitted`로 실패했다. `npm run build -- --webpack`은 컴파일·TypeScript·정적 6개 페이지 생성을 완료했다. 기본 빌드 성공으로 보고하지 않는다.
- 실제 수치·파일 내용·개별 원본 파일명은 AI 도구 출력이나 Git에 넣지 않았다. 원본 추출·Vitest JSON/로그·OCR·계산 중간값은 권한을 제한한 `/private/tmp/aifrm-golden-followup/`에만 보존했다. Git 제외 fixtures의 재무수치를 화면 출력하지 않도록 후속 작업도 로컬 로그 캡처 후 건수/상태만 읽어야 한다.

#### PDF·원본 대조의 확인 범위

- 골든 PDF는 3쪽의 이미지 문서다. macOS Vision으로 두 해상도에서 로컬 OCR을 수행했으며, 주요 지표 4개의 숫자 토큰은 두 판독에서 같았다. 원문을 사람이 눈으로 대조한 완전한 정답 검증은 아니다. OCR의 낮은 신뢰도를 이유로 전체 문서 동일성 검증을 완료로 처리하지 않았다.
- 주요 지표 4개(회수·유동성·건설경기·조달금리차)는 PDF 소수 2자리에서 일치했다. 현재/적정시재는 앱의 억원을 PDF의 조원으로 환산해 소수 1자리에서 일치했다. 앱의 더 세밀한 표시와 PDF의 표시 정밀도를 구별했다.
- **골든 문서 내부 확인 필요:** PDF 본문의 공사채 AAA·국고채 금리는 제공 폴더의 7월 HWP 본문과 같은 쌍이다. 두 금리를 뺀 결과는 PDF 표제의 금리차와 맞지 않으며, 각각 소수 2자리라는 반올림 오차 범위로도 설명되지 않는다. 금리 본문 두 값은 앱이 사용하는 7월 마지막 평가일의 출처 평균과도 다르다. 녹화된 7월의 22개 평가일 중 어느 날의 평균/개별 3사 쌍과도 표시 정밀도에서 동시에 일치하지 않았다.
- PDF와 원본 HWP의 금리 본문을 그대로 복제하면 같은 내부 불일치가 생길 수 있다. 앱의 공개 출처·날짜·만기·평가사 정책을 유지했으며, 원문 정정 또는 기준 확인 전에는 해당 본문을 정답으로 확정하지 않는다. 비교표는 로컬 `golden-validation.md`에만 두어 사용자가 실제 수치를 직접 검토할 수 있게 했다.
- **남은 확인:** 금리 본문의 원본 관측일·집계 기준/정정본, 건설경기 독립 인계 기대값 CSV, PDF 전체 서술·과거 차트에 대한 사람의 대조. 전체 골든 일치나 HWP 다운로드 구현 완료를 주장하지 않는다.

#### 후속 판단과 잘못 판단했을 때의 비용

1. 기존 체크아웃과 기능 브랜치를 재사용했다. 서버·기존 커밋을 보존하며, 비용은 동시 편집 충돌이다. 파일별 소유권으로 줄였다.
2. 계획 작성 뒤 추가 승인을 기다리지 않고 진행했다. 사용자가 계획과 실행을 함께 요청했으며, 비용은 되돌릴 수 있는 구현 재작업이다.
3. 입력 준비 조건을 regular/readable/nonempty 파일로 한정했다. 빈 파일·디렉터리의 오판을 막으며, 비용은 기존 existsSync보다 엄격한 준비 조건이다. 수치 검증과 구별해 문서화했다.
4. 0818 최신 수정본과 NFC 중립 이름으로 한 달 한 파일을 사용했다. 비용은 골든이 이전 0812 수정본 기준일 때 재대조가 필요한 점이다. 대안은 보존했고, 확인한 주요 재무 항목은 최신본에서 표시 정밀도로 일치해 교체하지 않았다.
5. 원본만으로 가능한 건설경기 2건과 별도 기대값 1건의 스킵 조건을 분리했다. 기대값을 만들어 채우지 않았으며, 비용은 가드 변경의 회귀 가능성이다. 합성 CLI와 실제 원본 대조로 검증했다.
6. 금리 본문을 골든에 강제로 맞추지 않고 기존 출처·산식을 유지했다. 원문 내부 차이와 실조회 근거가 있으며, 비용은 골든 본문과의 문자·수치 동일성이 정정/기준 확인 전까지 미완료인 점이다.


### 후속 최종 코드 검토 완료

- 최종 독립 검토 범위: `8e4f820..b2e161e`, Task 6~9 후속 변경 전체. gpt-6-astra의 fresh-context 리뷰 결과 Approved, Critical/Important/Minor 0건이다. 수정 파동은 필요하지 않았다.
- 검토자가 직접 보지 않은 비공개 자료·전체 수치 정답성은 root의 로컬 검증 범위와 한계로 기록했다. 앞선 UI/인쇄는 기존 실제 저장 QA로 유지하고, 기존 fixture 파서·실패 원시값은 변경 범위 밖이며 로컬 비공개 캡처로 실행했다. KOFIA 실응답과 빌드 환경은 root의 별도 실호출·빌드 증거로 구별했다.
- 구현 Task 6·7·9 및 문서·컨텍스트 커밋은 완료됐다. Task 8은 금리 원문 기준/정정·독립 기대값·전체 PDF 대조가 남은 **부분 완료**다. 로컬 브랜치 `codex/provided-data-report`와 원본 대조표를 보존한다.
- 개인/원본 데이터는 Git에 없으며 준비한 로컬 fixture 12개가 모두 Git 제외임을 확인했다. 최종 검토 뒤 변경은 이 문서의 상태·검토 결과 기록뿐이다.


## 8. 사용자 승인 머지·실제 서버 QA (2026-10-21)

사용자가 ‘머지하시고 단계별로 진행’하도록 요청했다. 완료된 구현을 먼저 통합하고, 남은 정답 확인과 실제 출력 QA를 분리했다. 추가 제품 코드·산식·API 변경은 없다.

### 단계 1: main 머지 완료

- [x] 원격 `main`을 fetch해 로컬 기준점 `ef0a7ff`와 같음을 확인했다. 작업 트리가 깨끗하며 기능 브랜치가 그 기준점의 후손이었다.
- [x] 머지 전 전체 verify **600 passed / 2 skipped / 0 failed**. 비공개 값은 로컬 JSON/로그에 캡처하고 건수만 읽었다.
- [x] `main`에 `codex/provided-data-report`를 fast-forward 머지해 `0b8e3d4`까지 통합했다. 머지 후에도 **600 passed / 2 skipped / 0 failed**이며, 통합된 기능 브랜치 포인터는 삭제했다. 일반 체크아웃과 로컬 서버는 유지했다.

### 단계 2: 독립 기대값 출처 확인

- [x] 공개 Git 이력과 정책에서 원래 외부 인계 묶음의 `fixture_expected.csv`를 참조함을 확인했다. 저장소의 모든 조회 가능한 이력에는 해당 파일·동반 인계 문서·생성 스크립트가 없다. ECOS 원천 통계 API도 그 기대값 파일의 복원 경로가 아니다.
- 사용자가 재확인한 `03. 자금수지표/`는 이미 사용한 월별 엑셀 경로다. 이 엑셀 8개와 건설경기 원본의 3CSV 대조는 완료했다. 별도 인계 파일과 혼동하지 않으며 기대값을 임의로 만들지 않는다.
- [ ] 별도 기대값이 확보될 때 2023/08~2026/06의 35개월 지수·단계 대조 1건을 실행한다. 현재 그 1건은 정답 검증 미완료다.

### 단계 3: 실제 파일·HTML·PDF 자동 QA 완료

- [x] 먼저 별도 client harness에서 현재 제품의 업로드 페이지·테마·보고서 컴포넌트를 그대로 실행했다. 실물 엑셀 8개를 FileInput에 넣고 산출·HTML 열기까지 검증했다. 외부 응답만 원본 통계 스냅샷으로 고정해 화면 연결을 분리했다. 지표 5개의 제목·값·설명·기준이 모델과 모두 일치했고 브라우저 오류·예상 밖 네트워크 요청·가로 넘침은 0건이었다.
- [x] 참고자료의 실제 체크박스를 포함·해제해 기본 3쪽/포함 4쪽/해제 3쪽을 저장했다. A4·빈 쪽 없음·원래 1~3쪽 텍스트 동일성·SVG 텍스트 라벨 보존을 확인했다. 참고자료는 계열 4개 각각 15개월을 유지한다. 전체 값·문장은 로컬에서만 대조했다.
- [x] 이어 실행 중인 `http://127.0.0.1:3001/aifrm`에 별도 headless Chrome으로 직접 접속해 같은 실제 파일 8개를 업로드했다. 브라우저의 localhost 외 요청은 차단했고 제품의 서버 API는 실제로 실행했다. 건설경기·조달금리 API 모두 HTTP 200/ok/산출 가능이었다. 브라우저 오류·가로 넘침은 0건이었다.
- [x] 실제 API 응답으로 표시 모델을 별도 조립해 실서버의 PDF와 대조했다. 실제 체크박스 3→4→3쪽, 지표 5개의 제목·값·전체 설명·기준 보존, 인쇄 대상 SVG 라벨 전부 보존, 원래 1~3쪽 동일성을 확인했다. PDF 경계 밖 글자와 치환 문자는 0건이다. 이는 자동 검사이며 실제 자료의 시각적 정답 대조 완료를 뜻하지 않는다.
- 실행 환경: macOS Chrome 155. 별도 headless 프로필을 사용하고 사용자의 기존 창은 조작하지 않았다. 제한된 환경/가상시간 CLI 시도의 실패 뒤 권한을 승인받은 실제시간 브라우저 자동화가 통과했다. 제품 코드를 바꿔 검사를 통과시키지 않았다.
- 비공개 산출물은 `/private/tmp/aifrm-golden-followup/`에만 보존했다. 원본 스냅샷 고정 PDF는 `actual-default.pdf`, `actual-reference.pdf`, `actual-reset.pdf`; 실제 서버 응답 PDF는 `live-default.pdf`, `live-reference.pdf`, `live-reset.pdf`다. 원본 수치·HTML·API 응답·로그는 Git에 포함하지 않는다.

### 단계 4: 실조회와 골든의 기준 차이 확인 — 부분 완료

- **§7의 주요 지표 4개 일치는 원본 통계 스냅샷을 주입한 대조 결과다.** 실제 서버의 현행 ECOS 응답을 사용하면 같은 기준월이어도 건설경기 지수가 달랐다. 조달금리의 실제 결과는 기존 스냅샷과 같았다. 현재 실서버 보고서가 골든 지표 4개와 모두 일치한다고 주장하지 않는다.
- 현행 ECOS와 원본 사이에서 원값/비교값 차이가 있는 지표는 총수주액·주택건설인허가·설비투자·환율·주가·선행지수다. 총수주액·인허가는 점수/기여도에도 차이가 있었다. 보고월과 최신 회차는 같았다.
- 공개 코드의 통계표·항목·월별 주기와 비교월 선택은 기존 정책과 일치했다. 원본 헤더에서는 설비투자의 `2015=100`·계절조정, 환율 평균자료, KOSPI 종가 표기를 로컬로 확인했다. 정책 §6-2에는 잠정치·기준연도 개편과 최신 원천값 사용이 이미 명시돼 있다. 다만 이것만으로 이번 모든 차이의 개별 원인을 통계 개정으로 확정하지 않는다.
- 응답의 항목 코드·계열 메타까지 원본과 독립 대조하지 않았으며, 단순 재기준화만으로 점수 차이가 설명된다고 판단하지 않는다. 기존 최신 원천값 정책을 유지하고 골든에 맞추기 위한 수치·산식 변경은 하지 않았다.
- [ ] 골든 금리 본문의 관측일·집계 기준/정정본, 건설경기 통계 시점·계열 기준의 원문 확인이 남았다.
- [ ] 실제 수치를 기기 안에서 직접 보는 사람의 PDF 전체 시각·서술·과거 추이 대조가 남았다. 검토용 PDF 생성과 자동 보존 검사를 전체 골든 동일성 승인으로 취급하지 않는다.

### 다음 작업을 위한 컨텍스트

- 구현과 머지는 완료됐고, 현재 제품 소스는 검토된 `0b8e3d4`의 내용이다. 이후 변경은 이 문서의 검증·인계 기록뿐이다.
- 다음 입력은 월별 엑셀 추가분이 아니라 원본 금리 정정/통계 기준의 확인 또는 별도 인계 기대값이다. 해당 자료가 오면 §8의 미완료 항목만 이어서 확인한다. 600건 검사·이미 완료된 UI/인쇄 작업을 처음부터 다시 구현하지 않는다.
- 실제 서버 생성 검토본은 `live-default.pdf`(3쪽)·`live-reference.pdf`(4쪽)이며, 스냅샷 재현 검토본과 구별한다. 실제 API 데이터의 차이를 숨기거나 서로 다른 기준의 기대값으로 통과를 만들지 않는다.
