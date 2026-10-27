import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { FileInput } from '@astryxdesign/core/FileInput';
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

const BASIC_OFFSETS = [0, -1, -3] as const;
const TREND_OFFSETS = [-2, -4, -5, -6] as const;

function monthLabel(month: YearMonth): string {
  const [year, number] = month.split('/').map(Number);
  return `${year}년 ${number}월`;
}
function relativeLabel(offset: number): string {
  return `${offset === 0 ? '기준월' : `${Math.abs(offset)}개월 전`} 자금수지표`;
}
function filePurpose(offset: number): string {
  if (offset === 0) return 'Gap·시재 산출과 직전월 분양회수 실적';
  if (offset === -1) return '직전월 대금 회수율 계산에 쓰는 계획값';
  if (offset === -3) return '건설경기 지수에 쓰는 분양회수 계획';
  return '해당 회차의 Gap·시재와 회수율 추이 보완';
}
function fileKey(file: File): string {
  return JSON.stringify([file.name, file.size, file.lastModified]);
}

/** 파일 판독 결과를 보여 준다. 파일 읽기·확정·지표 계산은 기존 페이지가 담당한다. */
export function UploadPanel({ files, prepared, isApplied, onFilesChange, onSubmit }: UploadPanelProps) {
  const rounds = prepared.kind === 'ready' ? prepared.rounds : null;
  const base = rounds?.latest.round ?? null;
  const sources = new Map(rounds?.rounds.map(round => [round.round, round]));
  const missingOffsets = base === null ? [] : BASIC_OFFSETS.filter(offset => !sources.has(addMonths(base, offset)));
  const missingBasic = rounds === null ? false
    : requirementsOf(rounds.rounds.map(round => round.round)).some(requirement => requirement.missing.length > 0);
  // 회차 준비 안내다. 항목 판독·실제 산출 성공이나 외부 위험 이력 확보를 뜻하지 않는다.
  const recoveryCount = base === null ? 0 : [-6, -5, -4, -3, -2, -1]
    .filter(offset => sources.has(addMonths(base, offset)) && sources.has(addMonths(base, offset + 1))).length;
  const summary = prepared.kind === 'reading' ? `파일 읽는 중 ${prepared.done}/${prepared.total}`
    : prepared.kind === 'error' ? '파일 내용을 확인해 다시 선택하세요'
      : rounds === null ? '파일을 선택하세요'
        : missingBasic ? '기본 산출용 파일 부족 · 일부 지표는 산출되지 않을 수 있습니다'
          : `기본 회차 충족 · 최근 6개월 회수율 자료 최대 ${recoveryCount}개월분`;
  const selectedFiles = files.map((file, index) => {
    // 이름이 같은 원본이 여럿이면 회차를 임의로 짝짓지 않는다. 제외는 정확한 선택 위치에 적용한다.
    const matchingSources = rounds?.rounds.filter(source => source.file === file.name) ?? [];
    const isUnique = files.filter(source => source.name === file.name).length === 1 && matchingSources.length === 1;
    return { file, index, source: isUnique ? matchingSources[0] : null };
  }).sort((left, right) => (right.source?.round ?? '').localeCompare(left.source?.round ?? '') || left.index - right.index);

  const addFiles = (picked: File | File[] | null) => {
    const additional = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
    if (additional.length === 0) return;
    const keys = new Set(files.map(fileKey));
    const combined = [...files];
    for (const file of additional) {
      const key = fileKey(file);
      if (!keys.has(key)) { keys.add(key); combined.push(file); }
    }
    if (combined.length !== files.length) onFilesChange(combined);
  };
  const guidance = (offsets: readonly number[], label: string) => <List hasDividers density="compact" header={<Text type="label">{label}</Text>}>
    {offsets.map(offset => {
      const month = base === null ? null : addMonths(base, offset);
      return <ListItem key={offset} label={relativeLabel(offset)}
        description={<VStack gap={1}>
          {month !== null && <Text color="secondary">{monthLabel(month)}</Text>}
          <Text color="secondary">{filePurpose(offset)}</Text>
        </VStack>}
        endContent={month === null ? undefined : <Token size="sm" color="gray"
          label={sources.has(month) ? '등록됨' : '파일 없음'} />} />;
    })}
  </List>;

  const content = <VStack gap={4}>
    <Text role="status" aria-label="자금수지표 기준월 확인" color={base === null ? 'secondary' : 'primary'}>
      {base === null ? '기준월은 업로드한 파일에서 자동으로 확인합니다.'
        : `자금수지표 기준월: ${monthLabel(base)} · 최신 파일 기준`}
    </Text>

    {files.length > 0 && <List hasDividers density="compact" header={<Text type="label">등록한 파일 {files.length}개</Text>}>
      {selectedFiles.map(({ file, index, source }) => {
        return <ListItem key={`${fileKey(file)}:${index}`}
          label={source === null ? file.name : `${monthLabel(source.round)} 자금수지표`}
          description={<Text color="secondary" wordBreak="break-all">{source === null ? `${index + 1}번째 선택 파일` : file.name}</Text>}
          endContent={<HStack gap={2} vAlign="center">
            {source !== null && <Token size="sm" color={source.round === base ? 'blue' : 'gray'} label={source.round === base ? '기준월' : '등록됨'} />}
            <Button size="sm" variant="ghost" label={`${file.name} · ${index + 1}번째 파일 제외`}
              onClick={() => onFilesChange(files.filter((_, selected) => selected !== index))}>제외</Button>
          </HStack>} />;
      })}
    </List>}

    <FileInput label={files.length > 0 ? '자금수지표 파일 추가' : '자금수지표 파일'}
      isLabelHidden width="100%" mode={files.length > 0 ? 'input' : 'dropzone'}
      accept=".xlsx,.xls" isMultiple value={null} onChange={addFiles}
      isLoading={prepared.kind === 'reading'} status={prepared.kind === 'error' ? { type: 'error' } : undefined}
      placeholder={files.length > 0 ? '파일 추가' : '엑셀 파일을 놓거나 클릭하여 선택'} />
    {files.length === 0 && <Text color="secondary">.xlsx · .xls / 여러 회차를 한 번에 선택</Text>}

    {base === null ? <Collapsible trigger="필요한 파일 안내" defaultIsOpen={false}>
      <VStack gap={5} paddingBlock={3}>
        {guidance(BASIC_OFFSETS, '기본 산출에 사용하는 파일')}
        {guidance(TREND_OFFSETS, '추이 보완에 사용하는 파일 · 선택')}
      </VStack>
    </Collapsible> : <>
      {missingOffsets.length > 0 && guidance(missingOffsets, '추가 자료로 더 산출할 수 있습니다')}
      <Collapsible trigger="추이 보완 자료 · 선택" defaultIsOpen={false}>
        <VStack gap={3} paddingBlock={3}>
          <Text color="secondary">추가 회차로 Gap·시재와 대금 회수율 추이를 보완할 수 있습니다.</Text>
          <Text color="secondary">회차 준비 기준입니다. 실제 산출 여부는 항목 판독·외부 자료 확인에 따라 달라집니다.</Text>
          {guidance(TREND_OFFSETS, '선택할 수 있는 자료')}
        </VStack>
      </Collapsible>
    </>}

    {(files.length > 0 || prepared.kind !== 'empty') && <HStack gap={3} wrap="wrap" vAlign="center" hAlign="between">
      <Text role="status" aria-label="자료 준비 요약">{summary}</Text>
      <Button label="산출하기" variant="primary" isDisabled={prepared.kind !== 'ready' || isApplied} onClick={onSubmit} />
    </HStack>}
  </VStack>;

  return <Section padding={0}>
    {prepared.kind === 'ready' && isApplied
      ? <Collapsible trigger="등록한 파일 확인·변경" defaultIsOpen={false}>{content}</Collapsible>
      : content}
  </Section>;
}
