import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// This command checks metadata only. Never open, parse, or print fixture contents.
const REQUIRED_PATHS = [
  'fixtures/자금수지표-최신회차.xlsx',
  'fixtures/건설경기인식지수-원값.csv',
  'fixtures/분양회수-오차율-엑셀.csv',
  'fixtures/건설경기인식지수-엑셀결과.csv',
  'fixtures/건설경기인식지수-기대값.csv',
];
const ROUND_PATH = 'fixtures/자금수지표';
let metadataFailed = false;

function errorStatus(error) {
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'missing';
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'unreadable';
  metadataFailed = true;
  return 'error';
}

function inputStatus(path, directory = false) {
  try {
    const metadata = statSync(resolve(path));
    if (directory ? !metadata.isDirectory() : !metadata.isFile()) {
      return directory ? 'not-directory' : 'not-regular-file';
    }
    if (!directory && metadata.size === 0) return 'empty';
    accessSync(resolve(path), directory ? constants.R_OK | constants.X_OK : constants.R_OK);
    return 'ready';
  } catch (error) {
    return errorStatus(error);
  }
}

const requiredInputs = REQUIRED_PATHS.map((path) => ({ path, status: inputStatus(path) }));
const rounds = {
  path: ROUND_PATH,
  status: inputStatus(ROUND_PATH, true),
  usableFileCount: 0,
  // Counting eight files cannot establish the actual months or round composition.
  compositionVerified: false,
};

if (rounds.status === 'ready') {
  try {
    for (const name of readdirSync(resolve(ROUND_PATH))) {
      if (!name.endsWith('.xlsx')) continue;
      const status = inputStatus(resolve(ROUND_PATH, name));
      if (status === 'ready') rounds.usableFileCount++;
      if (status === 'error') rounds.status = 'error';
    }
  } catch (error) {
    rounds.status = errorStatus(error);
  }
}

const roundsReadable = rounds.status === 'ready';
const validationGroups = {
  latestStatement: { inputsReady: requiredInputs[0].status === 'ready' },
  statementRounds: { inputsReady: roundsReadable && rounds.usableFileCount >= 1 },
  forecastError: {
    inputsReady: roundsReadable && rounds.usableFileCount >= 8 && requiredInputs[2].status === 'ready',
  },
  constructionWorkbook: { inputsReady: requiredInputs.slice(1, 4).every(({ status }) => status === 'ready') },
  constructionPerception: { inputsReady: requiredInputs.slice(1).every(({ status }) => status === 'ready') },
};
const inputsReady = !metadataFailed && Object.values(validationGroups).every((group) => group.inputsReady);
const report = {
  scope: 'fixture-input-metadata',
  inputsReady,
  numericValidation: 'not-run',
  pdfGoldenComparison: 'not-run',
  requiredInputs,
  rounds,
  validationGroups,
  ...(metadataFailed ? { error: 'metadata-check-failed' } : {}),
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = metadataFailed ? 1 : inputsReady ? 0 : 2;
