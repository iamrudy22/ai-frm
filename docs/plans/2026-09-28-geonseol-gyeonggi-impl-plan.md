# 건설경기 인식 지수 — 구현 계획

**작성일**: 2026-09-28 (DDD 검토 반영 개정)
**근거 문서**: [정책](./2026-09-28-geonseol-gyeonggi-policy.md), [DDD 검토 §10](../design/2026-09-18-ddd-review.md), [지표 분리 계획](./2026-09-28-jipyo-bunri-plan.md)

---

> **상태: 계획. 착수 전.** 정책은 확정됐다(정책 §9-1). 구조는 DDD 검토 §10에서 정했다.
>
> **개정 내용 (DDD 검토 반영)**
> 1. 분양회수 계획·실적 이력을 지표 폴더에서 빼서 **`domain/cashflow`의 애그리거트**로 둔다.
> 2. **Repository와 포트**를 넣는다. 흐름 조율은 화면이 아니라 **유스케이스 두 개**가 맡는다.
> 3. ECOS 번역은 **ACL(`infrastructure/ecos`)이 끝까지** 한다. 화면은 ECOS 형식을 모른다.
> 4. 점수화 기준을 함수가 아니라 **데이터 표**로 둔다.
> 5. 용어와 식별자(`construction-perception`)를 고정했다.
>
> **사전 확인 (2026-09-28)**
> - ECOS 인증키가 `ai-frm/.env.local`에서 동작한다. 9종 모두 2015/01부터 조회된다. 호출당 기본 100건이라 **`count`를 1000으로** 올려야 전 기간(139~140건)이 한 번에 온다.
> - 8월 회차 fixture에서 떼어 낸 **7월 실적과 8·9·10월 분양회수 계획 4개가 엑셀 이력과 모두 일치**한다. 최신 회차 한 장으로 이력을 쌓는 방식(정책 §3-3)이 성립한다.
> - **ECOS 현재 값으로 다시 계산하면 과거 126개월 중 6개월의 단계가 엑셀과 다르다**(§14 R1). 산식 오류가 아니라 원값 수정 때문이다. 엑셀 일치 검증은 엑셀 원값으로 하고, ECOS 연동은 따로 검증한다.

## 0. 원칙

- **안쪽(도메인)에서 바깥(화면)으로 쌓는다.** 단계마다 테스트를 먼저 쓰고, 끝날 때 `npm run verify`와 `npm run lint`가 통과해야 한다.
- **단계마다 커밋 하나.** 커밋 메시지는 한국어로, 왜 바꿨는지를 본문에 쓴다.
- **다른 지표 파일은 건드리지 않는다.** 고치는 공용 파일은 다음이 전부다.
  - `cashflow/statement.ts`: 달력 월 함수 추가 (W1)
  - `risk/grade.ts`: 구간표에 값의 종류(`GradeBands<T>`)를 붙인다. 기본값이 비율이라 기존 두 지표의 호출부는 그대로다 (W2)
  - `src/boundaries.test.ts`: 규칙 6·7 (W9)
  - `app/aifrm/page.tsx`: 카드 (W10)
  - `app/page.tsx`, `README.md`: W11
  - `.gitignore`: `/data/`
- **사내 수치는 커밋하지 않는다.** 분양회수 금액·오차율과 엑셀에서 뽑은 기대값은 `/fixtures/`와 `/data/`(둘 다 gitignore)에 둔다. 그 파일이 있을 때만 도는 테스트로 검증한다. ECOS 원값은 공개 통계라 테스트 데이터로 커밋해도 된다.
- **새 계층이 생긴다.** 지금까지 앱은 브라우저에서만 돌았다. 이번에 **서버 라우트 두 개**와 **포트 두 개**가 처음 생긴다. ECOS 키와 이력 파일이 브라우저로 새지 않는 것을 경계 테스트로 지킨다(W9).

## 1. 용어

[DDD 검토 §10-1](../design/2026-09-18-ddd-review.md)에서 확정했다. 코드 식별자는 영어, 화면·주석·문서는 한국어 용어를 쓴다.

| 도메인 용어 | 코드 | 화면 표기 |
|---|---|---|
| 건설경기 인식 지수 | `construction-perception` (폴더), `ConstructionPerception` | 건설경기 인식 지수 |
| 종합위기인식지수 | `index` | 종합위기인식지수 |
| 종합위기단계 | `grade: Grade` (어휘 공유) | 종합위기단계: 정상/주의/경고/위기 |
| 산출불가 | `kind: 'unavailable'` | 산출불가 |
| 분양회수 계획·실적 이력 | `ForecastLedger` | 분양회수 계획·실적 이력 |
| 회차 기재분 | `RoundEntry` — 한 회차에서 떼어 낸 직전 월 실적 1개와 3개월 계획 | (표시 안 함) |
| 분양회수 예측오차 | `forecastError` | 분양회수 예측오차 |
| 달력 월 | `YearMonth` (`'2026/07'`) | 2026/07 |

## 2. 구조

```
src/
  domain/
    shared/
      year-month.ts                    달력 월 값 객체 (신규)
    cashflow/
      statement.ts                     + calendarOf(statement, month)
      round-entry.ts                   회차 기재분 값 객체 + 회차에서 떼어 내기 (신규)
      forecast-ledger.ts               분양회수 계획·실적 이력 애그리거트 (신규)
    risk/
      construction-perception/         (신규 지표 폴더)
        policy.ts                      점수화 기준 표, 가중치, 단계 구간표, 단계별 코멘트
        forecast-error.ts              이력 → 분양회수 예측오차
        construction-perception.ts     변화율 → 점수 → 지수 → 단계, 결측, 기준월
  application/
    ports.ts                           ForecastLedgerRepository, EconomicIndicatorSource (신규)
    record-round.ts                    유스케이스: 회차 반영 (신규)
    construction-perception.ts         유스케이스: 건설경기 인식 지수 산출 (신규)
  infrastructure/
    ecos/ecos-indicator-source.ts      ACL: ECOS Open API → 지표별 달력 월 계열 (서버 전용)
    ledger/file-ledger-repository.ts   이력 JSON 파일 (서버 전용)
  app/
    api/construction-perception/route.ts   GET  — 조립 + 산출 유스케이스
    api/forecast-ledger/rounds/route.ts    POST — 조립 + 회차 반영 유스케이스
    aifrm/page.tsx                         카드 (표시만)

scripts/seed-forecast-ledger.mjs       레거시 ACL: 엑셀 → 초기 이력·fixture
data/forecast-ledger.json              이력 (gitignore)
```

**의존 방향**

```
app/api/**/route.ts ──조립──> application/(유스케이스, 포트) ──> domain/
        │                                ▲
        └──> infrastructure/ ──구현──────┘ (포트를 구현한다)

app/aifrm/page.tsx ──fetch──> /api/...     (서버 모듈을 import하지 않는다)
                  ──> domain/cashflow/round-entry (회차에서 기재분을 떼어 낸다)
```

**흐름**

1. 사용자가 최신 회차를 올린다. 브라우저가 `statement-reader`로 읽고 `roundEntryOf(statement)`로 **4개 값만** 떼어 낸다. 자금수지표 원본은 서버로 가지 않는다.
2. `POST /api/forecast-ledger/rounds` → 회차 반영 유스케이스가 이력을 불러와 `record`하고 저장한다.
3. `GET /api/construction-perception` → 산출 유스케이스가 ECOS 9종과 이력을 받아 기준월 한 달을 산출한다.
4. 화면은 결과를 표시한다. 회차를 올리지 않아도 3은 동작한다. 이력은 이미 서버에 있다.

## 3. 단계표

| # | 작업 | 주요 파일 | 커밋 |
|---|---|---|---|
| W1 | 달력 월, 회차의 달력 월 | `shared/year-month.ts`, `cashflow/statement.ts` | `feat: 달력 월과 회차 기준월` |
| W2 | 점수화 기준 표·산식·기준월 | `construction-perception/{policy,construction-perception}.ts` | `feat: 건설경기 인식 지수 정책과 산식` |
| W3 | 회차 기재분, 분양회수 계획·실적 이력 애그리거트 | `cashflow/{round-entry,forecast-ledger}.ts` | `feat: 분양회수 계획·실적 이력` |
| W4 | 분양회수 예측오차 | `construction-perception/forecast-error.ts` | (W3과 같은 커밋) |
| W5 | 시드·fixture 추출 스크립트 | `scripts/seed-forecast-ledger.mjs` | `feat: 분양회수 이력 시드와 엑셀 동등성 검증` |
| W6 | 엑셀 동등성 테스트 | `construction-perception.fixture.test.ts` | (W5와 같은 커밋) |
| W7 | 포트와 유스케이스 두 개 | `application/{ports,record-round,construction-perception}.ts` | `feat: 건설경기 인식 지수 유스케이스` |
| W8 | ECOS ACL, 파일 저장소 | `infrastructure/{ecos,ledger}/` | `feat: ECOS 수집과 이력 저장소` |
| W9 | 라우트(조립), 경계 규칙 6·7 | `app/api/**/route.ts`, `boundaries.test.ts` | (W8과 같은 커밋) |
| W10 | 화면 카드 | `app/aifrm/page.tsx` | `feat: 건설경기 인식 지수 카드` |
| W11 | 문서·홈 화면 | `docs/`, `app/page.tsx`, `README.md` | `docs: 건설경기 인식 지수 반영` |

- **W1~W6은 서버·네트워크 없이 끝난다.** W6이 통과하면 산식과 이력 경로가 엑셀과 같다는 것이 확정된다. 그 뒤는 입력을 어디서 가져오느냐의 문제만 남는다.
- **W7은 가짜 포트로 테스트한다.** 메모리 저장소와 고정 계열을 쓴다. ECOS·파일 없이 유스케이스의 조율 규칙을 전부 검증한 뒤 W8에서 진짜 구현을 끼운다.
- 이 계획 문서와 정책·DDD 검토 개정은 W1 전에 `docs:` 커밋 하나로 먼저 올린다.

---

## 4. W1 — 달력 월

지금 `Statement`의 월은 시트 안의 **인덱스**이고, 라벨(`8월`, `26.1월`)은 표시용이다. ECOS 계열과 이력은 **달력 월**로 이어야 하므로 둘을 잇는 다리가 필요하다.

**`domain/shared/year-month.ts`**
- `YearMonth` 브랜드 타입, `'2026/07'` 형식. 정책 문서와 엑셀의 시점 키와 같다.
- `yearMonth(y, m)`, `parseYearMonth(s)`, `addMonths(ym, n)`, `compareYearMonth(a, b)`.
- 테스트: 12월 + 1 = 다음 해 1월, 1월 − 12 = 전년 1월, `'2026/13'`·`'202607'`은 던진다.

**`statement.ts`에 추가**
- `calendarOf(statement, month): YearMonth`. 기준월의 달력 월을 `asOf`에서 얻고, 나머지 달은 인덱스 차이만큼 더한다. 라벨을 해석하지 않는다.
- **먼저 확인할 것 (R5)**: `asOf`의 달이 기준월과 같은가. `checkConsecutive`가 이미 그렇게 가정하지만 테스트한 적은 없다. 실물 fixture(8월 회차)로 `calendarOf(defaultBaseMonth) === '2026/08'`을 단언한다. 다르면 여기서 멈추고 판독 계층을 먼저 고친다.

## 5. W2 — 점수화 기준 표·산식·기준월

### 정책 (`policy.ts`) — 데이터 표

규칙 2에 따라 `risk/grade`와 `domain/shared`만 쓴다. **함수 없이 표만** 둔다(DDD 검토 §10-5).

```ts
export type IndicatorKey =
  | '총수주액' | '주택매매가격지수' | '미분양주택현황' | '주택건설인허가실적' | '설비투자지수'
  | '대출금리' | '분양회수예측오차' | '환율' | '주가' | '선행지수순환변동치';

export type ScoringRule = {
  readonly key: IndicatorKey;
  readonly 변환: '전년동월비' | '전월대비' | '전월차bp' | '3개월누적오차율';
  readonly 방향: '하락' | '상승' | '양방향';  // 무엇이 위험한가
  readonly 만점: number;                      // 이 값(방향 쪽 끝)이면 1점. 경계 포함
  readonly 영점: number;                      // 이 값이면 0점
  readonly 가중치: number;                    // 엑셀 위기단계!B2:K2, 자릿수 그대로
};

export const SCORING_RULES: readonly ScoringRule[]; // 1~10번, 엑셀 열 순서
export const STAGE_BANDS = defineBands([
  { atLeast: 60, grade: '위기' }, { atLeast: 40, grade: '경고' },
  { atLeast: 20, grade: '주의' }, { atLeast: Number.NEGATIVE_INFINITY, grade: '정상' },
]);
export function commentFor(grade: Grade): string; // 임시 문구
```

- 표의 각 줄은 정책 §3-4 표의 한 줄과 1:1로 대응한다. 엑셀 기준표를 정본으로 받으면(D6) 이 표만 교체한다.
- ECOS 통계표·항목 코드는 정책이 아니라 ACL(W8)의 것이다. 코드가 바뀌어도 산식은 바뀌지 않는다.
- 엑셀의 `L ≤ 100` 상한은 두지 않는다(정책 §3-6).

### 산식 (`construction-perception.ts`)

```ts
export type RawSeries = ReadonlyMap<YearMonth, number>;
export type Missing = { readonly missing: string };        // 사유
export type PerceptionInput = {
  readonly series: Readonly<Record<Exclude<IndicatorKey, '분양회수예측오차'>, RawSeries>>;
  readonly forecastError: (t: YearMonth) => Ratio | Missing;  // W4가 채운다
};
export type Latest = Readonly<Record<IndicatorKey, YearMonth | null>>; // null = 알 수 없음

export type IndicatorLine = {
  key: IndicatorKey; current?: number; reference?: number;  // 당월 원값, 비교 원값
  change: number; score: number; contribution: number;      // 가중치 × 점수
};
export type ConstructionPerception =
  | { kind: 'ok'; month: YearMonth; index: number; grade: Grade; lines: IndicatorLine[] }
  | { kind: 'unavailable'; month: YearMonth | null; missing: { key: IndicatorKey; reason: string }[] };

export function scoreBy(rule: ScoringRule, change: number): number; // 표 해석기 하나
export function baseMonthOf(latest: Latest): YearMonth | { unknown: IndicatorKey[] };
export function assessConstructionPerception(input: PerceptionInput, month: YearMonth): ConstructionPerception;
```

- **`scoreBy`**: 엑셀 IF문과 같은 순서로 판정한다. 1점 조건 → 0점 조건 → 선형 보간. `양방향`은 절댓값을 쓴다. 지표별 분기는 이 함수에 두지 않는다.
- **결측 (정책 §6-1)**: 다음 중 하나라도 없으면 그 지표는 결측이고, 결과는 `unavailable`이다. 0으로 채우는 경로를 두지 않는다.
  - 당월 값
  - 비교 월 값(전월 또는 12개월 전)
  - 분양회수 예측오차
- 비교 원값이 0이면 결측으로 본다. `Infinity`가 1점으로 들어가는 것을 막기 위해서다.
- **`baseMonthOf` (정책 §5)**: 지표별 최신월 중 가장 이른 달이다. 최신월을 알 수 없는 지표가 있으면 기준월을 정하지 않는다. **거슬러 내려가는 함수는 만들지 않는다.** 기준월의 결과가 `unavailable`이면 그대로 산출불가다(정책 §9-1 Q2).
- 합산 순서는 엑셀 `SUMPRODUCT`와 같게 1번 → 10번으로 고정한다. 소수점 6자리 일치를 지키기 위해서다.

### 테스트 (합성값)

- 가중치 합 = `100.47417291001882` (정규화하지 않았음을 고정).
- `scoreBy` 경계: 지표마다 만점 경계, 영점 경계, 중간값.
  - 4번·10번은 정확히 0%·−0.2%여도 0점이다. 엑셀의 `>`는 선형식이 영점에서 0을 내므로 결과를 바꾸지 않는다(W2에서 확인, 정책 §3-4). 결과가 `−0`이 아니라 `0`인지도 본다.
  - 환율 ±5%는 같은 점수다.
  - 대출금리는 12bp이면 0점, 40bp이면 0.5점이다.
- 단계: 19.999… 정상, 20 주의, 40 경고, 60 위기, 100.47 위기.
- 지수: 인허가만 −30%이면 15.5 정상. 인허가 −60%와 주택가격 −1.5%이면 54 경고.
- 2026/07 재현: 주택매매가격지수만 있으면 `unavailable`이고, 결측 목록이 나온다. **"위기"가 나오지 않는다.**
- `baseMonthOf`:
  - KB 8월·설비투자 7월·이력 7월이면 7월이다.
  - 한 지표가 `null`이면 기준월이 없다.
  - 이력 6월이 빠졌어도 기준월은 최신월로 정해지고, 결과가 `unavailable`이다. 더 이전 달로 내려가지 않는다.

## 6. W3·W4 — 회차 기재분, 이력 애그리거트, 예측오차

### 회차 기재분 (`cashflow/round-entry.ts`) — 값 객체

```ts
export type RoundEntry = {
  readonly round: YearMonth;                                  // 회차 = 기준월 b
  readonly actual: { month: YearMonth; value: Amount };       // b−1월 실적
  readonly plan: { month: YearMonth; values: readonly [Amount, Amount, Amount]; beyondPlanYear: boolean };
};
export function roundEntryOf(statement: Statement): RoundEntry;
export function roundEntry(raw: unknown): RoundEntry;         // 서버가 받은 본문을 검증해 만든다
```

- `roundEntryOf`: 기준월 b의 직전 달 `분양회수`(실적)와 b, b+1, b+2의 `분양회수`(계획)를 떼어 낸다. 읽을 수 없는 항목이면 던진다.
- **값 객체의 불변식**: `actual.month = round − 1`, `plan.month = round`, 금액은 유한한 수다. 브라우저에서 만들든 서버가 본문으로 받든 같은 팩토리를 지난다.
- `beyondPlanYear`: 11·12월 회차의 M1·M2가 계획연도 끝(`planYearEnd`)을 넘으면 `true`다(§14 R2).

### 분양회수 계획·실적 이력 (`cashflow/forecast-ledger.ts`) — 애그리거트

```ts
export type ForecastLedger = {
  record(entry: RoundEntry): ForecastLedger;                  // 유일한 변경 경로. 새 인스턴스를 돌려준다
  actualOf(month: YearMonth): Amount | undefined;
  planOf(month: YearMonth): readonly [Amount, Amount, Amount] | undefined;
  latestActualMonth(): YearMonth | null;
  gaps(): readonly YearMonth[];                               // 실적·계획이 빈 달 (최초~최신 사이)
  snapshot(): LedgerSnapshot;                                 // 저장용 직렬화
};
export function emptyLedger(): ForecastLedger;
export function ledgerFrom(snapshot: LedgerSnapshot): ForecastLedger; // 불변식을 다시 검사한다
```

**불변식** (정책 §3-3)
- **칸마다 쓸 수 있는 회차는 하나다.** u월 실적은 u+1월 회차, u월 계획은 u월 회차만 쓴다. 회차 b의 기재분은 정의상 (b−1)월 실적과 b월 계획뿐이므로 `record`가 이를 강제한다.
- **나중 회차는 과거 실적을 덮지 않는다.**
- 같은 회차를 다시 반영하면 그 칸을 덮는다(멱등).
- `ledgerFrom`은 스냅샷의 각 칸이 주인 회차와 맞는지 검사한다. 파일이 손으로 고쳐져도 불변식이 깨진 이력은 만들어지지 않는다.
- 시드한 칸도 주인 회차의 값으로 기록한다(`actualFrom = u+1`, `planFrom = u`). 예외 규칙이 없다. 시드 표시는 칸 단위(`actualSeeded`, `planSeeded`)다 — 한 줄의 실적만 실제 회차로 바뀌어도 계획은 여전히 시드일 수 있다.
- 회차 기재분은 정의상 제 칸만 가리키므로 `record`는 불변식을 따로 검사하지 않는다. 바깥에서 들어오는 두 입구(`ledgerFrom`, `roundEntry`)만 검사한다.

`LedgerSnapshot`은 `{ version: 1, rows: [...] }`다. 형식이 바뀌면 `version`을 올린다.

### 분양회수 예측오차 (`construction-perception/forecast-error.ts`)

```ts
export function forecastErrorAt(ledger: ForecastLedger, t: YearMonth): Ratio | Missing;
```

- 실적 `t−2 + t−1 + t`와 `planOf(t−2)`의 세 값 합으로 구한다(정책 §3-2).
- 하나라도 없거나 계획 합이 0 이하이면 `Missing`이다. 사유에 어느 달의 무엇이 없는지 적는다.
- 이 파일은 `cashflow/forecast-ledger`를 읽기만 한다. 이력을 바꾸지 않는다.

### 테스트 (합성값)

- 정책 §3-2 정의대로 한 창 계산.
- 8월 회차를 두 번 반영해도 결과가 같다.
- 시드된 7월 실적은 8월 회차를 반영하면 덮이고, 9월 회차를 반영하면 덮이지 않는다.
- 주인 회차가 맞지 않는 스냅샷은 `ledgerFrom`이 거부한다.
- 한 달 빠진 이력에서 그 달을 포함하는 세 창은 `Missing`이고, `gaps()`에 그 달이 나온다.
- `roundEntry`는 달이 어긋난 본문(`actual.month ≠ round − 1`)을 거부한다.

## 7. W5·W6 — 시드와 엑셀 동등성

### 시드 스크립트 (`scripts/seed-forecast-ledger.mjs`) — 레거시 ACL

`node scripts/seed-forecast-ledger.mjs <건설경기인식지수(2026).xlsx>`로 한 번 돌린다.

- `분양회수data`의 C(실적)와 D~F(계획 M0~M2)를 `data/forecast-ledger.json`(스냅샷 형식)으로 옮긴다.
- **라벨을 한 달 당긴다**(정책 §7 D8). "2026/08" 행을 `2026/07`로 옮긴다. 이 보정은 이 스크립트 한 곳에만 있다.
- W6용 fixture 세 개를 만든다.
  - `fixtures/건설경기인식지수-원값.csv`: `ecos기초데이터`의 9종 원값
  - `fixtures/분양회수-오차율-엑셀.csv`: `분양회수data` H열을 라벨 보정한 값
  - `fixtures/건설경기인식지수-엑셀결과.csv`: `위기단계` L(지수)·M(단계)열
- 이력 파일이 이미 있으면 멈춘다. 실제 회차가 쌓인 뒤 다시 돌리면 덮이기 때문이다. `--force`일 때만 덮는다.
- 스크립트는 **형식만** 검사한다. 날짜 연속, 숫자 여부를 본다. 산식을 두지 않는다. 산식이 두 벌이 되면 어긋난다.
- `.gitignore`에 `/data/`를 추가한다.

### 엑셀 동등성 (`construction-perception.fixture.test.ts`)

fixture와 `data/forecast-ledger.json`이 없으면 건너뛴다. 기존 `statement-reader.fixture.test.ts`와 같은 방식이다.

- 원값 fixture와 초기 이력(`ledgerFrom` → `forecastErrorAt`)으로 `PerceptionInput`을 만든다. 기대값 파일의 `raw_분양회수예측오차` 열은 한 달 어긋나 있으므로 쓰지 않는다(정책 §7 D8).
- **단언**
  - 초기 이력으로 계산한 모든 달의 오차율이 `분양회수-오차율-엑셀.csv`와 소수점 12자리까지 일치한다(시드 검증).
  - 2023/08~2026/06 35개월의 지수가 `toBeCloseTo(expected, 6)`이고, 단계 문자열이 일치한다(인계 폴더의 `fixture_expected.csv`를 `fixtures/`에 둔다).
  - 2026/07은 `kind === 'unavailable'`이다.
  - **엑셀 127개월 전체**(W5에서 확장): 시드 스크립트가 `위기단계` L·M열도 뽑는다(`fixtures/건설경기인식지수-엑셀결과.csv`). 산출되는 124개월은 지수·단계가 모두 엑셀과 같고, 산출불가는 2026/07(ECOS 미입력)과 2016/01·02(분양회수 이력이 2016/01부터라 창이 모자람, D9) 세 달뿐이다.
  - 이 테스트는 구현 뒤에 썼으므로 변이 검사로 확인했다. 가중치 23 → 23.00001이면 실패하고, 계획 회차를 한 달 어긋나게 해도 실패한다.
- 로그에는 실수치 대신 단계 문자열과 일치 여부만 남긴다.

## 8. W7 — 포트와 유스케이스

### 포트 (`application/ports.ts`)

```ts
export interface ForecastLedgerRepository {
  load(): Promise<ForecastLedger>;          // 없으면 emptyLedger()
  save(ledger: ForecastLedger): Promise<void>;
}

export type IndicatorFetch = { values: RawSeries; unit: string } | { error: string };
export interface EconomicIndicatorSource {
  /** 9종. 한 지표의 실패가 다른 지표를 막지 않는다. */
  fetchAll(): Promise<Readonly<Record<EcosIndicatorKey, IndicatorFetch>>>;
}
```

포트의 타입은 전부 도메인 언어다(`YearMonth`, `RawSeries`). ECOS 형식은 여기에 나오지 않는다.

최신월은 포트로 받지 않는다(W7에서 변경). 계열의 마지막 달이 곧 최신월이라 두 칸으로 두면 어긋날 수 있다. 유스케이스가 계열에서 구한다. `Outcome`은 대시보드와 함께 쓰도록 `application/outcome.ts`로 옮겼다.

### 회차 반영 (`application/record-round.ts`)

```ts
export async function recordRound(repo: ForecastLedgerRepository, entry: RoundEntry): Promise<Outcome<{ latestActualMonth: YearMonth; gaps: YearMonth[] }>>;
```

- 이력을 불러와 `record(entry)`하고 저장한다. 도메인 규칙은 애그리거트가 지키고, 이 함수는 순서만 맡는다.
- 동시 요청: 사용자는 한 명이고 월 1회 반영이므로 잠금을 두지 않는다. 대신 저장소가 원자적으로 쓴다(W8).

### 건설경기 인식 지수 산출 (`application/construction-perception.ts`)

```ts
export async function assessPerception(source: EconomicIndicatorSource, repo: ForecastLedgerRepository)
  : Promise<{ result: Outcome<ConstructionPerception>; diagnostics: PerceptionDiagnostics }>;
```

- 순서: ECOS 9종 조회 → 이력 불러오기 → 지표별 최신월(`Latest`) 구성 → `baseMonthOf` → `assessConstructionPerception`.
- 분양회수의 최신월은 `ledger.latestActualMonth()`다.
- 진단(`PerceptionDiagnostics`)에 다음을 담는다.
  - 지표별 최신월과 단위(ECOS `UNIT_NAME` 그대로)
  - ECOS 실패 지표
  - 이력의 마지막 달과 빈 달(`gaps`)
  - 조회 시각
  - 최신월이 기준월보다 늦은 지표. 예: "KB지수·환율·주가 8월 공표, 설비투자지수 대기"
- 한 지표의 ECOS 실패는 그 지표의 최신월을 `null`로 만든다. 결과는 산출불가이고, 사유에 그 지표가 나온다.

### 테스트

가짜 포트를 쓴다. 메모리 저장소와 고정 계열이다.

- 회차 반영 뒤 저장소에 그 칸이 들어가 있다. 같은 회차를 두 번 반영하면 저장소 내용이 같다.
- ECOS 9종이 모두 오고 이력이 7월까지면 7월 기준으로 `ok`다.
- ECOS 한 지표가 실패하면 산출불가이고, 사유에 그 지표 이름이 있다.
- 이력에 6월이 비면 산출불가이고, 진단의 `gaps`에 6월이 있다.

## 9. W8 — ECOS ACL과 파일 저장소

### ECOS ACL (`infrastructure/ecos/ecos-indicator-source.ts`) — 서버 전용

`EconomicIndicatorSource`를 구현한다. **번역을 여기서 끝낸다**(DDD 검토 §10-4).

- 9종 코드표를 여기에 둔다(인계 문서 §2). 비은행 대출금리는 넣지 않는다(정책 범위 밖).
- 한 지표당 호출 한 번: `/StatisticSearch/{key}/json/kr/1/1000/{통계표}/M/201501/{이번 달}/{항목1}[/{항목2}]`.
- 번역 내용:
  - `TIME '202607'` → `YearMonth '2026/07'`
  - `DATA_VALUE` 문자열 → 수
  - `UNIT_NAME` → 공백을 걷어 낸 단위
  - 가장 늦은 달 → `latest`
- 응답에 `RESULT`가 있으면 실패다(HTTP 200으로 온다). "데이터 없음"은 빈 계열로 본다. **실제 코드는 인계 문서의 `ERROR-200`이 아니라 `INFO-200`이다**(키 오류도 `INFO-100`). 그래서 앞머리가 아니라 번호(`-200`)로 가른다(W8에서 녹화로 확인). 받은 행이 `list_total_count`보다 적으면 잘린 계열이라 실패로 본다. 9종을 병렬로 부르고, 실패는 지표 단위로 격리한다.
- 키는 생성자 인자로 받는다. `process.env.ECOS_API_KEY`는 조립 지점(W9)에서만 읽는다. `NEXT_PUBLIC_` 접두어를 쓰지 않는다. **오류 메시지와 로그에 키가 들어간 URL을 남기지 않는다.**
- 테스트: 실제 응답을 녹화한 JSON(공개 통계)으로 번역, `RESULT` 오류, 빈 행, 항목코드 두 개(환율)를 검증한다. 네트워크는 부르지 않는다.

### 파일 저장소 (`infrastructure/ledger/file-ledger-repository.ts`) — 서버 전용

`ForecastLedgerRepository`를 구현한다.

- `data/forecast-ledger.json`을 읽을 때 `ledgerFrom`으로 불변식을 다시 검사한다.
- 쓸 때는 `snapshot()`을 임시 파일에 쓴 뒤 이름을 바꾼다. 반쯤 쓴 파일이 남지 않게 하기 위해서다.
- **서버 한 대, 디스크가 유지되는 환경에서만 맞다**(§14 R3). 서버리스로 가면 이 파일만 DB 구현으로 바꾼다. 포트가 있으므로 유스케이스는 바뀌지 않는다.
- 테스트: 임시 디렉터리에서 저장 → 불러오기 왕복, 파일이 없으면 빈 이력, 불변식이 깨진 파일은 거부.

## 10. W9 — 라우트(조립)와 경계 규칙

### 라우트 — 조립 지점

```ts
// app/api/construction-perception/route.ts
export async function GET() {
  const source = new EcosIndicatorSource(process.env.ECOS_API_KEY);
  const repo = new FileLedgerRepository(LEDGER_PATH);
  return Response.json(toDto(await assessPerception(source, repo)));
}
// app/api/forecast-ledger/rounds/route.ts
export async function POST(request: Request) {
  const entry = roundEntry(await request.json());   // 값 객체 팩토리가 검증
  return Response.json(await recordRound(new FileLedgerRepository(LEDGER_PATH), entry));
}
```

- 라우트는 조립과 직렬화만 한다. 규칙을 두지 않는다. `route.ts`는 정해진 이름만 내보낼 수 있어서 처리 함수는 `app/api/_lib/handlers.ts`에, 조립은 `app/api/_lib/composition.ts`에 두었다(W9).
- 키가 없으면 산출불가와 "ECOS_API_KEY가 설정되지 않았습니다"를 돌려준다.
- 잘못된 본문은 400을 돌려준다.
- Next 16 Route Handler는 기본적으로 캐시하지 않는다. 처음에는 캐시 없이 간다. 필요해지면 ECOS 조회를 `'use cache'` + `cacheLife('hours')` 도우미로 감싼다(route-handlers 문서).
- 결과 DTO(`YearMonth`는 문자열, `Map`은 배열)는 라우트 파일 옆에 둔다. 화면은 이 DTO만 안다.

### 경계 규칙 (`src/boundaries.test.ts`)

- **규칙 6**: `infrastructure/ecos/`, `infrastructure/ledger/`는 `app/api/` 아래 파일만 import한다. 화면(`'use client'`), `domain/`, `application/`은 import하지 않는다. ECOS 키와 이력 파일이 브라우저 번들에 들어가지 않게 한다.
- **규칙 7**: `application/`은 포트를 통해서만 바깥을 쓴다. 기존 규칙 4(판독 계층·화면을 모른다)가 이미 막고 있으므로, 여기서는 규칙 4의 검사 대상에 새 파일이 들어가는지 확인하는 테스트만 더한다.
- 규칙이 실제로 무언가를 검사하는지 확인하는 테스트도 둔다. 기존 "등급이 없는 지표 폴더가 실제로 있다"와 같은 방식이다.
- `construction-perception`은 등급을 쓰는 지표이므로 `UNGRADED_INDICATORS`에 넣지 않는다.

## 11. W10 — 화면 카드

`app/aifrm/page.tsx`. **표시만** 한다.

구현(W10): 카드는 `app/aifrm/construction-perception-card.tsx`로 따로 두었다. 표 행·기준월 설명·이력 안내·변화율 표기는 순수 함수(`construction-perception-view.ts`)로 떼어 테스트했다. 등급 배지 색은 `format.ts`의 `GRADE_BADGE`로 옮겨 세 지표가 함께 쓴다(`page.tsx`는 기본 내보내기 외의 이름을 내보낼 수 없다). 카드는 회차 업로드와 상관없이 뜬다.

- 페이지를 열면 `GET /api/construction-perception`을 부른다. 회차를 올리면 `roundEntryOf`로 기재분을 떼어 `POST`하고, 성공하면 다시 `GET`한다.
- 카드 내용:
  - 제목은 **건설경기 인식 지수**, 옆에 **기준월**을 적는다.
  - 기준월은 자금수지표 기준월 선택과 **별개로 자동 결정**된다(정책 §5). 이를 한 줄로 알린다. 예: "ECOS 공표 시차로 2026/07 기준".
  - **종합위기인식지수**(소수 둘째 자리), **종합위기단계** `Badge`(기존 `BADGE_VARIANT` 재사용), 코멘트.
  - 10종 표: 지표 · 당월 원값(단위) · 변화율(대출금리는 bp) · 점수 · 기여도. 엑셀과 같은 1~10번 순서다.
  - `unavailable`이면 단계 자리에 **산출불가**, 아래에 빠진 지표와 사유를 보인다.
  - 진단: ECOS 조회 시각, 기준월보다 늦게 나온 지표, 이력의 마지막 달, 빈 달이 있으면 어느 회차를 올려야 하는지.
  - 로딩 중, 서버 오류, 이력 없음을 각각 다르게 보여 준다.
- 월별 추이 표는 없다(정책 §9-1 Q7).
- Astryx 규칙(`<div>` 금지, 토큰만)을 따른다. 쓰기 전에 `npx astryx component Table` 등으로 속성을 확인한다.

**확인**
- `preview_start`로 개발 서버를 띄운다.
- 8월 회차 fixture를 올린다.
  - POST가 한 번 일어난다.
  - 카드가 2026/07 기준으로 뜬다.
  - 콘솔 오류가 없다.
- 브라우저로 내려온 JS 번들에 `ECOS_API_KEY` 값이 없는지 확인한다.
- 결과(W10): GET 경로는 브라우저에서 2026/07 기준 15.15 정상으로 뜨고 콘솔 오류가 없다. 브라우저 도구로 파일을 올릴 수 없어 POST는 8월 회차 fixture에서 뗀 기재분을 실행 중인 서버에 직접 보내 확인했다(200, 깨진 본문 400). 값이 시드와 같아 이력 금액은 그대로이고 해당 칸의 시드 표시만 걷혔다. 번들 21개에 ECOS 요청 주소와 `ECOS_API_KEY` 이름이 없다.
- 스크린숏을 남긴다.

## 12. W11 — 문서

- 정책 문서 상태를 "구현 완료"로 바꾼다. 구현 중 바뀐 결정이 있으면 §9에 날짜와 함께 적는다.
- 홈 화면(`app/page.tsx`)의 지표 목록에 **건설경기 인식 지수**를 올린다.
- `README.md`에 다음을 적는다.
  - `ECOS_API_KEY` 설정
  - 시드 스크립트 실행
  - `data/` 백업 필요. 이력은 되살릴 원천이 없다.

## 13. 이번에 하지 않는 것

- **도메인 이벤트**("회차가 접수됨"): 구독자가 이력 반영 하나뿐이라 유스케이스가 직접 부른다.
- **`RiskIndicator` 공통 추상화**: 2026-09-28 재검토의 결론(적정 시재에 등급이 없음)이 그대로 유효하다.
- **대금 회수 위험을 이력으로 옮기기**: 가능해졌지만(DDD 검토 §10-2) 이번 범위가 아니다.
- **대금 회수 `kind: 'invalid'` → `'unavailable'` 이름 통일**: 다음에 그 코드를 고칠 때 한다.
- **CQRS, DI 컨테이너**: 쓰지 않는다.

---

## 14. 위험과 확인할 것

| ID | 내용 | 대응 |
|---|---|---|
| **R1** | **ECOS 현재 값으로 계산하면 엑셀과 단계가 다른 달이 있다.** 2026-09-28 조회 기준 126개월 중 6개월이다. 2025/10·2023/11·2023/10은 주의→정상, 2020/10·2020/04·2020/01은 정상→주의. 지수 차이는 최대 14.5점이다. 원인은 KB지수 기준 개편(전 기간 약 6% 비례 차이), 인허가·선행지수·설비투자지수의 과거 수정, 수주액 잠정치 수정이다 | 산식 문제가 아니다. 화면은 기준월 한 달만 보여 준다. 다만 **자금기획팀에 "자동화 후 과거 수치가 엑셀과 다를 수 있다"는 점을 미리 알린다** |
| R2 | 11·12월 회차의 계획 M1·M2가 다음 해 열에 걸린다. 그 열은 계획이 일부만 채워져 있다 | 값은 그대로 쓰고 `beyondPlanYear`로 표시한다. 11월 회차 파일이 생기면 엑셀 이력 값과 대조한다 |
| R3 | 이력 파일 저장은 단일 서버에서만 맞다. 되살릴 원천도 없다 | 포트 뒤에 두었으므로 배포 형태가 정해지면 저장소 구현만 교체한다. `data/` 백업을 README에 적는다 |
| R4 | ECOS 장애·호출 제한 | 지표 단위로 격리하고 산출불가로 처리한다. 다음 조회에서 다시 시도한다 |
| R5 | `asOf`의 달 = 기준월이라는 가정 | W1에서 fixture로 먼저 확인한다 |
| R7 | **1월 회차에는 전년 12월 열이 없다.** 회차 시트는 계획연도 1월부터라 1월 회차에서 직전 월 실적을 뗄 수 없다(기존 대금 회수 위험도 같은 한계로 1월 회차를 거부한다). 12월 실적 칸이 비어 12·1·2월 세 창이 산출불가가 된다 | 기재분의 실적을 사유와 함께 비우고 계획만 기록한다(W3). 조용히 틀린 값을 내지 않고 드러낸다. 12월 실적을 어디서 받을지는 첫 1월 회차 파일을 보고 정한다 |
| R6 | 이력을 쌓으려면 **매달** 최신 회차를 올려야 한다. 한 달을 건너뛰면 그 달을 포함하는 세 달치가 산출불가다 | 화면에 이력의 빈 달과 올려야 할 회차를 보여 준다. 빠진 회차를 나중에 올리면 채워진다 |
