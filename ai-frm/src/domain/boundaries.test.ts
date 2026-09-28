/**
 * 도메인 경계 — 지표별 정책 분리를 약속이 아니라 테스트로 지킨다.
 *
 * 규칙
 *   1. risk/<지표>/ 아래 파일은 다른 지표 폴더를 import하지 않는다.
 *   2. risk/<지표>/policy.ts는 risk/grade와 domain/shared만 import한다.
 *   3. domain/ 아래 어떤 파일도 바깥 계층(application·infrastructure·app)과 xlsx를 모른다.
 *
 * 검사 범위: 정적 `import … from '…'`, `export … from '…'`, 부수효과 `import '…'`,
 * 동적 `import('…')`. 이 코드베이스에 그 밖의 모듈 적재 방식은 없다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';

type SourceFile = { readonly path: string; readonly source: string };

const INDICATOR = /^domain\/risk\/([^/]+)\//;
const OUTER_LAYERS = ['application/', 'infrastructure/', 'app/'];
const FORBIDDEN_PACKAGES = ['xlsx'];
const POLICY_MAY_IMPORT = [/^domain\/risk\/grade$/, /^domain\/shared\//];

const IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function specifiersOf(source: string): string[] {
  return IMPORT_PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((m) => m[1]));
}

/** src 기준 posix 경로로 푼다. 패키지면 null. */
function resolveInternal(from: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) return posix.normalize(posix.join(posix.dirname(from), specifier));
  return null;
}

function indicatorOf(path: string): string | null {
  return INDICATOR.exec(path)?.[1] ?? null;
}

function violations(files: readonly SourceFile[]): string[] {
  const found: string[] = [];

  for (const { path, source } of files) {
    if (!path.startsWith('domain/')) continue;
    const own = indicatorOf(path);
    const isPolicy = own !== null && path === `domain/risk/${own}/policy.ts`;

    for (const specifier of specifiersOf(source)) {
      const target = resolveInternal(path, specifier);

      if (target === null) {
        if (FORBIDDEN_PACKAGES.includes(specifier)) {
          found.push(`${path} → ${specifier}: 도메인은 ${specifier}를 모른다`);
        } else if (isPolicy && specifier !== 'vitest') {
          found.push(`${path} → ${specifier}: 정책은 외부 패키지에 기대지 않는다`);
        }
        continue;
      }

      if (OUTER_LAYERS.some((layer) => target.startsWith(layer))) {
        found.push(`${path} → ${specifier}: 도메인은 바깥 계층을 모른다`);
        continue;
      }

      // 폴더 안의 모듈을 가리킬 때만 지표다. risk/grade 같은 파일은 지표가 아니다.
      const other = indicatorOf(target);
      if (own !== null && other !== null && other !== own) {
        found.push(`${path} → ${specifier}: 지표 '${own}'가 지표 '${other}'에 기댄다`);
        continue;
      }

      if (isPolicy && !POLICY_MAY_IMPORT.some((allowed) => allowed.test(target))) {
        found.push(`${path} → ${specifier}: 정책은 risk/grade와 shared만 쓴다`);
      }
    }
  }

  return found;
}

// ── 실제 소스 ─────────────────────────────────────────────────────────────

const SRC = resolve(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

const SELF = 'domain/boundaries.test.ts';

// 이 파일은 위반 예시를 문자열로 품고 있으므로 검사 대상에서 뺀다.
const sources: SourceFile[] = walk(join(SRC, 'domain'))
  .map((full) => ({
    path: relative(SRC, full).split(sep).join('/'),
    source: readFileSync(full, 'utf8'),
  }))
  .filter((f) => f.path !== SELF);

const indicators = [...new Set(sources.map((f) => indicatorOf(f.path)).filter((x) => x !== null))];

// ── 검사기 자체 ───────────────────────────────────────────────────────────

describe('경계 검사기', () => {
  const file = (path: string, source: string): SourceFile => ({ path, source });

  it('다른 지표 폴더 import를 잡는다 — 절대 경로', () => {
    const v = violations([
      file('domain/risk/liquidity-gap/liquidity-gap.ts', `import { X } from '@/domain/risk/payment-recovery/policy';`),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/liquidity-gap.*payment-recovery/);
  });

  it('다른 지표 폴더 import를 잡는다 — 상대 경로', () => {
    const v = violations([
      file('domain/risk/liquidity-gap/liquidity-gap.ts', `import { X } from '../payment-recovery/policy';`),
    ]);
    expect(v).toHaveLength(1);
  });

  it('여러 줄 import와 type import도 잡는다', () => {
    const v = violations([
      file(
        'domain/risk/liquidity-gap/liquidity-gap.ts',
        `import type {\n  A,\n  B,\n} from '@/domain/risk/payment-recovery/payment-recovery';`,
      ),
    ]);
    expect(v).toHaveLength(1);
  });

  it('정책이 grade·shared 밖을 쓰면 잡는다', () => {
    const v = violations([
      file('domain/risk/liquidity-gap/policy.ts', `import { windowFrom } from '@/domain/cashflow/statement';`),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/정책/);
  });

  it('도메인이 바깥 계층이나 xlsx를 쓰면 잡는다', () => {
    const v = violations([
      file('domain/shared/amount.ts', `import * as XLSX from 'xlsx';`),
      file('domain/cashflow/statement.ts', `import { readStatement } from '@/infrastructure/xlsx/statement-reader';`),
    ]);
    expect(v).toHaveLength(2);
  });

  it('제 폴더, 등급 도구, 회차, 금액을 쓰는 것은 허용한다', () => {
    const v = violations([
      file(
        'domain/risk/liquidity-gap/liquidity-gap.ts',
        [
          `import { gradeBy } from '@/domain/risk/grade';`,
          `import { LIQUIDITY_GAP_BANDS } from './policy';`,
          `import { windowFrom } from '@/domain/cashflow/statement';`,
          `import { sumOf } from '@/domain/shared/amount';`,
        ].join('\n'),
      ),
      file(
        'domain/risk/liquidity-gap/policy.ts',
        `import { defineBands } from '@/domain/risk/grade';\nimport type { Ratio } from '../../shared/amount';`,
      ),
    ]);
    expect(v).toEqual([]);
  });
});

// ── 실제 소스에 적용 ──────────────────────────────────────────────────────

describe('도메인 경계', () => {
  // 경로를 잘못 잡아 아무것도 훑지 않고 통과하는 일을 막는다.
  it('지표 폴더를 둘 이상 찾는다', () => {
    expect(indicators.length).toBeGreaterThanOrEqual(2);
  });

  it('지표마다 정책 파일이 있다 — 정책이 공용 파일로 되돌아가지 않는다', () => {
    for (const indicator of indicators) {
      expect(sources.some((f) => f.path === `domain/risk/${indicator}/policy.ts`)).toBe(true);
    }
    expect(sources.some((f) => f.path === 'domain/risk/policy.ts')).toBe(false);
  });

  it('위반이 없다', () => {
    expect(violations(sources)).toEqual([]);
  });
});
