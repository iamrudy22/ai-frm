/**
 * 위험 등급과 구간 판정.
 *
 * 네 지표(건설경기 지수·대금 회수 위험·유동성 Gap·적정 시재)가 모두
 * "값 산출 → 구간 판정 → 4단계 등급" 구조라 등급은 도메인의 단일 개념이다.
 * 이전에는 Grade와 GapGrade로 두 번 선언돼 있었다.
 */

import type { Ratio } from '@/domain/shared/amount';

export type Grade = '정상' | '주의' | '경고' | '위기';

/** `atLeast` 이상이면 이 등급. 경계값은 포함한다(회의록의 "0.5 이상"). */
export type Band = { readonly atLeast: number; readonly grade: Grade };

/** 검증을 통과한 구간표. defineBands로만 만들 수 있다. */
export type GradeBands = readonly Band[] & { readonly __checked: unique symbol };

/**
 * 구간표를 검증해서 고정한다.
 *
 * 판정이 배열 순서에 조용히 의존하던 것을 불변식으로 바꾼다.
 * 전 구간을 덮도록 강제하므로 판정 불능이 생기지 않고,
 * 따라서 '위기' 같은 기본값을 코드에 박을 필요도 없다 — 정책은 구간표가 소유한다.
 */
export function defineBands(bands: readonly Band[]): GradeBands {
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

  return bands as GradeBands;
}

export function gradeBy(bands: GradeBands, value: Ratio): Grade {
  for (const band of bands) {
    if (value >= band.atLeast) return band.grade;
  }
  // defineBands가 전 구간을 덮도록 보장하므로 여기에 닿지 않는다.
  throw new Error(`판정할 수 없는 값입니다: ${value}`);
}
