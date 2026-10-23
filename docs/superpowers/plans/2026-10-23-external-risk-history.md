# 과거 자료 보완·월별 확정 이력 및 엑셀 정정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 계산식과 보고서 템플릿을 유지하면서 과거 자료와 월별 확정 이력을 로컬에 보관하고, 비개발자가 엑셀로 원자료를 수정한 뒤 검증·재계산·정정 확정할 수 있게 한다.

**Architecture:** 원천 캡처·정규화 회차 입력·계산 실행·업무 확정을 분리해 로컬 SQLite에 불변 보관하고, 기존 차트에는 이력 점만 투영한다. 엑셀은 조회·수정안 교환에 사용하며, 가져온 수정안은 서버의 기준 기록과 대조하고 기존 함수로 재계산한 뒤 별도 정정 확정으로 새 버전을 만든다. 원본 캡처와 이전 확정 문서는 그대로 보존한다.

**Tech Stack:** 현행 Next.js 16.3.4·React 19·TypeScript·Astryx 0.5.4·Vitest, 기존 SheetJS `xlsx@0.18.5`, 확인한 Node.js v26.8.2의 `node:sqlite`/`DatabaseSync`·`backup`·crypto·zlib. 외부 DB·스프레드시트 연결·새 npm 패키지·스케줄러는 사용하지 않는다.

**Spec:** 이 문서 §1~§4가 명세다. 사용자 요청 ‘기존 계산식과 리포트 템플릿은 유지’, ‘보고서 확정 시 자동 보관’, ‘로컬 파일로 기록’과 최신 ‘엑셀 내보내기·수정본 가져오기·정정 검증까지 포함해서 구현 계획 보완’을 따른다. 이전 제공 자료 기반 계획은 [2026-10-21-report-history.md](./2026-10-21-report-history.md), 현재 템플릿·서체·원본 참고표 기준은 [UI 진행 기록](./2026-10-21-ui-ux.md)의 최신 항목이다.

**상태:** Task1(`14648d1`)·Task2 구현·검토·QA 완료, Task3 대기. 최신 커밋/검증과 재개 지점은 UI 진행 기록을 따른다. 시작 커밋 `19673b1`, 보호 계산/템플릿 기준 `e3a8f9e`, 최초 계획 `89db12a`. 완료 단계와 검증은 아래 체크 및 최신 UI 진행 기록을 따른다. 실제 업무 파일을 읽지 않고 합성 자료로 검증한다.

## Global Constraints

- **“기존 계산식과 리포트 템플릿은 유지”**: `src/domain/risk/**`, 기존 `application/construction-perception.ts`·`funding-risk.ts`·`dashboard.ts`, 회차 판독·월 대응·가중치·임계값·정밀도를 수정하지 않는다.
- `report-model.ts`·`report-preview.tsx`·`report-chart.tsx`·`report-chart-view.ts`·`report-reference.ts`·`format.ts`·`globals.css`·`ThemeProvider.tsx`·참고 PNG의 diff 0을 유지한다. 이력은 새 투영 함수에서 연결한다. 현재 보고서 3쪽·차트 5개·본문·서체·원본 참고표·인쇄 용지/배치는 그대로다.
- 확정 트리거는 용지 바깥의 **‘보고서 확정’**이다. 파일 적용·보고서 열기·인쇄 버튼·PDF 저장 시도를 업무 확정으로 간주하지 않는다.
- 확정 이력 원장은 PC에서 실행 중인 Next.js 서버의 `ai-frm/data/report-history.sqlite`다. 사용자는 앱에서 조회·내보낸 `.xlsx`의 수정 입력 칸을 편집하고 앱으로 다시 가져온다. 엑셀 저장만으로 원장/확정본은 바뀌지 않는다. 다른 PC로 이전할 때 DB·내보내기 기준 기록·백업을 함께 이전한다.
- 외부 스프레드시트 연결은 후속 답변으로 제외됐다. 외부 DB/클라우드 업로드·백그라운드 정기 수집도 이번 범위가 아니다.
- 원래 업무용 자금수지표 `.xlsx`/PDF는 복제·전송·덮어쓰기하지 않는다. 앱이 생성한 정정용 교환 `.xlsx`만 새 전용 경로로 로컬 서버에 가져오는 것은 이번 추가 범위다. 원본 파일과 별개로 정규화 입력·수정안·산출 결과를 로컬 보관한다. 실제 재무 수치·비밀값·교환 파일·DB·백업은 Git·로그·fixture에 넣지 않는다.
- 엑셀에서 지수·등급·산식·가중치·기준월/단위/평가일 식별자는 직접 수정할 수 없다. 수정 허용 필드는 §1.5의 원자료와 사유뿐이다. 워크시트 보호는 편집 안내이며, 실제 검증 기준은 서버에 보관한 내보내기 명세다.
- 원래 회차를 다른 회차의 수정 실적으로 대체하지 않는다. 결측/조회 실패/비적용·0·음수를 구분하고 보간·0 채움·이전 월/이전 평가일 후퇴를 하지 않는다.
- 과거 보완 경로는 `reconstructed`, 일반 단월 산출 경로는 `live`로 기록한다. `live`는 기준월 당시에 확보한 자료라는 뜻이 아니다. 실제 원천 확보 시점은 fetchedAt/receivedAt, 업무 확정 시점은 confirmedAt로 구분한다. 후일 재조회한 값이 기존 확정 문서·값·추이를 덮어쓰지 않는다.
- 매 단계 TDD 또는 의미 있는 시각 RED→GREEN, 독립 검토, 적절한 QA, 별도 커밋과 진행 기록을 남긴다. 전체 빌드와 `tsc`는 동시에 실행하지 않는다.
- `ai-frm/AGENTS.md`와 설치된 Next.js 문서·Astryx CLI를 따른다. 화면 조작/알림은 용지 바깥의 실제 Astryx 컴포넌트로 구성한다.

## Review Focus

1. 보고서 제목 월·건설 기준월·조달 판단/관측월·달력 날짜를 혼동하면 한두 달 이동하거나 시간대에 따라 전월로 저장된다. → Task 2·3·5의 월/날짜 테스트.
2. 같은 회차 수정 파일·늦은 응답·타 scope/변조된 내보내기 ID·수정 중 입력 변경이 새/옛 입력을 섞지 않아야 한다. → Task 2·5·6·7의 해시·generation·명세 대조 테스트.
3. 두 탭 정정·오래된 엑셀·응답 유실·서버 종료·디스크 오류가 중복/반쪽 확정 또는 거짓 ‘저장됨’을 만들면 안 된다. → Task 1·5·7·8의 멱등·revision/CAS·장애 테스트.
4. ECOS 수정치·보완 배치·수기 정정이 과거 문서/작성일/차트를 바꾸거나 다른 보고서를 자동 정정하면 안 된다. → Task 3·4·5·7·8의 출처·영향·무조회 재열람 테스트.
5. 무수정 엑셀 왕복의 정밀도, 빈칸/0/결측, 연말 열 부재, 수식/단위 오류·18개월·저장 실패에도 산식·템플릿을 보존한다. → Task 3·4·6·7·8·9의 파일·도메인·템플릿 회귀 QA.

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

### 1.5 비개발자용 엑셀 조회·정정

**흐름:** 확정 이력에서 대상 보고서 선택 → 정정용 엑셀 내보내기 → 수정 입력 칸 편집 → 수정본 가져오기 → 오류/원자료·산출값·등급 차이/영향 보고서 확인 → 사유와 함께 ‘정정 확정’. 가져오기·검증·미리보기만으로 기존 확정값을 바꾸지 않는다.

- v1의 한 파일은 **선택한 확정 보고서 한 개와 해당 revision**을 기준으로 한다. 최근18개월 이력은 조회용으로 함께 내보내되, 다른 보고서의 직접 원자료를 한 파일에서 일괄 정정하지 않는다. 다른 확정본에 미칠 영향은 목록으로 보여 주고 대상별로 별도 정정한다.
- 파일명은 `aifrm-history-<reportTitleMonth YYYYMM>-r<revision>-<exportId 앞8자리>.xlsx`. 앱이 선택한 다운로드 위치에 새 파일을 만들며 원본 자금수지표를 덮지 않는다. 내보내기 완료는 로컬 파일 저장/업무 확정을 증명하지 않는다.
- 시트는 `안내`, `확정이력`, `경제지표_정정`, `자금자료_정정`, `조달금리_정정`, `_교환정보`의6개다. 결과·월별 이력·단위/출처는 기존 저장 모델에서 그대로 표시하고 엑셀에 계산 수식을 새로 만들지 않는다. 화면/리포트 템플릿과 이 관리용 엑셀 양식은 별개다.
- `안내`·`확정이력`·`_교환정보`는 시트 보호를 적용한다. 정정 시트에는 식별 정보·기준값(읽기 전용)과 `수정 동작`·`수정 값`·`정정 사유`·`근거 메모`(수정 입력)를 명확히 구분한다. 보호 열을 편집했더라도 서버 검증에서 거부한다. 세밀한 셀별 잠금/색상은 현재 SheetJS 기능으로 보장한다고 가정하지 않는다.

| 원자료 | 수정 허용 | 유지/금지 사항 |
|---|---|---|
| ECOS 9종 | 해당 건설 산출이 사용한 당월/비교월 원값. 성공 캡처에서 계열·비어 있지 않은 단위가 확인된 월 결측만 출처를 명시해 보완 허용. | 지표/통계 계열/월/캡처 단위 고정. 조회 실패/빈 단위 계열은 읽기 전용이며 새 조회/배치·새 확정 후 내보내기 필요. 변화율·점수·기여도·지수·등급·가중치는 읽기 전용. 공표된 공식 수정으로 표시하지 않음. |
| 정규화 자금수지표 | 저장된 회차의6개 금액 항목(`기초시재/수입계/수입/분양회수/기타수입/지출`)의 기존 월 칸. | 억원 단위·기준일·회차·월순번·계획연도 끝은 고정. 수정한 전체 StatementInput에서 기존 createStatement/roundEntryOf/assessDashboard를 다시 사용. 분리된 RoundEntry/예측오차를 직접 수정하지 않음. |
| 조달금리 | 저장된 관측월 평가일별 공사채 AAA 1년/국고채 1년의 **공표 3사 평균 금리**. | 단위는 %이며 3.674는3.674%. 날짜/채권/만기/평가사별 참고값은 고정. 평균은 원천 입력이며 평가사 값으로 다시 평균 내지 않음. 차이(%p)·등급은 읽기 전용. |

- 경제지표는 필요한 현재/비교 셀만, 자금자료는 보고서에 저장된 전체 정규화 회차 입력의 월/항목 셀만, 조달금리는 저장한 관측월 평가일만 내보낸다. 데이터 없는 행/월을 사용자가 임의 추가할 수 없다. 과거 차트 점을 고치려면 그 점의 보고 회차를 선택해 별도 정정한다. 아직 확정되지 않은 보완 결과는 해당 회차 보고서를 지금 확정한 뒤 정정하며 소급 확정으로 표현하지 않는다.
- `유지`: 수정 값 빈칸·사유 빈칸. DB의 기존 수를 그대로 재사용한다. `값수정`: 유한한 숫자와 비어 있지 않은 사유 필수. **0은 실제 값**이다. `결측처리`: ECOS 값 제거/KOFIA 평균 null에만 허용하고 사유 필수다. 빈칸을 암묵적으로0/결측으로 변환하지 않는다.
- 자금자료에는 개별 칸 결측처리/월 추가를 허용하지 않는다. 기존 항목 전체가 Unreadable이면 같은 항목의 모든 기존 월 값을 완성해야 정상 계열로 복구한다. 일부 칸만 채우면 남은 월을 안내하고 가져오기를 거부한다. 없는 전년도 열을 만들거나 다른 회차 값으로 대신 채우지 않는다.
- 자금 금액 수정은 전체 StatementInput의 불변 복사본에 적용하고 ledger와5개 지표를 기존 함수로 재확인한다. 외부 지표만 수정한 경우에도 로컬 결과·문서와의 일관성을 검증한다. 원본 자금수지표 reader/기존 위험 함수를 수정하거나 엑셀 산식을 따로 복제하지 않는다.
- 결과가 같아도 실제 원자료가 바뀌면 변경 사실과 ‘산출값 변화 없음’을 미리보기에 표시한다. 반대로 같은 수를 다시 적었거나 무수정 왕복이면 no-change로 종료하고 새 캡처·산출·revision을 만들지 않는다.
- 새 수정은 해당 캡처/회차 입력의 **수기 정정 파생본**이다. 원본 캡처·엑셀·다른 회차·다른 원천 vintage를 덮지 않고, 다음 업로드/API 응답에 자동 전역 override를 적용하지 않는다. 다른 업무 원본에도 반영하려면 사용자가 원래 업무 파일을 별도로 수정해야 한다.

### 1.6 정정용 엑셀 검증·정밀도·영향 규칙

- 서버가 내보내기 전에 `exportId`별 불변 명세를 먼저 저장한다. scope/기준 confirmationId와 revision/문서·입력·산출 ID/계산·템플릿·교환양식 버전/행 ID별 원천 경로·단위·기준값·허용 동작을 보관한다. 파일 안의 메타·숨김·비밀번호·해시만 신뢰하지 않는다. DB에 대응 명세가 없으면 수정 반영을 거부하고 원래 이력 DB 또는 재내보내기를 안내한다.
- 내보내는 기준 원값은 `Number.toString()`의 왕복 가능한 **텍스트**로 표시한다. 미수정 가져오기는 DB 원값을 재사용하므로 Excel의15자리 제한/표시 반올림이 정정으로 바뀌지 않는다. 출력 지수/등급도 참고 문자열이며 계산 입력으로 읽지 않는다.
- 수정 값은 숫자 셀의 유한 `v` 또는 공백 없는 일반 십진 텍스트(`[+-]?(정수.소수 또는 소수)`)만 허용한다. 텍스트 문법은 `/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/`로 고정한다. 문자열의 천단위 쉼표·통화기호·%·날짜/과학표기는 거부하고 숫자만 입력하도록 안내한다. 숫자 셀이라도 날짜/% 서식·수식·Boolean·오류 타입은 거부한다. 유효한0·음수는 기존 도메인 규칙에 맡기며 임의 양수 제한을 만들지 않는다.
- 숫자 파싱 뒤 미리보기에는 실제 계산에 넣을 정밀도 그대로 표시한다. 오버플로/언더플로(0이 아닌 십진수가0이 됨)·유한하지 않은 값은 거부한다. 부동소수의 표시용 반올림·금액 환산을 하지 않는다. 정상 입력의 IEEE754 값은 기존 런타임과 동일하게 사용한다.
- `.xlsx` 교환 양식만 지원한다. 수식 셀(`f/F`)과 캐시값·매크로·외부 workbook/하이퍼링크·지원하지 않는 시트/버전은 실행하지 않고 거부한다. 정정 시트의 추가/누락/중복 행, 보호 열·월/단위/결과·행 ID 변경도 전체 오류다. 행 순서·일반 글꼴/열폭 변경은 무시하며 행 ID로 대조한다. 텍스트를 HTML이나 수식으로 해석하지 않는다.
- 한 셀이라도 오류이면 **전체 수정안 미반영**이며 시트·셀·이유를 표시한다. 내보내기/수정본 최대5MiB, 압축 해제 총량25MiB, ZIP항목128개, 시트6개, 워크북 전체 데이터행 합계10000개/비어 있지 않은 셀 합계200000개, 셀 텍스트2000자 제한을 둔다. 정상 내보내기 자체가 한도를 넘으면 잘라내지 않고 범위를 줄이도록 안내한다.
- workbook codec은 SheetJS 전에 ZIP 중앙 디렉터리와 실제 제한된 해제를 검사한다. ZIP64·암호화·중복/경로 탈출 항목·지원하지 않는 압축 방식·상한 초과를 거부하며 파일을 디스크에 풀지 않는다. `bookFiles`로 파싱한 뒤에만 크기를 확인하는 방식으로 압축 해제 제한을 보장했다고 하지 않는다.
- 수정안 가져오기 → 구조/명세 검증 → 원자료 차이 정규화 → 기준 head 대조 → 새 입력/캡처 구성 → 기존 함수로 재계산 → 변경 전후와 영향 목록을 불변 미리보기로 고정한다. 이 과정의 원본/기존 확정본/head는 불변이며 **외부 API 호출은0회**다.
- 영향 목록은 저장된 원천·회차 입력 참조를 역추적한다. ECOS 월 m은 기존 변환에 따라 m 및 m+1/m+12 지수, 분양회수 계획/실적 회차는 기존 대응의 다른 지수, 조달 금리는 해당 월 마지막 평가일 선택에 영향을 줄 수 있다. 실제 관련 입력으로 재계산해 차이와 결측 사유를 확인하며 새 영향 산식을 도메인에 복제하지 않는다.
- 동일 원천을 참조한 다른 확정본은 영향 목록만 표시하고 자동 변경하지 않는다. 현재 대상 외 보고서의 ‘영향 가능’과 실제 재계산 가능 여부를 구분한다. 다른 vintage의 동일 월 값을 자동 수정하지 않는다. 이전 보고서에 복사된 과거 점도 자동 정정/확정으로 승격하지 않는다.
- 미리보기 후 ‘정정 확정’에 미리보기 ID·해시·기준 revision·멱등 키·사유만 보낸다. 수정 숫자/산출 결과를 다시 보내 확정하지 않는다. 서버가 저장된 수정안과 후보를 사용한다. 기준 보고서 및 미리보기 차트가 의존한 head가 바뀌면409로 새 내보내기를 안내하며 조용히 병합하지 않는다. 같은 exportId/patch의 단순 재검증은 새 preview를 만들지 않으며 충돌이면409다. 따라서 충돌 복구 방법이 아니다. 새로 내보낸 파일에 수정안을 다시 입력·검증해야 한다.
- 새 정정본은 정정 미리보기 생성 시각을 작성 시각으로 고정하고 실제 confirmedAt은 별도 저장한다. 원본 문서의 작성일/값/차트/hash는 보존한다. 정정 출처·사유·버전은 용지 밖과 관리 엑셀에서 제공하며 PDF 본문에 새 설명/표식을 넣지 않는다.

## 2. DDD 경계와 저장 설계

### 2.1 분리할 기록

| 기록 | 책임·불변성 |
|---|---|
| `SourceCapture` | 실제 계산에 공급한 정규화 ECOS 계열 또는 KOFIA 평가일별 금리. 원천별 단위·수신 시각·오류·내용 해시를 보관하며 변경하지 않는다. |
| `ReportInputSnapshot` | 전체 정규화 Statement 입력·입력 해시·출처 메타. 메서드/원본 xlsx를 저장하지 않는다. 정정 시 새 복사본과 부모 ID를 남긴다. |
| `CalculationRecord` | 기존 유스케이스의 입력 해시·실효 월·버전·결과·원천 ID·live/reconstructed 경로와 captured/manual-correction 파생 구분. 결과를 반올림해 저장하지 않는다. |
| `ReportCandidate` | 입력 묶음·월 조합·외부 산출 ID·작성 시각·문서 해시·차트에 선택한 이력 ID를 묶은 준비 완료 후보. 준비 이후 수정하지 않는다. |
| `HistorySelection` | cutoff·head revision·단일 선택 batch·선택 산출 ID를 고정한 읽기 스냅샷. UI와 문서 후보가 공유한다. |
| `MonthlyConfirmation` | scope/회차별 확정 revision과 후보 참조. 자체 현재 지표 ID와 차트의 과거 참조 ID를 구분하고, 확정 시각·정정 사유·이전 revision을 남긴다. |
| `BackfillBatch` | 요청 범위·입력 해시·고정 원천 참조·월별 진행 상태. 중단 후 완료하지 않은 단계를 재개한다. |
| `WorkbookExport` | 서버가 발급한 내보내기 명세. 기준 확정본·입력/원천·허용 셀과 원값·버전을 불변 보관한다. 엑셀은 이 기록의 교환 표현이다. |
| `WorkbookImport` | 파일 해시·정규화 수정안/해시·검증 오류·no-change 또는 preview 참조. 원본 교환 파일 바이트는 저장하지 않는다. |
| `CorrectionPreview` | 검증된 수정안·파생 후보·전후 차이·타 보고서 영향·검증 시점 head 토큰. 미리보기는 확정/원장 head를 변경하지 않는다. |

`upload-session.committed`는 파일 적용 상태이므로 업무 확정 애그리거트로 재사용하지 않는다. 모든 월 이력을 하나의 애그리거트에 넣지 않고 **한 회차의 확정과 head 갱신**만 원자적으로 처리한다. 차트/파일/SQL은 기존 위험 도메인에 넣지 않는다.

### 2.2 핵심 인터페이스

기본 이력 계약은 Task1에서, 엑셀 계약은 Task6~8에서 정의·구현하며 이후 Task는 같은 이름을 사용한다. `YearMonth`·`Grade` 등 기존 값 타입을 재사용한다.

```ts
type HistoryIndicator = 'construction' | 'funding';
type CalculationOrigin = 'live' | 'reconstructed';
type Derivation =
  | { kind: 'captured' }
  | { kind: 'manual-correction'; importId: string; patchHash: string;
      parentId: string; correctedAt: string };
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
type WorkbookVersion = 1;
type EditAction = 'keep' | 'set' | 'set-missing';
type CorrectionPatch = readonly {
  rowId: string; action: Exclude<EditAction, 'keep'>;
  value: number | null; reason: string; evidenceNote: string;
}[];
type WorkbookCellError = {
  sheet: string | null; row: number | null; column: string | null; code: string; message: string;
};
type DecodedCorrection = { patch: CorrectionPatch; errors: readonly WorkbookCellError[] };
type HistoryOperationErrorCode = 'STALE_BASE' | 'STALE_DEPENDENCY'
  | 'STORAGE_UNAVAILABLE' | 'LIMIT_EXCEEDED' | 'NOT_FOUND' | 'UNSUPPORTED_VERSION'
  | 'EVALUATION_ZONE_MISMATCH';
type RevisionToken = { reportCycle: YearMonth; confirmationId: string | null; revision: number };
type CorrectionConfirmCommand = {
  previewId: string; previewHash: string; expectedBaseRevision: number;
  idempotencyKey: string; reason: string;
};
type ImportResult =
  | { kind: 'invalid'; importId: string | null; errors: readonly WorkbookCellError[] }
  | { kind: 'no-change'; importId: string; baseConfirmationId: string }
  | { kind: 'preview'; previewId: string; previewHash: string };

interface HistoryRepository {
  defaultScopeId(): Promise<string>;
  putEvidence(input: EvidenceWrite): Promise<{ captureId: string }>;
  getEvidence(scopeId: string, id: string): Promise<StoredEvidence | null>;
  putCalculation(input: CalculationWrite): Promise<{ calculationId: string }>;
  getCalculation(scopeId: string, id: string): Promise<StoredCalculation | null>;
  putInputSnapshot(input: InputSnapshotWrite): Promise<{ inputSnapshotId: string }>;
  getInputSnapshot(scopeId: string, id: string): Promise<StoredInputSnapshot | null>;
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
  putWorkbookExport(input: WorkbookExportWrite): Promise<StoredWorkbookExport>;
  getWorkbookExport(scopeId: string, id: string): Promise<StoredWorkbookExport | null>;
  putWorkbookImport(input: WorkbookImportWrite): Promise<StoredWorkbookImport>;
  getWorkbookImport(scopeId: string, id: string): Promise<StoredWorkbookImport | null>;
  getCorrectionPreview(scopeId: string, id: string): Promise<StoredCorrectionPreview | null>;
  stageCorrection(input: CorrectionStageWrite): Promise<StoredCorrectionPreview>;
  commitCorrection(scopeId: string, cmd: CorrectionConfirmCommand): Promise<ConfirmationResult>;
}
```

- `EvidenceWrite`: `scopeId/sourceKind/contentHash/payloadJson/schemaVersion/receivedAt/derivation`. ECOS 9종 Map과 KOFIA 평가일 목록은 원천 포트가 반환한 월 키/순서를 손실 없이 직렬화한다. 캡처를 위해 원본 순서·정밀도를 바꾸지 않는다. 지표별 fetchedAt·단위·결측 사유를 payload에 남기며 인증정보/키 포함 URL은 넣지 않는다. 수기 파생본도 원본 fetchedAt/receivedAt을 유지하고 새 correctedAt/부모 captureId를 별도로 기록한다.
- `InputSnapshotWrite`: `scopeId/statements:readonly StatementSnapshotDto[]/sourceMetadata:JsonValue/inputHash/derivation/createdAt`. 출처 파일명은 수치 해시와 분리한다. 새 수정본은 부모 inputSnapshotId를 연결하고 원래 기준일/월 구조를 바꾸지 않는다. CandidateWrite의 해시는 이 불변 스냅샷과 일치해야 한다.
- `CalculationWrite`: `scopeId/indicator/origin/derivation/effectiveMonth/requestContext/inputHash/calculationVersion/captureIds/resultJson/evaluatedAt/evaluationClockTrace/evaluatedCalendar/evaluationTimeZone/createdAt/batchId?`. effectiveMonth는 실제 차트 월(건설 result.month, 조달 result.observedMonth)이다. 조달 judgedMonth는 requestContext에 별도 보관한다. inputHash는 실제 계산 입력(건설 정규화 ledger, 조달 판단월 요청)의 해시이며 문서 전체 입력 해시와 같다고 가정하지 않는다. 기존 Outcome을 성공·산출불가·실패 상태 그대로 기록한다. `evaluationClockTrace:readonly string[]`는 기존 유스케이스가 호출한 순서대로 실제 Clock 반환 ISO 값을 기록한다(건설은 fetchedAt fallback 때문에 여러 번 호출할 수 있다). `evaluatedAt`은 그 첫 Clock의 ISO instant, `evaluatedCalendar`는 그때의 로컬 `{year,month,day}`, `evaluationTimeZone`은 서버의 IANA 시간대다. 수기 정정은 부모 calculationId를 연결하고 같은 evaluationClockTrace를 순서대로 재생해 재계산한다. 호출 횟수가 기록과 달라지면 버전 불일치로 중단하며 시각을 새로 생성하지 않는다. `origin`은 부모의 live/reconstructed를 유지하며 수기 정정을 live로 승격하지 않는다.
- `CandidateWrite`: `scopeId/basis/inputSnapshotId/inputHash/calculationInputHashes:{construction:string;funding:string}/calculationVersion/authoredAt/preparedAt/calculationIds/historySelectionId/document:PreparedDocument/correctionPreviewId:string|null`. 후보 inputHash는 전체 StatementSnapshot 해시이고, calculationInputHashes는 각 지표의 실제 입력 해시다. 서버가 전체 입력에서 재구성한 건설 ledger 해시/조달 판단월 요청 해시를 대조하며 원천/평가 Clock은 별도 참조다. 조달 결과는 자금 금액에 의존하지 않으므로 같은 판단월의 입력 수정에도 재사용할 수 있다. document는 application의 opaque 값이며 domain이 `FinancialReport`를 import하지 않는다. 엑셀 후보는 일반 commitConfirmation으로 확정할 수 없고 commitCorrection만 사용한다.
- `StoredEvidence`를 포함한 `Stored*`는 각 Write와 서버 발급 ID를 가진 불변 레코드다. getEvidence는 frozen source/엑셀 명세가 기존 원천을 읽는 서버 포트다. `StoredConfirmation`에는 revision·previousConfirmationId·confirmedAt·candidateId와 문서가 연결된다. `HistoryQuery`는 `scopeId/indicator/from/to/calculationVersion/asOf/selectedBackfillBatchId:string|null`이다.
- `BatchWrite`는 `scopeId/startKey/fromCycle/toCycle/inputHash/roundEntriesJson/fixedNow`와 월별 `pending/completed` 목록이다. 동일 scope/startKey와 동일 요청 해시는 기존 batch ID를 반환하고 다른 요청 해시는 충돌이다. ECOS/KOFIA 캡처 ID는 별도 capture slot에 연결한다. `BatchStepWrite`는 `scopeId/batchId/reportCycle/basis:ReportBasis/calculationIds`이며 reportCycle=basis.reportCycle과 각 산출의 실제 월·지표/scope/batch를 검사하고 같은 step은 한 번만 완료된다. 기준월은 기존 유스케이스 결과로 조립하고 저장소가 별도 역산하지 않는다.
- `CaptureClaim`은 `scopeId/batchId/sourceKey/ownerId/now/leaseUntil`이다. sourceKey는 `ecos` 또는 `kofia:YYYY/MM`. claim 결과는 ready(captureId), claimed(fence:number), busy다. `CaptureCompletion`은 slot key+ownerId+fence+EvidenceWrite이며, 현재 fence 소유자만 증거 저장과 slot 연결을 한 트랜잭션으로 완료할 수 있다. lease는90초이고 만료 시 다음 요청이 더 큰 fence로 회수한다. 늦은 응답은 새 slot을 덮지 못한다.
- 필드 타입은 다음으로 고정한다. ID·해시·버전·ISO 시각은 string, 월은 YearMonth, payload/result/requestContext/roundEntriesJson은 JsonValue, schemaVersion은 1, captureIds/historyCalculationIds는 readonly string 배열, calculationIds는 `{construction: string; funding: string}`이다. `sourceKind`는 `'ecos'|'kofia'`, 결과 유효성/등급은 기존 Outcome 안에서 보존한다.
- `ConfirmationSummary`는 `confirmationId/reportCycle/revision/confirmedAt/candidateId/correctionReason?`를 갖는다. `StoredConfirmation`은 이 값과 scopeId·previousConfirmationId(null 허용)·basis·canonicalCurrentCalculationIds·historySelectionId·document를 갖는다. `StoredBatch`는 BatchWrite와 batchId·completedCycles·pendingCycles·상태(`pending-source|running|completed`)를 갖는다. 후보는 준비 완료 데이터만 `putCandidate`하며 준비 불가 사유는 저장 성공 후보로 표현하지 않는다.
- `BackfillInput`은 `scopeId/anchorCycle/fromCycle/toCycle/rounds: readonly RoundEntry[]/inputGeneration`이다. from≤to≤anchor 및18회차 이하를 검증한다. `BackfillPlan`은 대상 cycle 배열과 각 cycle의 필요/부족 회차·원본 열 사유를 갖는다. 외부 지표 실제 가용성은 실행 전 확인됐다고 표시하지 않는다.
- `PreparedCandidate`는 `candidateId/documentHash/document: PreparedDocument/basis/inputGeneration`이다. `PrepareCandidateInput`은 `scopeId/basis/statements: readonly StatementSnapshotDto[]/sourceMetadata:JsonValue/constructionCalculationId/fundingCalculationId/historySelectionId/authoredAt/inputGeneration`이다. `StatementSnapshotDto`는 `asOf:{year,month,day}`, `monthLabels`, `baseMonthIndex`, `planYearEndIndex`, `amounts`(기존 ItemSeries의 수/Unreadable JSON)를 갖는다. 파일명은 별도 출처 메타이며 입력 수치 해시와 구분한다.
- `HistoryDependencies`는 repository·기존 두 source 포트·Clock(`now():Date`)·ID 발급(`nextId():string`)·해시(`hash(JsonValue):string`)·버전 값을 갖는다. `ReportDocumentFactory`는 `(input: RestoredReportInput, selection: ExternalHistorySelection) => PreparedDocument`이다. `RestoredReportInput`은 복원 회차·기존 Dashboard·두 산출의 기존 Outcome·gapMonth·authoredAt이고, app/API 구현만 이를 기존 `FinancialReportInput`/DTO로 변환한다.
- `ExternalHistorySelection`은 historySelectionId·scopeId·calculationVersion·지표별 실제 차트 anchor(건설 기준월/조달 관측월)·cutoff·selectedBackfillBatchId·월별 head revision·선택된 StoredCalculation 배열·해당 historyCalculationIds를 갖는다. 단일 선택 batch가 scope/version/범위를 만족하는지 검사하며 각 실제 anchor−17~anchor의18개월만 담는다. dependency head 토큰도 실제 참조 범위로 제한한다. version/schema는 서버가 정한다. 최초 식별자는 `risk-policy-2026-09-28@e3a8f9e`, `report@e3a8f9e`, schemaVersion1로 고정하고 이전 버전으로 결과를 재계산/덮어쓰지 않는다.
- `WorkbookExportWrite`는 `scopeId/exportId/workbookFormatVersion:1/baseConfirmationId/baseRevision/baseDocumentHash/basis/inputSnapshotId/inputHash/calculationIds/historySelectionId/calculationVersion/templateVersion/createdAt`와 `rows:readonly ExportRow[]`, 조회용 이력 스냅샷을 갖는다. `ExportRow`는 `rowId/sheet/sourceRecordId/sourceKind:ecos|statement|kofia/fieldPath/identityJson/unit/originalValue:number|null/allowedActions:readonly EditAction[]/protectedCells:JsonValue`다. 성공 캡처·계열·비어 있지 않은 단위가 확인된 필요 월 결측 셀은 originalValue=null과 원래 사유를 분리한다. 실패/빈 단위의 ECOS 계열은 keep만 허용하며 error 분기를 성공 values로 바꾸거나 단위/기준연도를 추정하지 않는다. 모든 보호 셀과 6개 시트의 셀/헤더 구조도 명세에 포함한다.
- `WorkbookImportWrite`는 `scopeId/importId/exportId/fileHash/patchHash:string|null/patch:CorrectionPatch/status:'invalid'|'no-change'|'validated'/errors:readonly WorkbookCellError[]/receivedAt`다. 저장된 명세가 없는 미식별 파일은 레코드를 만들지 않고 importId=null로 거부한다. 식별된 검증 실패는 patch=[]·patchHash=null과 오류 위치/코드만 보관하며 원문 셀 내용은 로그/오류에 복사하지 않는다. `patchHash`는 rowId순으로 정규화한 수정안 전체(값·사유·근거)의 해시다. 포장 ZIP/서식이 달라도 같은 exportId/patchHash는 같은 검증 수정안·preview를 재사용한다. 파일 해시는 최초 채택 바이트의 해시이고 재업로드의 바이트 동일성을 보증하는 ID가 아니다.
- `CorrectionPreviewWrite`는 `scopeId/previewId/previewHash/importId/exportId/baseConfirmationId/baseRevision/inputSnapshotId/candidateId/dependencyHeads:readonly RevisionToken[]/rawDiff:JsonValue/resultDiff:JsonValue/affectedReports:JsonValue/createdAt`다. hash는 정규화 patch·입력·산출/원천·문서 hash·기준 revision·dependencyHeads를 포함한다. 미리보기 JSON에 숫자/등급/불가의 전후 값과 출처·사유를 제공한다. `stageCorrection`은 scope/exportId/patchHash의 이미 저장된 불변 preview를 재사용한다. 그 미확정 preview의 head 토큰이 stale이면 재사용 대신409이며 같은 exportId에서 새 preview를 만들지 않는다. 잘못된 파일/no-change에는 파생 입력·캡처·산출·후보를 만들지 않는다.
- `StoredWorkbookExport/StoredWorkbookImport/StoredCorrectionPreview`는 각 Write의 필드와 서버 발급 ID로 정의한다. 파생 캡처/입력/계산의 parentId는 같은 종류 레코드만 참조하고 서버가 cross-scope 참조를 거부한다. 정정 후보와 preview는 미리 발급한 서로의 ID를 사용하고, **검증 성공 결과 묶음(파생 기록·import·preview·후보)을 단일 저장 트랜잭션으로 게시**하는 repository의 `stageCorrection(input: CorrectionStageWrite):Promise<StoredCorrectionPreview>`를 추가한다. `CorrectionStageWrite`는 `scopeId/expectedBase:RevisionToken/dependencyHeads:readonly RevisionToken[]/evidence:readonly (EvidenceWrite & {captureId:string})[]/inputs:readonly (InputSnapshotWrite & {inputSnapshotId:string})[]/calculations:readonly (CalculationWrite & {calculationId:string})[]/candidate:CandidateWrite & {candidateId:string}/import:WorkbookImportWrite/preview:CorrectionPreviewWrite`다. 계산은 트랜잭션 전에 한다. 참조는 미리 발급한 ID와 같은 scope를 검사하고 한 트랜잭션 안에서 순서대로 넣는다. candidate↔preview의 순환 외래키는 해당 트랜잭션 끝까지 지연 검사한다. 게시 시에도 expectedBase/dependencyHeads를 확인해 검증 중 head 변경을409로 거부한다. validation 중단 후 반쪽 preview가 조회되지 않게 한다.
- `ReportCorrectionDependencies`는 `HistoryDependencies`와 `documentFactory:ReportDocumentFactory`, `workbookCodec:HistoryWorkbookCodec`을 갖는다. codec 포트는 `encode(manifest:StoredWorkbookExport):Uint8Array`, `decode(bytes:Uint8Array, manifest:StoredWorkbookExport):DecodedCorrection`이며 decode는 정규화 patch와 셀 오류만 반환한다. exportId 추출도 제한된 사전 ZIP 검사 뒤 `readExportId(bytes:Uint8Array):string`으로 수행하며 숫자 재계산·저장은 application 책임이다.
- repository/서비스의 실패는 `HistoryOperationError`의 `code:HistoryOperationErrorCode`로 전달한다. HTTP 경계는 STALE_BASE/STALE_DEPENDENCY→409, STORAGE_UNAVAILABLE→503, LIMIT_EXCEEDED→413, NOT_FOUND→404, UNSUPPORTED_VERSION/EVALUATION_ZONE_MISMATCH→422로 매핑한다. 일반 셀/파일 형식 오류는 ImportResult.invalid→422이며 stale을 셀 오류나500으로 바꾸지 않는다. 오류에는 원문 셀·금액·SQL/파일경로/키를 노출하지 않는다.
- 해시·UUID·현재 시각·문서 조립은 주입된 포트/서버 어댑터가 제공한다. 기존 위험 함수는 저장소를 알지 못한다.

### 2.3 로컬 저장 ADR

**Status:** Proposed. **Date:** 2026-10-23. **Deciders:** 사용자(확정 시점·로컬 파일 요구 확정), 구현 담당(어댑터 제안).

**결정 제안:** 원장은 SQLite 단일 파일로, 비개발자 수정 창구는 로컬 엑셀 교환으로 둔다. 이력 본문은 스키마 버전과 해시가 있는 JSON으로 보관하고, 검색 키와 참조/확정 버전은 관계형 컬럼으로 관리한다. 로컬 파일 사용 요구와 원자적 중복 처리에 맞춘 선택이다.

| 검토 대안 | 이점 | 한계·판단 |
|---|---|---|
| SQLite 로컬 파일 | 트랜잭션·중복/참조 제약·복구를 한 어댑터로 처리 | 실행 Node API 호환성/백업 필요. v1 제안. |
| 월별 JSON 파일 | 사람이 열기 쉽고 의존성 없음 | 여러 파일 원자 확정·두 프로세스 lock·중단 복구를 직접 구현해야 하므로 제외. |
| 브라우저 localStorage | 화면 연동 간단 | 삭제·브라우저별 분리·트랜잭션/서버 재현 제약으로 확정 저장소에서 제외. |

- 위치: `ai-frm/data/report-history.sqlite`; 기존 `/data/` Git 제외를 유지한다. 폴더는 소유자 전용, DB/백업은 사용자 전용 권한으로 생성한다. 요청으로 임의 파일 경로를 받지 않는다.
- Task1 migration1 테이블: `workspace_scope`, `source_capture`, `report_input_snapshot`, `calculation_record`, `history_selection`, `report_document`, `report_candidate`, `monthly_confirmation`, `monthly_head`, `idempotent_command`, `backfill_batch`, `backfill_step`, `batch_capture_slot`, `schema_migration`. Task6 migration2는 `workbook_export`, `workbook_import`, `correction_preview`를 추가한다. DB migration 번호·payload schemaVersion1·workbookFormatVersion1은 별개다.
- Task1~5의 후보 correctionPreviewId는 논리적으로 null이다. 교환용 nullable ID 컬럼/FK는 Task6 migration2에서 추가해 migration1이 아직 없는 교환 테이블을 참조하지 않게 한다. migration2의 candidate↔preview 참조는 DEFERRABLE INITIALLY DEFERRED로 검사하고 기존 null 후보는 그대로 유지한다.
- `monthly_confirmation(scope_id, report_cycle, revision)` 및 `(scope_id, report_cycle, candidate_id)`, `monthly_head(scope_id, report_cycle)`, `idempotent_command(scope_id, key)`, `backfill_batch(scope_id,start_key)`, `backfill_step(batch_id, report_cycle)`, `batch_capture_slot(scope_id,batch_id,source_key)`에 unique 제약을 둔다. 증거/산출/문서는 내용 해시로 중복 보관을 줄이되 원천 수신 기록과 확정 revision은 잃지 않는다.
- WAL·foreign keys·`synchronous=FULL`·5초 busy timeout을 사용한다. 확정은 짧은 트랜잭션에서 후보 검증→멱등 키 확인→revision 비교→확정/참조 생성→head 갱신을 한 번에 커밋한다. 트랜잭션 안에서 외부 요청/계산/문서 생성은 하지 않는다.
- 같은 멱등 키/같은 후보는 같은 확정 ID를 반환한다. 같은 키/다른 후보는 충돌이다. 새 키라도 이미 확정된 동일 후보이면 기존 ID/revision을 반환하고 head는 변경하지 않는다. 그 외 기대 revision 불일치는 충돌이며 새 내용은 사유를 가진 새 revision으로만 저장한다.
- 엑셀 정정은 `(scope_id,export_id,patch_hash)`의 채택 import/preview를 unique로 연결하고 정정 확정의 `(scope_id,preview_id)`도 unique로 둔다. commitCorrection은 멱등 요청/이미 확정된 preview부터 확인해 기존 ID를 돌려준다. 그 외 previewHash·기준 head·검증 시점 dependencyHeads·사유를 한 트랜잭션에서 확인하고 **선택한 한 보고서**의 새 revision/head만 갱신한다. 같은 키/다른 요청은409, 미확정 preview의 head 충돌도409다. 이 경우 새 exportId로 다시 내보낸 파일을 사용하며 동일 preview를 갱신/재기준화하지 않는다. 이미 확정된 preview 재시도는 후속 head를 되돌리지 않는다.
- import/preview/parent source/input/candidate 참조는 같은 scope의 외래키로 묶는다. 실제 파일 읽기·해시·ZIP 검사·기존 함수 재계산·문서 생성은 트랜잭션 밖에서 하고 최종 게시/확정만 원자 처리한다. 정정 중 디스크 실패 시 반쪽 후보·성공 메시지를 남기지 않는다.
- 시작 시 migration을 적용한다. 미지원 스키마/읽기 전용/손상 파일이면 보관 기능을 중단하고 기존 산출·HTML·인쇄는 유지한다. 빈 DB로 조용히 대체하지 않는다.
- `node:sqlite`가 release candidate인 점과 현재 확인한 v26.8.2 API를 기록한다. 서버 어댑터에 격리하고 최초 지원 런타임은 package engines의 `26.8.2`로 명시한다. 범위 확대는 호환 검증 후 별도 변경하며 글로벌 Node 설치/업그레이드는 하지 않는다.
- 온라인 backup API로 `data/backups/report-history-YYYYMMDDTHHmmssZ.sqlite`를 만든다. 실행 중 DB 파일 하나만 복사하지 않는다. v1에서는 확정본 자동 삭제/보존기간 정리는 하지 않는다. 백업 복구는 별도 경로에서 확인한 뒤 서버를 중지하고 교체하는 수동 절차로 제공한다.
- 결과적으로 브라우저를 닫아도 기록은 남지만 PC의 파일을 잃으면 백업 복구가 필요하다. Task1에서 저장·백업을, Task9에서 복구·이전 절차를 인수한다. XLSX만 보관해서는 export 명세·이전 문서를 복구할 수 없다.

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
- 후보 준비는 검증한 전체 StatementSnapshotDto와 별도 파일명 출처를 `ReportInputSnapshot`으로 저장하고 후보에 inputSnapshotId를 연결한다. 입력 해시만 남기거나 계산에 필요한 일부 RoundEntry만 보관하면 엑셀의 원자료 조회/정정이 불가능하므로 허용하지 않는다. 저장된 입력이 없는 옛 후보는 정정용 내보내기 불가 사유를 반환한다.
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

### 3.4 엑셀 정정·재계산·확정

1. **내보내기:** 서버는 선택한 확정본의 inputSnapshot·원천·산출·문서를 읽고 수정 가능한 행을 결정해 export 명세를 영속 저장한다. 그 명세에서 수식 없는6개 시트를 만든다. 파일은 앱 다운로드이며 원본 업무 파일을 찾거나 덮어쓰지 않는다. 내보내기 응답 유실 시 동일 exportId 다운로드를 제공한다.
2. **식별/검증:** 크기/ZIP 검사를 통과한 파일에서 exportId를 읽고 서버 명세를 조회한다. 형식 버전·scope·기준 revision·모든 행/보호 셀·수정 동작/자료형/단위를 검사한다. 행 순서/서식만 달라도 허용하지만 보호 데이터 변조는 거부한다. 최신 head가 기준 revision과 다르면 계산 전에409로 중단한다.
3. **정규화:** keep은 DB 값을 재사용하고 set은 숫자·사유, set-missing은 허용 원천의 결측만 반영한다. 같은 수로 set한 행은 patch에서 제거한다. 원값 차이가 없는 파일은 no-change다. `reason/evidenceNote`는 trim 후2000자 이하이며 수식/HTML로 실행하지 않는 텍스트다. 근거를 수집기관 공식 값으로 위장하지 않는다.
4. **재계산:** 전체 StatementSnapshot·ECOS/KOFIA 캡처를 복사해 허용 path만 변경한다. 자금자료는 기존 createStatement→roundEntryOf→assessDashboard와 원래 외부 유스케이스를 실행해5개 지표를 일관되게 복원한다. 변경하지 않은 원천도 원래 captureId를 사용한다. 기초 금액 계열이 완전하지 않으면 이전 정상 값으로 채우지 않는다. KOFIA 공표 평균을 byAgency로 재생성하지 않는다. 서버 검증/재계산 중 외부 API 호출은0이다. 외부 계산별 부모 evaluationClockTrace를 순서 재생하는 Clock으로 재사용하며 현재 시각으로 계산 가능 월/사유를 바꾸지 않는다. 서버 시간대가 부모 evaluationTimeZone과 다르거나 저장된 평가 달력과 현재 해석이 다르면 EVALUATION_ZONE_MISMATCH로 정정을 중단하고 원래 시간대에서 서버를 실행하도록 안내한다. 시간대를 조용히 바꾸거나 새 현재월로 계산하지 않는다. 확정본/엑셀 조회는 계속 가능하다. 원천을 조회하지 않은 미래월 guard 등 terminal 결과는 원래 입력/Clock으로 재현하고 frozen source가 호출되면 실패시키는 검증을 둔다.
5. **미리보기 저장:** 기준 확정본의 historySelectionId·과거 산출 ID·배치를 유지해 과거 차트 점을 조용히 최신 값과 섞지 않는다. 현재 anchor는 새 산출로 투영한다. 해당 선택이 참조한 회차들의 **검증 시점 현재 head 토큰**도 일관된 읽기로 기록한다. 문서에 사용한 과거 revision과 이 경합 검사 토큰은 별개다. 검증 중 head가 바뀌면 재시도/409이며 서로 다른 시점의 토큰을 합치지 않는다. 성공한 파생 기록·후보·preview만 stageCorrection으로 원자 게시한다. 원자료/산출/등급/불가 사유 차이와 타 확정본의 영향 목록을 용지 밖에 보여 준다.
6. **정정 확정:** previewHash·기준 revision·dependencyHeads가 유효하고 사유가 있으면 commitCorrection이 선택한 보고서의 새 revision을 만든다. 충돌이면 기존 preview와 확정본을 보존하고 새로 내보낸 파일에 수정안을 다시 입력·검증하도록 안내한다. 중복 클릭/응답 유실/새 멱등 키도 같은 preview를 재확정하지 않는다. 다른 보고서 head와 과거 문서는 바꾸지 않는다.

직접 산출값을 편집하는 별도 수기 지수 경로·워크북 수식·공통 원천 override 테이블은 추가하지 않는다. 최신 API가 다르더라도 현재 수정안은 선택한 snapshot에만 적용한다. 부모 원천의 실제 확보 시각, 수기 정정 시각, 새 문서 작성 시각, 새 확정 시각을 구분한다.

## 4. 변경 파일과 책임

경로는 저장소 루트 기준이다. 계획 단계에서는 아래 코드 파일을 만들지 않는다. 기존 파일 편집을 우선하며 저장/이력의 새 책임만 독립 파일로 추가한다.

| 파일 | 작업·책임 |
|---|---|
| 새 `ai-frm/src/domain/report-history/report-history.ts`와 `.test.ts` | 월별 확정/정정·버전 불변식. 위험 산식과 분리. |
| 새 `ai-frm/src/application/report-history/ports.ts` | §2.2 repository·시계·ID·해시·문서 factory 포트와 기록 타입. |
| 새 `ai-frm/src/application/report-history/report-history.ts`와 `.test.ts` | 캡처/후보/확정/조회 조율. |
| 새 `ai-frm/src/application/report-history/historical-risk-backfill.ts`와 `.test.ts` | 준비 점검·고정 입력·월별 기존 함수 호출·배치 재개. |
| 새 `ai-frm/src/application/report-history/report-correction.ts`와 `.test.ts` | 서버 명세 발급·수정안 검증 조율·기존 함수 재계산·영향/미리보기·정정 확정. |
| 새 `ai-frm/src/infrastructure/report-history/sqlite-history-repository.ts`와 `.test.ts` | migration·원자 저장·멱등·head CAS·백업. |
| 새 `ai-frm/src/infrastructure/report-history/evidence-codec.ts`와 `.test.ts` | 정렬 JSON·Map/Date 복원·정밀도·해시·런타임 스키마 검사. |
| 새 `ai-frm/src/infrastructure/report-history/captured-sources.ts`와 `.test.ts` | 기존 source 포트의 기록/frozen 어댑터. |
| 새 `ai-frm/src/infrastructure/report-history/history-workbook.ts`와 `.test.ts` | 기존 SheetJS의6개 시트 입출력·ZIP 제한·셀/명세 대조. 기존 statement-reader와 분리한 서버 전용 교환 ACL. |
| 수정 `ai-frm/src/app/api/_lib/composition.ts`, `handlers.ts`와 기존 handler 테스트 | 저장소·원천 캡처 조립. 기존 계산 응답 보존. |
| 수정 기존 두 API `route.ts`·`dto.ts` | 서버 runtime 고정, 선택적 history receipt만 추가. |
| 새 `ai-frm/src/app/api/_lib/report-history-handlers.ts`와 `.test.ts` | HTTP 검증·app 문서 factory·히스토리 명령 변환. |
| 새 `ai-frm/src/app/api/report-history/route.ts` | 후보 POST, 후보/확정 문서/확정 목록 GET. |
| 새 `ai-frm/src/app/api/report-history/confirm/route.ts` | 일반 후보의 확정/정정 POST. 새 입력/산식은 받지 않고 후보 ID만 확정. 엑셀 정정 후보는 거부. |
| 새 `ai-frm/src/app/api/report-history/backfill/route.ts` | plan/start/step POST 및 진행 GET. |
| 새 `ai-frm/src/app/api/report-history/exchange/route.ts` | export/validate POST, 기존 exportId의 다운로드·previewId 조회 GET. 생성 교환 xlsx만 수신. |
| 새 `ai-frm/src/app/api/report-history/corrections/route.ts` | 저장된 preview의 명시적 정정 확정 POST. 숫자/산식/클라이언트 결과 수신 금지. |
| 새 `ai-frm/src/app/aifrm/report-history-view.ts`와 `.test.ts` | Statement 달력 DTO, UI 상태 전이, API 계약. 서버 모듈 import 금지. |
| 새 `ai-frm/src/app/aifrm/report-history-projection.ts`와 `.test.ts` | 기존 보고서의 외부 points/coverage/historyNote만 투영. |
| 새 `ai-frm/src/app/aifrm/report-history-controls.tsx`와 `.test.tsx` | 용지 바깥 보완·확정·이력·엑셀 교환·오류/차이/정정 확정. 기존 Astryx 사용. |
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
- `POST /api/report-history/exchange` JSON `command:'export', confirmationId` → 명세를 저장하고 `{exportId,downloadUrl}` 반환. GET `exportId`는 그 명세의 기존 파일 표현만 재생성해 Content-Disposition attachment로 반환하며 원장을 변경하지 않는다.
- 같은 exchange POST의 multipart `command:'validate',file` → `ImportResult`. 브라우저 파일명/확장자/MIME만 신뢰하지 않는다. 파일5MiB/본문6MiB를 읽는 동안 제한하고 일괄 formData 파싱 전에 초과 수신을 중단한다. 미지원/보호 셀/수식/입력 오류는422+셀 오류, no-change/preview는200. ZIP 사전검사 등 식별 이전 오류는 sheet/row가 없다는 구조화 파일 오류로 반환한다.
- exchange GET `previewId`는 저장된 전후 차이/영향/기준 revision을 재열람한다. 정정 버튼의 최신 head 충돌 가능성을 안내하되 이전 미리보기를 바꾸지 않는다. 충돌409는 새 exportId로 내보내기를 다시 해야 하며 같은 파일 재검증으로 복구되지 않는다. 모르는/다른 scope ID는404, 범위 초과413, stale head409, 미지원 schema/양식422, 저장소 장애503이다.
- `POST /api/report-history/corrections`는 `CorrectionConfirmCommand`만 허용한다. 저장된 검증 성공 preview를 조회해 대상 한 건의 head만 갱신한다. `commitConfirmation` 우회·클라이언트 numeric patch/결과는422. 최초 성공/재시도200, revision/dependency 충돌409, 사유/미리보기 검증422, 저장 실패503.

엑셀 구현 근거는 [SheetJS 셀 모델](https://docs.sheetjs.com/docs/csf/cell/)·[읽기 옵션](https://docs.sheetjs.com/docs/api/parse-options/)·[쓰기 옵션](https://docs.sheetjs.com/docs/api/write-options/)이다. `v`를 검사하고 `w`를 입력으로 사용하지 않으며 `cellFormula:true`로 수식을 검출한다. `cellNF:true`로 보존한 서식 코드`z`에서 날짜/%를 검사하고 `cellDates:false`인 숫자 타입도 이 검사를 면제하지 않는다. 매크로/vbaProject·외부 관계는 bounded ZIP의 파일/relationship 검사에서 거부하며 `bookVBA:false`의 기본값으로 검출된다고 가정하지 않는다. `raw:true`만으로 XLSX 숫자/수식 안전성을 보증하지 않는다. 서버 전용 workbook codec은 application/domain에 SheetJS 타입을 노출하지 않는다.

## 5. 구현 순서·TDD·단계별 커밋

모든 명령은 `ai-frm/`에서 실행한다. 각 Task는 아래 기능이 독립적으로 테스트 가능한 상태에서 리뷰하고 커밋한다.

### Task 1: 로컬 불변 저장소와 월별 확정 불변식

**Files:** §4의 새 domain, application ports, SQLite repository, evidence codec, 경계 테스트, package engines.
**Interfaces:** §2.2의 기본 repository/기록 계약(서비스 의존성 타입은 사용하는 Task2/5에서 정의, 엑셀 교환/정정 계약 제외)과 `confirmDecision(basis, currentRevision, expectedRevision, correctionReason): ConfirmationDecision`을 제공한다. evidence codec은 유한 수/Map/단위/시각을 손실 없이 round-trip한다.

- [x] 실패 테스트: 처음은 revision1, 같은 멱등 키/후보는 같은 ID, 같은 키/다른 후보는 conflict, 새 키/이미 확정된 후보도 기존 ID, 정정 후 과거 후보 재시도는 head를 되돌리지 않음, 정정 사유 없음/오래된 expectedRevision 거부, scope A/B 격리.
- [x] 저장 실패 테스트: 두 repository 연결 동시 확정에서 1개만 승리, 트랜잭션 중 예외면 head/확정/문서 참조 모두 rollback, 재시작 후 동일 문서 복원, 손상/읽기전용 DB의 실패를 성공으로 표시하지 않음.
- [x] 정밀도/달력 테스트: 0·음수·소수 원값/Map 순서/계열별 시각·단위/실패·전체 정규화 StatementInput을 왕복 보존. 입력/캡처/산출의 부모 참조·origin/derivation을 별개로 기록. SQL 반올림·합계·문자열 표시값을 계산 입력으로 쓰지 않음.
- [x] `npx vitest run src/domain/report-history src/application/report-history src/infrastructure/report-history src/boundaries.test.ts`로 RED 확인 후 구현·GREEN. 새 서버 저장 폴더와 `node:sqlite`의 클라이언트 import 차단 검사도 포함.
- [x] 신규 DB에 migration→기록→프로세스 재시작→읽기→온라인 백업→별도 임시 경로 복구를 합성 자료로 QA. 독립 리뷰 후 `feat(history): add immutable local history repository` 커밋·진행 기록.

### Task 2: 기존 외부 계산의 원천·실행 receipt 자동 기록

**Files:** captured-sources, application report-history 서비스, 기존 API handlers/composition/route/DTO와 관련 테스트.
**Interfaces:** `captureConstruction(deps: HistoryDependencies, scopeId: string, request: PerceptionRequest, ledger: ForecastLedger): Promise<CapturedOutcome<Outcome<PerceptionReport>>>`, `captureFunding(deps: HistoryDependencies, scopeId: string, request: FundingRiskRequest): Promise<CapturedOutcome<Outcome<FundingRiskReport>>>`. HTTP 조립 시 기존 Outcome를 그대로 펼치고 history만 추가한다. 실패 metadata에는 저장 오류 코드만 포함하며 정상 산출 본문을 바꾸지 않는다. 인증정보가 포함된 원천 오류만 HTTP 경계에서 키/키 포함 URL을 가리는 예외를 적용한다. raw Outcome의 기존 계산 함수는 그대로이며 비밀값이 있는 캡처/결과는 보관하지 않는다.

- [x] 실패 테스트: 기록 사용 전후 기존 단월 결과를 deepEqual. 계산에 사용한 ECOS 9종/금리 응답과 fetchedAt를 캡처하며 API 키/키 포함 URL은 JSON·오류·로그에 없음.
- [x] 월 테스트: 합성 R=2026/08은 건설06·조달 판단08/관측07. 실패 Outcome에도 검증된 요청 맥락/ID가 남음. 읽지 못한 입력은 정상 receipt로 저장하지 않음.
- [x] 저장 장애 시 원래 산출 성공/산출불가 상태는 그대로이고 `captureStatus='failed'`만 반환하는 RED를 확인 후 구현.
- [x] 기존 handler·construction/funding·경계 테스트와 전체 verify 통과. 저장소를 비활성/실패시킨 실제 합성 API QA 후 독립 리뷰·`feat(history): capture external calculation evidence` 커밋·진행 기록.

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
- [ ] 후보 준비에서 전체 입력 스냅샷을 영속 저장·inputSnapshotId로 연결하고, 해시만 보관한 후보/다른 scope 입력 참조를 거부한다. 저장 후 createStatement 복원 결과와 원래 dashboard/ledger를 deepEqual 검증한다.
- [ ] 보고서 열기 전에는 산출 기록만 보관하고 document candidate는 없음. 후보 준비 시 서버가 기존 dashboard 계산·기존 문서 factory·선택된 historySelectionId를 재사용하고 외부 조회0회. `authoredAt`을 보존해 자정 전 열고 다음 날 확정해도 작성일 불변. 과거 회차를 지금 확정해도 confirmedAt은 실제 현재 시각.
- [ ] pending/receipt 미보관/다른 scope·월·버전은 확정 차단. 종료된 일부 불가 후보는 당시 사유 그대로 확정 가능. 커스텀 실효 월은 기본월로 변경하지 않고 월별 확정 불가만 안내.
- [ ] A 준비 중 B 파일 적용/선택월 변경/늦은 A 응답이면 자동 확정 중단. 표시 hash가 다르면 새 후보를 보여 주고 재클릭 필요. 같은 클릭의 중복 전송·503 후 재시도·두 탭 경합은 §2.3대로 처리.
- [ ] 확정본 재열람 시 외부 API0회·이력 재선택0회. 후일 ECOS 수정/새 보완 batch/다음날 재열람에도 문서 JSON/hash·값·차트·작성일 동일. unsupported template/schema version은 재계산으로 대체하지 않음.
- [ ] ‘확정 중/확정됨/보관 실패·재시도/정정 사유/확정본 열기’는 용지 밖 UI에만 추가. 기존 산출·파일 복원·HTML 열기·인쇄·포커스는 유지.
- [ ] 대상 테스트 RED→GREEN·전체 verify·관련 lint·독립 리뷰·합성 서버 재시작/오프라인 저장소/동시 탭 QA 후 `feat(history): confirm and reopen monthly report snapshots` 커밋·진행 기록.

### Task 6: 정정용 엑셀 내보내기와 서버 기준 명세

**Files:** §4의 새 report-correction 서비스·history-workbook codec/테스트·exchange route와 기존 ports/repository/handlers/view/controls·README. repository migration2로 교환 기록을 추가한다.
**Interfaces:** `exportCorrectionWorkbook(deps:ReportCorrectionDependencies, scopeId:string, confirmationId:string):Promise<StoredWorkbookExport>`, `downloadCorrectionWorkbook(deps:ReportCorrectionDependencies, scopeId:string, exportId:string):Promise<Uint8Array>`. `HistoryWorkbookCodec.encode/readExportId/decode`는 §2.2 계약을 따른다. Task6은 encode와 제한된 식별을 구현하고 수정안 적용/확정 버튼은 아직 제공하지 않는다.

- [ ] `export_preserves_input_and_source_lineage`: 합성 확정본에서6개 시트·고정 rowId/단위/월·정규화 자금 전체 계열·ECOS 필요한 셀·KOFIA 공표 평균과 읽기 전용 결과/평가사 값이 정확히 나온다는 실패 테스트를 작성한다. 미지원 버전·입력 snapshot 부재·다른 scope ID는 파일 대신 오류다.
- [ ] `export_preserves_number_roundtrip`: 0/음수/소수 및 `1.0000000000000002`가 기준값 텍스트로 나오고 지수/등급/차이/산식에 실행 수식이 없음을 검증한다. 사용자 메모가 `=...`, `+...`로 시작해도 문자열 셀로 내보내 수식으로 실행되지 않는다.
- [ ] `npx vitest run src/infrastructure/report-history/history-workbook.test.ts src/application/report-history/report-correction.test.ts src/app/api/_lib/report-history-handlers.test.ts` 실행해 RED를 확인한다.
- [ ] 서버 명세를 먼저 저장한 뒤 그 명세에서 파일을 만든다. 예외/응답 유실 후 exportId로 동일 내용 재다운로드, 다른 scope의 명세 조회 불가, 외부 API 호출0을 구현한다. 시트 보호는 편집 안내로만 적용하며 기존 statement-reader와 새 dependency는 변경하지 않는다.
- [ ] 같은 명령으로 GREEN, migration1 기존 DB→migration2 후 기존 문서/해시 불변·신규DB 순차 migration·백업에 명세 포함·서버 전용 경계 테스트를 통과시킨다.
- [ ] 합성 파일을 실제 Excel 또는 LibreOffice에서 열어6개 시트·읽을 수 있는 행/열 제목·수정 입력 칸 구분·기준값 정밀도·조회 이력을 QA한다. 사용 가능한 편집기가 없으면 실제 왕복 검수를 미완료로 기록한다. 앱 UI는 실제 Astryx 이력 목록의 선택/내보내기만 추가하고 용지 안을 바꾸지 않는다.
- [ ] 독립 리뷰 후 `feat(history): export revision-bound correction workbooks` 커밋·기존 컨텍스트 기록. 내보내기 파일을 Git에 넣지 않는다.

### Task 7: 수정본 가져오기·기존 함수 재계산·차이 미리보기

**Files:** report-correction·history-workbook 및 테스트, ports/repository의 stageCorrection, exchange route/handlers, 기존 view/controls.
**Interfaces:** `validateCorrectionWorkbook(deps:ReportCorrectionDependencies, scopeId:string, bytes:Uint8Array):Promise<ImportResult>`, `getCorrectionPreview(repository:HistoryRepository, scopeId:string, previewId:string):Promise<StoredCorrectionPreview|null>`. 외부 API와 확정 명령을 호출하지 않으며 성공 결과는 stageCorrection으로 게시한다.

- [ ] `import_unchanged_is_noop`: 앱 내보내기 그대로/Excel 저장 후 무수정 파일·행 순서/서식만 변경한 파일은 no-change이며 입력/원천/산출/문서/확정 head 수가 늘지 않는다. 같은 수를 set해도 no-change, blank는0이 아니고 set 0은 실제0, keep+수정 값은 오류다.
- [ ] `import_rejects_untrusted_structure`: 변조 exportId·버전·단위/월/평가일·보호 결과·수식/공유수식·캐시 수식값·빈/중복/추가/누락 rowId·잘못된 표식·다른 scope를 거부한다. 셀 오류 위치와 원인만 보여 주고 수식/원문을 실행·로그 출력하지 않는다. 한 행 오류면 모든 수정 반영0이다.
- [ ] `import_bounds_before_parse`: 5MiB 압축/25MiB 실제 해제/128 ZIP 항목/6시트/10000행/200000셀/2000자 경계와 초과, 확장자 위장·ZIP64·암호화·외부 참조·매크로·날짜/%/Boolean/오류 타입·숫자 overflow/underflow를 검증한다. bounded ZIP 처리 후 SheetJS를 호출하며 사전검사 실패 시 파서 호출0을 단언한다.
- [ ] `recalculate_from_complete_input`: 자금 금액 하나 수정 시 전체 입력을 createStatement/roundEntryOf로 복원해 기존 dashboard+건설/조달 결과와 deepEqual. Unreadable 항목 전체 복구는 허용하되 일부만 복구/없는 전년도 열 추가는 거부한다. KOFIA 평균3.674와 평가사 평균이 달라도 공표값3.674를 그대로 사용하고 마지막 평가일 null은 기존대로 불가다.
- [ ] `correction_preserves_vintage_and_history`: API 호출0, origin 유지·derivation=manual-correction·부모ID/import/사유·원래 fetchedAt/evaluatedAt 보존을 검증한다. 월말 원래 계산→다음 달 가져오기에도 무관한 외부 결과/불가 사유는 deepEqual이며 미래 guard의 frozen source 호출0이다. KST 월초 캡처→UTC 서버 정정은422·새 파생/확정0, 원래 KST로 재시작하면 기존 Clock trace로 동일 결과가 재현됨을 검증한다. fetchedAt가 없는 원천의 두 번째 Clock 호출/fallback 시각도 그대로 왕복 보존한다. 현재 지표만 새 값, 과거 차트 ID·기준 문서/작성일/hash·다른 보고서 head 불변. 원자료만 바뀌어 등급/지수 동일해도 차이를 보여 준다. ECOS 월 m의 전월/전년 비교·회차 q의 계획/실적 대응 영향은 기존 함수 결과로 검증하고 다른 vintage는 수정하지 않는다.
- [ ] 위3개 대상 테스트 명령으로 RED를 확인한다. 명세 기반 path별 patch·재계산·이전 이력 투영·전후 차이·영향 목록·원자 stageCorrection을 구현한다. ZIP/숫자 파싱은 infrastructure, 명세·흐름은 application, 원장 CAS는 repository가 담당한다.
- [ ] GREEN 후 stage 저장 중 실패·동시 동일 export/patch·서식만 다른 재업로드·서버 재시작 후 preview 재열람을 검증한다. 재계산 완료→stage 직전 다른 연결로 base/dependency head를 바꾸면409·파생 레코드0을 확인한다. 외부 put*를 순차 호출해 미리 ID/레코드를 만드는 구현은 금지한다. 부분 파생본/preview 또는 head 변경0, 같은 수정안/유효한 head는 같은 preview이며 입력값을 클라이언트 계산에 의존하지 않는다.
- [ ] 합성 엑셀의 정상 수정/0/잘못된 단위/수식/결측처리를 가져와 셀별 오류·수정전/후 값·등급·산출불가·타 보고서 영향·정정 사유를 키보드로 확인한다. 오류 후 재선택/재검증 포커스를 유지하고 검증 완료를 ‘확정됨’으로 표시하지 않는다.
- [ ] 독립 리뷰 후 `feat(history): validate and preview Excel corrections` 커밋·컨텍스트 기록. 이 단계까지 확정 head는 바뀌지 않는다.

### Task 8: 명시적 정정 확정·충돌 처리·이전 버전 조회

**Files:** domain/report-history 불변식, report-correction·repository·corrections route/handlers와 테스트, 기존 view/controls/page.
**Interfaces:** `confirmWorkbookCorrection(deps:ReportCorrectionDependencies, scopeId:string, cmd:CorrectionConfirmCommand):Promise<ConfirmationResult>`는 저장된 preview/candidate를 사용해 repository.commitCorrection을 호출한다. 성공 후 Task5의 `openConfirmedReport`로 새/이전 버전을 연다.

- [ ] `correction_commits_one_revision`: preview 전후 head 불변, 정정 확정 클릭+사유 후 대상 reportCycle만 revision+1·부모 confirmationId·importId·원자료 lineage 연결. 이전 문서/hash/차트/작성일 불변, 새 작성일은 preview 생성일, confirmedAt은 실제 확정 시각이다.
- [ ] `correction_cas_and_idempotency`: 두 탭/오래된 export/preview hash 변조/대상 또는 dependency head 변경은409·쓰기0. 같은 preview 재시도·응답 유실·새 멱등 키는 같은 확정 ID이며 후속 head를 되돌리지 않는다. 같은 키/다른 요청은409, 일반 confirm endpoint로 엑셀 후보 우회는422다. dependency만 바뀐409에서도 새 exportId→동일 수정 입력→새 preview로만 복구되고, 기존 파일의 재검증은 새 preview 생성 없이409임을 검증한다.
- [ ] `correction_atomic_after_restart`: 저장 중 예외·디스크 실패는 정정/멱등/확정/head 모두 rollback. 재시작 후 미확정 preview를 그대로 열어 다시 확인하고 명시적 클릭으로만 확정한다. 재열람/확정 때 외부 API0, 이력 재선택0이다.
- [ ] `npx vitest run src/domain/report-history src/application/report-history/report-correction.test.ts src/infrastructure/report-history/sqlite-history-repository.test.ts src/app/api/_lib/report-history-handlers.test.ts src/app/aifrm/report-history-controls.test.tsx`로 RED를 확인하고 트랜잭션/CAS·UI를 구현해 GREEN을 확인한다.
- [ ] 기존 controls에 ‘엑셀 내보내기/수정본 가져오기/검증 중/오류/차이 확인/정정 확정/이전 버전’ 상태만 추가한다. 가져오기 성공과 확정 성공을 구분하며 충돌 시 새로 내보내기→수정→재검증 경로를 제공한다. 같은 파일만 재검증하면 충돌이 해소된다는 안내는 하지 않는다. 용지 안과 기존 보고서 진입/복귀·다운로드 흐름은 유지한다.
- [ ] 실제 합성 파일을 두 탭에서 수정해 먼저 확정한1건만 채택되는지, 뒤 탭은409 안내 후 이전 확정본을 조회할 수 있는지 QA한다. no-change에 정정 확정 버튼이 없고, 상태·오류·차이표가 인쇄에 포함되지 않는지 확인한다.
- [ ] 독립 리뷰·전체 verify·관련 lint 후 `feat(history): confirm validated corrections without overwriting history` 커밋·컨텍스트 기록.

### Task 9: 전체 보존 검증·운영 문서·인수 QA

**Files:** README·진행 기록·확인된 결함의 소유 파일만. 새 기능을 위한 보고서 템플릿 수정은 하지 않는다.

- [ ] 합성 기본회차/일부 불가/18개월/연말/수정파일/중복확정/두탭/디스크실패/재시작/백업복구와 엑셀 무수정 왕복→no-change·원자료 수정→미리보기→정정 확정→이전/새 버전 재열람을 끝까지 실행한다. 실제 Excel/LibreOffice 저장을 사용한 왕복과 codec 자동 테스트를 구분하고 미완료를 완료로 표시하지 않는다.
- [ ] 기존 위험 계산·월 선택·판독 테스트 및 보고서 값/정밀도 테스트를 변경 없이 통과시킨다. 보호 파일 diff0와 저장 경로 Git 제외를 검사한다.
- [ ] 전체 lint·`npm run build -- --webpack` 완료 후 `npm run verify`를 순차 실행한다. 현재 기준647 passed/기존2 skipped에 추가된 의미 있는 테스트가 모두 포함되어야 한다.
- [ ] 실제 화면·키보드·오류 복구·보관 UI의 인쇄 제외를 검증한다. 지원되는 브라우저에서 PDF 저장 후3쪽/페이지 경계·18개월 라벨을 수동 검수한다. 기존 자동 승인/브라우저 접근 제약으로 실행할 수 없으면 그 구체 한계와 미검수 상태를 기록하며 우회하지 않는다.
- [ ] 데이터 파일/백업 위치, 원본 엑셀 불변, 외부 연결 없음, 같은 PC/서버에서만 자동 보관됨, 복구 절차, 정정/보완의 의미,6시트 편집법·허용 칸·0/빈칸/결측·사유·409 시 새 엑셀 내보내기부터 복구를 README에 기록한다. XLSX 단독으로 확정 원장을 복구/이전할 수 없고 DB의 export 명세가 필요함을 명시한다.
- [ ] 최종 독립 리뷰·수정·재검증 후 `docs(history): document local archive and recovery` 커밋. 단계별 결과와 다음 재개 지점을 기존 컨텍스트 문서에 남긴다. 원격 push·merge·배포는 별도 요청 전 수행하지 않는다.

## 6. 계획 자체 검토와 구현 시작 조건

- 범위 대응: 과거 보완(Task3), 로컬 원장·월별 확정(Task1·2·5), 기존 추이(Task4), 엑셀 조회/내보내기(Task6), 수정본 가져오기·검증·재계산(Task7), 명시적 정정·이전 버전(Task8), 운영 인수/계산·템플릿 보존(Task9)으로 배정했다.
- 논리 검토: 파일 적용≠업무 확정, 보완≠당시 확정, 제목 월≠지표 월, 엑셀 저장≠원장 변경, 검증 미리보기≠정정 확정, 원자료 정정≠지수 직접 편집, 실제0≠빈칸/결측, HTML 용지≠저장 PDF 검증을 구분했다.
- 재현 책임: 전체 입력 스냅샷·원천 캡처·계산/문서·이력 선택·정정 부모/사유를 불변 기록한다. 원장/명세는 서버가 보유하고 결과는 기존 함수로만 재계산한다. 외부 API 재조회나 PDF 양식 변경은 정정의 전제가 아니다.
- 최초 계획의 독립 검토 지적(원자 캡처·저장 전 중단·후보 시점·확정 우선점 자격·selection ID·멱등·live 의미·두 anchor 계약)을 유지한다. 이번 독립 검토에서 받은 ECOS 실패/빈단위 수기 보완 제한, 원래 평가 Clock/달력/시간대, stale preview의 새 exportId 복구, stage CAS/사전 ID/지연 FK, 셀 서식·VBA 검출, 예외→HTTP 계약을 반영하고 Task6~8 테스트에 연결했다. 재검토에서 추가 중요한 모순은 발견되지 않았다.
- Root 자체 검토는 명세→Task 대응, 단계별 RED/GREEN/QA/검토/커밋, 포트/타입 이름, Review Focus의 담당 테스트, 구현 본문 대신 책임·계약 중심인지 확인한다. 문서 링크·코드 fence·9개 Task·모든 미완료 체크·앱 diff0·diff-check를 확인하고 독립 검토 결과를 컨텍스트에 기록한다. 문서 작업이므로 앱 테스트/빌드를 새로 실행했다고 보고하지 않는다.
- 기존 계산/템플릿을 수정해야만 통과하는 구현이라면 범위를 넓히지 말고 저장·투영·월 대응 버그를 먼저 찾는다. 실제 재무 Excel/PDF/별도 기대값 CSV를 생성·복사·Git 추적하지 않는다. 교환 파일 QA는 합성 자료만 사용한다.
- 사용자가 보완한 계획의 순차 구현을 승인했다. Task1부터 TDD·독립 검토·QA·커밋·컨텍스트 기록을 완료한 뒤 다음 단계로 진행한다. 미완료를 완료로 표시하지 않으며 원격 push·merge·배포는 수행하지 않는다.
