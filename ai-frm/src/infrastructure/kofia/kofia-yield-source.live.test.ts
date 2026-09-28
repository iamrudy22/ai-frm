/**
 * 실제 채권정보센터를 부르는 확인 — 사이트의 응답 형식이 그대로인지 본다.
 *
 * 공개 API가 아니라 사이트 개편 때 깨질 수 있다. 평소에는 건너뛴다(네트워크를 부르지 않는다).
 * 확인하려면: KOFIA_LIVE=1 npx vitest run src/infrastructure/kofia
 *
 * 과거 달의 시가평가는 바뀌지 않으므로 녹화 fixture와 같은 값을 기대한다.
 */
import { describe, it, expect } from 'vitest';
import { KofiaYieldSource } from '@/infrastructure/kofia/kofia-yield-source';
import { parseYearMonth } from '@/domain/shared/year-month';

describe.skipIf(process.env.KOFIA_LIVE !== '1')('채권정보센터 실제 호출', () => {
  it('2026/07/31 공사채 AAA 3.674, 국고채 3.393 (3사 평균)', async () => {
    const result = await new KofiaYieldSource().dailyYields(parseYearMonth('2026/07'));
    if ('error' in result) throw new Error(result.error);
    const july31 = result.days.find((d) => d.date === '2026/07/31');
    expect(july31?.publicAaa.average).toBe(3.674);
    expect(july31?.treasury.average).toBe(3.393);
    expect(july31?.publicAaa.byAgency).toEqual({ 나이스피앤아이: 3.68, 한국자산평가: 3.665, KIS자산평가: 3.679 });
  }, 20_000);
});
