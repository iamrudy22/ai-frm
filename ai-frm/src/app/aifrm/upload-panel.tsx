import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Section } from '@astryxdesign/core/Section';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { addMonths, type YearMonth } from '@/domain/shared/year-month';
import type { PreparedUpload } from './upload-session';
import { requirementsOf } from './uploaded-rounds';

type UploadPanelProps = {
  readonly files: File[];
  readonly prepared: PreparedUpload;
  readonly isApplied: boolean;
  readonly onFilesChange: (picked: File | File[] | null) => void;
  readonly onSubmit: () => void;
};

const FILE_GROUPS = [
  { label: '기본 산출용 파일', offsets: [0, -1, -3] },
  { label: '6개월 추이 보완 파일', offsets: [-2, -4, -5, -6] },
] as const;

function monthLabel(month: YearMonth): string {
  const [year, number] = month.split('/').map(Number);
  return `${year}년 ${number}월`;
}

function filePurpose(offset: number): string {
  if (offset === 0) return 'Gap·시재 산출과 직전월 분양회수 실적';
  if (offset === -1) return '직전월 대금 회수율 계산에 쓰는 계획값';
  if (offset === -3) return '건설경기 지수에 쓰는 분양회수 계획';
  return '해당 회차의 Gap·시재와 회수율 추이 보완';
}

/** 파일 판독 결과를 보여 준다. 파일 읽기·확정·지표 계산은 기존 페이지가 담당한다. */
export function UploadPanel({ files, prepared, isApplied, onFilesChange, onSubmit }: UploadPanelProps) {
  const rounds = prepared.kind === 'ready' ? prepared.rounds : null;
  const base = rounds?.latest.round ?? null;
  const sources = new Map(rounds?.rounds.map((round) => [round.round, round]));
  const displayedMonths = new Set(base === null ? [] : FILE_GROUPS.flatMap((group) => group.offsets.map((offset) => addMonths(base, offset))));
  const additionalRounds = rounds?.rounds.filter((round) => !displayedMonths.has(round.round)) ?? [];
  const missingBasic = rounds === null ? false
    : requirementsOf(rounds.rounds.map((round) => round.round)).some((requirement) => requirement.missing.length > 0);
  // 안내 대상으로 둔 최근 6개월의 인접 회차 쌍만 센다. 금액 판독·산출 성공을 뜻하지 않는다.
  const recoveryCount = base === null ? 0 : [-6, -5, -4, -3, -2, -1]
    .filter((offset) => sources.has(addMonths(base, offset)) && sources.has(addMonths(base, offset + 1))).length;
  const summary = prepared.kind === 'reading' ? `파일 읽는 중 ${prepared.done}/${prepared.total}`
    : prepared.kind === 'error' ? '파일 내용을 확인해 다시 선택하세요'
      : rounds === null ? '파일을 선택하세요'
        : missingBasic ? '기본 산출용 파일 부족 · 일부 지표는 산출되지 않을 수 있습니다'
          : `기본 회차 충족 · 최근 6개월 회수율 자료 최대 ${recoveryCount}개월분`;

  return (
    <Section padding={6}>
      <VStack gap={4}>
        <FileInput label="자금수지표 파일" isLabelHidden width="100%" mode="dropzone"
          description=".xlsx · .xls / 여러 회차를 한 번에 선택"
          accept=".xlsx,.xls" isMultiple value={files.length > 0 ? files : null}
          onChange={onFilesChange} isLoading={prepared.kind === 'reading'}
          status={prepared.kind === 'error' ? { type: 'error' } : undefined}
          placeholder="엑셀 파일을 놓거나 클릭하여 선택" />

        <Text size="sm" color={base === null ? 'secondary' : 'primary'}
          role="status" aria-label="자금수지표 기준월 확인">
          {base === null ? '기준월은 업로드한 파일에서 자동으로 확인합니다.'
            : `자금수지표 기준월: ${monthLabel(base)} · 최신 파일 기준`}
        </Text>

        <Grid columns={{ minWidth: 300, max: 2, repeat: 'fit' }} gap={5}>
          {FILE_GROUPS.map((group) => (
            <List key={group.label} hasDividers density="compact" header={<Text type="label">{group.label}</Text>}>
              {group.offsets.map((offset) => {
                const month = base === null ? null : addMonths(base, offset);
                const source = month === null ? undefined : sources.get(month);
                return (
                  <ListItem key={offset}
                    label={`${offset === 0 ? '기준월' : `${Math.abs(offset)}개월 전`} 자금수지표`}
                    description={<VStack gap={0.5}>
                      <Text size="sm" color="secondary">{filePurpose(offset)}</Text>
                      {month !== null && <Text size="xsm" color="secondary" className="break-all">
                        {monthLabel(month)}{source === undefined ? '' : ` · ${source.file}`}
                      </Text>}
                    </VStack>}
                    endContent={month === null ? undefined : <Token size="sm" color={source === undefined ? 'gray' : 'green'}
                      label={source === undefined ? '파일 필요' : '파일 확인'} />} />
                );
              })}
            </List>
          ))}
        </Grid>

        {additionalRounds.length > 0 && <List hasDividers density="compact" header={<Text type="label">추가로 등록한 회차</Text>}>
          {additionalRounds.map((source) => <ListItem key={source.round}
            label={`${monthLabel(source.round)} 자금수지표`}
            description={<Text size="sm" color="secondary" className="break-all">{source.file}</Text>}
            endContent={<Token size="sm" color="green" label="파일 확인" />} />)}
        </List>}

        <Divider />
        <HStack gap={3} wrap="wrap" vAlign="center" hAlign="between">
          <Text size="sm" role="status" aria-label="자료 준비 요약">{summary}</Text>
          <Button label="산출하기" variant="primary" isDisabled={prepared.kind !== 'ready' || isApplied} onClick={onSubmit} />
        </HStack>
        {rounds !== null && <Text size="sm" color="secondary">
          회차 준비 기준입니다. 실제 산출 여부는 항목 판독·외부 자료 확인에 따라 달라집니다.
        </Text>}
      </VStack>
    </Section>
  );
}
