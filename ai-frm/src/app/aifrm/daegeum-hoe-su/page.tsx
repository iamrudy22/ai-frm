'use client';

import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';

// ── 상수 ────────────────────────────────────────────────────────────────

/** 대금 회수 위험 판정에 쓸 시트명 */
const TARGET_SHEET = '12_26년자금수지표(본운영반영)';

/** '수입' 라벨이 있는 셀 */
const LABEL_REF = 'A7';

/** 7월 수입값을 읽는 셀 (8월 시점 기준: 8월 파일에서 K7 = 7월 실적, 7월 파일에서 K7 = 7월 계획) */
const VALUE_CELL_REF = 'K7';

/** 회수율 구간별 등급 */
type Grade = '정상' | '주의' | '경고' | '위기';

const GRADE_BREAKPOINTS: Array<{ threshold: number; grade: Grade }> = [
  { threshold: 0.9, grade: '정상' },
  { threshold: 0.8, grade: '주의' },
  { threshold: 0.7, grade: '경고' },
];

const GRADE_COMMENTS: Record<Grade, string> = {
  정상: '계획 대비 실적이 양호합니다.',
  주의: '계획 대비 실적이 다소 낮습니다. 추이를 확인하세요.',
  경고: '계획 대비 실적 미달이 분명합니다. 원인을 점검하세요.',
  위기: '계획 대비 실적 미달이 큽니다. 즉시 대응이 필요합니다.',
};

// ── 타입 ────────────────────────────────────────────────────────────────

type ParseResult =
  | { kind: 'ok'; plan: number; actual: number; rate: number; grade: Grade }
  | { kind: 'error'; message: string };

// ── 파싱·계산 로직 ──────────────────────────────────────────────────────

function readTargetCellValue(
  workbook: XLSX.WorkBook,
  valueCellRef: string,
  sheetName: string,
): number | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;

  // xlsx는 셀 reference 키로 접근 (예: K7 → workbook.Sheets[sheet]['K7'])
  const cell = sheet[valueCellRef];
  if (!cell) return null;
  if (cell.t === 's') return null; // 문자열 셀이면 숫자 아님
  const v = cell.v;
  if (v === undefined || v === null || v === '') return null;
  const num = Number(v);
  if (!Number.isFinite(num)) return null;
  return num;
}

function findTargetSheetName(workbook: XLSX.WorkBook): string | null {
  // 시트 목록에서 목표 시트명 정확히 찾기
  for (const name of Object.keys(workbook.Sheets)) {
    if (name === TARGET_SHEET) return name;
  }
  return null;
}

/**
 * 업로드된 엑셀 파일 2개(계획/실적)에서 '수입' K7 값을 읽어 회수율과 등급을 계산한다.
 * - 계획 파일: 7월 자금수지표 (K7 = 7월 계획값)
 * - 실적 파일: 8월 자금수지표 (K7 = 7월 실적값)
 */
function computeFromFiles(
  planBuffer: ArrayBuffer,
  actualBuffer: ArrayBuffer,
): ParseResult {
  let planBook: XLSX.WorkBook | null = null;
  let actualBook: XLSX.WorkBook | null = null;

  try {
    planBook = XLSX.read(planBuffer, { type: 'array' });
  } catch (e) {
    return { kind: 'error', message: '계획 파일 파싱에 실패했습니다.' };
  }

  try {
    actualBook = XLSX.read(actualBuffer, { type: 'array' });
  } catch (e) {
    return { kind: 'error', message: '실적 파일 파싱에 실패했습니다.' };
  }

  const planSheet = findTargetSheetName(planBook);
  if (!planSheet) {
    return { kind: 'error', message: `계획 파일에서 시트 "${TARGET_SHEET}"를 찾을 수 없습니다.` };
  }

  const actualSheet = findTargetSheetName(actualBook);
  if (!actualSheet) {
    return { kind: 'error', message: `실적 파일에서 시트 "${TARGET_SHEET}"를 찾을 수 없습니다.` };
  }

  // '수입' 라벨(A7) 확인
  const planLabelCell = planBook.Sheets[planSheet][LABEL_REF];
  const actualLabelCell = actualBook.Sheets[actualSheet][LABEL_REF];

  if (!planLabelCell || planLabelCell.t !== 's' || planLabelCell.v !== '수입') {
    return { kind: 'error', message: `계획 파일에서 "${LABEL_REF}" 셀의 값이 "수입"이 아닙니다.` };
  }
  if (!actualLabelCell || actualLabelCell.t !== 's' || actualLabelCell.v !== '수입') {
    return { kind: 'error', message: `실적 파일에서 "${LABEL_REF}" 셀의 값이 "수입"이 아닙니다.` };
  }

  const planValue = readTargetCellValue(planBook, VALUE_CELL_REF, planSheet);
  if (planValue === null) {
    return { kind: 'error', message: `계획 파일의 "${VALUE_CELL_REF}" 셀에서 숫자 값을 읽을 수 없습니다.` };
  }

  const actualValue = readTargetCellValue(actualBook, VALUE_CELL_REF, actualSheet);
  if (actualValue === null) {
    return { kind: 'error', message: `실적 파일의 "${VALUE_CELL_REF}" 셀에서 숫자 값을 읽을 수 없습니다.` };
  }

  if (planValue === 0) {
    return { kind: 'error', message: '계획값이 0이어서 회수율을 계산할 수 없습니다.' };
  }

  const rate = actualValue / planValue;

  // 등급 판정
  let grade: Grade = '위기';
  for (const { threshold, grade: g } of GRADE_BREAKPOINTS) {
    if (rate >= threshold) {
      grade = g;
      break;
    }
  }

  return {
    kind: 'ok',
    plan: planValue,
    actual: actualValue,
    rate,
    grade,
  };
}

// ── 표시 헬퍼 ───────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatRate(r: number): string {
  return (r * 100).toFixed(1) + '%';
}

// ── 페이지 컴포넌트 ─────────────────────────────────────────────────────

export default function DaegeumHoeSuPage() {
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [actualFile, setActualFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);

  const handlePlanChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setPlanFile(file);
    setResult(null);
  }, []);

  const handleActualChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setActualFile(file);
    setResult(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!planFile || !actualFile) {
      setResult({ kind: 'error', message: '계획 파일과 실적 파일을 모두 올려 주세요.' });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const planBuffer = await planFile.arrayBuffer();
      const actualBuffer = await actualFile.arrayBuffer();
      const res = computeFromFiles(planBuffer, actualBuffer);
      setResult(res);
    } catch (e) {
      setResult({ kind: 'error', message: '처리 중 오류가 발생했습니다.' });
    } finally {
      setLoading(false);
    }
  }, [planFile, actualFile]);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-6">대금 회수 위험 판정</h1>

      {/* 업로드 영역 */}
      <div className="space-y-6">
        <section className="space-y-2">
          <h2 className="text-lg font-medium">업로드할 파일</h2>

          <label className="block border border-gray-300 rounded-lg p-4 cursor-pointer hover:bg-gray-50">
            <span className="text-sm text-gray-500">계획 파일 · 7월 자금수지표 (예: 0708_v1)</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handlePlanChange}
              className="hidden"
              id="plan-file-input"
            />
            <label htmlFor="plan-file-input" className="cursor-pointer mt-2 inline-block text-sm text-blue-600">
              {planFile ? `선택됨: ${planFile.name}` : '파일 선택'}
            </label>
          </label>

          <label className="block border border-gray-300 rounded-lg p-4 cursor-pointer hover:bg-gray-50">
            <span className="text-sm text-gray-500">실적 파일 · 8월 자금수지표 (예: 0818_v1) — 7월 실적 포함</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleActualChange}
              className="hidden"
              id="actual-file-input"
            />
            <label htmlFor="actual-file-input" className="cursor-pointer mt-2 inline-block text-sm text-blue-600">
              {actualFile ? `선택됨: ${actualFile.name}` : '파일 선택'}
            </label>
          </label>
        </section>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !planFile || !actualFile}
          className="w-full bg-blue-600 text-white rounded-lg py-2 px-4 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition"
        >
          {loading ? '처리 중…' : '판정하기'}
        </button>
      </div>

      {/* 결과 영역 */}
      {result && (
        <section className="mt-8 border-t border-gray-200 pt-6">
          <h2 className="text-lg font-medium mb-4">결과</h2>

          {result.kind === 'error' ? (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">
              {result.message}
            </div>
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-gray-500">판정 기준월</dt>
                  <dd className="font-medium">7월</dd>
                </div>
                <div>
                  <dt className="text-gray-500">기준 설명</dt>
                  <dd className="font-medium">7월 계획 대비 7월 실적</dd>
                </div>
                <div>
                  <dt className="text-gray-500">계획값</dt>
                  <dd className="font-medium">{formatNumber((result as { kind: 'ok'; plan: number }).plan)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">실적값</dt>
                  <dd className="font-medium">{formatNumber((result as { kind: 'ok'; actual: number }).actual)}</dd>
                </div>
              </dl>

              <div className="bg-gray-50 rounded-lg p-4">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-gray-500">회수율</dt>
                    <dd className="font-medium">
                      {formatRate((result as { kind: 'ok'; rate: number }).rate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">판정 등급</dt>
                    <dd className="font-medium">
                      {(result as { kind: 'ok'; grade: Grade }).grade}
                    </dd>
                  </div>
                </dl>
              </div>

              <p className="text-sm text-gray-600">
                판정 근거: 회수율{' '}
                {formatRate((result as { kind: 'ok'; rate: number }).rate)} →{' '}
                {(result as { kind: 'ok'; grade: Grade }).grade} 구간
              </p>

              <p className="text-sm text-gray-700 italic">
                {GRADE_COMMENTS[(result as { kind: 'ok'; grade: Grade }).grade]}
              </p>
            </div>
          )}
        </section>
      )}

      {/* 안내 */}
      <p className="mt-8 text-xs text-gray-400">
        안내: 계획 파일은 7월 자금수지표, 실적 파일은 8월 자금수지표(7월 실적 포함)를 올려 주세요.
        두 파일 모두 시트명 《12_26년자금수지표(본운영반영)》에서 '수입'(A7)의 K7 값을 읽어 판정합니다.
      </p>
    </div>
  );
}
