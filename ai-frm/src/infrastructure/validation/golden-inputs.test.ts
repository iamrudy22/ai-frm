import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(process.cwd(), 'scripts/check-golden-inputs.mjs');
const LATEST = 'fixtures/자금수지표-최신회차.xlsx';
const ROUNDS = 'fixtures/자금수지표';
const CSV_PATHS = [
  'fixtures/건설경기인식지수-원값.csv',
  'fixtures/분양회수-오차율-엑셀.csv',
  'fixtures/건설경기인식지수-엑셀결과.csv',
  'fixtures/건설경기인식지수-기대값.csv',
];
const CONTENT = 'SYNTHETIC_PRIVATE_CONTENT_DO_NOT_PRINT';

type Report = {
  scope: string;
  inputsReady: boolean;
  numericValidation: string;
  pdfGoldenComparison: string;
  requiredInputs: { path: string; status: string }[];
  rounds: { path: string; status: string; usableFileCount: number; compositionVerified: boolean };
  validationGroups: {
    latestStatement: { inputsReady: boolean };
    statementRounds: { inputsReady: boolean };
    forecastError: { inputsReady: boolean };
    constructionWorkbook: { inputsReady: boolean };
    constructionPerception: { inputsReady: boolean };
  };
  error?: string;
};

describe('골든 입력 준비 점검 CLI — 합성 메타데이터', () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(resolve(tmpdir(), 'golden-inputs-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  function put(path: string, content = CONTENT) {
    const absolute = resolve(cwd, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }

  function prepare(roundCount = 8) {
    [LATEST, ...CSV_PATHS].forEach((path) => put(path));
    mkdirSync(resolve(cwd, ROUNDS), { recursive: true });
    for (let i = 0; i < roundCount; i++) put(`${ROUNDS}/private-round-${i}.xlsx`);
  }

  function run() {
    const result = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout) as Report;
    expect(report.scope).toBe('fixture-input-metadata');
    expect(report.numericValidation).toBe('not-run');
    expect(report.pdfGoldenComparison).toBe('not-run');
    expect(result.stdout).not.toContain(CONTENT);
    expect(result.stdout).not.toContain('private-round-');
    expect(result.stdout).not.toContain(cwd);
    return { report, status: result.status, stdout: result.stdout };
  }

  it('자료가 전부 없으면 모든 검증군을 미준비로 두고 exit 2를 반환한다', () => {
    const { report, status } = run();
    expect(status).toBe(2);
    expect(report.inputsReady).toBe(false);
    expect(report.requiredInputs).toEqual([LATEST, ...CSV_PATHS].map((path) => ({ path, status: 'missing' })));
    expect(report.rounds).toEqual({ path: ROUNDS, status: 'missing', usableFileCount: 0, compositionVerified: false });
    expect(report.validationGroups).toEqual({
      latestStatement: { inputsReady: false }, statementRounds: { inputsReady: false },
      forecastError: { inputsReady: false }, constructionWorkbook: { inputsReady: false },
      constructionPerception: { inputsReady: false },
    });
  });

  it('읽을 수 있는 비어 있지 않은 파일이 모두 있으면 내용 해석 없이 exit 0을 반환한다', () => {
    prepare();
    const { report, status } = run();
    expect(status).toBe(0);
    expect(report.inputsReady).toBe(true);
    expect(report.requiredInputs.every(({ status }) => status === 'ready')).toBe(true);
    expect(report.rounds).toEqual({ path: ROUNDS, status: 'ready', usableFileCount: 8, compositionVerified: false });
    expect(Object.values(report.validationGroups).every(({ inputsReady }) => inputsReady)).toBe(true);
  });

  it.each([LATEST, ...CSV_PATHS])('빈 필수 파일 %s는 준비된 입력에서 제외한다', (path) => {
    prepare();
    put(path, '');
    const { report, status } = run();
    expect(status).toBe(2);
    expect(report.inputsReady).toBe(false);
    expect(report.requiredInputs.find((input) => input.path === path)?.status).toBe('empty');
  });

  it('필수 파일 이름을 가진 디렉터리는 파일로 인정하지 않는다', () => {
    prepare();
    rmSync(resolve(cwd, LATEST));
    mkdirSync(resolve(cwd, LATEST));
    const { report, status } = run();
    expect(status).toBe(2);
    expect(report.requiredInputs[0].status).toBe('not-regular-file');
    expect(report.validationGroups.latestStatement.inputsReady).toBe(false);
    expect(report.validationGroups.constructionPerception.inputsReady).toBe(true);
  });

  it('소문자 .xlsx인 비어 있지 않은 regular file 회차만 센다', () => {
    prepare(1);
    put(`${ROUNDS}/UPPER.XLSX`);
    put(`${ROUNDS}/suffix.xlsx.bak`);
    put(`${ROUNDS}/empty.xlsx`, '');
    mkdirSync(resolve(cwd, `${ROUNDS}/directory.xlsx`));
    const { report, status } = run();
    expect(status).toBe(2);
    expect(report.rounds.usableFileCount).toBe(1);
    expect(report.validationGroups.statementRounds.inputsReady).toBe(true);
    expect(report.validationGroups.forecastError.inputsReady).toBe(false);
  });

  it('일곱 회차는 회차 판독만 준비되며 예측오차는 미준비다', () => {
    prepare(7);
    const { report, status } = run();
    expect(status).toBe(2);
    expect(report.rounds.usableFileCount).toBe(7);
    expect(report.validationGroups.statementRounds.inputsReady).toBe(true);
    expect(report.validationGroups.forecastError.inputsReady).toBe(false);
  });

  it('세 추출 CSV만 있으면 건설경기 원본 대조는 준비되지만 전체는 exit 2다', () => {
    prepare();
    rmSync(resolve(cwd, CSV_PATHS[3]));
    const { report, status } = run();
    expect(status).toBe(2);
    expect(report.inputsReady).toBe(false);
    expect(report.validationGroups.constructionWorkbook.inputsReady).toBe(true);
    expect(report.validationGroups.constructionPerception.inputsReady).toBe(false);
    expect(report.validationGroups.forecastError.inputsReady).toBe(true);
  });

  it.each(CSV_PATHS.slice(0, 3))('추출 CSV %s가 없으면 건설경기 원본 대조도 미준비다', (path) => {
    prepare();
    rmSync(resolve(cwd, path));
    const { report, status } = run();
    expect(status).toBe(2);
    expect(report.validationGroups.constructionWorkbook.inputsReady).toBe(false);
    expect(report.validationGroups.constructionPerception.inputsReady).toBe(false);
  });

  it('오차율 CSV가 없으면 회차 수가 충분해도 예측오차는 미준비다', () => {
    prepare();
    rmSync(resolve(cwd, CSV_PATHS[1]));
    const { report, status } = run();
    expect(status).toBe(2);
    expect(report.validationGroups.forecastError.inputsReady).toBe(false);
  });

  it('회차 경로가 파일이면 회차 검증군을 준비하지 않는다', () => {
    prepare();
    rmSync(resolve(cwd, ROUNDS), { recursive: true });
    put(ROUNDS);
    const { report, status } = run();
    expect(status).toBe(2);
    expect(report.rounds.status).toBe('not-directory');
    expect(report.rounds.usableFileCount).toBe(0);
  });

  it.skipIf(process.getuid?.() === 0)('읽을 수 없는 필수 파일과 회차를 준비에서 제외한다', () => {
    prepare();
    const latest = resolve(cwd, LATEST);
    const round = resolve(cwd, `${ROUNDS}/private-round-0.xlsx`);
    chmodSync(latest, 0);
    chmodSync(round, 0);
    try {
      const { report, status } = run();
      expect(status).toBe(2);
      expect(report.requiredInputs[0].status).toBe('unreadable');
      expect(report.rounds.usableFileCount).toBe(7);
    } finally {
      chmodSync(latest, 0o600);
      chmodSync(round, 0o600);
    }
  });

  it('예기치 않은 메타데이터 오류는 예외와 파일명을 숨긴 JSON 및 exit 1을 반환한다', () => {
    prepare();
    const privateName = 'SYNTHETIC_SECRET_LOOP.xlsx';
    symlinkSync(privateName, resolve(cwd, ROUNDS, privateName));
    const { report, status, stdout } = run();
    expect(status).toBe(1);
    expect(report.inputsReady).toBe(false);
    expect(report.error).toBe('metadata-check-failed');
    expect(stdout).not.toContain(privateName);
    expect(stdout).not.toMatch(/ELOOP|statSync|Error:|stack/);
  });
});
