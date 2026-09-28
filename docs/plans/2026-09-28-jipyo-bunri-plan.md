# 지표 분리 — 적정 시재 선행 작업 계획

**작성일**: 2026-09-28
**후행 문서**: [적정 시재 PRD](./2026-09-28-jeokjeong-sijae-prd.md)
**선행 문서**: [유동성 Gap 수정 계획](./2026-09-18-yudongseong-gap-fix-plan.md), [DDD 도메인 모델 검토](../design/2026-09-18-ddd-review.md)

---

> **상태: 계획, 구현 전.** P1~P4를 마친 뒤 적정 시재 PRD를 구현한다.

## 0. 요구

**각 지표의 정책은 서로 분리되어야 한다.** 한 지표의 구간표·문구·가중치를 바꾸거나 한 지표의 입력이 깨져도, 다른 지표의 코드·테스트·산출 결과가 영향을 받지 않아야 한다.

## 1. 현재 상태 진단 (2026-09-28)

### 1-1. 분리되어 있는 것

- **지표끼리 서로 import하지 않는다.** `payment-recovery.ts`와 `liquidity-gap.ts`는 상대를 모른다.
- **구간표 값은 지표마다 별도 상수다.** `LIQUIDITY_GAP_BANDS`를 바꿔도 대금 회수 판정은 변하지 않는다.

### 1-2. 결합되어 있는 것 — 세 곳

| # | 결합 지점 | 무엇이 묶였나 | 왜 이렇게 되었나 |
|---|---|---|---|
| C1 | `risk/policy.ts` 한 파일 | 두 지표의 구간표, 순유입 기본 등급, 코멘트 표(`COMMENTS: Record<IndicatorKey, Record<Grade, string>>`)가 한 모듈에 있다. 지표를 추가하면 이 공용 표와 `IndicatorKey`를 고쳐야 하고, 한 지표의 정책을 바꾸면 이 파일과 `policy.test.ts`가 함께 바뀐다 | 수정 계획 §2-4·DDD 검토 D6이 "기준이 코드 곳곳에 흩어지지 않도록 정책은 한 파일이 소유한다"로 정했다. **정책을 코드와 분리**하는 데 초점을 두었고, **정책끼리 분리**하는 것은 고려하지 않았다 |
| C2 | `risk/grade.ts`의 `Grade` | 모든 지표가 `정상/주의/경고/위기` 4단계 어휘를 공유한다. 코멘트 표 타입도 이 어휘에 묶여 있어 T/F 판정인 적정 시재는 들어갈 자리가 없다 | DDD 검토 D1이 `Grade`/`GapGrade` 중복 선언을 하나로 합쳤다. 회의록이 "네 지표를 각각 같은 단계로 판정한다"고 했기 때문이다 |
| C3 | 판독 계층 + `Statement` | 판독이 항목 목록(`ItemName`) **전체를 필수**로 읽는다. 한 항목이라도 없거나 빈 칸이 있으면 회차 전체를 거부하므로, 어느 한 지표만 쓰는 행이 깨져도 **모든 지표가 멈춘다** | 빈 칸을 0으로 세면 순지출이 작아 보이므로 fail-fast로 막았다. 옳은 판단이었지만 실패 범위를 회차 전체로 잡았다 |

결합이 하나 더 있다. **화면(`page.tsx`)이 지표들을 조율한다.** 지금은 지표별 `useMemo`로 실패가 격리되어 있지만, 이 격리를 보장하는 테스트가 없다.

### 1-3. 판정

- C1은 **정책 결합**이다. 요구와 정면으로 어긋나므로 분리한다.
- C2는 **어휘 공유**다. 4단계 등급의 이름과 구간 판정 메커니즘(`defineBands`·`gradeBy`)은 정책이 아니라 도구다. 공유는 유지하되 **등급을 쓰는 지표만** 가져다 쓰게 하고, 코멘트 표를 지표별 정책으로 옮겨 어휘와 정책을 떼어 낸다.
- C3은 **실패 전파**다. 정책 분리와 같은 이유로 분리한다.

## 2. 작업

| # | 작업 | 해소 |
|---|---|---|
| P1 | 대금 회수의 월 일치 검증 | 리뷰 약점 1 |
| P2 | 정책을 지표별 모듈로 분리하고, 경계를 테스트로 보호 | C1, C2 |
| P3 | 판독 실패를 항목 단위로 격리 | C3 |
| P4 | 애플리케이션 서비스 `assessDashboard` | 화면 조율, 오류 모델 혼재, 롤포워드 미사용 |

순서: P1 → P2 → P3 → P4 → 적정 시재. 각 단계에서 기존 테스트 82개가 모두 통과해야 한다(파일 이동 포함).

### P1. 대금 회수 — 같은 달을 비교한다

- `paymentRecoveryInputFrom(prev, next)`이 `prev.defaultBaseMonth.label`과 최신 회차 직전 월의 라벨이 같은지 확인한다. 다르면 판정하지 않고 사유를 돌려준다.
- 회차 연속성 경고(`checkConsecutive`)는 그대로 둔다. 경고는 사용자 안내이고, 월 일치는 **판정의 전제**라서 역할이 다르다.
- 테스트: 6월 회차와 8월 회차를 넣으면 등급이 나오지 않고 사유가 나온다.

### P2. 정책 분리

목표 구조:

```
domain/
  shared/amount.ts                 + scale(amount, weight)
  cashflow/statement.ts
  risk/
    grade.ts                       4단계 어휘 + defineBands·gradeBy (정책 아님, 도구)
    payment-recovery/
      policy.ts                    구간표 · 등급별 문구
      policy.test.ts
      payment-recovery.ts
      payment-recovery.test.ts
    liquidity-gap/
      policy.ts                    구간표 · 순유입 기본 등급 · 등급별 문구
      policy.test.ts
      liquidity-gap.ts
      liquidity-gap.test.ts
    adequate-cash/                 (적정 시재 PRD에서 추가)
      policy.ts                    LCR 가중치 · T/F 문구
    boundaries.test.ts             지표 폴더 간 import 금지
```

- 공용 `COMMENTS` 표, `IndicatorKey`, `commentFor(indicator, grade)`를 없앤다. 대신 지표마다 `commentFor(grade)`를 둔다.
- 각 `policy.ts`는 `grade.ts`와 `shared` 외에는 import하지 않는다.
- **경계 테스트** `boundaries.test.ts`: `risk/<지표>/` 아래 파일이 다른 지표 폴더를 import하면 실패한다. 소스 파일을 읽어 import 경로를 검사하는 방식이다. 분리를 약속이 아니라 테스트로 지킨다.
- **적정 시재에는 등급이 없다**(PRD §9-6). `grade.ts`를 쓰지 않고, T/F 판정과 `안정적`/`적정시재 부족` 표기는 적정 시재 정책 안에서만 정의한다. 경계 테스트가 `risk/adequate-cash/` → `risk/grade` import를 금지한다.

### P3. 판독 실패를 항목 단위로 격리

- 판독 실패를 두 층으로 나눈다.
  - **회차 전체 실패**: 시트 없음, 헤더 없음, 기준일 없음. 지금처럼 거부한다.
  - **항목 실패**: 항목 행이 없거나, 빈 칸이 있거나, 숫자가 아님. 회차는 만들고 그 항목만 "읽지 못함 + 사유"로 기록한다.
- `Statement.amountOf`는 읽지 못한 항목을 요청받으면 사유를 담아 던진다. 빈 칸을 0으로 세지 않는 원칙은 유지된다.
- 그러면 실패는 그 항목을 쓰는 지표에만 번진다. 예: `기타수입` 행이 깨지면 적정 시재만 "산출할 수 없습니다 — 기타수입의 10월 칸이 비어 있습니다"가 되고, 대금 회수·유동성 Gap은 정상 산출된다.
- 테스트: 한 항목만 빈 칸인 합성 시트에서 다른 지표는 산출되고, 그 항목을 쓰는 지표만 사유를 낸다.

### P4. 애플리케이션 서비스

```ts
// application/dashboard.ts
export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };

export type Dashboard = {
  readonly paymentRecovery: Outcome<PaymentRecovery> | null;   // 이전 회차 없으면 null
  readonly liquidityGap: Outcome<LiquidityGap>;
  readonly adequateCash: Outcome<AdequateCashReport>;          // 적정 시재 PRD
  readonly diagnostics: {
    readonly order: ConsecutiveCheck | null;
    readonly rollForward: readonly string[];                   // 지금은 화면에 안 나옴 → 노출
  };
};

export function assessDashboard(previous: Statement | null, latest: Statement, base: Month): Dashboard;
```

- 지표마다 따로 `try`로 감싸 **한 지표의 실패가 다른 지표로 번지지 않게** 한다. 이 격리를 테스트로 보호한다.
- 오류 모델을 `Outcome`으로 통일한다. 화면의 `X | string | null` 분기를 없애고, 화면은 표시만 한다.
- 롤포워드 진단 결과를 경고 배너로 노출한다. 판정은 막지 않는다.
- 테스트: 지표별 성공/실패 조합, 이전 회차 없음, 순서 경고, 롤포워드 경고.

## 3. 비범위

- 정책을 엑셀 기준표에서 읽어 오기(D6 후속). 이번에는 코드 안에서 지표별로 나누기만 한다.
- 지표 공통 인터페이스(D5). 판정 형태가 4단계와 T/F로 갈리므로, 공통화하지 않는 쪽이 분리 요구에도 맞다.
