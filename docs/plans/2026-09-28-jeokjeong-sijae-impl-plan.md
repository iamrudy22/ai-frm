# 지표 분리 + 적정 시재 — 구현 계획

**작성일**: 2026-09-28
**근거 문서**: [지표 분리 계획](./2026-09-28-jipyo-bunri-plan.md)(P1~P4), [적정 시재 PRD](./2026-09-28-jeokjeong-sijae-prd.md)(A1~A8)

---

> **상태: 계획, 착수 전.** 기준선은 테스트 82개 통과(`c30b038`)다.

## 0. 원칙

- **안쪽(도메인)에서 바깥(화면)으로 쌓는다.** 각 단계는 테스트를 먼저 쓰고(TDD), 끝날 때마다 `npm run verify`(tsc + vitest)와 `npm run lint`가 통과해야 한다.
- **단계마다 커밋 하나.** 커밋 메시지는 기존 관례(한국어, 왜 바꿨는지를 본문에)를 따른다.
- **리팩터링 단계(P2)에서는 동작이 바뀌지 않는다.** 테스트는 옮기기만 하고, 지우는 테스트는 이유를 커밋에 적는다.
- **실수치는 커밋하지 않는다.** 실물 fixture 테스트의 단언은 이미 회의록에 있는 169%와 T/F 판정만 쓴다.
- **등급은 대금 회수 위험과 유동성 Gap에만 있다.** 두 지표는 등급 어휘(`정상/주의/경고/위기`)와 구간 판정 도구(`grade.ts`)를 공유한다. **적정 시재에는 등급이 없다.** T/F 판정과 `안정적` / `적정시재 부족` 표기만 있고, `grade.ts`에 의존하지 않는다(PRD §9-6).

## 1. 단계표

| # | 작업 | 주요 파일 | 커밋 |
|---|---|---|---|
| P1 | 대금 회수 월 일치 검증 | `risk/payment-recovery.ts` | `fix: 대금 회수 위험이 서로 다른 달을 비교하지 않는다` |
| P2-1 | 지표별 폴더·정책 분리 | `risk/{payment-recovery,liquidity-gap}/policy.ts` | `refactor: 지표별 정책 분리` |
| P2-2 | 경계 테스트 | `domain/boundaries.test.ts` | (P2-1과 같은 커밋) |
| P3-1 | 회차가 읽지 못한 항목을 품는다 | `cashflow/statement.ts` | `refactor: 판독 실패를 항목 단위로 격리` |
| P3-2 | 판독 실패를 항목 단위로 기록 | `infrastructure/xlsx/statement-reader.ts` | (P3-1과 같은 커밋) |
| P4-1 | 애플리케이션 서비스 | `application/dashboard.ts` | `feat: 대시보드 유스케이스와 지표별 실패 격리` |
| P4-2 | 화면을 표시 전용으로 | `app/aifrm/page.tsx` | (P4-1과 같은 커밋) |
| A1 | 금액 가중 연산 | `shared/amount.ts` | `feat: 적정 시재 산식` |
| A2 | 기타수입·계획연도 끝 | `statement.ts`, `statement-reader.ts` | (A1과 같은 커밋) |
| A3 | 적정 시재 정책 (등급 없음) + 경계 규칙 4 | `risk/adequate-cash/policy.ts`, `boundaries.test.ts` | (A1과 같은 커밋) |
| A4 | 적정 시재 산식·롤링 | `risk/adequate-cash/adequate-cash.ts` | (A1과 같은 커밋) |
| A5 | 대시보드 슬롯 | `application/dashboard.ts` | `feat: 적정 시재 카드` |
| A6 | 화면 카드 | `app/aifrm/page.tsx` | (A5와 같은 커밋) |
| A7 | 실물 fixture 검증 | `statement-reader.fixture.test.ts` | (A5와 같은 커밋) |
| A8 | 문서·홈 화면 갱신 | `docs/`, `app/page.tsx` | `docs: 적정 시재 반영` |

**P1~P4가 끝나면 지표 분리 요구가 테스트와 함께 충족된다.** A 단계는 그 구조 위에 지표 하나를 더하는 일이라서, 적정 시재를 추가해도 다른 지표의 파일은 건드리지 않는다. A5·A6의 대시보드와 화면만 예외다.

---

## 2. P1 — 대금 회수 월 일치 검증

**테스트 먼저** (`payment-recovery.test.ts`의 "두 회차에서 입력 조립"):
- 6월 회차(기준월 6월)와 8월 회차(직전 월 7월)를 넣으면 `/같은 달이 아닙니다/`로 던진다.
- 기존 연속 회차 케이스 4개는 그대로 통과한다.

**구현**:
- `paymentRecoveryInputFrom`에서 `prev.defaultBaseMonth.label !== targetInNext.label`이면 던진다. 메시지에는 두 달 이름을 넣는다.
- 지금은 던지는 것까지만 한다. 값으로 바꾸는 일은 P4가 한 곳에서 맡는다(조립 단계의 실패는 전부 P4의 `Outcome`으로 모인다).

**완료 기준**: 비연속 회차에서 등급이 나오지 않는다. 화면의 순서 경고 배너는 그대로 뜬다.

---

## 3. P2 — 정책 분리

### P2-1. 폴더 이동과 정책 쪼개기

```
domain/risk/
  grade.ts, grade.test.ts               어휘 + defineBands·gradeBy. 머리 주석의 "네 지표 모두 4단계"를
                                        "등급을 쓰는 지표(대금 회수·유동성 Gap)"로 고친다
  payment-recovery/
    policy.ts                           PAYMENT_RECOVERY_BANDS, commentFor(grade)
    policy.test.ts                      기존 policy.test의 대금 회수 부분
    payment-recovery.ts                 import 경로만 변경
    payment-recovery.test.ts
  liquidity-gap/
    policy.ts                           LIQUIDITY_GAP_BANDS, GRADE_WHEN_NET_INFLOW, commentFor(grade)
    policy.test.ts
    liquidity-gap.ts
    liquidity-gap.test.ts
```

- `risk/policy.ts`, `risk/policy.test.ts`, `IndicatorKey`, 공용 `COMMENTS`를 지운다.
- **지우는 테스트 1개**: "지표마다 문구가 다르다". 두 지표의 정책을 한 테스트에서 비교하는 것 자체가 결합이고, 분리 뒤에는 서로 다른 문구여야 한다는 요구도 없다. "네 등급 모두 문구가 있다"는 지표별로 나눠 둘 다 남긴다.
- 호출부 변경: `app/aifrm/page.tsx`(`commentFor` 2곳, import 2곳), `statement-reader.test.ts`, `statement-reader.fixture.test.ts`의 import 경로.

### P2-2. 경계 테스트 `domain/boundaries.test.ts`

소스 파일을 읽어 import 경로를 검사한다. 규칙 세 가지:

1. `domain/risk/<지표>/` 아래 파일은 다른 `<지표>/` 폴더를 import하지 않는다. `@/…` 절대 경로와 `../` 상대 경로를 모두 본다.
2. `<지표>/policy.ts`는 `risk/grade`와 `domain/shared`만 import한다.
4. `risk/adequate-cash/` 아래 파일은 `risk/grade`를 import하지 않는다. **적정 시재에 등급이 없다는 결정을 테스트로 지킨다.** 이 규칙은 폴더가 생기는 A3에서 추가한다. 추가할 때 폴더가 실제로 있는지 먼저 단언해서, 이후 폴더 이름이 바뀌어 규칙이 아무것도 검사하지 않고 통과하는 일을 막는다.
3. `domain/` 아래 어떤 파일도 `@/application`, `@/infrastructure`, `@/app`, `xlsx`를 import하지 않는다.

**빈 통과를 막는 장치**:
- 검사 함수를 따로 떼서, 위반이 들어 있는 문자열을 넣으면 실제로 잡는지 먼저 테스트한다.
- 지표 폴더를 2개 이상 찾았는지 확인한다. 경로를 잘못 잡아 0개를 훑고 통과하는 일을 막는다.

**완료 기준**: 테스트 수는 82 − 1 + (경계 테스트 수)개다. 동작 변화는 없다. `next build`가 통과한다.

---

## 4. P3 — 판독 실패를 항목 단위로 격리

### P3-1. 회차 (`statement.ts`)

- 항목 계열 타입을 `readonly Amount[] | Unreadable`로 넓힌다. `Unreadable = { readonly unreadable: string }`(사유).
- `createStatement`는 읽은 항목에만 길이 불변식을 검사한다. 모든 항목이 읽지 못한 상태면 회차를 거부한다. 헤더만 맞고 표가 통째로 다른 시트일 가능성이 크기 때문이다.
- `amountOf(item, month)`가 읽지 못한 항목을 만나면 `"<항목>을 읽지 못했습니다 — <사유>"`로 던진다. **0으로 대체하지 않는다.**
- `unreadableItems(): readonly { item; reason }[]`를 추가한다. 진단 표시용이다.
- `checkRollForward`는 필요한 항목(기초시재·수입계·지출) 중 하나라도 읽지 못했으면 "롤포워드를 확인할 수 없습니다"라는 진단 한 줄을 돌려준다.

테스트: 읽지 못한 항목 조회 시 사유가 담긴 오류, 읽은 항목은 정상 조회, 전부 못 읽으면 거부, 롤포워드 진단 불가 메시지.

### P3-2. 판독 (`statement-reader.ts`)

- **회차 전체 실패**(지금처럼 `ok: false`): 시트 없음, 헤더 없음, 기준일 없음, 기준월 열 없음.
- **항목 실패**(회차는 만들고 그 항목만 `Unreadable`): 행 없음, 빈 칸, 숫자 아님. 사유 문구는 지금 문구를 그대로 쓴다.

기존 테스트 3개의 기대가 바뀐다. 모두 "거부"에서 "그 항목만 못 읽음"으로 바뀐다.
- "항목이 없으면 어느 항목인지 알려 준다"
- "빈 칸이 있으면 거부한다 — 0으로 세면 순지출이 작아 보인다"
- "숫자가 아니면 거부한다"

새 테스트: 분양회수 칸 하나가 빈 합성 시트에서 유동성 Gap은 169%로 나오고, 분양회수 조회는 사유와 함께 실패한다.

**완료 기준**: 한 항목이 깨져도 그 항목을 쓰지 않는 지표는 산출된다. 빈 칸을 0으로 세는 경로가 없다.

---

## 5. P4 — 애플리케이션 서비스

### P4-1. `src/application/dashboard.ts`

```ts
export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };

export type Dashboard = {
  paymentRecovery: Outcome<PaymentRecoveryOk> | null;  // 이전 회차 없으면 null
  liquidityGap: Outcome<LiquidityGap>;
  diagnostics: {
    order: ConsecutiveCheck | null;
    rollForward: readonly string[];
    unreadable: readonly { item: ItemName; reason: string }[];
  };
};

export function assessDashboard(previous: Statement | null, latest: Statement, base: Month): Dashboard;
```

- 지표마다 `attempt(() => …)`로 따로 감싼다. 던지면 `ok: false`로 바꾼다. 대금 회수의 `kind: 'invalid'`도 여기서 `ok: false`로 모은다. 그러면 화면이 보는 실패 모양은 하나뿐이다.
- 대금 회수는 회차 기준월(`defaultBaseMonth`)로, 유동성 Gap은 사용자가 고른 `base`로 계산한다. 지금 화면에 숨어 있는 이 규칙을 여기로 옮기고 테스트로 고정한다.
- 경계 테스트에 규칙을 하나 더한다. `application/`은 `app/`과 `xlsx`를 import하지 않는다.

테스트 `application/dashboard.test.ts`(합성 회차):
- 셋 다 성공
- 이전 회차 없음 → 대금 회수 `null`, Gap은 성공
- 월 불일치(P1) → 대금 회수만 실패, Gap은 성공
- 기준월 창 부족 → Gap만 실패, 대금 회수는 성공
- 분양회수를 읽지 못함 → 대금 회수만 실패
- 순서 경고·롤포워드 진단·읽지 못한 항목이 `diagnostics`에 실린다

### P4-2. 화면

- `useMemo` 두 개(gap, recovery)를 `assessDashboard` 하나로 바꾼다. `X | string | null` 분기가 `Outcome` 분기로 바뀐다.
- 새 경고 배너 둘: "시재가 다음 달로 이어지지 않습니다"(롤포워드), "읽지 못한 항목이 있습니다"(항목과 사유).
- 기준월 선택자 라벨을 "유동성 Gap 기준월"에서 "기준월"로 바꾼다. A6에서 적정 시재도 이 선택을 따른다.

**검증**: `next build`를 돌리고, `/aifrm`을 브라우저로 열어 빈 상태와 콘솔 오류를 확인한다. 파일 업로드 흐름은 브라우저 자동화로 파일을 넣을 수 없을 수 있다. 그럴 경우 fixture 기반 `assessDashboard` 테스트로 대신하고, 수동 확인이 필요하다고 보고한다.

---

## 6. A — 적정 시재

### A1. `shared/amount.ts`
- `scale(a: Amount, weight: number): Amount`를 추가한다. 가중치가 유한하지 않으면 거부한다. 테스트 2개.

### A2. 기타수입과 계획연도 끝
- `ItemName`에 `'기타수입'`, `SHEET_LABEL`에 `기타수입: '기타수입'`을 추가한다.
- 판독이 헤더에서 점 없는 `N월` 라벨의 마지막 열을 찾아 `planYearEndIndex`로 넘기고, `Statement.planYearEnd: Month`로 노출한다. 도메인은 라벨을 해석하지 않는다.
- 테스트 헬퍼(`statement.test.ts`, 두 지표 테스트, 판독 테스트의 `workbook()`)에 기타수입 행·계열을 추가한다.
- 판독 테스트에 이웃 행 `기타지출`, ` - 기타`를 깔아 두고 완전 일치로 `기타수입`만 집는지 확인한다.
- 테스트: `planYearEnd`가 `12월`이다(`26.1월`이 아니다).

### A3. `risk/adequate-cash/policy.ts`
- `LCR_WEIGHTS`(분양회수 0.2 · 기타수입 0.1 · 지출 0.1 · 수지차 0.4)와 `verdictLabel(isAdequate)`(`안정적` / `적정시재 부족`)를 둔다.
- `grade.ts`를 쓰지 않는다(경계 규칙 4). 구간표·등급별 코멘트·`GRADE_WHEN_…` 같은 등급 정책이 없다. 정책은 가중치와 두 표기뿐이다.
- 테스트: 가중치 값, `verdictLabel(true) = 안정적`, `verdictLabel(false) = 적정시재 부족`.

### A4. `risk/adequate-cash/adequate-cash.ts`
- `adequateCashInputFrom(statement, base)`: `windowFrom`으로 3개월을 자르고 합계를 낸다. 창이 부족하면 던진다.
- `assessAdequateCash(month, input)`: 구성요소 4개와 적정시재를 계산하고, `isAdequate = openingCash >= adequateCash`로 판정한다. 결과 타입에는 `isAdequate`만 있고 `grade` 필드가 없다.
- `adequateCashSeries(statement, from)`: `from`부터 창이 시트 안에 드는 달까지 계산한다. 창이 부족한 달은 빼고 던지지 않는다. 각 행에 두 표시를 붙인다.
  - `isPlan = month.index > defaultBaseMonth.index`
  - `beyondPlanYear = month.index + 2 > planYearEnd.index`
- 테스트: PRD §4-3 합성 케이스 5개, 목록 길이 `months.length − base.index − 2`, 두 표시의 경계, 시트 끝 근처 기준월에서 빈 목록.

### A5. 대시보드 슬롯
- `Dashboard.adequateCash: Outcome<AdequateCashReport>`를 추가한다. `AdequateCashReport = { current: AdequateCash; series: readonly AdequateCash[]; cutoff: Month | null }`이고, `cutoff`는 창이 부족해 빠지기 시작한 첫 달이다.
- 테스트: 기타수입을 읽지 못하면 적정 시재만 실패하고 다른 두 지표는 성공한다. 이것이 분리 요구의 최종 확인이다.

### A6. 화면 카드
- 착수 전에 `npx astryx build "지표 요약 카드와 월별 추이 표"`와 `npx astryx component <Name>`으로 접기 컴포넌트와 상태 표시 컴포넌트를 확인한다.
- **판정 표시는 두 상태 전용이다.** `T · 안정적` / `F · 적정시재 부족`. 두 지표의 `BADGE_VARIANT`(등급→색)와 `commentFor`를 재사용하지 않는다. 등급 배지처럼 보이면 등급이 있는 지표로 오해되기 때문이다. Astryx 규칙상 Badge는 개수 표시용이므로 StatusDot/Token 계열에서 고른다.
- 구성: PRD §5 — 기준월 요약 → 산출 내역(접기) → 월별 추이 표 → 각주("다음 해 계획 미확정", 빠진 달 안내).
- 검증: P4-2와 같다. 라이트·다크 모드와 좁은 폭에서 스크린샷을 찍는다.

### A7. 실물 fixture 검증
- 기존 fixture(8월 회차)로 확인한다. 기준월 8월 판정은 `true`, 추이는 6개 행, 8월 행은 `isPlan = false`, 11월 이후 행은 `beyondPlanYear = true`. 금액은 단언하지 않는다.

### A8. 문서·홈
- PRD 상태를 "구현 완료"로 바꾸고, 지표 분리 계획의 P1~P4에 결과를 적는다.
- DDD 검토 D5("넷 다 4단계 등급" 전제)를 고치고, D5·D6에 "지표별 정책 분리, 적정 시재는 등급 없이 T/F" 결과를 적는다. 회의록은 당시 기록이므로 고치지 않는다.
- 홈 화면(`app/page.tsx`): "자동으로 내는 지표 둘"을 셋으로 고치고, 적정 시재 항목의 "ACR 모델"을 "LCR 모델"로 바꾸고(PRD §9-4) "T/F 판정"임을 적는다.

---

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| P2에서 import 경로를 빠뜨림 | `tsc --noEmit`이 잡는다. 이동 직후 바로 돌린다 |
| P3 이후 "회차는 읽혔는데 전부 실패" 상태가 사용자에게 혼란을 줌 | 읽지 못한 항목 배너를 결과보다 위에 띄운다. 전부 못 읽으면 회차 자체를 거부한다 |
| 경계 테스트가 정규식 한계로 동적 import 등을 놓침 | 이 코드베이스에는 동적 import가 없다. 경계 테스트 주석에 범위를 밝힌다 |
| 업로드 흐름을 브라우저로 확인하지 못함 | `assessDashboard` fixture 테스트로 로직을 덮고, 화면은 수동 확인 항목으로 보고한다 |
| 다음 해 열 때문에 11월 이후 판정이 낙관적으로 나옴 | 정책 결정 사항(PRD §9-1). "다음 해 계획 미확정" 표시로 드러낸다 |

---

## 8. 진행 기록

### P1 결과 (2026-09-28)

- **계획을 보강했다.** 원안은 라벨만 비교했는데, 그러면 12개월 떨어진 회차(`7월` 회차와 이듬해 `8월` 회차)도 통과한다. 달력(`checkConsecutive`)과 열(라벨)을 둘 다 확인한다.
- 검사 순서: 직전 월 존재 → 회차 연속 → 같은 달. 기존 "직전 월이 없다" 테스트의 기대 메시지가 유지된다.
- 순서 경고 배너 문구를 "그대로 산출했다"에서 "대금 회수 위험은 판정하지 않았다"로 고쳤다. 이제 그 경우 등급이 나오지 않기 때문이다.
- 테스트 82 → 86개(건너뛴 회차, 뒤바뀐 순서, 1년 차이, 열 어긋남). `tsc`·`eslint`·`next build` 통과.

### P2 결과 (2026-09-28)

- `risk/payment-recovery/`, `risk/liquidity-gap/`로 옮기고 `policy.ts`를 지표마다 하나씩 뒀다. 공용 `COMMENTS`·`IndicatorKey`·`commentFor(indicator, grade)`는 없어졌다. 화면은 `import * as <지표>Policy`로 각 지표의 `commentFor(grade)`를 부른다.
- **테스트 수 계산을 바로잡는다.** 계획은 "82 − 1 + 경계"였지만, "네 등급 모두 문구가 있다"가 지표별 2개로 나뉘어 +1이 된다. 정책 테스트는 12개 그대로이고, 전체는 86 + 경계 9 = 95개다.
- 경계 검사기 작성 중 버그 둘을 잡았다. ① `risk/grade`에 `/`를 붙여 검사하면 `grade`가 지표 폴더로 오인된다. ② 위반 예시를 문자열로 품은 테스트 파일 자신이 위반으로 잡힌다(검사 대상에서 제외).
- 실제 위반을 심어(`liquidity-gap.ts`에 `../payment-recovery/…` import) 경계 테스트가 실패하는 것을 확인하고 되돌렸다.
- `grade.ts` 머리 주석을 "등급을 쓰는 지표만, 적정 시재는 등급 없음"으로 고쳤다.
- `tsc`·`eslint`·`next build` 통과. `/aifrm`이 콘솔 오류 없이 렌더된다.

### P3 결과 (2026-09-28)

- `Statement`의 항목 계열을 `readonly Amount[] | Unreadable`로 넓혔다. `amountOf`는 읽지 못한 항목에서 사유를 담아 던지고, `unreadableItems()`가 목록을 준다. 모든 항목을 못 읽으면 회차를 거부한다.
- **빈 칸 원칙을 강화했다.** 한 칸이라도 비면 그 항목의 계열 전체를 버린다. 빈 칸이 아닌 달도 부분값으로 살려 쓰지 않는다(테스트로 고정).
- `checkRollForward`는 기초시재·수입계·지출 중 하나라도 못 읽으면 "확인할 수 없습니다"를 돌려준다. 빈 목록은 "확인했고 맞다"로 읽히기 때문이다.
- 판독 테스트 3개의 기대를 "거부"에서 "그 항목만 못 읽음"으로 바꿨다. 새로 추가한 테스트 두 가지: "어떤 항목도 못 읽으면 거부", "분양회수 칸이 비어도 유동성 Gap 169%".
- 테스트 95 → 104개. `tsc`·`eslint`·`next build` 통과.
