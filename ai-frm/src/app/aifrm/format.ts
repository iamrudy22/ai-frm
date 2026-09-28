/**
 * 화면 표시 형식. 계산에는 쓰지 않는다 — 금액은 도메인에서 소수까지 그대로 셈하고
 * 여기서만 모양을 정한다.
 *
 * 금액은 자금기획팀 엑셀처럼 정수로 보여 준다. 반올림은 0.5를 올리는
 * 방식(Intl 기본값)이라 엑셀의 표시와 같다.
 */

export const money = (n: number): string =>
  `${n.toLocaleString('ko-KR', { maximumFractionDigits: 0 })} 억원`;

export const percent = (n: number): string => `${n.toFixed(1)}%`;
