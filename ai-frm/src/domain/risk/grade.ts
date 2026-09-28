/**
 * 위험 등급과 구간 판정.
 *
 * 등급을 매기는 지표(대금 회수 위험·유동성 Gap)는 "값 산출 → 구간 판정 →
 * 4단계 등급" 구조라 등급 어휘와 판정 도구를 여기서 함께 쓴다.
 * 이전에는 Grade와 GapGrade로 두 번 선언돼 있었다.
 *
 * 이 파일은 도구다. 구간 값과 코멘트 같은 정책은 각 지표 폴더의 policy.ts가
 * 따로 소유한다. 적정 시재에는 등급이 없다 — T/F와 '안정적'/'적정시재 부족'
 * 표기만 있으므로 이 파일을 쓰지 않는다.
 */

import type { Ratio } from '@/domain/shared/amount';

export type Grade = '정상' | '주의' | '경고' | '위기';

/** `atLeast` 이상이면 이 등급. 경계값은 포함한다(회의록의 "0.5 이상"). */
export type Band = { readonly atLeast: number; readonly grade: Grade };

/**
 * 검증을 통과한 구간표. defineBands로만 만들 수 있다.
 *
 * `T`는 이 구간표가 판정하는 값의 종류다. 기본은 비율이다. 건설경기 인식 지수의
 * 0~100 지수처럼 비율이 아닌 판정값은 제 타입으로 구간표를 만든다. 종류가 다른
 * 값을 넣으면 컴파일에서 막힌다 — 금액을 회수율로 착각한 사고(D2)와 같은 혼동이다.
 */
export type GradeBands<T extends number = Ratio> = readonly Band[] & {
  readonly __checked: unique symbol;
  readonly __value?: T;
};

/**
 * 구간표를 검증해서 고정한다.
 *
 * 판정이 배열 순서에 조용히 의존하던 것을 불변식으로 바꾼다.
 * 전 구간을 덮도록 강제하므로 판정 불능이 생기지 않고,
 * 따라서 '위기' 같은 기본값을 코드에 박을 필요도 없다 — 정책은 구간표가 소유한다.
 */
export function defineBands<T extends number = Ratio>(bands: readonly Band[]): GradeBands<T> {
  if (bands.length === 0) {
    throw new Error('구간표가 비어 있습니다.');
  }

  for (let i = 1; i < bands.length; i++) {
    if (bands[i].atLeast >= bands[i - 1].atLeast) {
      throw new Error(
        `구간표는 내림차순이어야 합니다: ${bands[i - 1].atLeast} 다음에 ${bands[i].atLeast}`,
      );
    }
  }

  if (bands[bands.length - 1].atLeast !== Number.NEGATIVE_INFINITY) {
    throw new Error(
      '구간표가 전 구간을 덮지 않습니다. 마지막 구간의 atLeast는 -Infinity여야 합니다.',
    );
  }

  return bands as GradeBands<T>;
}

export function gradeBy<T extends number>(bands: GradeBands<T>, value: NoInfer<T>): Grade {
  for (const band of bands) {
    if (value >= band.atLeast) return band.grade;
  }
  // defineBands가 전 구간을 덮도록 보장하므로 여기에 닿지 않는다.
  throw new Error(`판정할 수 없는 값입니다: ${value}`);
}
