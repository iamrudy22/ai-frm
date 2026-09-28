/**
 * 적정 시재 판정 정책 — LCR 가중치와 판정 표기.
 *
 * 정본: 2026-09-28 정책 확정 (docs/plans/2026-09-28-jeokjeong-sijae-prd.md §4-1, §9)
 *
 * 적정 시재에는 등급이 없다. 현재시재가 적정시재 이상이면 T('안정적'),
 * 아니면 F('적정시재 부족')다. 구간표·등급별 코멘트·등급 색이 없고,
 * 그래서 risk/grade를 쓰지 않는다. 이 약속은 src/boundaries.test.ts가 지킨다.
 *
 * 이 지표의 정책은 이 파일만 소유한다. 다른 지표의 정책과 한 파일에 두지 않는다
 * (docs/plans/2026-09-28-jipyo-bunri-plan.md).
 */

/**
 * 3개월 합계에 곱하는 가중치. 네 항을 모두 더한 값이 적정시재다.
 *
 * - 수지차는 지출 − 수입(시트 '수입' 행)이다. 시트의 '수지차' 행과 부호가 반대다.
 * - 자금조달은 정책상 산식에서 뺐다. 그래서 가중치가 없다.
 * - 가중치 합이 1이 아닌 것도 정책이 정한 그대로다.
 */
export const LCR_WEIGHTS = {
  분양회수: 0.2,
  기타수입: 0.1,
  지출: 0.1,
  수지차: 0.4,
} as const;

export type LcrComponent = keyof typeof LCR_WEIGHTS;

export function verdictLabel(isAdequate: boolean): '안정적' | '적정시재 부족' {
  return isAdequate ? '안정적' : '적정시재 부족';
}
