/**
 * 금액과 비율을 타입으로 가른다.
 *
 * 둘 다 number라서 생긴 사고가 있었다 — 금액(억원)을 회수율로 착각해
 * `v >= 0.9`로 등급을 매기는 코드가 있었고, 타입이 막아 주지 못했다.
 * 브랜드 타입은 런타임 비용이 없으면서 그 혼동을 컴파일 단계에서 끊는다.
 */

declare const unit: unique symbol;

/** 자금수지표의 금액. 단위는 억원. */
export type Amount = number & { readonly [unit]: '억원' };

/** 비율. 0.9 = 90%, 1.69 = 169%. 회의록의 등급 기준이 비율이므로 여기에 맞춘다. */
export type Ratio = number & { readonly [unit]: 'ratio' };

function assertFinite(n: number, what: string): void {
  if (!Number.isFinite(n)) {
    throw new Error(`${what}는 유한한 수여야 합니다: ${n}`);
  }
}

export function amount(n: number): Amount {
  assertFinite(n, '금액');
  return n as Amount;
}

export function ratio(n: number): Ratio {
  assertFinite(n, '비율');
  return n as Ratio;
}

export function sumOf(amounts: readonly Amount[]): Amount {
  return amount(amounts.reduce<number>((a, b) => a + b, 0));
}

export function minus(a: Amount, b: Amount): Amount {
  return amount(a - b);
}

/**
 * 금액 × 가중치 = 금액. 적정 시재 LCR 모델처럼 항목에 비중을 줄 때 쓴다.
 *
 * 가중치는 비율(Ratio)이 아니다. 비율은 금액 ÷ 금액으로만 만들어지는 판정값이고,
 * 가중치는 정책이 정한 계수다. 둘을 섞으면 회수율을 가중치로 쓰는 실수가 열린다.
 */
export function scale(a: Amount, weight: number): Amount {
  if (!Number.isFinite(weight)) {
    throw new Error(`가중치는 유한한 수여야 합니다: ${weight}`);
  }
  return amount(a * weight);
}

/** 금액 ÷ 금액 = 비율. 이 방향으로만 비율이 만들어진다. */
export function divide(numerator: Amount, denominator: Amount): Ratio {
  if (denominator === 0) {
    throw new Error('0으로 나눌 수 없습니다.');
  }
  return ratio(numerator / denominator);
}

/** 표시용. 저장·판정은 비율로 하고 화면에서만 퍼센트로 바꾼다. */
export function toPercent(r: Ratio): number {
  return r * 100;
}
