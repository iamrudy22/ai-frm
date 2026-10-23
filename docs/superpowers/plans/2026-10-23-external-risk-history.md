# 과거 자료 보완·월별 확정 이력 자동 보관 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 계산식과 보고서 템플릿을 유지하면서 건설경기·조달위험의 과거 산출 자료를 보완하고, 사용자가 ‘보고서 확정’을 누른 결과를 원자료·월별 추이와 함께 로컬 파일에 불변 이력으로 보관한다.

**Architecture:** 원천 캡처, 기존 계산 함수의 실행 기록, 월별 보고서 확정을 분리한다. 서버의 로컬 SQLite 파일에 입력·산출 결과·확정 버전·문서 모델을 저장하고, 기존 차트에는 별도 투영 함수로 이력 점만 공급한다. 과거 보완은 기존 단월 유스케이스를 고정한 원천 입력으로 실행하며 당시 확정 기록으로 승격하지 않는다.

**Tech Stack:** 현행 Next.js 16.3.4·React 19·TypeScript·Astryx 0.5.4·Vitest, 실행 환경에서 확인한 Node.js v26.8.2의 `node:sqlite`/`DatabaseSync` 및 `backup`. 외부 DB·스프레드시트·새 npm 패키지·스케줄러는 사용하지 않는다.

**Spec:** 이 문서 §1~§4가 명세다. 사용자 요청 ‘기존 계산식과 리포트 템플릿은 유지하고, 과거 자료 보완과 월별 확정 이력 자동 저장 기능의 구현 계획’ 및 후속 답변 ‘보고서 확정 시 자동 보관’, ‘아니다 로컬 파일로 기록하게 해주세요’를 따른다. 이전 제공 자료 기반 계획은 [2026-10-21-report-history.md](./2026-10-21-report-history.md), 현재 템플릿·서체·원본 참고표 기준은 [UI 진행 기록](./2026-10-21-ui-ux.md)의 최신 항목이다.

**상태:** 구현 전 제안. 기준 커밋 `e3a8f9e`. 이 문서 작성에서는 애플리케이션 코드·계산·데이터·실행 중 화면을 수정하지 않는다.

## Global Constraints

- **“기존 계산식과 리포트 템플릿은 유지”**: `src/domain/risk/**`, 기존 `application/construction-perception.ts`·`funding-risk.ts`·`dashboard.ts`, 회차 판독·월 대응·가중치·임계값·정밀도를 수정하지 않는다.
- `report-model.ts`·`report-preview.tsx`·`report-chart.tsx`·`report-chart-view.ts`·`report-reference.ts`·`format.ts`·`globals.css`·`ThemeProvider.tsx`·참고 PNG의 diff 0을 유지한다. 이력은 새 투영 함수에서 연결한다. 현재 보고서 3쪽·차트 5개·본문·서체·원본 참고표·인쇄 용지/배치는 그대로다.
- 확정 트리거는 용지 바깥의 **‘보고서 확정’**이다. 파일 적용·보고서 열기·인쇄 버튼·PDF 저장 시도를 업무 확정으로 간주하지 않는다.
- 저장은 PC에서 실행 중인 Next.js 서버의 `ai-frm/data/report-history.sqlite` 파일이다. 브라우저 다운로드 파일이나 원본 엑셀에 직접 기록하는 방식이 아니다. 다른 PC/서버로 옮기면 DB와 백업을 함께 이전해야 한다.
- 외부 스프레드시트 연결은 후속 답변으로 제외됐다. 외부 DB/클라우드 업로드·백그라운드 정기 수집도 이번 범위가 아니다.
- 원본 `.xlsx`/PDF를 복제·전송·수정하지 않는다. 재현에 필요한 정규화 입력과 산출 결과만 로컬에 보관한다. 실제 재무 수치·비밀값·로컬 DB·백업은 Git·로그·fixture에 넣지 않는다.
- 원래 회차를 다른 회차의 수정 실적으로 대체하지 않는다. 결측/조회 실패/비적용·0·음수를 구분하고 보간·0 채움·이전 월/이전 평가일 후퇴를 하지 않는다.
- 과거 보완 경로는 `reconstructed`, 일반 단월 산출 경로는 `live`로 기록한다. `live`는 기준월 당시에 확보한 자료라는 뜻이 아니다. 실제 원천 확보 시점은 fetchedAt/receivedAt, 업무 확정 시점은 confirmedAt로 구분한다. 후일 재조회한 값이 기존 확정 문서·값·추이를 덮어쓰지 않는다.
- 매 단계 TDD 또는 의미 있는 시각 RED→GREEN, 독립 검토, 적절한 QA, 별도 커밋과 진행 기록을 남긴다. 전체 빌드와 `tsc`는 동시에 실행하지 않는다.
- `ai-frm/AGENTS.md`와 설치된 Next.js 문서·Astryx CLI를 따른다. 화면 조작/알림은 용지 바깥의 실제 Astryx 컴포넌트로 구성한다.

## Review Focus

1. 보고서 제목 월·건설 기준월·조달 판단/관측월·달력 날짜를 혼동하면 한두 달 이동하거나 시간대에 따라 전월로 저장된다. → Task 2·3·5의 월/날짜 테스트.
2. 같은 회차 수정 파일, 선택월 변경, 늦은 응답, 후보 준비 중 입력 변경이 이전 입력과 새 계산을 섞지 않아야 한다. → Task 2·5의 해시·generation·캡처 대조 테스트.
3. 두 탭 중복 확정·응답 유실 후 재시도·서버 종료·디스크 오류가 중복/반쪽 확정 또는 거짓 ‘저장됨’을 만들면 안 된다. → Task 1·5의 트랜잭션·멱등·장애 테스트.
4. ECOS 수정치와 새 보완 배치가 과거 확정값/작성일/차트를 바꾸지 않아야 한다. → Task 3·4·5의 캡처 고정·시점 제한·무조회 재열람 테스트.
5. 연말 실적 열 부재·외부 부분 실패·현재 조회 중·18개월 이력·저장 실패에도 기존 산출/보고서 동작을 보존해야 한다. → Task 2·3·4·6의 결측·경계·템플릿 회귀 QA.

---

## 1. 업무 규칙과 범위

### 1.1 서로 다른 월을 별도로 보관

최신 업로드 회차를 `R`이라고 한다. 월 대응은 **기존 함수의 결과를 기록**하며 새 산식으로 다시 정의하지 않는다.

| 필드 | 기본 월 | 합성 예: R=2026/08 |
|---|---|---|
| `reportCycle` / `latestRound` | R | 2026/08 |
| `reportTitleMonth` | R−1 | 2026/07 |
| `constructionBaseMonth` / 건설 차트 x축 | R−2 | 2026/06 |
| `fundingJudgedMonth` | R | 2026/08 |
| `fundingObservedMonth` / 조달 차트 x축 | R−1 | 2026/07 |
| `gapMonth` | 현재 선택값, 기본 R | 기본 2026/08 |

- `(지표, month)`만을 전체 저장 키로 사용하지 않는다. `scopeId`, 월별 보고 회차, 지표의 실제 월, 계산 버전과 산출 ID를 구분한다.
- v1의 **월별 확정**은 실효 월이 기본 조합(건설 R−2, 조달 판단 R, Gap R)인 보고서에 한정한다. 직접 선택했더라도 실효 월이 같으면 허용한다. 다른 월의 조회·기존 보고서 열기는 그대로 제공하되 확정 시 기본 조합이 아닌 이유를 용지 밖에 표시한다. 조용히 기본월로 바꾸지 않는다.
- 기본 업무 자료집합은 DB 생성 시 발급한 로컬 `scopeId` 한 개다. 다른 회사/사업장 자료집합은 다른 scope 또는 별도 DB로 분리한다. 서버가 scope를 결정하며 클라이언트가 임의 scope의 기록을 읽거나 쓰게 하지 않는다.

### 1.2 후보 자동 보관과 확정은 별개

1. 현재 입력 적용·외부 응답이 종료되면 원천과 산출 기록을 자동 보관한다. **문서 후보는 보고서를 연 뒤** reportOpenedAt가 존재할 때 입력·응답·선택한 이력의 연결을 검사해 준비한다. 보고서 열기 전의 산출 기록을 문서 후보나 업무 확정으로 부르지 않는다. 응답 대기 중에는 확정하지 않는다.
2. 후보에는 산출 성공뿐 아니라 종료된 산출불가/조회 실패 상태도 그대로 보관한다. 일부 불가 보고서도 사용자가 그 상태를 확인한 뒤 확정할 수 있다. 로딩을 불가로 바꾸거나 과거 정상값으로 대체하지 않는다.
3. ‘보고서 확정’을 누르면 사용자가 본 후보 ID와 해시를 확인하고 저장한다. 성공 응답을 받은 뒤에만 ‘확정됨’을 표시한다.
4. 후보 준비로 표시 내용/이력이 달라졌다면 새 후보를 보여 주고 자동 확정을 중단한다. 변경된 후보에 대한 다음 명시적 확정 클릭을 받는다.
5. 인쇄 창은 실제 PDF 파일 저장 여부를 알려 주지 않으므로 확정 트리거로 사용하지 않는다. 기존 PDF/보고서 열기는 저장 장애와 독립적으로 계속 사용할 수 있다.
6. 같은 달·같은 후보 재시도는 새 멱등 키를 보내도 기존 확정 결과를 반환하며 head를 되돌리지 않는다. 이미 확정된 달에 내용이 다르면 ‘정정 확정’과 사유가 필요하다. 원본 revision은 보존한다. 과거 회차를 지금 확정하면 확정 시각은 지금이며 당시 확정으로 소급 기록하지 않는다.

### 1.3 과거 자료 보완

- 기본 범위는 현재 보고 회차 R까지 최근 **18개 달력 회차**다. 화면에 범위를 먼저 보여 주며 실행 전 준비 상태를 계산한다. 부족한 달이 있어도 가능한 달을 보완한다.
- 건설 기준월 b에는 기존 `roundsNeededFor(b)`가 정한 **b−1 회차 계획과 b+2 회차 실적**, ECOS의 b/전월/전년동월 값이 필요하다. 파일명·장수만으로 계산 가능하다고 판정하지 않는다.
- 표준 회차 시트가 해당 연도 1월부터이면 연말/연초에 필요한 전년도 실적 열이 없을 수 있다. 기존 ledger가 거부하는 값은 다른 회차에서 메우지 않고 사유를 남긴다.
- 현재 ECOS 어댑터는 2015/01부터 조회한 월까지의 9종 계열을 이미 받는다. v1은 기존 자료 범위 안에서만 보완하며, 2016/01 이후도 실제 공통 원값과 엑셀 회차가 갖춰진 월만 산출한다. 이론적 하한을 가용성 보증으로 표시하지 않는다.
- 조달은 각 판단월 J에 대해 J−1 관측월의 마지막 평가일을 사용한다. 기존 어댑터에 기록된 2023/01/09 이전 평균값 부재를 고려하되 개별 응답으로 가용 여부를 판정한다. 마지막 평가일 평균 결측 시 전날 값으로 옮기지 않는다.
- 보완은 `현재 확보한 자료로 계산한 과거값`이다. 과거 보고서를 당시 확정했다고 소급 기록하지 않는다. 나중의 재조회는 새 배치·새 산출 ID로 추가한다.

### 1.4 추이에 선택할 값

- 건설은 `result.month`, 조달은 `observedMonth`에 점을 놓는다. 각 지표의 현재 기준점까지 최대 18개 달력 월을 표시한다. 미래 점·다른 scope/계산 버전/단위의 점을 섞지 않는다.
- 과거 월은 **해당 canonical 회차의 최신 확정 revision 자체 현재 지표**(`canonicalCurrentCalculationIds`)를 우선한다. 확정 문서의 차트 전체나 `historyCalculationIds`를 확정값으로 재분류하지 않는다. 복사된 reconstructed 점은 계속 보완값이다. 자체 현재 지표가 불가이면 결측을 유지한다. 해당 월에 이런 확정 기록이 없을 때만 선택된 보완 배치의 점을 사용한다.
- 현재 기준점의 본문 값·등급·사유와 점은 기존 현재 응답을 우선한다. 같은 월의 기존 확정값과 새 재계산값은 별개이며 재계산값이 기존 확정본을 수정하지 않는다.
- 보완 배치의 이전 정상값으로 최신 실패를 숨기지 않는다. 선택된 배치에서 실패한 월은 그 실패를 사용한다. 실제 0·음수는 available이고, 빠진 월은 missing으로 추가해 기존 SVG가 선을 끊도록 한다.
- 서버가 한 번의 일관된 읽기로 cutoff·월별 head revision·선택 batch·산출 ID를 읽고 불변 `historySelectionId`를 발급한다. UI와 후보 준비는 이 ID를 공통 사용한다. 현재 문서의 출처 선택 ID와 시점 제한을 후보에 고정한다. 확정본을 다시 열 때 새 이력을 합치거나 외부 API를 부르지 않는다.
- 보완값 포함 여부와 확정/보완 개수는 **용지 밖**에서 알린다. 고정 PDF 본문에는 새로운 출처 범례를 추가하지 않는다. 따라서 PDF만으로 당시 확정값/후일 보완값을 식별할 수 없다는 제약이 있으며 원천 구분은 보관 메타데이터에서 추적한다.

## 2. DDD 경계와 저장 설계

### 2.1 분리할 기록

| 기록 | 책임·불변성 |
|---|---|
| `SourceCapture` | 실제 계산에 공급한 정규화 ECOS 계열 또는 KOFIA 평가일별 금리. 원천별 단위·수신 시각·오류·내용 해시를 보관하며 변경하지 않는다. |
| `CalculationRecord` | 기존 유스케이스의 입력 해시·실효 월·버전·결과·원천 ID·live/reconstructed 구분. 결과를 반올림해 저장하지 않는다. |
| `ReportCandidate` | 입력 묶음·월 조합·외부 산출 ID·작성 시각·문서 해시·차트에 선택한 이력 ID를 묶은 준비 완료 후보. 준비 이후 수정하지 않는다. |
| `HistorySelection` | cutoff·head revision·단일 선택 batch·선택 산출 ID를 고정한 읽기 스냅샷. UI와 문서 후보가 공유한다. |
| `MonthlyConfirmation` | scope/회차별 확정 revision과 후보 참조. 자체 현재 지표 ID와 차트의 과거 참조 ID를 구분하고, 확정 시각·정정 사유·이전 revision을 남긴다. |
| `BackfillBatch` | 요청 범위·입력 해시·고정 원천 참조·월별 진행 상태. 중단 후 완료하지 않은 단계를 재개한다. |

`upload-session.committed`는 파일 적용 상태이므로 업무 확정 애그리거트로 재사용하지 않는다. 모든 월 이력을 하나의 애그리거트에 넣지 않고 **한 회차의 확정과 head 갱신**만 원자적으로 처리한다. 차트/파일/SQL은 기존 위험 도메인에 넣지 않는다.

### 2.2 핵심 인터페이스

다음 계약을 Task 1에서 정의하고 이후 Task는 같은 이름을 사용한다. `YearMonth`·`Grade` 등 기존 값 타입을 재사용한다.

```ts
type HistoryIndicator = 'construction' | 'funding';
type CalculationOrigin = 'live' | 'reconstructed';
type JsonValue = null | boolean | number | string | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
type ReportBasis = {
  reportCycle: YearMonth; reportTitleMonth: YearMonth;
  constructionBaseMonth: YearMonth; fundingJudgedMonth: YearMonth;
  fundingObservedMonth: YearMonth; gapMonth: YearMonth;
};
type PreparedDocument = {
  schemaVersion: 1; templateVersion: string;
  contentHash: string; json: JsonValue; historyCalculationIds: readonly string[];
};
type ConfirmationCommand = {
  candidateId: string; expectedRevision: number; idempotencyKey: string;
  correctionReason?: string;
};
type ConfirmationResult =
  | { kind: 'confirmed' | 'already-confirmed'; confirmationId: string; revision: number }
  | { kind: 'conflict' | 'not-ready'; reason: string };
type ConfirmationDecision =
  | { kind: 'create'; revision: number }
  | { kind: 'conflict' | 'not-ready'; reason: string };
type HistoryReceipt =
  | { captureStatus: 'saved'; calculationId: string; contextHash: string }
  | { captureStatus: 'failed'; code: 'STORAGE_UNAVAILABLE' };
type CapturedOutcome<T> = { outcome: T; history: HistoryReceipt };
type HistorySelectionQuery = {
  scopeId: string; basis: ReportBasis; calculationVersion: string;
  asOf: string; selectedBackfillBatchId: string | null;
};

interface HistoryRepository {
  defaultScopeId(): Promise<string>;
  putEvidence(input: EvidenceWrite): Promise<{ captureId: string }>;
  putCalculation(input: CalculationWrite): Promise<{ calculationId: string }>;
  getCalculation(scopeId: string, id: string): Promise<StoredCalculation | null>;
  putCandidate(input: CandidateWrite): Promise<{ candidateId: string; documentHash: string }>;
  getCandidate(scopeId: string, id: string): Promise<StoredCandidate | null>;
  commitConfirmation(scopeId: string, cmd: ConfirmationCommand): Promise<ConfirmationResult>;
  listCalculations(query: HistoryQuery): Promise<readonly StoredCalculation[]>;
  createHistorySelection(query: HistorySelectionQuery): Promise<ExternalHistorySelection>;
  getHistorySelection(scopeId: string, id: string): Promise<ExternalHistorySelection | null>;
  getConfirmation(scopeId: string, id: string): Promise<StoredConfirmation | null>;
  listConfirmations(scopeId: string, cycle?: YearMonth): Promise<readonly ConfirmationSummary[]>;
  putBatch(input: BatchWrite): Promise<{ batchId: string }>;
  getBatch(scopeId: string, id: string): Promise<StoredBatch | null>;
  listBatches(scopeId: string, status: 'active' | 'all', limit: number): Promise<readonly StoredBatch[]>;
  commitBatchStep(input: BatchStepWrite): Promise<StoredBatch>;
  claimCaptureSlot(input: CaptureClaim): Promise<CaptureClaimResult>;
  completeCaptureSlot(input: CaptureCompletion): Promise<{ kind: 'saved'; captureId: string } | { kind: 'stale' }>;
}
```

- `EvidenceWrite`: `scopeId/sourceKind/contentHash/payloadJson/schemaVersion/receivedAt`. ECOS 9종 Map은 월순 배열로, KOFIA는 평가일순 배열로 직렬화한다. 지표별 fetchedAt·단위·결측 사유를 payload에 남기며 인증정보/키 포함 URL은 넣지 않는다.
- `CalculationWrite`: `scopeId/indicator/origin/effectiveMonth/requestContext/inputHash/calculationVersion/captureIds/resultJson/createdAt/batchId?`. 기존 Outcome을 성공·산출불가·실패 상태 그대로 기록한다.
- `CandidateWrite`: `scopeId/basis/inputHash/calculationVersion/authoredAt/preparedAt/calculationIds/historySelectionId/document: PreparedDocument`. document는 application의 opaque 값이며 domain이 `FinancialReport`를 import하지 않는다.
- `Stored*`는 각 Write와 서버 발급 ID를 가진 불변 레코드다. `StoredConfirmation`에는 revision·previousConfirmationId·confirmedAt·candidateId와 문서가 연결된다. `HistoryQuery`는 `scopeId/indicator/from/to/calculationVersion/asOf/selectedBackfillBatchId:string|null`이다.
- `BatchWrite`는 `scopeId/startKey/fromCycle/toCycle/inputHash/roundEntriesJson/fixedNow`와 월별 `pending/completed` 목록이다. 동일 scope/startKey와 동일 요청 해시는 기존 batch ID를 반환하고 다른 요청 해시는 충돌이다. ECOS/KOFIA 캡처 ID는 별도 capture slot에 연결한다. `BatchStepWrite`는 `scopeId/batchId/reportCycle/calculationIds`이며 같은 step은 한 번만 완료된다.
- `CaptureClaim`은 `scopeId/batchId/sourceKey/ownerId/now/leaseUntil`이다. sourceKey는 `ecos` 또는 `kofia:YYYY/MM`. claim 결과는 ready(captureId), claimed(fence:number), busy다. `CaptureCompletion`은 slot key+ownerId+fence+EvidenceWrite이며, 현재 fence 소유자만 증거 저장과 slot 연결을 한 트랜잭션으로 완료할 수 있다. lease는90초이고 만료 시 다음 요청이 더 큰 fence로 회수한다. 늦은 응답은 새 slot을 덮지 못한다.
- 필드 타입은 다음으로 고정한다. ID·해시·버전·ISO 시각은 string, 월은 YearMonth, payload/result/requestContext/roundEntriesJson은 JsonValue, schemaVersion은 1, captureIds/historyCalculationIds는 readonly string 배열, calculationIds는 `{construction: string; funding: string}`이다. `sourceKind`는 `'ecos'|'kofia'`, 결과 유효성/등급은 기존 Outcome 안에서 보존한다.
- `ConfirmationSummary`는 `confirmationId/reportCycle/revision/confirmedAt/candidateId/correctionReason?`를 갖는다. `StoredConfirmation`은 이 값과 scopeId·previousConfirmationId(null 허용)·basis·canonicalCurrentCalculationIds·historySelectionId·document를 갖는다. `StoredBatch`는 BatchWrite와 batchId·completedCycles·pendingCycles·상태(`pending-source|running|completed`)를 갖는다. 후보는 준비 완료 데이터만 `putCandidate`하며 준비 불가 사유는 저장 성공 후보로 표현하지 않는다.
- `BackfillInput`은 `scopeId/anchorCycle/fromCycle/toCycle/rounds: readonly RoundEntry[]/inputGeneration`이다. from≤to≤anchor 및18회차 이하를 검증한다. `BackfillPlan`은 대상 cycle 배열과 각 cycle의 필요/부족 회차·원본 열 사유를 갖는다. 외부 지표 실제 가용성은 실행 전 확인됐다고 표시하지 않는다.
- `PreparedCandidate`는 `candidateId/documentHash/document: PreparedDocument/basis/inputGeneration`이다. `PrepareCandidateInput`은 `scopeId/basis/statements: readonly StatementSnapshotDto[]/constructionCalculationId/fundingCalculationId/historySelectionId/authoredAt/inputGeneration`이다. `StatementSnapshotDto`는 `asOf:{year,month,day}`, `monthLabels`, `baseMonthIndex`, `planYearEndIndex`, `amounts`(기존 ItemSeries의 수/Unreadable JSON)를 갖는다. 파일명은 별도 출처 메타이며 입력 수치 해시와 구분한다.
- `HistoryDependencies`는 repository·기존 두 source 포트·Clock(`now():Date`)·ID 발급(`nextId():string`)·해시(`hash(JsonValue):string`)·버전 값을 갖는다. `ReportDocumentFactory`는 `(input: RestoredReportInput, selection: ExternalHistorySelection) => PreparedDocument`이다. `RestoredReportInput`은 복원 회차·기존 Dashboard·두 산출의 기존 Outcome·gapMonth·authoredAt이고, app/API 구현만 이를 기존 `FinancialReportInput`/DTO로 변환한다.
- `ExternalHistorySelection`은 historySelectionId·scopeId·calculationVersion·지표별 anchor·cutoff·selectedBackfillBatchId·월별 head revision·선택된 StoredCalculation 배열·해당 historyCalculationIds를 갖는다. 단일 선택 batch가 scope/version/범위를 만족하는지 검사한다. version/schema는 서버가 정한다. 최초 식별자는 `risk-policy-2026-09-28@e3a8f9e`, `report@e3a8f9e`, schemaVersion1로 고정하고 이전 버전으로 결과를 재계산/덮어쓰지 않는다.
- 해시·UUID·현재 시각·문서 조립은 주입된 포트/서버 어댑터가 제공한다. 기존 위험 함수는 저장소를 알지 못한다.

### 2.3 로컬 저장 ADR

**Status:** Proposed. **Date:** 2026-10-23. **Deciders:** 사용자(확정 시점·로컬 파일 요구 확정), 구현 담당(어댑터 제안).

**결정 제안:** 브라우저 localStorage·월별 엑셀 수정·JSON append 대신 SQLite 단일 파일을 사용한다. 이력 본문은 스키마 버전과 해시가 있는 JSON으로 보관하고, 검색 키와 참조/확정 버전은 관계형 컬럼으로 관리한다. 로컬 파일 사용 요구와 원자적 중복 처리에 맞춘 선택이다.

| 검토 대안 | 이점 | 한계·판단 |
|---|---|---|
| SQLite 로컬 파일 | 트랜잭션·중복/참조 제약·복구를 한 어댑터로 처리 | 실행 Node API 호환성/백업 필요. v1 제안. |
| 월별 JSON 파일 | 사람이 열기 쉽고 의존성 없음 | 여러 파일 원자 확정·두 프로세스 lock·중단 복구를 직접 구현해야 하므로 제외. |
| 브라우저 localStorage | 화면 연동 간단 | 삭제·브라우저별 분리·트랜잭션/서버 재현 제약으로 확정 저장소에서 제외. |

- 위치: `ai-frm/data/report-history.sqlite`; 기존 `/data/` Git 제외를 유지한다. 폴더는 소유자 전용, DB/백업은 사용자 전용 권한으로 생성한다. 요청으로 임의 파일 경로를 받지 않는다.
- 테이블: `workspace_scope`, `source_capture`, `calculation_record`, `history_selection`, `report_document`, `report_candidate`, `monthly_confirmation`, `monthly_head`, `idempotent_command`, `backfill_batch`, `backfill_step`, `batch_capture_slot`, `schema_migration`.
- `monthly_confirmation(scope_id, report_cycle, revision)` 및 `(scope_id, report_cycle, candidate_id)`, `monthly_head(scope_id, report_cycle)`, `idempotent_command(scope_id, key)`, `backfill_batch(scope_id,start_key)`, `backfill_step(batch_id, report_cycle)`, `batch_capture_slot(scope_id,batch_id,source_key)`에 unique 제약을 둔다. 증거/산출/문서는 내용 해시로 중복 보관을 줄이되 원천 수신 기록과 확정 revision은 잃지 않는다.
- WAL·foreign keys·`synchronous=FULL`·5초 busy timeout을 사용한다. 확정은 짧은 트랜잭션에서 후보 검증→멱등 키 확인→revision 비교→확정/참조 생성→head 갱신을 한 번에 커밋한다. 트랜잭션 안에서 외부 요청/계산/문서 생성은 하지 않는다.
- 같은 멱등 키/같은 후보는 같은 확정 ID를 반환한다. 같은 키/다른 후보는 충돌이다. 새 키라도 이미 확정된 동일 후보이면 기존 ID/revision을 반환하고 head는 변경하지 않는다. 그 외 기대 revision 불일치는 충돌이며 새 내용은 사유를 가진 새 revision으로만 저장한다.
- 시작 시 migration을 적용한다. 미지원 스키마/읽기 전용/손상 파일이면 보관 기능을 중단하고 기존 산출·HTML·인쇄는 유지한다. 빈 DB로 조용히 대체하지 않는다.
- `node:sqlite`가 release candidate인 점과 현재 확인한 v26.8.2 API를 기록한다. 서버 어댑터에 격리하고 최초 지원 런타임은 package engines의 `26.8.2`로 명시한다. 범위 확대는 호환 검증 후 별도 변경하며 글로벌 Node 설치/업그레이드는 하지 않는다.
- 온라인 backup API로 `data/backups/report-history-YYYYMMDDTHHmmssZ.sqlite`를 만든다. 실행 중 DB 파일 하나만 복사하지 않는다. v1에서는 확정본 자동 삭제/보존기간 정리는 하지 않는다. 백업 복구는 별도 경로에서 확인한 뒤 서버를 중지하고 교체하는 수동 절차로 제공한다.
- 결과적으로 브라우저를 닫아도 기록은 남지만 PC의 파일을 잃으면 백업 복구가 필요하다. Task1에서 저장·백업을, Task6에서 복구·이전 절차를 인수한다.

검토 근거: [Node v26.8.2 SQLite API](https://nodejs.org/download/release/v26.8.2/docs/api/sqlite.html), [SQLite의 로컬 저장 용도](https://www.sqlite.org/whentouse.html), [SQLite 온라인 백업](https://www.sqlite.org/backup.html). 여러 서버/네트워크 공유 폴더로 확장하는 설계는 이번 로컬 범위에 포함하지 않는다.

## 3. 기존 계산·문서와 연결하는 방법

### 3.1 원천과 산출 캡처

- 기존 단월 API 실행 시 기록 어댑터가 **실제로 소비한** `SourceResult`/`YieldFetch`를 캡처한다. ECOS 10분 캐시를 거친 값이면 원래 fetchedAt를 보존한다. 현재 응답의 최종 진단 시각 하나를 9종 전체의 수신 시각으로 복제하지 않는다.
- 기존 Outcome의 필드는 유지하고 선택적 `history` metadata(`calculationId`, 요청 맥락, `captureStatus`)만 추가한다. 저장 오류는 계산 실패로 바꾸지 않는다. 메타가 없거나 저장 실패이면 해당 상태를 용지 밖에 보이고 확정만 막는다.
- 실패 응답에도 검증된 요청 월/입력 해시를 감싼 산출 기록을 남긴다. 잘못된 JSON/입력 검증 실패를 정상 산출 후보로 만들지는 않는다.
- 후보 준비와 확정에서는 외부 API를 **0회** 호출한다. 이미 화면에 사용한 calculation ID와 원천 참조를 재사용한다. 같은 최신 회차 수정 파일에 조달 응답을 재사용할 수 있으나 원래 capture ID/조회 시각을 보존한다.

### 3.2 입력·작성일·동일성

- `Statement`에는 함수가 있어 그대로 JSON 저장하지 않는다. 새 app codec이 `StatementInput`에 해당하는 월 라벨·인덱스·6개 계열·Unreadable 사유를 직렬화하고 기존 `createStatement()`로 복원한다. 원본 엑셀 파일은 서버에 보내지 않는다.
- 기준일은 원래 **달력 년/월/일**로 기록한다. 로컬 자정을 ISO instant로 바꿔 UTC 서버에서 전월로 해석하지 않도록 `{year,month,day}`로 보내 `new Date(y,m−1,d)`로 복원하고 회차 일치를 검사한다.
- 서버는 복원된 회차로 기존 `assessDashboard()`와 `roundEntryOf()`를 사용한다. 건설 산출 당시 ledger 해시와 현재 복원 ledger 해시가 일치해야 한다. 파일명·파일 크기·배열 참조는 영속 입력 ID로 쓰지 않는다.
- `authoredAt`은 사용자가 보고서를 열었을 때의 작성 시각을 고정한다. 서버의 `preparedAt`/`confirmedAt`은 별도다. 자정을 넘어 확정해도 문서 작성일은 바꾸지 않는다.
- 기존 `buildFinancialReport()`는 app 타입을 알므로 새 application에서 직접 import하지 않는다. `app/api` 조립점의 문서 factory가 기존 함수를 호출하고 §1.4의 이력 투영 후 `PreparedDocument`를 만든다.
- UI는 `inputGeneration + scope + 입력 해시 + 선택월 + calculationIds + 표시 문서 hash`를 대조한다. 후보 준비 중 파일/선택월/응답이 바뀌면 자동 확정을 취소한다. 이미 준비한 후보/확정 문서는 변경하지 않는다.

### 3.3 중단 가능한 보완 배치

- 외부 요청 없는 준비 점검에서 회차별 성공 가능/부족 회차/원본 열 부재를 보여 준다. 실행 요청은 최대 18회차로 제한한다.
- 배치를 먼저 로컬에 생성하고 ECOS slot을 claim해 9종 응답을 고정한다. 월별 건설 계산에는 저장된 slot의 frozen source를 넣어 기존 `assessPerception()`을 그대로 호출한다.
- KOFIA도 필요한 관측월별 slot을 claim해 캡처한다. 영구 저장된 캡처는 재시도/재개에서 재조회하지 않는다. 응답 수신 후 저장 전 프로세스가 종료되면 네트워크 요청은 재시도될 수 있으며 새 수신 시각을 기록한다. 물리적 exactly-once 외부 호출을 약속하지 않는다.
- slot claim/저장에는 §2.2의 lease/fence를 사용한다. 같은 slot의 캡처 선택은 하나만 채택하고, 완료된 step도 하나만 커밋한다. 동시 작업이 같은 고정 입력으로 중복 계산하더라도 채택 결과를 추가 revision으로 만들지 않는다. 전체 배치가 동일 시각의 원천이라고 주장하지 않는다.
- HTTP 한 요청에서 무제한 백그라운드 Promise를 실행하지 않는다. `start` 후 `step` 요청 하나가 한 보고 회차를 처리하고, 페이지가 다음 step을 요청한다. 브라우저/서버를 닫으면 pending으로 남기고 같은 batch ID로 재개한다. 완료된 step/성공 캡처를 다시 조회하지 않는다.
- start 요청에는 UUID startKey를 유지해 응답 유실 재시도도 같은 batch ID를 받는다. 시작 응답 전에 탭을 닫았어도 서버의 최근 active batch 목록(최대20개)에서 찾아 재개한다. 브라우저 저장소를 이력 원본으로 삼지 않는다.
- 아직 캡처하지 않은 KOFIA 월은 재개 시 최초 캡처할 수 있다. 이미 실패로 캡처한 월을 새 자료로 다시 보완하려면 새 배치를 만든다. 따라서 배치 전체 공통 원천시점을 보증하지 않는다.
- 지표/월별 부분 실패는 결과로 저장하고 다른 월을 계속 처리한다. 디스크/트랜잭션 실패는 처리 완료로 표시하지 않고 재시도할 수 있게 한다.

## 4. 변경 파일과 책임

경로는 저장소 루트 기준이다. 계획 단계에서는 아래 코드 파일을 만들지 않는다. 기존 파일 편집을 우선하며 저장/이력의 새 책임만 독립 파일로 추가한다.

| 파일 | 작업·책임 |
|---|---|
| 새 `ai-frm/src/domain/report-history/report-history.ts`와 `.test.ts` | 월별 확정/정정·버전 불변식. 위험 산식과 분리. |
| 새 `ai-frm/src/application/report-history/ports.ts` | §2.2 repository·시계·ID·해시·문서 factory 포트와 기록 타입. |
| 새 `ai-frm/src/application/report-history/report-history.ts`와 `.test.ts` | 캡처/후보/확정/조회 조율. |
| 새 `ai-frm/src/application/report-history/historical-risk-backfill.ts`와 `.test.ts` | 준비 점검·고정 입력·월별 기존 함수 호출·배치 재개. |
| 새 `ai-frm/src/infrastructure/report-history/sqlite-history-repository.ts`와 `.test.ts` | migration·원자 저장·멱등·head CAS·백업. |
| 새 `ai-frm/src/infrastructure/report-history/evidence-codec.ts`와 `.test.ts` | 정렬 JSON·Map/Date 복원·정밀도·해시·런타임 스키마 검사. |
| 새 `ai-frm/src/infrastructure/report-history/captured-sources.ts`와 `.test.ts` | 기존 source 포트의 기록/frozen 어댑터. |
| 수정 `ai-frm/src/app/api/_lib/composition.ts`, `handlers.ts`와 기존 handler 테스트 | 저장소·원천 캡처 조립. 기존 계산 응답 보존. |
| 수정 기존 두 API `route.ts`·`dto.ts` | 서버 runtime 고정, 선택적 history receipt만 추가. |
| 새 `ai-frm/src/app/api/_lib/report-history-handlers.ts`와 `.test.ts` | HTTP 검증·app 문서 factory·히스토리 명령 변환. |
| 새 `ai-frm/src/app/api/report-history/route.ts` | 후보 POST, 후보/확정 문서/확정 목록 GET. |
| 새 `ai-frm/src/app/api/report-history/confirm/route.ts` | 확정/정정 POST. 새 입력/산식은 받지 않고 후보 ID만 확정. |
| 새 `ai-frm/src/app/api/report-history/backfill/route.ts` | plan/start/step POST 및 진행 GET. |
| 새 `ai-frm/src/app/aifrm/report-history-view.ts`와 `.test.ts` | Statement 달력 DTO, UI 상태 전이, API 계약. 서버 모듈 import 금지. |
| 새 `ai-frm/src/app/aifrm/report-history-projection.ts`와 `.test.ts` | 기존 보고서의 외부 points/coverage/historyNote만 투영. |
| 새 `ai-frm/src/app/aifrm/report-history-controls.tsx`와 `.test.tsx` | 용지 바깥 보완·확정·이력 열기·상태/복구. 기존 Astryx 사용. |
| 수정 `ai-frm/src/app/aifrm/page.tsx` | generation·receipt·후보/확정 문서 표시 연결. 기존 계산/useMemo/포커스 유지. |
| 수정 기존 두 외부 지표 card 훅 | receipt/요청 상관 정보 노출만 추가. 월 정책/조회 재시도 의미는 유지. |
| 수정 `ai-frm/src/boundaries.test.ts` | infrastructure/report-history 및 node:sqlite가 API 경계 밖으로 새지 않도록 확장. |
| 수정 `ai-frm/package.json`, `README.md`, 기존 UI 진행 기록 | 지원 Node·백업/복구·데이터 경로·단계 검증 기록. |

**HTTP 계약:** 모두 서버가 default scope를 주입하고 `runtime='nodejs'`, no-store를 적용한다. 변경 명령은 같은 origin/허용된 로컬 host만 허용하고 본문 크기/18회차 제한을 검사한다.

- `POST /api/report-history`: `command:'select-history'`, 현재 basis, `selectedBackfillBatchId:string|null` → 서버의 일관 읽기로 고정한 `ExternalHistorySelection`. UI와 후보 준비가 같은 selection을 공유한다.
- 같은 POST의 `command:'prepare'`는 `inputGeneration`, 정규화 statements, 선택월, `constructionCalculationId`, `fundingCalculationId`, `historySelectionId`, `authoredAt` → `candidateId`, `documentHash`, 불변 `FinancialReport` 문서 또는 준비 불가 사유. 후보 준비 시 최신 batch/head를 다시 선택하지 않는다.
- `GET /api/report-history`: `candidateId`/`confirmationId`/`historySelectionId` 중 하나 또는 확정 목록의 cycle 필터. 다른 scope/모르는 ID는 내용 없이 404.
- `POST /api/report-history/confirm`: §2.2 `ConfirmationCommand`만 받는다. 첫 확정 `expectedRevision=0`; 정정은 현재 revision과 사유 필수. 성공/기존 성공 200, 충돌 409, 준비 불가 422, 저장 실패 503.
- `POST /api/report-history/backfill`: `command:'plan'|'start'|'step'`; plan/start는 범위·정규화 RoundEntry·입력 generation, start에는 startKey 추가, step은 batch ID만 받는다. start 응답의 batch ID를 유지한다. GET은 batch ID의 진행 또는 최근 active batch 목록(20개)을 읽는다.

## 5. 구현 순서·TDD·단계별 커밋

모든 명령은 `ai-frm/`에서 실행한다. 각 Task는 아래 기능이 독립적으로 테스트 가능한 상태에서 리뷰하고 커밋한다.

### Task 1: 로컬 불변 저장소와 월별 확정 불변식

**Files:** §4의 새 domain, application ports, SQLite repository, evidence codec, 경계 테스트, package engines.
**Interfaces:** §2.2 전 계약과 `confirmDecision(basis, currentRevision, expectedRevision, correctionReason): ConfirmationDecision`을 제공한다. evidence codec은 유한 수/Map/단위/시각을 손실 없이 round-trip한다.

- [ ] 실패 테스트: 처음은 revision1, 같은 멱등 키/후보는 같은 ID, 같은 키/다른 후보는 conflict, 새 키/이미 확정된 후보도 기존 ID, 정정 후 과거 후보 재시도는 head를 되돌리지 않음, 정정 사유 없음/오래된 expectedRevision 거부, scope A/B 격리.
- [ ] 저장 실패 테스트: 두 repository 연결 동시 확정에서 1개만 승리, 트랜잭션 중 예외면 head/확정/문서 참조 모두 rollback, 재시작 후 동일 문서 복원, 손상/읽기전용 DB의 실패를 성공으로 표시하지 않음.
- [ ] 정밀도/달력 테스트: 0·음수·소수 원값/Map 순서/계열별 시각·단위/실패를 왕복 보존. SQL 반올림·합계·문자열 표시값을 계산 입력으로 쓰지 않음.
- [ ] `npx vitest run src/domain/report-history src/application/report-history src/infrastructure/report-history src/boundaries.test.ts`로 RED 확인 후 구현·GREEN. 새 서버 저장 폴더와 `node:sqlite`의 클라이언트 import 차단 검사도 포함.
- [ ] 신규 DB에 migration→기록→프로세스 재시작→읽기→온라인 백업→별도 임시 경로 복구를 합성 자료로 QA. 독립 리뷰 후 `feat(history): add immutable local history repository` 커밋·진행 기록.

### Task 2: 기존 외부 계산의 원천·실행 receipt 자동 기록

**Files:** captured-sources, application report-history 서비스, 기존 API handlers/composition/route/DTO와 관련 테스트.
**Interfaces:** `captureConstruction(deps: HistoryDependencies, scopeId: string, request: PerceptionRequest, ledger: ForecastLedger): Promise<CapturedOutcome<Outcome<PerceptionReport>>>`, `captureFunding(deps: HistoryDependencies, scopeId: string, request: FundingRiskRequest): Promise<CapturedOutcome<Outcome<FundingRiskReport>>>`. HTTP 조립 시 기존 Outcome를 그대로 펼치고 history만 추가한다. 실패 metadata에는 저장 오류 코드만 포함하며 산출 본문을 바꾸지 않는다.

- [ ] 실패 테스트: 기록 사용 전후 기존 단월 결과를 deepEqual. 계산에 사용한 ECOS 9종/금리 응답과 fetchedAt를 캡처하며 API 키/키 포함 URL은 JSON·오류·로그에 없음.
- [ ] 월 테스트: 합성 R=2026/08은 건설06·조달 판단08/관측07. 실패 Outcome에도 검증된 요청 맥락/ID가 남음. 읽지 못한 입력은 정상 receipt로 저장하지 않음.
- [ ] 저장 장애 시 원래 산출 성공/산출불가 상태는 그대로이고 `captureStatus='failed'`만 반환하는 RED를 확인 후 구현.
- [ ] 기존 handler·construction/funding·경계 테스트와 전체 verify 통과. 저장소를 비활성/실패시킨 실제 합성 API QA 후 독립 리뷰·`feat(history): capture external calculation evidence` 커밋·진행 기록.

### Task 3: 과거 자료 준비 점검·보완·중단 후 재개

**Files:** historical-risk-backfill 서비스/테스트, backfill route/handlers.
**Interfaces:** `planBackfill(input: BackfillInput): BackfillPlan`, `startBackfill(deps: HistoryDependencies, input: BackfillInput & {startKey:string}): Promise<StoredBatch>`, `runBackfillStep(deps: HistoryDependencies, scopeId: string, batchId: string): Promise<StoredBatch>`. span은 최대18, step은 한 회차.

- [ ] 실패 테스트: 같은 고정 source/ledger/now의 월별 기존 함수 결과와 batch 결과가 지수·등급·세부 원값까지 동일. 정상 실행에서 ECOS 배치당1회·KOFIA 관측월당1회, 영속 캡처 후 재개에서는 해당 원천 재조회0회. 저장 전 crash는 재시도 허용/새 시각 기록.
- [ ] slot 동시 claim·lease 만료 후 회수·과거 fence의 늦은 응답 거부·증거 저장/slot 연결 원자성·완료 step 중복 방지를 두 repository 연결로 검증한다.
- [ ] start 응답 유실 후 같은 startKey로 재시도하면 같은 batch ID, 다른 payload/같은 키는 충돌. 시작 직후 탭 종료 후 active 목록에서 같은 배치를 찾아 재개.
- [ ] b−1/b+2 회차 부족, 연말 전년도 실적 열 부재, 전년동월/전월 원값 부재, 기준값0, 미래 관측월, 마지막 평가일 평균 결측을 기존 사유대로 기록하는 RED를 먼저 확인.
- [ ] source가 다음 호출에서 수정값을 반환해도 현재 batch의 캡처는 불변. 새 batch만 새 revision 원천을 사용. 일부 월 실패·서버 중단·step 응답 유실 후 재시도에도 중복/반쪽 완료 없음.
- [ ] `npx vitest run src/application/report-history/historical-risk-backfill.test.ts src/infrastructure/report-history src/app/api/_lib/report-history-handlers.test.ts` GREEN, 전체 verify·관련 lint·독립 리뷰.
- [ ] 합성 부족 회차/연말/18개월·재개 QA 후 `feat(history): backfill past risks from frozen sources` 커밋·진행 기록. 실제 ECOS/KOFIA는 사용자가 실행한 보완 명령에서만 호출한다.

### Task 4: 기존 차트에 이력 점 연결·보완 상태 UI

**Files:** 새 projection/view/controls, page 연결, SSR 테스트. 보호 템플릿 파일은 수정하지 않는다.
**Interfaces:** `withExternalRiskHistory(report: FinancialReport, history: ExternalHistorySelection): FinancialReport`는 construction/funding의 `points/historyCoverage/historyNote`만 바꾼다. selection에는 cutoff·scope·계산 버전·선택 ID가 들어간다.

- [ ] 실패 테스트: 건설06/조달07의 서로 다른 anchor, 미래 점 제외,18달력월·연도 경계·누락월 단절·0/음수 보존. 자체 현재 지표만 확정 우선/확정 불가 월은 불가 유지/확정 없는 달만 선택 batch 보완값 사용. 확정 문서에 복사된 reconstructed 과거점을 소급 확정값으로 승격하지 않음.
- [ ] 선택 이후 다른 batch/head가 생겨도 같은 historySelectionId는 같은 산출 ID/차트를 반환. 다른 scope/version/basis의 selection은 후보 준비에서 거부하며 최신 batch로 교체하지 않음.
- [ ] 건설/조달의 서로 다른 anchor를 HistorySelectionQuery로 전달하면 같은 일관 읽기와 하나의 historySelectionId로 고정됨을 검증한다.
- [ ] 현재 실패+과거 정상 시 본문·현재 상태/사유는 불변. 같은 report를 input-mutating하지 않고 기존 다른3개 지표·문구·산식·값·작성일 deepEqual. 서로 다른 scope/단위/버전 거부.
- [ ] Controls에는 보완 범위/진행/부족 회차·보완 포함 상태만 제공. 초기에는 불필요한 설명을 접고 용지 밖에 배치하며 인쇄에서 제외한다. 실제 Astryx 문서를 조회하고 기존 포커스를 유지한다.
- [ ] projection RED→GREEN, 기존 report-model/chart-view/preview 정밀도 테스트 통과. 합성18개월 실제 화면에서 라벨·범례·3개 용지·차트5개를 QA하고 템플릿/CSS/이미지 diff0 확인.
- [ ] 독립 리뷰 후 `feat(history): project external histories into existing charts` 커밋·진행 기록.

### Task 5: 보고서 확정 자동 보관·정정·확정본 재열람

**Files:** domain/application 확정 서비스, report-history HTTP handlers/routes, app view/controls/page와 기존 훅의 receipt 노출.
**Interfaces:** `prepareReportCandidate(deps: HistoryDependencies, input: PrepareCandidateInput, documentFactory: ReportDocumentFactory): Promise<PreparedCandidate>`, `confirmMonthlyReport(deps: HistoryDependencies, scopeId: string, cmd: ConfirmationCommand): Promise<ConfirmationResult>`, `openConfirmedReport(repository: HistoryRepository, scopeId: string, id: string): Promise<PreparedDocument>`. 준비/입력 오류는 도메인·검증 사유로 반환하며 HTTP 경계가422/503으로 변환한다.

- [ ] 실패 테스트: Statement 달력 DTO의 KST/UTC 월초·연초 round-trip 후 회차/계산 동일. 같은 이름의 수정 내용은 새 입력, 이름만 다른 동일 내용은 같은 핵심 입력 해시. 수정 ledger+옛 construction calculationId는 거부.
- [ ] 보고서 열기 전에는 산출 기록만 보관하고 document candidate는 없음. 후보 준비 시 서버가 기존 dashboard 계산·기존 문서 factory·선택된 historySelectionId를 재사용하고 외부 조회0회. `authoredAt`을 보존해 자정 전 열고 다음 날 확정해도 작성일 불변. 과거 회차를 지금 확정해도 confirmedAt은 실제 현재 시각.
- [ ] pending/receipt 미보관/다른 scope·월·버전은 확정 차단. 종료된 일부 불가 후보는 당시 사유 그대로 확정 가능. 커스텀 실효 월은 기본월로 변경하지 않고 월별 확정 불가만 안내.
- [ ] A 준비 중 B 파일 적용/선택월 변경/늦은 A 응답이면 자동 확정 중단. 표시 hash가 다르면 새 후보를 보여 주고 재클릭 필요. 같은 클릭의 중복 전송·503 후 재시도·두 탭 경합은 §2.3대로 처리.
- [ ] 확정본 재열람 시 외부 API0회·이력 재선택0회. 후일 ECOS 수정/새 보완 batch/다음날 재열람에도 문서 JSON/hash·값·차트·작성일 동일. unsupported template/schema version은 재계산으로 대체하지 않음.
- [ ] ‘확정 중/확정됨/보관 실패·재시도/정정 사유/확정본 열기’는 용지 밖 UI에만 추가. 기존 산출·파일 복원·HTML 열기·인쇄·포커스는 유지.
- [ ] 대상 테스트 RED→GREEN·전체 verify·관련 lint·독립 리뷰·합성 서버 재시작/오프라인 저장소/동시 탭 QA 후 `feat(history): confirm and reopen monthly report snapshots` 커밋·진행 기록.

### Task 6: 전체 보존 검증·운영 문서·인수 QA

**Files:** README·진행 기록·확인된 결함의 소유 파일만. 새 기능을 위한 보고서 템플릿 수정은 하지 않는다.

- [ ] 합성 기본회차/일부 불가/18개월/연말/수정파일/중복확정/두탭/디스크실패/재시작/백업복구 시나리오를 실행한다. 미완료는 완료로 표시하지 않는다.
- [ ] 기존 위험 계산·월 선택·판독 테스트 및 보고서 값/정밀도 테스트를 변경 없이 통과시킨다. 보호 파일 diff0와 저장 경로 Git 제외를 검사한다.
- [ ] 전체 lint·`npm run build -- --webpack` 완료 후 `npm run verify`를 순차 실행한다. 현재 기준647 passed/기존2 skipped에 추가된 의미 있는 테스트가 모두 포함되어야 한다.
- [ ] 실제 화면·키보드·오류 복구·보관 UI의 인쇄 제외를 검증한다. 지원되는 브라우저에서 PDF 저장 후3쪽/페이지 경계·18개월 라벨을 수동 검수한다. 기존 자동 승인/브라우저 접근 제약으로 실행할 수 없으면 그 구체 한계와 미검수 상태를 기록하며 우회하지 않는다.
- [ ] 데이터 파일/백업 위치, 원본 엑셀 불변, 외부 연결 없음, 같은 PC/서버에서만 자동 보관됨, 복구 절차, 정정/보완의 의미를 README에 기록한다.
- [ ] 최종 독립 리뷰·수정·재검증 후 `docs(history): document local archive and recovery` 커밋. 단계별 결과와 다음 재개 지점을 기존 컨텍스트 문서에 남긴다. 원격 push·merge·배포는 별도 요청 전 수행하지 않는다.

## 6. 계획 자체 검토와 구현 시작 조건

- 요청 범위 대응: 과거 보완(Task3), 월별 확정 자동 보관(Task1·2·5), 기존 추이 연결(Task4), 계산/템플릿 유지(전 Task·Task6), 로컬 파일/외부 연결 제외(Task1·6)를 모두 배정했다.
- 핵심 논리 검토: 파일 적용≠업무 확정, 재구성≠당시 확정, 제목 월≠지표 월, 후보 저장≠확정 완료, 화면/HTML 용지 수≠실제 PDF 저장 검증을 구분했다.
- 재현 책임: 원천은 계산에 사용한 캡처로, 로컬 입력은 달력 DTO로, 확정 문서는 당시 문서/이력 ID로 고정한다. 확정 단계에서 새 외부 자료를 받지 않는다.
- 독립 검토2회에서 받은 원자 캡처 연결·저장 전 중단 한계·후보 준비 시점·확정 우선점 자격·선택 ID·동일 후보 멱등·live 의미와 두 anchor의 selection query 계약 지적을 문서와 담당 Task 테스트에 반영했다. 최종 재검토의 남은 시그니처1곳도 HistorySelectionQuery로 정리했다. 문서 링크·코드 fence·6개 Task·미완료 체크 상태·애플리케이션 diff0를 확인했다. 문서 변경이므로 앱 테스트/빌드를 새로 실행했다고 보고하지 않는다.
- 기존 계산/템플릿을 수정해야만 통과하는 구현이라면 범위를 넓히지 말고 저장·투영·월 대응 버그를 먼저 찾는다. 별도 기대값 CSV나 골든 PDF 수치를 생성/복사하지 않는다.
- 이번 요청은 계획 수립이다. 구현 Task는 모두 미완료로 남기며, 실제 구현은 이 계획 검토 후 단계별 검토·QA·커밋 방식으로 시작한다.
