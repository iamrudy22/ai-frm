/**
 * 조립 지점 — 포트에 구현을 끼운다. DI 컨테이너는 쓰지 않는다(DDD 검토 §10-3).
 *
 * 서버 전용 모듈(ECOS, 이력 파일)은 app/api/ 아래에서만 import한다(경계 규칙 6).
 * 인증키는 여기서만 환경변수에서 읽는다. NEXT_PUBLIC_ 접두어를 쓰지 않으므로
 * 브라우저 번들에 들어가지 않는다.
 */

import { resolve } from 'node:path';
import type { EconomicIndicatorSource, ForecastLedgerRepository } from '@/application/ports';
import { CachedIndicatorSource } from '@/infrastructure/ecos/cached-indicator-source';
import { EcosIndicatorSource } from '@/infrastructure/ecos/ecos-indicator-source';
import { FileLedgerRepository } from '@/infrastructure/ledger/file-ledger-repository';

/** 사내 데이터라 gitignore다. 되살릴 원천이 없으니 백업한다(README). */
const LEDGER_PATH = resolve(process.cwd(), 'data/forecast-ledger.json');

export function ledgerRepository(): ForecastLedgerRepository {
  return new FileLedgerRepository(LEDGER_PATH);
}

/** 기준월을 바꿀 때마다 ECOS를 다시 부르지 않도록 서버 프로세스에 하나만 둔다. */
const ECOS_CACHE_MS = 10 * 60 * 1000;
let cachedSource: EconomicIndicatorSource | null = null;

export function indicatorSource(): EconomicIndicatorSource {
  cachedSource ??= new CachedIndicatorSource(new EcosIndicatorSource(process.env.ECOS_API_KEY), ECOS_CACHE_MS);
  return cachedSource;
}
