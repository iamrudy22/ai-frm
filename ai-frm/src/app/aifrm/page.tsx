'use client';

import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';

// ── 상수 ─────────────────────────────────────────────────────────────────

const TARGET_SHEET = '12_26년자금수지표(본운영반영)';
const LABEL_REF = 'A7';

const GAP_MONTH_COLS = ['L', 'M', 'N'] as const; // 8월, 9월, 10월
const GAP_OPENING_ROW = 5; // 기초시재
const GAP_INCOME_ROW = 7;  // 수입 (운영)
const GAP_EXPENSE_ROW = 41; // 지출

// 유동성 Gap 판정 기준 (PRD 4장)
type GapGrade = '정상' | '주의' | '경고' | '위기';
const GAP_BREAKPOINTS: Array<{ threshold: number; grade: GapGrade }> = [
  { threshold: 50, grade: '정상' },
  { threshold: 25, grade: '주의' },
  { threshold: 15, grade: '경고' },
];
const GAP_COMMENTS: Record<GapGrade, string> = {
  정상: '현재 시재로 3개월 순유출을 충분히 커버할 수 있습니다.',
  주의: '시재 여유가 줄고 있습니다. 추이를 확인하세요.',
  경고: '시재 압박이 보입니다. 자금 계획을 점검하세요.',
  위기: '시재가 3개월 순유출에 크게 못 미칩니다. 즉시 대응이 필요합니다.',
};

// ── 타입 ──────────────────────────────────────────────────────────────────

type RecoveryResult =
  | { kind: 'ok'; plan: number; actual: number; rate: number; grade: string }
  | { kind: 'error'; message: string };

type GapResult =
  | {
      kind: 'ok';
      openingCash: number;
      income3m: number;
      expense3m: number;
      netOutflow: number;
      gap: number;
      grade: GapGrade;
    }
  | { kind: 'error'; message: string };

type DashboardResult =
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ok';
      recovery: RecoveryResult;
      gap: GapResult;
      fileLabel: string;
    };

// ── 파싱 헬퍼 ─────────────────────────────────────────────────────────────

function readCell(sheet: XLSX.WorkSheet, col: string, row: number): number | null {
  const ref = `${col}${row}`;
  const cell = sheet[ref];
  if (!cell || cell.t === 's') return null;
  const v = cell.v;
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function findSheetName(wb: XLSX.WorkBook): string | null {
  for (const name of Object.keys(wb.Sheets)) {
    if (name === TARGET_SHEET) return name;
  }
  return null;
}

// ── 대금 회수 위험 (단일 파일: K7 값만 표시, 상세 비교는 별도 페이지) ────

function computeRecovery(wb: XLSX.WorkBook): RecoveryResult {
  const name = findSheetName(wb);
  if (!name) return { kind: 'error', message: `시트 "${TARGET_SHEET}"를 찾을 수 없습니다.` };

  const sheet = wb.Sheets[name];
  const label = sheet[LABEL_REF];
  if (!label || label.t !== 's' || label.v !== '수입') {
    return { kind: 'error', message: `"${LABEL_REF}" 셀이 "수입"이 아닙니다.` };
  }

  const v = readCell(sheet, 'K', 7);
  if (v === null) return { kind: 'error', message: `"K7"에서 숫자 값을 읽을 수 없습니다.` };

  // 단일 파일 기준: 계획/실적 비교를 못 하므로 K7 값을 기준으로 표시만 함
  // 상세 판정(계획 vs 실적)은 /aifrm/daegeum-hoe-su 페이지에서 2개 파일로 수행
  const grade = v >= 0.9 ? '정상' : v >= 0.8 ? '주의' : v >= 0.7 ? '경고' : '위기';
  return { kind: 'ok', plan: v, actual: v, rate: 1.0, grade };
}

// ── 유동성 Gap ─────────────────────────────────────────────────────────────

function computeGap(wb: XLSX.WorkBook): GapResult {
  const name = findSheetName(wb);
  if (!name) return { kind: 'error', message: `시트 "${TARGET_SHEET}"를 찾을 수 없습니다.` };

  const sheet = wb.Sheets[name];

  // 기초시재 (5행 L열)
  const opening = readCell(sheet, 'L', GAP_OPENING_ROW);
  if (opening === null) {
    return { kind: 'error', message: `기초시재(L${GAP_OPENING_ROW})를 읽을 수 없습니다.` };
  }

  const cols = GAP_MONTH_COLS;
  const incomeVals: Array<number | null> = cols.map((c) => readCell(sheet, c, GAP_INCOME_ROW));
  const expenseVals: Array<number | null> = cols.map((c) => readCell(sheet, c, GAP_EXPENSE_ROW));

  // null 체크: 하나라도 null이면 에러
  for (let i = 0; i < cols.length; i++) {
    if (incomeVals[i] === null) {
      return { kind: 'error', message: `수입(${cols[i]}${GAP_INCOME_ROW})를 읽을 수 없습니다.` };
    }
    if (expenseVals[i] === null) {
      return { kind: 'error', message: `지출(${cols[i]}${GAP_EXPENSE_ROW})를 읽을 수 없습니다.` };
    }
  }

  // 이 시점에서 모든 값이 number임이 보장됨 — 타입 프레디킷으로 좁혀 reduce
  const incomeSum = incomeVals.filter((v): v is number => v !== null).reduce((a, b) => a + b, 0);
  const expenseSum = expenseVals.filter((v): v is number => v !== null).reduce((a, b) => a + b, 0);
  const netOutflow = Math.abs(incomeSum - expenseSum);

  if (netOutflow === 0) {
    return { kind: 'error', message: '순지출이 0이어서 유동성 Gap을 계산할 수 없습니다.' };
  }

  const gap = (opening / netOutflow) * 100;
  let grade: GapGrade = '위기';
  for (const { threshold, grade: g } of GAP_BREAKPOINTS) {
    if (gap >= threshold) { grade = g; break; }
  }

  return {
    kind: 'ok',
    openingCash: opening,
    income3m: incomeSum,
    expense3m: expenseSum,
    netOutflow,
    gap,
    grade,
  };
}

// ── 표시 헬퍼 ──────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRate = (r: number) => `${(r * 100).toFixed(1)}%`;
const fmtGap = (g: number) => `${g.toFixed(1)}%`;

function gradeChip(grade: string): string {
  const map: Record<string, string> = {
    정상: 'bg-green-50 text-green-700 border-green-200',
    주의: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    경고: 'bg-orange-50 text-orange-700 border-orange-200',
    위기: 'bg-red-50 text-red-700 border-red-200',
  };
  return map[grade] ?? 'bg-gray-50 text-gray-700 border-gray-200';
}

function errBox(msg: string) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm">
      {msg}
    </div>
  );
}

// ── 컴포넌트 ───────────────────────────────────────────────────────────────

export default function AifrmDashboardPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DashboardResult>({ kind: 'empty' });

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult({ kind: 'empty' });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setResult({ kind: 'empty' }); }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!file) { setResult({ kind: 'error', message: '파일을 올려 주세요.' }); return; }
    setLoading(true);
    setResult({ kind: 'empty' });

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const recovery = computeRecovery(wb);
      const gap = computeGap(wb);
      setResult({ kind: 'ok', recovery, gap, fileLabel: file.name });
    } catch {
      setResult({ kind: 'error', message: '파일 처리 중 오류가 발생했습니다.' });
    } finally {
      setLoading(false);
    }
  }, [file]);

  // ── 렌더링 헬퍼 ─────────────────────────────────────────────────────────

  function renderRecoveryCard(r: RecoveryResult) {
    if (r.kind === 'error') return errBox(r.message);

    // r.kind === 'ok' — TypeScript가 여기서 좁힘
    return (
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dl className="space-y-1">
            <dt className="text-gray-500">기준값 (K7)</dt>
            <dd className="font-medium">{fmt(r.plan)}</dd>
          </dl>
        </div>
        <div>
          <dl className="space-y-1">
            <dt className="text-gray-500">회수율 (참고)</dt>
            <dd className="font-medium">{fmtRate(r.rate)}</dd>
          </dl>
        </div>
        <div className="col-span-2 mt-2">
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium border ${gradeChip(r.grade)}`}>
            {r.grade}
          </span>
          <span className="ml-3 text-xs text-gray-400">
            ※ 계획 대비 실적 판정은{' '}
            <a href="/aifrm/daegeum-hoe-su" className="text-blue-600 hover:underline">
              대금회수 위험 상세 페이지
            </a>에서 2개 파일로 비교하세요.
          </span>
        </div>
      </div>
    );
  }

  function renderGapCard(g: GapResult) {
    if (g.kind === 'error') return errBox(g.message);

    // g.kind === 'ok'
    return (
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-gray-500">8월 기초시재</dt>
            <dd className="font-medium">{fmt(g.openingCash)} 억원</dd>
          </div>
          <div>
            <dt className="text-gray-500">3개월 순지출</dt>
            <dd className="font-medium">{fmt(g.netOutflow)} 억원</dd>
          </div>
          <div>
            <dt className="text-gray-500">3개월 수입 합계</dt>
            <dd className="font-medium">{fmt(g.income3m)} 억원</dd>
          </div>
          <div>
            <dt className="text-gray-500">3개월 지출 합계</dt>
            <dd className="font-medium">{fmt(g.expense3m)} 억원</dd>
          </div>
        </dl>

        <div className="bg-gray-50 rounded-lg p-4">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">유동성 Gap</dt>
              <dd className="font-medium text-lg">{fmtGap(g.gap)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">판정 등급</dt>
              <dd className="font-medium">
                <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium border ${gradeChip(g.grade)}`}>
                  {g.grade}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        <p className="text-sm text-gray-600">{GAP_COMMENTS[g.grade]}</p>

        <details className="text-sm text-gray-500">
          <summary className="cursor-pointer hover:text-gray-700">자금조달 포함 기준 비교 (PRD 참고)</summary>
          <p className="mt-2 pl-2">
            운영 수입(7행) 기준: Gap {fmtGap(g.gap)} → {g.grade}<br />
            ※ 자금조달 포함 수입계(6행) 기준은 별도 산출 필요.
          </p>
        </details>
      </div>
    );
  }

  function renderSummary(r: RecoveryResult, g: GapResult) {
    if (r.kind !== 'ok' || g.kind !== 'ok') return null;
    return (
      <div className="bg-gray-50 rounded-lg p-4 text-sm">
        <h3 className="font-medium mb-2">종합</h3>
        <ul className="list-disc list-inside space-y-1 text-gray-600">
          <li>대금 회수 위험: {r.grade} (K7 기준값 {fmt(r.plan)}, 회수율 {fmtRate(r.rate)})</li>
          <li>유동성 Gap: {g.grade} (Gap {fmtGap(g.gap)}, 시재 {fmt(g.openingCash)}억원 / 순유출 {fmt(g.netOutflow)}억원)</li>
        </ul>
      </div>
    );
  }

  // ── 메인 렌더 ───────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">재무위험 선행지표 대시보드</h1>
      <p className="text-sm text-gray-500 mb-6">대금 회수 위험 · 유동성 Gap — 단일 자금수지표 파일에서 함께 산출</p>

      {/* 업로드 */}
      <div className="space-y-4 mb-8">
        <label
          className="block border border-gray-300 rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <span className="text-sm text-gray-500 block">자금수지표 엑셀 파일 (예: 2026 본운영계획 자금수지표(0818_v1)_법인세추가.xlsx)</span>
          <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="hidden" id="file-input" />
          <label htmlFor="file-input" className="cursor-pointer mt-2 inline-block text-sm text-blue-600">
            {file ? `선택됨: ${file.name}` : '파일 선택 (또는 여기에 드롭)'}
          </label>
        </label>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !file}
          className="w-full bg-blue-600 text-white rounded-lg py-2 px-4 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition"
        >
          {loading ? '처리 중…' : '산출하기'}
        </button>
      </div>

      {/* 오류 */}
      {result.kind === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 mb-6">{result.message}</div>
      )}

      {/* 결과 */}
      {result.kind === 'ok' && (
        <div className="space-y-6">
          <p className="text-xs text-gray-400">기준 파일: {result.fileLabel}</p>

          {/* 대금 회수 위험 */}
          <section className="border border-gray-200 rounded-lg p-5">
            <h2 className="text-lg font-medium mb-4">대금 회수 위험</h2>
            {renderRecoveryCard(result.recovery)}
          </section>

          {/* 유동성 Gap */}
          <section className="border border-gray-200 rounded-lg p-5">
            <h2 className="text-lg font-medium mb-4">유동성 Gap (8월 기준 · 3개월 윈도우)</h2>
            {renderGapCard(result.gap)}
          </section>

          {/* 종합 */}
          {renderSummary(result.recovery, result.gap)}
        </div>
      )}

      {result.kind === 'empty' && !loading && (
        <p className="text-sm text-gray-400 text-center mt-12">파일을 올리고 [산출하기]를 누르면 두 지표가 함께 표시됩니다.</p>
      )}

      {/* 산출 기준 */}
      <details className="mt-8 text-xs text-gray-400">
        <summary className="cursor-pointer hover:text-gray-600">산출 기준 상세</summary>
        <div className="mt-2 space-y-1 border-t border-gray-200 pt-2">
          <p><strong>대금 회수 위험:</strong> 시트 《12_26년자금수지표(본운영반영)》 A7='수입' 확인 후 K7 값 표시. 단일 파일 기준 상댓값이며, 계획 대비 실적 판정은 <a href="/aifrm/daegeum-hoe-su" className="text-blue-600 hover:underline">대금회수 위험 상세 페이지</a>에서 2개 파일(계획/실적) 비교로 수행.</p>
          <p><strong>유동성 Gap:</strong> 8월 기준 3개월 윈도우 — 8월(L)·9월(M)·10월(N) 열, 기초시재(5행), 수입(7행), 지출(41행). Gap(%) = 기초시재 ÷ |3개월 수입 − 3개월 지출| × 100.</p>
          <p><strong>판정 기준 (PRD 4장):</strong> Gap ≥ 50% 정상, 25~50% 주의, 15~25% 경고, &lt;15% 위기.</p>
        </div>
      </details>
    </div>
  );
}
