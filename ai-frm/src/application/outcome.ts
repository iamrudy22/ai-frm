/**
 * 유스케이스가 돌려주는 실패의 모양 — 성공 값 또는 사람이 읽을 사유.
 *
 * 조립 단계에서 던진 오류와 산식이 값으로 돌려준 판정 불가를 같은 모양으로
 * 모은다. 대시보드와 건설경기 인식 지수 유스케이스가 함께 쓴다.
 */

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export function succeed<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function fail<T>(reason: string): Outcome<T> {
  return { ok: false, reason };
}

/** 던진 오류를 실패 값으로 바꾼다. 실패가 여기서 멈춘다. */
export function settle<T>(run: () => Outcome<T>, fallback: string): Outcome<T> {
  try {
    return run();
  } catch (e) {
    return fail(e instanceof Error ? e.message : fallback);
  }
}

/** settle의 비동기판. 저장소·외부 조회처럼 기다리는 일에 쓴다. */
export async function settleAsync<T>(run: () => Promise<Outcome<T>>, fallback: string): Promise<Outcome<T>> {
  try {
    return await run();
  } catch (e) {
    return fail(e instanceof Error ? e.message : fallback);
  }
}
