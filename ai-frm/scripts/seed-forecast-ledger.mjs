/**
 * 엑셀 → 분양회수 계획·실적 초기 이력, 그리고 엑셀 동등성 검증용 fixture.
 *
 *   node scripts/seed-forecast-ledger.mjs "<3. 건설경기인식지수(2026).xlsx>" [--force]
 *
 * 레거시 ACL이다(DDD 검토 §10-4). 엑셀 모양을 이력의 모양으로 옮기는 일만 한다.
 * 산식은 두지 않는다 — 산식이 두 벌이 되면 어긋난다. 옮긴 값이 맞는지는
 * construction-perception.fixture.test.ts가 도메인 함수로 검사한다.
 *
 * 만드는 파일 (모두 사내 데이터라 커밋하지 않는다)
 *   data/forecast-ledger.json                    초기 이력
 *   fixtures/건설경기인식지수-원값.csv             ecos기초데이터의 9종 원값
 *   fixtures/분양회수-오차율-엑셀.csv              분양회수data H열 (라벨 보정)
 *   fixtures/건설경기인식지수-엑셀결과.csv          위기단계 L(지수)·M(단계)열
 *
 * 라벨 보정(정책 §7 D8): 분양회수data의 날짜 라벨은 실제 데이터 월보다 한 달
 * 앞서 있다. "2026/08" 행은 7월 실적과 7월 회차 계획이다. 이 보정은 이 파일
 * 한 곳에만 있다.
 *
 * 이미 이력 파일이 있으면 멈춘다. 실제 회차가 쌓인 뒤 다시 돌리면 그 값을 덮기
 * 때문이다. 정말 덮으려면 --force.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const XLSX = createRequire(import.meta.url)('xlsx');

const [source, ...flags] = process.argv.slice(2);
if (source === undefined) {
  console.error('사용법: node scripts/seed-forecast-ledger.mjs "<건설경기인식지수.xlsx>" [--force]');
  process.exit(2);
}
const force = flags.includes('--force');

const LEDGER = resolve('data/forecast-ledger.json');
const FIXTURES = resolve('fixtures');

if (existsSync(LEDGER) && !force) {
  console.error(`${LEDGER}이(가) 이미 있습니다. 쌓인 회차를 덮지 않도록 멈춥니다. 덮으려면 --force.`);
  process.exit(1);
}

const wb = XLSX.readFile(source);
const sheet = (name) => {
  const ws = wb.Sheets[name];
  if (ws === undefined) fail(`시트가 없습니다: ${name}`);
  return ws;
};
const cell = (ws, address) => ws[address]?.v;

// ── 달력 월 (도메인의 YearMonth와 같은 'YYYY/MM') ─────────────────────────

const MONTH = /^(\d{4})\/(\d{2})$/;

function parseMonth(label, where) {
  const m = MONTH.exec(String(label ?? ''));
  if (m === null || Number(m[2]) < 1 || Number(m[2]) > 12) fail(`${where}: 달 형식이 아닙니다: ${label}`);
  return label;
}

function addMonths(ym, n) {
  const [y, m] = ym.split('/').map(Number);
  const serial = y * 12 + (m - 1) + n;
  return `${Math.floor(serial / 12)}/${String((serial % 12) + 1).padStart(2, '0')}`;
}

function number(v, where) {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${where}: 수가 아닙니다: ${v}`);
  return v;
}

const blank = (v) => v === undefined || v === null || v === '';

function fail(message) {
  console.error(`실패 — ${message}`);
  process.exit(1);
}

/** 최신 달이 위인 시트에서 라벨이 한 달씩 줄어드는지 본다. */
function expectDescending(months, what) {
  for (let i = 1; i < months.length; i++) {
    if (months[i] !== addMonths(months[i - 1], -1)) {
      fail(`${what}: ${months[i - 1]} 다음이 ${months[i]}입니다. 달이 한 달씩 이어지지 않습니다.`);
    }
  }
}

// ── 분양회수data → 이력 ───────────────────────────────────────────────────

const bd = sheet('분양회수data');
const rows = [];
const errorRates = [];
const labels = [];

for (let r = 6; ; r++) {
  const label = cell(bd, `B${r}`);
  if (blank(label)) break;
  const labelMonth = parseMonth(label, `분양회수data!B${r}`);
  labels.push(labelMonth);
  const month = addMonths(labelMonth, -1); // 라벨 보정 (D8)

  const row = { month };
  const actual = cell(bd, `C${r}`);
  if (!blank(actual)) {
    row.actual = number(actual, `분양회수data!C${r}`);
    row.actualFrom = addMonths(month, 1);
    row.actualSeeded = true;
  }
  const plan = ['D', 'E', 'F'].map((c) => cell(bd, `${c}${r}`));
  if (plan.some((v) => !blank(v))) {
    row.plan = plan.map((v, i) => number(v, `분양회수data!${'DEF'[i]}${r}`));
    row.planFrom = month;
    row.planSeeded = true;
  }
  if (row.actual !== undefined || row.plan !== undefined) rows.push(row);

  const h = cell(bd, `H${r}`);
  if (typeof h === 'number') errorRates.push([month, h]);
}
expectDescending(labels, '분양회수data B열');
rows.reverse(); // 이력 스냅샷은 달 순서(오름차순)다

// ── ecos기초데이터 → 원값 ─────────────────────────────────────────────────

const ECOS_COLUMNS = [
  ['B', '총수주액'],
  ['C', '주택매매가격지수'],
  ['D', '미분양주택현황'],
  ['E', '주택건설인허가실적'],
  ['F', '설비투자지수'],
  ['G', '대출금리'],
  ['H', '환율'],
  ['I', '주가'],
  ['J', '선행지수순환변동치'],
];

const ecos = sheet('ecos기초데이터');
const raw = [];
for (let r = 8; ; r++) {
  const label = cell(ecos, `A${r}`);
  if (blank(label)) break;
  const month = parseMonth(label, `ecos기초데이터!A${r}`);
  raw.push([month, ...ECOS_COLUMNS.map(([c]) => {
    const v = cell(ecos, `${c}${r}`);
    return blank(v) ? '' : number(v, `ecos기초데이터!${c}${r}`);
  })]);
}
expectDescending(raw.map((x) => x[0]), 'ecos기초데이터 A열');

// ── 위기단계 → 엑셀 결과 ──────────────────────────────────────────────────

const stage = sheet('재무위기인식지수_위기단계');
const results = [];
for (let r = 5; ; r++) {
  const label = cell(stage, `A${r}`);
  if (blank(label)) break;
  results.push([
    parseMonth(label, `위기단계!A${r}`),
    number(cell(stage, `L${r}`), `위기단계!L${r}`),
    String(cell(stage, `M${r}`) ?? ''),
  ]);
}
expectDescending(results.map((x) => x[0]), '위기단계 A열');

// ── 쓰기 ──────────────────────────────────────────────────────────────────

const csv = (header, lines) => [header.join(','), ...lines.map((l) => l.join(','))].join('\n') + '\n';
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  console.log(`썼습니다: ${path}`);
};

write(LEDGER, JSON.stringify({ version: 1, rows }, null, 2) + '\n');
write(resolve(FIXTURES, '건설경기인식지수-원값.csv'), csv(['시점', ...ECOS_COLUMNS.map(([, k]) => k)], raw));
write(resolve(FIXTURES, '분양회수-오차율-엑셀.csv'), csv(['시점', '오차율'], errorRates));
write(resolve(FIXTURES, '건설경기인식지수-엑셀결과.csv'), csv(['시점', '종합위기인식지수', '종합위기단계'], results));

console.log(
  `이력 ${rows.length}개월(${rows[0].month}~${rows[rows.length - 1].month}), ` +
    `오차율 ${errorRates.length}개월, 원값 ${raw.length}개월, 엑셀 결과 ${results.length}개월.`,
);
