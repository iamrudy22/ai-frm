import { describe, it, expect } from 'vitest';
import { money, percent, percentPoints } from '@/app/aifrm/format';

// 자금기획팀 엑셀과 같은 모양으로 보여 준다. 금액은 합성값이다.
describe('금액 표시 — 엑셀처럼 정수', () => {
  it('소수는 반올림해 정수로 보여 준다', () => {
    expect(money(1234.4)).toBe('1,234 억원');
    expect(money(1234.6)).toBe('1,235 억원');
  });

  it('0.5는 올린다 — 엑셀의 반올림과 같다', () => {
    expect(money(1234.5)).toBe('1,235 억원');
  });

  it('음수도 같은 규칙으로 보여 준다', () => {
    expect(money(-370.4)).toBe('-370 억원');
  });
});

describe('비율 표시', () => {
  it('퍼센트는 소수 첫째 자리까지 — 회의록의 169.0%와 같은 모양', () => {
    expect(percent(169)).toBe('169.0%');
  });
});

describe('금리 차이 표시', () => {
  it('%p로 셋째 자리까지 — 금리가 셋째 자리까지 온다', () => {
    expect(percentPoints(0.281)).toBe('0.281%p');
    expect(percentPoints(0.24)).toBe('0.240%p');
  });

  it('음수는 수학 기호 −', () => {
    expect(percentPoints(-0.05)).toBe('−0.050%p');
  });
});
