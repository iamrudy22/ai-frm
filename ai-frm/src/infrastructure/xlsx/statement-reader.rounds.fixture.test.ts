/**
 * 2026년 1~8월 회차를 모두 읽는다 — 1·2월 회차는 잠정운영기준 시트다.
 *
 * 사내 자금 데이터라 커밋하지 않는다(.gitignore). 폴더가 없으면 건너뛴다.
 * 파일을 두려면: ai-frm/fixtures/자금수지표/2026년 N,N+1,N+2월 계획*.xlsx
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readStatement } from '@/infrastructure/xlsx/statement-reader';
import { calendarOf } from '@/domain/cashflow/statement';

const DIR = resolve(process.cwd(), 'fixtures/자금수지표');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.xlsx')).sort() : [];

describe.skipIf(files.length === 0)('2026년 회차 판독', () => {
  it.each(files)('%s — 기준월이 파일 이름의 첫 달이고 분양회수를 읽는다', (file) => {
    const month = Number(/^2026년 (\d+),/.exec(file)?.[1]);
    const data = readFileSync(resolve(DIR, file));
    const result = readStatement(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    if (!result.ok) throw new Error(result.error);
    const s = result.statement;
    expect(s.defaultBaseMonth.label).toBe(`${month}월`);
    expect(calendarOf(s, s.defaultBaseMonth)).toBe(`2026/${String(month).padStart(2, '0')}`);
    expect(s.unreadableItems().map((u) => u.item)).not.toContain('분양회수');
  }, 60_000);
});
