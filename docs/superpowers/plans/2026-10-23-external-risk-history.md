# 과거 자료 보완·월별 확정 이력 및 웹 정정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 계산식과 보고서 템플릿을 유지하면서 과거 자료와 월별 확정 이력을 자동 보관하고, 사용자가 파일 관리 없이 웹에서 원자료를 수정·검증·정정 확정할 수 있게 한다.

**Architecture:** 원천 캡처·정규화 회차 입력·계산 실행·업무 확정을 분리해 로컬 SQLite에 불변 보관한다. 정정의 중심을 파일 교환에서 서버 발급 편집 기준·수정안·변경 검토로 옮기고, 미완성 웹 입력은 별도 가변 초안에 자동 보관하고, 검증된 불변 수정안만 기존 함수로 재계산한 뒤 명시적 정정 확정으로 새 버전을 만든다. 종료 기록과 읽기 전용 조회·새 수정안 복사는 확정본과 분리한다. 기존 엑셀 정정 자료는 읽기 호환 어댑터로 보존하며 원본 캡처와 이전 확정 문서는 수정하지 않는다.

**Tech Stack:** 현행 Next.js 16.3.4·React 19·TypeScript·Astryx 0.5.4·Vitest, 기존 SheetJS `xlsx@0.18.5`, 현재 지원 Node.js v26.12.1의 `node:sqlite`/`DatabaseSync`·`backup`·crypto·zlib. 외부 DB·스프레드시트 연결·새 npm 패키지·스케줄러는 사용하지 않는다.

**Spec:** 웹 정정 명세는 **§7**, 확정 이력 없는 월의 웹 원자료 직접 입력 명세와 실행 계획은 **§8**이다. 사용자 요청 ‘사용자는 해당 파일의 존재를 몰라도 되어야 해요’, ‘웹에서 편집하고 수정’에 따라 §1~§6의 엑셀 교환 흐름을 대체한다. §1~§6과 완료 Task1~9는 당시 구현·검증 기록으로 보존하고, 계산·월 대응·불변 확정·원자성 규칙은 계속 적용한다. 이전 제공 자료 기반 계획은 [2026-10-21-report-history.md](./2026-10-21-report-history.md), 템플릿·서체·원본 참고표 기준은 [UI 진행 기록](./2026-10-21-ui-ux.md)이다.

**상태:** Task1(`14648d1`)·Task2(`d2b862c`)·Task3(`44a2db9`)·Task4(`4423ee3`)·Task5(`1d859db`)·Task6(`aff91c6`)·Task7(`e40b0ea`)·Task8(`e4aa811`) 완료. Task9 기능·통합 검증·운영 문서·최종 독립 재검토 Approved까지 완료했으며 최종 커밋에 이 기록을 포함한다. 보완 후 전체 lint·webpack build·896개 테스트(병렬4)·합성 전체 원장 백업복원·재시작·문서별 출처 전환 QA가 통과했다. 실제 Excel 저장 왕복·기본 파일 선택기·PDF/200% 수동 인수는 미완료다. 시작 커밋 `19673b1`, 보호 계산/템플릿 기준 `e3a8f9e`, 최초 계획 `89db12a`. 보호51파일 SHA-256은 모두 그대로이며 실제 업무 파일 대신 합성 자료로 검증했다.

**웹 정정 완료 상태(2026-10-27):** 실행 기준은 `666e6ef`이며 W1~W6 구현·TDD·단계별 독립 검토·자동 QA와 로컬 적용을 완료했다. 전체 검토의 Important2건과 generation Minor를 수정한 뒤 재검토도 통과했다. 최종1068개 통과/기존2skip, 보호51파일 변경0. **실제 저장 PDF 페이지 경계·native200% 확대 수동 인수2건은 Mac 잠금으로 미완료**다. 다음 재개는 사용자 잠금 해제 후 이2건이며 구현 단계를 반복하지 않는다. 운영 앱은 `http://127.0.0.1:3002/aifrm`이다.

**현재 추가 작업(2026-10-27):** 사용자 확답에 따라 §8 D1–D5를 순서대로 실행 중이다. 자금자료·경제지표·금리를 웹에 직접 입력하고 확정 이력 없이도 최초 보고서를 만들 수 있게 한다. 새 실행 기준은 `e2a1602`이며 D1 계약·검토·QA를 완료했으며 D2 저장소를 이어서 구현한다. 기존 W1–W6는 반복하지 않는다.

## Global Constraints

- **“기존 계산식과 리포트 템플릿은 유지”**: `src/domain/risk/**`, 기존 `application/construction-perception.ts`·`funding-risk.ts`·`dashboard.ts`, 회차 판독·월 대응·가중치·임계값·정밀도를 수정하지 않는다.
- `report-model.ts`·`report-preview.tsx`·`report-chart.tsx`·`report-chart-view.ts`·`report-reference.ts`·`format.ts`·`globals.css`·`ThemeProvider.tsx`·참고 PNG의 diff 0을 유지한다. 이력은 새 투영 함수에서 연결한다. 현재 보고서 3쪽·차트 5개·본문·서체·원본 참고표·인쇄 용지/배치는 그대로다.
- 확정 트리거는 용지 바깥의 **‘보고서 확정’**이다. 파일 적용·보고서 열기·인쇄 버튼·PDF 저장 시도를 업무 확정으로 간주하지 않는다.
- 확정 이력 원장은 PC에서 실행 중인 Next.js 서버의 `ai-frm/data/report-history.sqlite`다. 사용자는 웹에서 조회·수정하며 저장 파일·경로·내부 ID를 관리하지 않는다. 입력 편집·변경 검토만으로 확정본은 바뀌지 않는다. 운영용 원장 백업·PC 이전은 사용자 정정 화면과 분리한다.
- 외부 스프레드시트 연결은 후속 답변으로 제외됐다. 외부 DB/클라우드 업로드·백그라운드 정기 수집도 이번 범위가 아니다.
- 원래 업무용 자금수지표 `.xlsx`/PDF는 덮어쓰지 않는다. 최초 자료 등록의 엑셀 업로드는 유지하고 정정용 파일 내보내기·가져오기만 사용자 흐름에서 없앤다. 원본 파일과 별개로 정규화 입력·수정안·산출 결과를 로컬 보관한다. 실제 재무 수치·비밀값·DB·백업은 Git·로그·fixture에 넣지 않는다.
- 웹에서도 지수·등급·산식·가중치·기준월/단위/평가일 식별자는 직접 수정할 수 없다. 수정 허용 대상은 기존과 같은 원자료와 사유다. 실제 검증 기준은 서버의 불변 편집 기준이며, 브라우저의 disabled/readonly 상태를 신뢰하지 않는다.
- 원래 회차를 다른 회차의 수정 실적으로 대체하지 않는다. 결측/조회 실패/비적용·0·음수를 구분하고 보간·0 채움·이전 월/이전 평가일 후퇴를 하지 않는다.
- 과거 보완 경로는 `reconstructed`, 일반 단월 산출 경로는 `live`로 기록한다. `live`는 기준월 당시에 확보한 자료라는 뜻이 아니다. 실제 원천 확보 시점은 fetchedAt/receivedAt, 업무 확정 시점은 confirmedAt로 구분한다. 후일 재조회한 값이 기존 확정 문서·값·추이를 덮어쓰지 않는다.
- 매 단계 TDD 또는 의미 있는 시각 RED→GREEN, 독립 검토, 적절한 QA, 별도 커밋과 진행 기록을 남긴다. 전체 빌드와 `tsc`는 동시에 실행하지 않는다.
- `ai-frm/AGENTS.md`와 설치된 Next.js 문서·Astryx CLI를 따른다. 화면 조작/알림은 용지 바깥의 실제 Astryx 컴포넌트로 구성한다.

## Review Focus

1. 보고서 제목 월·건설 기준월·조달 판단/관측월·달력 날짜를 혼동하면 한두 달 이동하거나 시간대에 따라 전월로 저장된다. → 기존 Task2·3·5 및 W1·W3·W5의 월/날짜·자료 식별 테스트.
2. 같은 회차 정정·늦은 응답·타 scope/변조된 행 ID·수정 중 입력 변경이 새/옛 입력을 섞지 않아야 한다. → W1~W5의 서버 기준 검증·draft CAS·generation·검토 무효화 테스트.
3. 두 탭 정정·오래된 편집 기준·응답 유실·서버 종료·디스크 오류가 중복/반쪽 확정 또는 거짓 ‘저장됨’을 만들면 안 된다. → W2~W5의 멱등·draft/확정 CAS·종료 경쟁·장애 테스트.
4. ECOS 수정치·보완 배치·수기 정정이 과거 문서/작성일/차트를 바꾸거나 다른 보고서를 자동 정정하면 안 된다. → 기존 Task3·4·5·7·8 및 W2·W3·W5·W6의 출처·영향·무조회 재열람 테스트.
5. 숫자 자동 보정·빈칸/0/결측·구형 원장 읽기·18개월·저장 실패에서도 산식·템플릿을 보존한다. → W1~W6의 정밀도·호환·회귀 QA.

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
- `BatchWrite`는 `scopeId/startKey/fromCycle/toCycle/inputHash/roundEntriesJson/fixedNow/evaluatedCalendar/evaluationTimeZone`와 월별 `pending/completed` 목록이다. 동일 scope/startKey와 동일 요청 해시는 기존 batch ID를 반환하고 다른 요청 해시는 충돌이다. 요청 해시는 고정 입력·범위만 포함하고 서버가 만든 fixedNow/평가 달력/시간대는 제외한다. 재시도는 원래 저장된 평가 문맥을 유지한다. ECOS/KOFIA 캡처 ID는 별도 capture slot에 연결한다. `BatchStepWrite`는 `scopeId/batchId/reportCycle/basis:ReportBasis/calculationIds`이며 reportCycle=basis.reportCycle과 각 산출의 실제 월·지표/scope/batch를 검사하고 같은 step은 한 번만 완료된다. 기준월은 기존 유스케이스 결과로 조립하고 저장소가 별도 역산하지 않는다.
- `CaptureClaim`은 `scopeId/batchId/sourceKey/ownerId/now/leaseUntil`이다. sourceKey는 `ecos` 또는 `kofia:YYYY/MM`. claim 결과는 ready(captureId), claimed(fence:number), busy다. `CaptureCompletion`은 slot key+ownerId+fence+EvidenceWrite이며, 현재 fence 소유자만 증거 저장과 slot 연결을 한 트랜잭션으로 완료할 수 있다. lease는90초이고 만료 시 다음 요청이 더 큰 fence로 회수한다. 늦은 응답은 새 slot을 덮지 못한다.
- 필드 타입은 다음으로 고정한다. ID·해시·버전·ISO 시각은 string, 월은 YearMonth, payload/result/requestContext/roundEntriesJson은 JsonValue, schemaVersion은 1, captureIds/historyCalculationIds는 readonly string 배열, calculationIds는 `{construction: string; funding: string}`이다. `sourceKind`는 `'ecos'|'kofia'`, 결과 유효성/등급은 기존 Outcome 안에서 보존한다.
- `ConfirmationSummary`는 `confirmationId/reportCycle/revision/confirmedAt/candidateId/correctionReason?`를 갖는다. `StoredConfirmation`은 이 값과 scopeId·previousConfirmationId(null 허용)·basis·canonicalCurrentCalculationIds·historySelectionId·document를 갖는다. `StoredBatch`는 BatchWrite와 batchId·completedCycles·pendingCycles·상태(`pending-source|running|completed`)를 갖는다. 후보는 준비 완료 데이터만 `putCandidate`하며 준비 불가 사유는 저장 성공 후보로 표현하지 않는다.
- `BackfillInput`은 `scopeId/anchorCycle/fromCycle/toCycle/rounds: readonly RoundEntry[]/inputGeneration`이다. anchor는 서버가 정규화 ledger의 최신 업로드 회차에서 확인하며 오늘로 치환하지 않는다. 회차가 없으면 NO_REPORT_CYCLE로 준비 불가다. from≤to≤anchor 및18회차 이하를 검증한다. `BackfillPlan`은 대상 cycle 배열과 각 cycle의 필요/부족 회차·원본 열 사유를 갖는다. 외부 지표 실제 가용성은 실행 전 확인됐다고 표시하지 않는다.
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
- 최초 구현에서 `node:sqlite`의 release candidate 상태와 v26.8.2 API를 확인하고 package engines의 `26.8.2`를 최초 지원 런타임으로 명시했다(과거 검증 기록). 서버 어댑터 격리는 유지한다. **현재 지원 기준은 2026-10-26 보안 대응으로 승인한 `26.12.1` 정확 버전**이며 package engines와 실행·백업 안내에 반영한다. 이는 CVE-2026-111497 패치를 포함한 [Node.js 26.12.1 보안 릴리스](https://nodejs.org/en/blog/release/v26.12.1/)를 기준으로 한 갱신이다. 범위 확대는 호환 검증 후 별도 변경하며 글로벌 Node 설치/업그레이드는 하지 않는다.
- 온라인 backup API로 `data/backups/report-history-YYYYMMDDTHHmmssZ.sqlite`를 만든다. 실행 중 DB 파일 하나만 복사하지 않는다. v1에서는 확정본 자동 삭제/보존기간 정리는 하지 않는다. 백업 복구는 별도 경로에서 확인한 뒤 서버를 중지하고 교체하는 수동 절차로 제공한다.
- 결과적으로 브라우저를 닫아도 기록은 남지만 PC의 파일을 잃으면 백업 복구가 필요하다. Task1에서 저장·백업을, Task9에서 복구·이전 절차를 인수한다. XLSX만 보관해서는 export 명세·이전 문서를 복구할 수 없다.

최초 구현의 검토 근거(과거 기록): [Node v26.8.2 SQLite API](https://nodejs.org/download/release/v26.8.2/docs/api/sqlite.html), [SQLite의 로컬 저장 용도](https://www.sqlite.org/whentouse.html), [SQLite 온라인 백업](https://www.sqlite.org/backup.html). 여러 서버/네트워크 공유 폴더로 확장하는 설계는 이번 로컬 범위에 포함하지 않는다.

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
- 배치를 먼저 로컬에 생성하고 ECOS slot을 claim해 9종 응답을 고정한다. 시작 평가 시각·달력·시간대를 함께 고정하고 다른 시간대에서 재개하면 조회 전에422로 중단한다. lease/fence의 만료 판단에는 고정 평가시각 대신 실제 현재 운영 시계를 사용한다. 월별 건설 계산에는 저장된 slot의 frozen source를 넣어 기존 `assessPerception()`을 그대로 호출한다.
- KOFIA도 필요한 관측월별 slot을 claim해 캡처한다. 영구 저장된 캡처는 재시도/재개에서 재조회하지 않는다. 응답 수신 후 저장 전 프로세스가 종료되면 네트워크 요청은 재시도될 수 있으며 새 수신 시각을 기록한다. 물리적 exactly-once 외부 호출을 약속하지 않는다.
- slot claim/저장에는 §2.2의 lease/fence를 사용한다. 같은 slot의 캡처 선택은 하나만 채택하고, 완료된 step도 하나만 커밋한다. 동시 작업이 같은 고정 입력으로 중복 계산하더라도 채택 결과를 추가 revision으로 만들지 않는다. 전체 배치가 동일 시각의 원천이라고 주장하지 않는다.
- HTTP 한 요청에서 무제한 백그라운드 Promise를 실행하지 않는다. `start` 후 `step` 요청 하나가 한 보고 회차를 처리하고, 페이지가 다음 step을 요청한다. 브라우저/서버를 닫으면 pending으로 남기고 같은 batch ID로 재개한다. 완료된 step/성공 캡처를 다시 조회하지 않는다.
- start 요청에는 UUID startKey를 유지해 응답 유실 재시도도 같은 batch ID를 받는다. 시작 응답 전에 탭을 닫았어도 서버의 최근 active batch 목록(최대20개)에서 찾아 재개한다. 브라우저 저장소를 이력 원본으로 삼지 않는다.
- slot busy/회수·fence 상실/로컬 저장 실패는 원천의 조회 실패가 아니다. 기존 fetchSafely가 이를 불가 결과로 바꾸더라도 별도 제어 상태로 감지하여 산출/step 완료로 채택하지 않는다. busy는202/Retry-After1초로 재시도하고 저장 실패는503이다. 실제 원천 오류/빈 응답은 캡처한 결과로 구별해 채택할 수 있다.
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

- [x] 실패 테스트: 같은 고정 source/ledger/now의 월별 기존 함수 결과와 batch 결과가 지수·등급·세부 원값까지 동일. 정상 실행에서 ECOS 배치당1회·KOFIA 관측월당1회, 영속 캡처 후 재개에서는 해당 원천 재조회0회. 저장 전 crash는 재시도 허용/새 시각 기록.
- [x] slot 동시 claim·lease 만료 후 회수·과거 fence의 늦은 응답 거부·증거 저장/slot 연결 원자성·완료 step 중복 방지를 두 repository 연결로 검증한다.
- [x] start 응답 유실 후 같은 startKey로 재시도하면 같은 batch ID, 다른 payload/같은 키는 충돌. 시작 직후 탭 종료 후 active 목록에서 같은 배치를 찾아 재개.
- [x] b−1/b+2 회차 부족, 연말 전년도 실적 열 부재, 전년동월/전월 원값 부재, 기준값0, 미래 관측월, 마지막 평가일 평균 결측을 기존 사유대로 기록하는 RED를 먼저 확인.
- [x] source가 다음 호출에서 수정값을 반환해도 현재 batch의 캡처는 불변. 새 batch만 새 revision 원천을 사용. 일부 월 실패·서버 중단·step 응답 유실 후 재시도에도 중복/반쪽 완료 없음.
- [x] `npx vitest run src/application/report-history/historical-risk-backfill.test.ts src/infrastructure/report-history src/app/api/_lib/report-history-handlers.test.ts` GREEN, 전체 verify·관련 lint·독립 리뷰.
- [x] 합성 부족 회차/연말/18개월·재개 QA 후 `feat(history): backfill past risks from frozen sources` 커밋·진행 기록. 실제 ECOS/KOFIA는 사용자가 실행한 보완 명령에서만 호출한다.

### Task 4: 기존 차트에 이력 점 연결·보완 상태 UI

**Files:** 새 projection/view/controls, page 연결, SSR 테스트. 보호 템플릿 파일은 수정하지 않는다.
**Interfaces:** `withExternalRiskHistory(report: FinancialReport, history: ExternalHistoryView): FinancialReport`는 construction/funding의 `points/historyCoverage/historyNote`만 바꾼다. view는 서버가 불변 selection의 tagged Outcome을 해독한 일반 차트 DTO다. cutoff·scope·계산 버전·선택 ID를 포함하며 클라이언트가 server-only codec을 import하지 않는다. 후보 준비는 서버의 원래 selection ID를 신뢰한다. 조회용 selection은 유효한 커스텀 기준월도 허용하고 canonical 월별 확정 검증은 유지한다.

- [x] 실패 테스트: 건설06/조달07의 서로 다른 anchor, 미래 점 제외,18달력월·연도 경계·누락월 단절·0/음수 보존. 자체 현재 지표만 확정 우선/확정 불가 월은 불가 유지/확정 없는 달만 선택 batch 보완값 사용. 확정 문서에 복사된 reconstructed 과거점을 소급 확정값으로 승격하지 않음.
- [x] 선택 이후 다른 batch/head가 생겨도 같은 historySelectionId는 같은 산출 ID/차트를 반환. 다른 scope/version/basis의 selection은 후보 준비에서 거부하며 최신 batch로 교체하지 않음.
- [x] 건설/조달의 서로 다른 anchor를 HistorySelectionQuery로 전달하면 같은 일관 읽기와 하나의 historySelectionId로 고정됨을 검증한다.
- [x] 현재 실패+과거 정상 시 본문·현재 상태/사유는 불변. 같은 report를 input-mutating하지 않고 기존 다른3개 지표·문구·산식·값·작성일 deepEqual. 서로 다른 scope/단위/버전 거부.
- [x] Controls에는 보완 범위/진행/부족 회차·보완 포함 상태만 제공. 초기에는 불필요한 설명을 접고 용지 밖에 배치하며 인쇄에서 제외한다. 실제 Astryx 문서를 조회하고 기존 포커스를 유지한다.
- [x] projection RED→GREEN, 기존 report-model/chart-view/preview 정밀도 테스트 통과. 합성18개월 실제 화면에서 라벨·범례·3개 용지·차트5개를 QA하고 템플릿/CSS/이미지 diff0 확인.
- [x] 독립 리뷰 후 `feat(history): project external histories into existing charts` 커밋·진행 기록.

### Task 5: 보고서 확정 자동 보관·정정·확정본 재열람

**Files:** domain/application 확정 서비스, report-history HTTP handlers/routes, app view/controls/page와 기존 훅의 receipt 노출.
**Interfaces:** `prepareReportCandidate(deps: HistoryDependencies, input: PrepareCandidateInput, documentFactory: ReportDocumentFactory): Promise<PreparedCandidate>`, `confirmMonthlyReport(deps: HistoryDependencies, scopeId: string, cmd: ConfirmationCommand): Promise<ConfirmationResult>`, `openConfirmedReport(repository: HistoryRepository, scopeId: string, id: string): Promise<PreparedDocument>`. 준비/입력 오류는 도메인·검증 사유로 반환하며 HTTP 경계가422/503으로 변환한다.

- [x] 실패 테스트: Statement 달력 DTO의 KST/UTC 월초·연초 round-trip 후 회차/계산 동일. 같은 이름의 수정 내용은 새 입력, 이름만 다른 동일 내용은 같은 핵심 입력 해시. 수정 ledger+옛 construction calculationId는 거부.
- [x] 후보 준비에서 전체 입력 스냅샷을 영속 저장·inputSnapshotId로 연결하고, 해시만 보관한 후보/다른 scope 입력 참조를 거부한다. 저장 후 createStatement 복원 결과와 원래 dashboard/ledger를 deepEqual 검증한다.
- [x] 보고서 열기 전에는 산출 기록만 보관하고 document candidate는 없음. 후보 준비 시 서버가 기존 dashboard 계산·기존 문서 factory·선택된 historySelectionId를 재사용하고 외부 조회0회. `authoredAt`을 보존해 자정 전 열고 다음 날 확정해도 작성일 불변. 과거 회차를 지금 확정해도 confirmedAt은 실제 현재 시각.
- [x] pending/receipt 미보관/다른 scope·월·버전은 확정 차단. 종료된 일부 불가 후보는 당시 사유 그대로 확정 가능. 커스텀 실효 월은 기본월로 변경하지 않고 월별 확정 불가만 안내.
- [x] A 준비 중 B 파일 적용/선택월 변경/늦은 A 응답이면 자동 확정 중단. 표시 hash가 다르면 새 후보를 보여 주고 재클릭 필요. 같은 클릭의 중복 전송·503 후 재시도·두 탭 경합은 §2.3대로 처리.
- [x] 확정본 재열람 시 외부 API0회·이력 재선택0회. 후일 ECOS 수정/새 보완 batch/다음날 재열람에도 문서 JSON/hash·값·차트·작성일 동일. unsupported template/schema version은 재계산으로 대체하지 않음.
- [x] ‘확정 중/확정됨/보관 실패·재시도/정정 사유/확정본 열기’는 용지 밖 UI에만 추가. 기존 산출·파일 복원·HTML 열기·인쇄·포커스는 유지.
- [x] 대상 테스트 RED→GREEN·전체 verify·관련 lint·독립 리뷰·합성 서버 재시작/오프라인 저장소/동시 탭 QA 후 `feat(history): confirm and reopen monthly report snapshots` 커밋·진행 기록.

### Task 6: 정정용 엑셀 내보내기와 서버 기준 명세

**Files:** §4의 새 report-correction 서비스·history-workbook codec/테스트·exchange route와 기존 ports/repository/handlers/view/controls·README. repository migration2로 교환 기록을 추가한다.
**Interfaces:** `exportCorrectionWorkbook(deps:ReportCorrectionDependencies, scopeId:string, confirmationId:string):Promise<StoredWorkbookExport>`, `downloadCorrectionWorkbook(deps:ReportCorrectionDependencies, scopeId:string, exportId:string):Promise<Uint8Array>`. `HistoryWorkbookCodec.encode/readExportId/decode`는 §2.2 계약을 따른다. Task6은 encode와 제한된 식별을 구현하고 수정안 적용/확정 버튼은 아직 제공하지 않는다.

- [x] `export_preserves_input_and_source_lineage`: 합성 확정본에서6개 시트·고정 rowId/단위/월·정규화 자금 전체 계열·ECOS 필요한 셀·KOFIA 공표 평균과 읽기 전용 결과/평가사 값이 정확히 나온다는 실패 테스트를 작성한다. 미지원 버전·입력 snapshot 부재·다른 scope ID는 파일 대신 오류다.
- [x] `export_preserves_number_roundtrip`: 0/음수/소수 및 `1.0000000000000002`가 기준값 텍스트로 나오고 지수/등급/차이/산식에 실행 수식이 없음을 검증한다. 사용자 메모가 `=...`, `+...`로 시작해도 문자열 셀로 내보내 수식으로 실행되지 않는다.
- [x] `npx vitest run src/infrastructure/report-history/history-workbook.test.ts src/application/report-history/report-correction.test.ts src/app/api/_lib/report-history-handlers.test.ts` 실행해 RED를 확인한다.
- [x] 서버 명세를 먼저 저장한 뒤 그 명세에서 파일을 만든다. 예외/응답 유실 후 exportId로 동일 내용 재다운로드, 다른 scope의 명세 조회 불가, 외부 API 호출0을 구현한다. 시트 보호는 편집 안내로만 적용하며 기존 statement-reader와 새 dependency는 변경하지 않는다.
- [x] 같은 명령으로 GREEN, migration1 기존 DB→migration2 후 기존 문서/해시 불변·신규DB 순차 migration·백업에 명세 포함·서버 전용 경계 테스트를 통과시킨다.
- [x] 합성 파일을 실제 Excel 또는 LibreOffice에서 열어6개 시트·읽을 수 있는 행/열 제목·수정 입력 칸 구분·기준값 정밀도·조회 이력을 QA한다. 사용 가능한 편집기가 없으면 실제 왕복 검수를 미완료로 기록한다. 앱 UI는 실제 Astryx 이력 목록의 선택/내보내기만 추가하고 용지 안을 바꾸지 않는다.
- [x] 독립 리뷰 후 `feat(history): export revision-bound correction workbooks` 커밋·기존 컨텍스트 기록. 내보내기 파일을 Git에 넣지 않는다.

### Task 7: 수정본 가져오기·기존 함수 재계산·차이 미리보기

**Files:** report-correction·history-workbook 및 테스트, ports/repository의 stageCorrection, exchange route/handlers, 기존 view/controls.
**Interfaces:** `validateCorrectionWorkbook(deps:ReportCorrectionDependencies, scopeId:string, bytes:Uint8Array):Promise<ImportResult>`, `getCorrectionPreview(repository:HistoryRepository, scopeId:string, previewId:string):Promise<StoredCorrectionPreview|null>`. 외부 API와 확정 명령을 호출하지 않으며 성공 결과는 stageCorrection으로 게시한다.

- [ ] `import_unchanged_is_noop`: 앱 내보내기 그대로/Excel 저장 후 무수정 파일·행 순서/서식만 변경한 파일은 no-change이며 입력/원천/산출/문서/확정 head 수가 늘지 않는다. 같은 수를 set해도 no-change, blank는0이 아니고 set 0은 실제0, keep+수정 값은 오류다.
- [x] `import_rejects_untrusted_structure`: 변조 exportId·버전·단위/월/평가일·보호 결과·수식/공유수식·캐시 수식값·빈/중복/추가/누락 rowId·잘못된 표식·다른 scope를 거부한다. 셀 오류 위치와 원인만 보여 주고 수식/원문을 실행·로그 출력하지 않는다. 한 행 오류면 모든 수정 반영0이다.
- [x] `import_bounds_before_parse`: 5MiB 압축/25MiB 실제 해제/128 ZIP 항목/6시트/10000행/200000셀/2000자 경계와 초과, 확장자 위장·ZIP64·암호화·외부 참조·매크로·날짜/%/Boolean/오류 타입·숫자 overflow/underflow를 검증한다. bounded ZIP 처리 후 SheetJS를 호출하며 사전검사 실패 시 파서 호출0을 단언한다.
- [x] `recalculate_from_complete_input`: 자금 금액 하나 수정 시 전체 입력을 createStatement/roundEntryOf로 복원해 기존 dashboard+건설/조달 결과와 deepEqual. Unreadable 항목 전체 복구는 허용하되 일부만 복구/없는 전년도 열 추가는 거부한다. KOFIA 평균3.674와 평가사 평균이 달라도 공표값3.674를 그대로 사용하고 마지막 평가일 null은 기존대로 불가다.
- [x] `correction_preserves_vintage_and_history`: API 호출0, origin 유지·derivation=manual-correction·부모ID/import/사유·원래 fetchedAt/evaluatedAt 보존을 검증한다. 월말 원래 계산→다음 달 가져오기에도 무관한 외부 결과/불가 사유는 deepEqual이며 미래 guard의 frozen source 호출0이다. KST 월초 캡처→UTC 서버 정정은422·새 파생/확정0, 원래 KST로 재시작하면 기존 Clock trace로 동일 결과가 재현됨을 검증한다. fetchedAt가 없는 원천의 두 번째 Clock 호출/fallback 시각도 그대로 왕복 보존한다. 현재 지표만 새 값, 과거 차트 ID·기준 문서/작성일/hash·다른 보고서 head 불변. 원자료만 바뀌어 등급/지수 동일해도 차이를 보여 준다. ECOS 월 m의 전월/전년 비교·회차 q의 계획/실적 대응 영향은 기존 함수 결과로 검증하고 다른 vintage는 수정하지 않는다.
- [x] 위3개 대상 테스트 명령으로 RED를 확인한다. 명세 기반 path별 patch·재계산·이전 이력 투영·전후 차이·영향 목록·원자 stageCorrection을 구현한다. ZIP/숫자 파싱은 infrastructure, 명세·흐름은 application, 원장 CAS는 repository가 담당한다.
- [x] GREEN 후 stage 저장 중 실패·동시 동일 export/patch·서식만 다른 재업로드·서버 재시작 후 preview 재열람을 검증한다. 재계산 완료→stage 직전 다른 연결로 base/dependency head를 바꾸면409·파생 레코드0을 확인한다. 외부 put*를 순차 호출해 미리 ID/레코드를 만드는 구현은 금지한다. 부분 파생본/preview 또는 head 변경0, 같은 수정안/유효한 head는 같은 preview이며 입력값을 클라이언트 계산에 의존하지 않는다.
- [ ] 합성 엑셀의 정상 수정/0/잘못된 단위/수식/결측처리를 가져와 셀별 오류·수정전/후 값·등급·산출불가·타 보고서 영향·정정 사유를 키보드로 확인한다. 오류 후 재선택/재검증 포커스를 유지하고 검증 완료를 ‘확정됨’으로 표시하지 않는다.
- [x] 독립 리뷰 후 `feat(history): validate and preview Excel corrections` 커밋·컨텍스트 기록. 이 단계까지 확정 head는 바뀌지 않는다.

검수 기록: 위 두 수동 항목은 일부 미완료여서 체크를 남긴다. codec/SheetJS 무수정·행/서식 변경 no-change와 7종 합성 파일의 공개 HTTP 가져오기, 0/공표평균/문자열 사유·보호셀·수식·미등록 export 거부는 확인했다. 정상 ID→Tab→Enter 재열람, 없는 ID 오류 시 이전 표 제거·포커스 유지·재복구도 실제 화면에서 확인했다. Excel은 라이선스 read-only로 저장 불가, Numbers 저장은 ZIP64라 명세대로 거부했다. 기본 파일 선택기·실제 PDF/200% 검수는 도구 접근/사용자 브라우저 활동으로 중단했으며 성공으로 간주하지 않는다. 구현·자동/HTTP QA·독립 검토는 완료했고 이 수동 한계는 Task9 기록으로 이관한다. 기존 확정 head 변경은0이다.

### Task 8: 명시적 정정 확정·충돌 처리·이전 버전 조회

**Files:** domain/report-history 불변식, report-correction·repository·corrections route/handlers와 테스트, 기존 view/controls/page.
**Interfaces:** `confirmWorkbookCorrection(deps:ReportCorrectionDependencies, scopeId:string, cmd:CorrectionConfirmCommand):Promise<ConfirmationResult>`는 저장된 preview/candidate를 사용해 repository.commitCorrection을 호출한다. 성공 후 Task5의 `openConfirmedReport`로 새/이전 버전을 연다.

- [x] `correction_commits_one_revision`: preview 전후 head 불변, 정정 확정 클릭+사유 후 대상 reportCycle만 revision+1·부모 confirmationId·importId·원자료 lineage 연결. 이전 문서/hash/차트/작성일 불변, 새 작성일은 preview 생성일, confirmedAt은 실제 확정 시각이다.
- [x] `correction_cas_and_idempotency`: 두 탭/오래된 export/preview hash 변조/대상 또는 dependency head 변경은409·쓰기0. 같은 preview 재시도·응답 유실·새 멱등 키는 같은 확정 ID이며 후속 head를 되돌리지 않는다. 같은 키/다른 요청은409, 일반 confirm endpoint로 엑셀 후보 우회는422다. dependency만 바뀐409에서도 새 exportId→동일 수정 입력→새 preview로만 복구되고, 기존 파일의 재검증은 새 preview 생성 없이409임을 검증한다.
- [x] `correction_atomic_after_restart`: 저장 중 예외·디스크 실패는 정정/멱등/확정/head 모두 rollback. 재시작 후 미확정 preview를 그대로 열어 다시 확인하고 명시적 클릭으로만 확정한다. 재열람/확정 때 외부 API0, 이력 재선택0이다.
- [x] `npx vitest run src/domain/report-history src/application/report-history/report-correction.test.ts src/infrastructure/report-history/sqlite-history-repository.test.ts src/app/api/_lib/report-history-handlers.test.ts src/app/aifrm/report-history-controls.test.tsx`로 RED를 확인하고 트랜잭션/CAS·UI를 구현해 GREEN을 확인한다.
- [x] 기존 controls에 ‘엑셀 내보내기/수정본 가져오기/검증 중/오류/차이 확인/정정 확정/이전 버전’ 상태만 추가한다. 가져오기 성공과 확정 성공을 구분하며 충돌 시 새로 내보내기→수정→재검증 경로를 제공한다. 같은 파일만 재검증하면 충돌이 해소된다는 안내는 하지 않는다. 용지 안과 기존 보고서 진입/복귀·다운로드 흐름은 유지한다.
- [ ] 실제 합성 파일을 두 탭에서 수정해 먼저 확정한1건만 채택되는지, 뒤 탭은409 안내 후 이전 확정본을 조회할 수 있는지 QA한다. no-change에 정정 확정 버튼이 없고, 상태·오류·차이표가 인쇄에 포함되지 않는지 확인한다.
- [x] 독립 리뷰·전체 verify·관련 lint 후 `feat(history): confirm validated corrections without overwriting history` 커밋·컨텍스트 기록.

검수 기록: 이 복합 수동 항목은 파일 선택기/실제 Excel 저장 검수가 남아 체크하지 않는다. 두 탭에서 기존 합성 수정 미리보기를 각각 열어 첫 탭을 확정한 뒤 두 번째 탭을 확정했다. 첫 요청만3차로 채택되고 두 번째 탭은409·새 내보내기 안내를 표시했으며 기존2차 보고서 재열람도 성공했다. 이는 순차 클릭 검수이며 정확히 동시에 클릭했다고 주장하지 않는다. 원본 파일 선택/Excel 저장은 Task7에서 기록한 수동 한계가 남아 있고, 저장 preview 기반 화면/공개 HTTP/저장소의 실제 연결 경쟁을 구분한다. 용지3개·차트5개·용지 안 제어부0개, 제어부 report-controls 인쇄 제외 계약은 확인했으나 실제 PDF 저장은 미완료다.

### Task 9: 전체 보존 검증·운영 문서·인수 QA

**Files:** README·진행 기록·확인된 결함의 소유 파일만. 새 기능을 위한 보고서 템플릿 수정은 하지 않는다.

- [ ] 합성 기본회차/일부 불가/18개월/연말/수정파일/중복확정/두탭/디스크실패/재시작/백업복구와 엑셀 무수정 왕복→no-change·원자료 수정→미리보기→정정 확정→이전/새 버전 재열람을 끝까지 실행한다. 실제 Excel/LibreOffice 저장을 사용한 왕복과 codec 자동 테스트를 구분하고 미완료를 완료로 표시하지 않는다.
- [x] 기존 위험 계산·월 선택·판독 테스트 및 보고서 값/정밀도 테스트를 변경 없이 통과시킨다. 보호 파일 diff0와 저장 경로 Git 제외를 검사한다.
- [x] 전체 lint·`npm run build -- --webpack` 완료 후 `npm run verify`를 순차 실행한다. 현재 기준647 passed/기존2 skipped에 추가된 의미 있는 테스트가 모두 포함되어야 한다.
- [ ] 실제 화면·키보드·오류 복구·보관 UI의 인쇄 제외를 검증한다. 지원되는 브라우저에서 PDF 저장 후3쪽/페이지 경계·18개월 라벨을 수동 검수한다. 기존 자동 승인/브라우저 접근 제약으로 실행할 수 없으면 그 구체 한계와 미검수 상태를 기록하며 우회하지 않는다.
- [x] 데이터 파일/백업 위치, 원본 엑셀 불변, 외부 연결 없음, 같은 PC/서버에서만 자동 보관됨, 복구 절차, 정정/보완의 의미,6시트 편집법·허용 칸·0/빈칸/결측·사유·409 시 새 엑셀 내보내기부터 복구를 README에 기록한다. XLSX 단독으로 확정 원장을 복구/이전할 수 없고 DB의 export 명세가 필요함을 명시한다.
- [x] 최종 독립 리뷰·수정·재검증 후 `docs(history): document local archive and recovery` 커밋. 단계별 결과와 다음 재개 지점을 기존 컨텍스트 문서에 남긴다. 원격 push·merge·배포는 별도 요청 전 수행하지 않는다.

인수 검수 기록: 전체 자동/공개 HTTP/DOM·백업 복구 검증과 실제 스프레드시트·PDF 수동 검수를 구분한다. 기본회차·일부 불가·18개월·연말·무수정 codec/no-change·0/공표평균 정정·명시적 새 개정·중복/충돌·저장 실패 rollback·재시작은 기존 및 추가 테스트/합성 QA로 확인했다. 전체18테이블을 공식 SQLite 백업으로 다른 임시 폴더에 복구해 모든 행과 확정4건·export6건·preview4건 및 참조 재열람/FK/integrity가 동일했다. README 명령도 작은 합성 schema3 WAL 원장에서 정상 복구·실패 후 원상 복원을 확인했다. 실제 Excel/LibreOffice 저장 왕복, 기본 파일 선택기로 수정본 업로드, PDF3쪽 저장·페이지 경계/18개월 라벨·200% 확대는 미검수로 남긴다. Excel은 read-only, Numbers는 ZIP64 거부, 브라우저/native 도구 제한 및 사용자 Chrome 활동으로 해당 동작을 중단했고 우회하지 않았다. 기존 보호 SVG의18개 같은 값 숫자 라벨 겹침도 유지한다.

최종 검토 보완: 건설 산출불가 missing 항목·사유의 구조화된 전후 비교, 저장 문서에 묶인 확정/보완 개수와 보관본 전환, README의 보관 시점3구분을 수정하고 집중49개 RED→GREEN·재검토 Approved를 받았다. 보완 후 전체 lint→webpack build→verify --maxWorkers=4가896통과/기존2skip이었다. 실제 화면4차→5차→Enter로4차 재열람에서 조달위험 확정1/보완17→확정1/보완0→확정1/보완17과 heading 포커스를 확인했다. 공개 API 동일 순서 조회 후 모든 DB 행/문서hash 불변, 원천 호출0·FK/integrity OK였다. 최종5개 확정·6개 export·4개 preview를 포함한 전체18테이블 백업/복원·재시작 검증도 통과했다. 위 미완료 수동 항목은 이 승인과 별개다.

## 6. 계획 자체 검토와 구현 시작 조건

- 범위 대응: 과거 보완(Task3), 로컬 원장·월별 확정(Task1·2·5), 기존 추이(Task4), 엑셀 조회/내보내기(Task6), 수정본 가져오기·검증·재계산(Task7), 명시적 정정·이전 버전(Task8), 운영 인수/계산·템플릿 보존(Task9)으로 배정했다.
- 논리 검토: 파일 적용≠업무 확정, 보완≠당시 확정, 제목 월≠지표 월, 엑셀 저장≠원장 변경, 검증 미리보기≠정정 확정, 원자료 정정≠지수 직접 편집, 실제0≠빈칸/결측, HTML 용지≠저장 PDF 검증을 구분했다.
- 재현 책임: 전체 입력 스냅샷·원천 캡처·계산/문서·이력 선택·정정 부모/사유를 불변 기록한다. 원장/명세는 서버가 보유하고 결과는 기존 함수로만 재계산한다. 외부 API 재조회나 PDF 양식 변경은 정정의 전제가 아니다.
- 최초 계획의 독립 검토 지적(원자 캡처·저장 전 중단·후보 시점·확정 우선점 자격·selection ID·멱등·live 의미·두 anchor 계약)을 유지한다. 이번 독립 검토에서 받은 ECOS 실패/빈단위 수기 보완 제한, 원래 평가 Clock/달력/시간대, stale preview의 새 exportId 복구, stage CAS/사전 ID/지연 FK, 셀 서식·VBA 검출, 예외→HTTP 계약을 반영하고 Task6~8 테스트에 연결했다. 재검토에서 추가 중요한 모순은 발견되지 않았다.
- Root 자체 검토는 명세→Task 대응, 단계별 RED/GREEN/QA/검토/커밋, 포트/타입 이름, Review Focus의 담당 테스트, 구현 본문 대신 책임·계약 중심인지 확인한다. 문서 링크·코드 fence·9개 Task·모든 미완료 체크·앱 diff0·diff-check를 확인하고 독립 검토 결과를 컨텍스트에 기록한다. 문서 작업이므로 앱 테스트/빌드를 새로 실행했다고 보고하지 않는다.
- 기존 계산/템플릿을 수정해야만 통과하는 구현이라면 범위를 넓히지 말고 저장·투영·월 대응 버그를 먼저 찾는다. 실제 재무 Excel/PDF/별도 기대값 CSV를 생성·복사·Git 추적하지 않는다. 교환 파일 QA는 합성 자료만 사용한다.
- 사용자가 보완한 계획의 순차 구현을 승인했다. Task1부터 TDD·독립 검토·QA·커밋·컨텍스트 기록을 완료한 뒤 다음 단계로 진행한다. 미완료를 완료로 표시하지 않으며 원격 push·merge·배포는 수행하지 않는다.

## 7. 웹 원자료 편집·정정 전환 계획 (2026-10-26, 목업 검토 반영)

### 7.1 변경 명세와 범위

이 절은 2026-10-26에 수립한 웹 전환 명세다. 계획 당시 schema3/XLSX 정정 구현을 사용자 웹 편집으로 대체하기 위해 **W1~W6**으로 재편했으며, 현재 실행 결과와 남은 수동 인수는 문서 상단 및 아래 체크리스트를 따른다. 기존 Task1~9의 완료 이력과 미완료 수동 QA 기록은 보존한다.

**목표 흐름:** 월별 확정 이력 → 기존 수정안 이어가기/선택 또는 명시적 새 수정안 → 원자료 편집·자동 보관 → 변경 내용 확인 → 명시적 정정 확정 → 새 확정본 열기. 처리한 수정안은 읽기 전용으로 조회하며, 수동 종료한 안은 원본을 보존한 새 수정안으로 다시 검토한다.

**UI/UX 고정 사항:**

- 기본 목록은 저장된 최신 보고월을 끝으로 하는 달력12개월, 연도 선택과 전체 기간 조회를 제공한다. 중간에 자료가 없는 달을 임의 생성하거나 더 오래된 달로 채우지 않는다. `전체 기간 미처리만`은 연도 조건에 가려진 옛 수정안도 찾는다. 월별 최신 확정1행을 표시하고 이전 차수·수정안은 해당 월에서 펼친다.
- 작성 중 수정안이 하나면 월 행의 대표 동작은 `이어서 작성`이다. 여러 개이거나 선택이 필요하면 `수정안 보기`로 해당 월 목록을 연다. `새 수정안`은 별도 명시적 동작으로 두고 재개 때 새 ID/빈 입력을 만들지 않는다. 확정본 `열기`는 계속 제공한다.
- 수정안의 첫 식별 정보는 `항목 · 적용 월/평가일 · 변경 전→후 · 단위`다. 여러 행이면 첫 변경과 나머지 건수를 요약하고 사유를 보조 정보로 둔다. 미검증 입력은 변경 확정 개수처럼 표시하지 않는다. 긴 원문·전체 값은 내용 보기에서 확인한다.
- 편집은 자금자료/경제지표/조달금리 탭으로 구분한다. 탭별 회차·해당 월/평가일·검색어·변경 항목 필터와 다른 탭의 입력을 유지한다. 보고월·자료회차·해당 월/평가일·단위를 일관되게 표시한다.
- 원장/API의 reportCycle은 기존 자료회차 키이며 화면 보고월은 저장된 ReportBasis.reportTitleMonth다. 목록의 연도/최근12개월은 표시 보고월 기준으로 선택하고 기존 월 정책으로 회차 범위에 매핑한다. reportCycle을 보고월로 재명명하거나 기존 reportTitleMonth=reportCycle-1 규칙을 바꾸지 않는다.
- **미완성 입력도 로컬 서버의 SQLite에 자동 보관한다.** 기존 계획의 ‘검증 성공 이후만 보관’은 폐기한다. 마지막 입력 후1000ms debounce, 동일 수정안당 저장1건 직렬 실행, 전송 중 바뀐 입력은 최신 상태만 이어서 저장한다. `저장 중/보관됨/저장 실패`를 구분하고 서버 ACK 전에는 보관됐다고 표시하지 않는다.
- `목록으로`·검토 요청 전에는 남은 저장을 기다린다. 실패하면 입력을 유지한 채 재시도를 제공하고 전환하지 않는다. 미전송 입력이 있을 때만 지원되는 브라우저의 이탈 경고를 사용한다. 서버 ACK 전 강제 종료까지 복구를 보장하지 않는다. 제품 저장에 sessionStorage를 원장처럼 사용하지 않는다.
- 검토 성공한 특정 초안 버전에만 `확정 대기`를 표시한다. 값·사유·근거 변경은 기존 미리보기와 확정 명령의 현재 연결을 해제하지만 저장된 미리보기 자체는 바꾸지 않는다. 오류/검증 중/변경 없음/저장 중/충돌 상태에서는 확정하지 않는다.
- `검토 종료`는 작업 목록에서 정리하는 동작이며 정정 확정과 구별한다. 대상 항목·사유 요약을 확인창에 보여 주고, 확정본은 바꾸지 않는다. 같은 원자료 값이 이미 확정된 검증안은 `이미 반영됨`으로 처리 기록에 남기며 새 차수를 만들지 않는다.
- 모든 수정안에 읽기 전용 `내용 보기`를 제공한다. 시작값·제안값·자료 식별·사유·근거·상태를 보관 당시 기준으로 보여 주고, 조회 때문에 자동 저장/상태 변경/기준 발급/원천 조회를 실행하지 않는다.
- 수동 종료한 안의 `새 수정안으로 다시 검토`는 원본을 보존하고 새 작업을 만든다. 원래 시작값/최신값/제안값을 비교한 뒤 명시적 재적용과 재검증을 거친다. 과거 행ID만으로 자동 병합하지 않는다. 이미 동일한 값이면 변경 없음 안내만 하고 새 확정 차수는 만들지 않는다.
- 정정용 엑셀 내보내기·수정본 업로드·내부 ID/파일 경로 입력을 일반 UI에서 제거한다. 최초 자금수지표 업로드, 보고서 열기·PDF 다운로드와 과거 보완 기능은 유지한다. 이력 제어부는 보고서 용지 밖/인쇄 제외다.
- Astryx 실제 컴포넌트만 사용한다. 현재 `@astryxdesign/core/@astryxdesign/cli/@astryxdesign/theme-neutral` 0.5.4를 재사용하고 다른 UI 라이브러리나 임의 복제 컴포넌트를 추가하지 않는다. 원래 ThemeProvider·global CSS·리포트 폰트는 바꾸지 않는다.

**편집 범위와 숫자 의미:**

| 대상 | 수정 가능한 원자료 | 변경 금지 |
|---|---|---|
| 자금자료 | 저장된 각 회차의 기존 월별 기초시재·수입계·수입·분양회수·기타수입·지출(억원) | 수입계는 기존 독립 입력 그대로. 새 합계식·개별 결측·새 월 추가 금지. 판독불가 항목 복구는 모든 기존 월 값을 입력 |
| 경제지표 | 저장된 유효 ECOS9종의 기준월·비교월 원값, 허용 행의 명시적 값 없음 | 단위·통계/항목 코드·월 고정. 조회 실패 계열의 임의 생성 금지 |
| 조달금리 | 저장된 관측월 평가일별 공사채AAA1년·국고채1년 공표3사 평균(%) | 기관별 참고값 재평균 금지. 날짜·채권·만기·기관별 참고값 고정 |
| 파생 결과 | 편집하지 않음 | 변화율·가중치·지수·점수·등급·차트·문구는 기존 함수와 템플릿을 호출만 함 |

숫자는 Astryx TextInput 문자열로 다룬다. 빈 수정 칸=변경 없음, 숫자0/음수/허용된 명시적 값 없음은 별개다. 미수정 저장값과 정밀도는 보존하고 자동 반올림·범위 보정·휠 증감을 하지 않는다. 미완성 초안에는 잘못된 숫자 문자열·빈 사유도 보관하지만 검증/확정 시에는 기존 십진 문법·유한 값·overflow/underflow·사유 규칙을 모두 검사한다. 전체 사유는 원문 최대2000자·trim 후 비어 있지 않음, 근거 메모는 선택·최대2000자다.

### 7.2 DDD 경계·저장·동시성

1. **CorrectionBasis:** 서버가 저장된 최신 확정본에서 만든 불변 편집 기준. rowId→실제 원자료 경로·단위·회차·기간·허용 동작은 서버가 소유한다. 브라우저의 원값/단위/fieldPath/scope/산출 결과를 신뢰하지 않는다.
2. **CorrectionDraft:** 가변 작업이며 `draftId/scopeId/reportCycle/basisId/draftRevision/rawEdits/reason/evidenceNote/createdAt/savedAt/currentPreviewId`를 가진다. createdAt은 고정하고 savedAt만 갱신한다. raw 문자열을 저장해도 계산·candidate·preview·업무 revision/head를 만들지 않는다. 완전히 빈 새 작업은 저장하지 않으며, 기존 작업을 비운 경우 명시적 검토 종료 경로를 제공한다.
3. **CorrectionSubmission/Preview:** 특정 draftRevision의 정규화 patch·검증 사유·기준/의존 head·계산·문서를 불변 기록한다. 기존 XLSX 숫자/허용 행 검증을 순수 도메인 함수로 분리하고, 실제 재계산은 기존 `replayCalculation`/documentFactory·Clock trace·달력·시간대·고정 history selection을 재사용한다. ECOS/KOFIA 재조회와 파일 codec 호출은0이다.
4. **CorrectionResolution:** 수동 종료/이미 반영됨의 별도 append-only 기록. 확정 완료는 실제 confirmation 연결이 근거다. 완료된 안을 이후 head 변경 때문에 다시 미처리/stale로 취급하지 않는다. 불변 preview나 이전 확정본의 body를 상태 저장용으로 UPDATE하지 않는다.
5. **초안 CAS/재시도:** 모든 저장은 expectedDraftRevision·멱등키·요청hash를 사용한다. 동일 키/동일 요청은 이전 ACK를 반환하고 상태를 되돌리지 않는다. 같은 키/다른 요청 또는 두 탭의 오래된 버전은409·쓰기0이다. 프런트는 늦은 ACK가 새 입력/대상을 덮지 않도록 generation을 검사한다. 같은 draft의 유효 ACK는 해당 저장 queue의 서버 revision만 진전시키며 최신 입력 문자열을 응답 값으로 덮지 않는다. 실패한 요청을 동일 키로 재확인하기 전 다음 버전을 추정해 보내지 않는다. 요청 abort를 서버 쓰기 취소로 추정하지 않는다.
6. **검토/확정 경쟁:** stage는 열린 초안의 현재 draftRevision을 CAS로 확인하고 현재 preview 연결까지 한 트랜잭션으로 게시한다. 신규 웹 확정은 열린 상태·현재 draftRevision/currentPreviewId·기준/의존 head를 검사한다. 구형 preview의 신규 확정도 resolution을 확인해 수동 종료/이미 반영됨 처리를 우회하지 못하게 한다. 이미 성공한 확정의 동일 요청 재시도는 기존 멱등 receipt를 먼저 반환하며 이후 head를 되돌리지 않는다. 종료와 신규 확정은 한쪽만 승리한다. 확정 wire는 기존 CorrectionConfirmCommand를 유지하고 새 연결은 서버 preview metadata에서 검사한다.
7. **동일값 정리:** 웹에서는 **현재 draftRevision/currentPreviewId와 일치하는 검증안만** 자동 종료 대상이다. 과거 preview와 달라진 입력을 자동 보관 중이면 옛 preview가 반영됐어도 최신 draft를 닫지 않는다. 구형은 미종료·미확정 preview 자체가 대상이다. 대상의 전체 변경에 대해 원자료 의미(계열/회차/기간/단위)와 정규화 숫자/명시적 결측을 대조한다. 일부 행만 같거나 의미 대응이 불명확하면 이미 반영됨으로 닫지 않는다. 정정 확정 시 같은 트랜잭션에서 완전히 반영된 안의 resolution을 기록하고 나머지 오래된 안은 비교 필요로 남긴다. 미검증 draft를 추정 확정/자동 종료하지 않는다.
8. **종료안 복사/충돌:** 원본은 그대로 두고 새 draft·최신 basis를 발급한다. 과거 제안은 적용 대기 상태로 보존하며 명시적 재적용 전에는 검증/확정할 수 없다. 서버가 항목·원천 의미·회차·기간·단위를 매핑하고 사라진/편집 불가 행은 오류로 표시한다. 비교 이후 최신 head가 바뀌면409로 다시 비교한다. 전부 이미 같으면 no-change이며 빈 draft/candidate/새 차수를 만들지 않는다.
9. **호환과 schema4:** 실제 원장은 schema3이고 schema4는 아직 계획이다. schema4에 중립 payload와 아래 부가 테이블을 함께 원자 적용한다. 기존18테이블의 행/body/hash/ID/revision/head/시각과 불변 트리거를 재작성하지 않는다. 기존 물리 workbook_export/import와 FK는 중립 basis/submission의 저장 어댑터 내부에서 재사용하되, 신규 body는 `recordKind/payloadVersion:2`로 구분하며 가짜 XLSX bytes/시트/fileHash를 생성하지 않는다. 구형 body는 읽을 때만 메모리 변환한다.

| schema4 부가 테이블 | 책임·제약 |
|---|---|
| `correction_draft` | 가변 작업 head와 raw 입력·version·basis/currentPreview 연결. scope 포함 키, version CAS. 종료/확정 후 쓰기 거부 |
| `correction_work_command` | create/save/copy/close/reapply의 멱등키·요청hash·ACK. 기존 confirmation 전용 idempotent_command를 오용하지 않음 |
| `correction_resolution` | draft 또는 구형 preview 참조 중 정확히 하나, 수동 종료/이미 반영됨·종료 시각·보존 내용 참조. append-only/FK·scope 검사 |

새 초안/이벤트는 기존 불변 원장과 구분한다. 구버전 실행 파일의 schema4 거부, 읽기 전용 열기·마이그레이션 실패 rollback/재실행·온라인 backup/restore도 검증한다. 알 수 없는 recordKind/payloadVersion은 거부한다. 원래 일반 확정 API로 정정 후보를 우회 확정하는 금지는 유지한다.

**새 hash 규칙:** v2 submission/preview의 식별 hash에는 draftId·draftRevision·정규화 patch·사유·근거·기준/의존 head와 계산/문서 참조를 포함한다. 같은 현재 draftRevision의 재시도만 같은 preview를 반환한다. 편집 후 숫자가 우연히 같은 patch로 돌아와도 옛 draftRevision의 preview를 현재 검증으로 재사용하지 않는다. 순수 의미 동일값 판정용 hash와 저장 식별 hash를 구분하고 기존 v1 patch/preview/명령 hash는 바꾸지 않는다.

### 7.3 파일 책임·계약

경로는 저장소 루트 기준이다. 새 파일은 편집 업무 규칙·초안 lifecycle·UI 상태 분리에 필요한 것만 추가한다.

| 파일 | 책임 |
|---|---|
| 신규 `ai-frm/src/domain/report-history/correction.ts` + `.test.ts` | 편집 행/문자열 검증·정규화·초안 입력 경계·의미 식별·상태/동일값 판정 |
| 기존 `ai-frm/src/application/report-history/ports.ts` | 중립 기준/수정안/preview, draft/command/resolution, 읽기 DTO와 저장소 port |
| 기존 `ai-frm/src/infrastructure/report-history/sqlite-history-repository.ts` + `.test.ts` | schema4·불변 payload 호환·draft CAS/멱등·종료/확정 원자성·cursor 조회 |
| 기존 `ai-frm/src/infrastructure/report-history/history-workbook.ts` + `.test.ts` | 구형 XLSX codec와 순수 검증 연결, 신규 웹 경로에서는 호출하지 않음 |
| 신규 `ai-frm/src/application/report-history/correction-work.ts` + `.test.ts` | 초안 생성/자동 보관/재개/종료/복사·목록/읽기 전용 조회 |
| 기존 `ai-frm/src/application/report-history/report-correction.ts` + `.test.ts` | 파일 없는 기준 준비·기존 함수 재생·미리보기/확정·동일값 처리 연결 |
| 신규 `ai-frm/src/app/api/_lib/report-history-editor-handlers.ts` + `.test.ts`, `api/report-history/{editor,drafts,reviews}/route.ts` | bounded JSON/서버 scope/HTTP 계약과 공통 오류 |
| 기존 corrections/exchange routes·handlers·`_lib/composition.ts` + 관련 테스트 | 공통 확정 provider 연결, 기존 파일 교환410, 구형 preview 호환 |
| 신규 `ai-frm/src/app/aifrm/report-correction-editor.tsx` + `.test.tsx` | 편집/검토/읽기 모드의 실제 Astryx 컴포넌트 |
| 신규 `ai-frm/src/app/aifrm/report-correction-state.ts` + `.test.ts`, `use-report-correction.ts` + `.test.ts` | UI 상태 기계·직렬 자동저장·generation·복구. fake timer/주입 client로 DOM 모사 없이 의미 검증 |
| 기존 page/history-controls/confirmation-state/use-report-history + 관련 테스트 | 월별 목록/재개·파일UI 제거·캐시 무효화. 기존 과거 보완 흐름과 문서 열람은 보존 |
| 기존 README·이 문서·`2026-10-21-ui-ux.md` | 사용법·운영/schema4·증거/커밋/재개 지점 |

**W1에서 고정하는 타입/인터페이스:** 아래 서비스의 `deps`는 CorrectionDependencies, `repository`는 HistoryRepository다. 서버만 scope를 선택한다.

- `CorrectionEdit = {rowId:string;action:'set'|'set-missing';rawValue:string|null;evidenceNote:string}`. 공란 수정 칸은 편집 DTO에서 빠진다. draft 저장에는 아직 유효하지 않은 숫자 문자열도 허용하며 submission 변환 때 엄격 검사한다.
- `CorrectionEditRequest = {basisId:string;reason:string;edits:readonly CorrectionEdit[]}`; `normalizeCorrectionEdits(basis:CorrectionBasis,request:CorrectionEditRequest):CorrectionValidation` → invalid(errors)/no-change/valid(patch,reason).
- `CorrectionFieldError = {rowId:string|null;field:'request'|'action'|'value'|'reason'|'evidenceNote';code:string;message:string}`.
- `CorrectionEditorDto = {basisId:string;baseConfirmationId:string;baseRevision:number;basis:ReportBasis;rows:readonly CorrectionEditorRow[]}`. row는 rowId/category(cashflow|economic|funding)/label/sourceRound/period/unit/originalText/originalState(available|missing|unreadable)/allowedActions를 제공한다. sourceRecordId/fieldPath는 서버에만 둔다.
- `CorrectionWorkRef = {kind:'draft'|'legacy-preview';id:string}`. `CorrectionWorkState = 'draft'|'pending'|'stale'|'confirmed'|'closed'|'reflected'`. DB 수명 상태와 현재 head 대비 freshness를 읽기 모델에서 합성한다.
- `DraftEdit = {rowId:string;action:'set'|'set-missing';rawValue:string|null}`; `DraftContent = {edits:readonly DraftEdit[];reason:string;evidenceNote:string}`; `SaveDraftCommand = {draftId:string;expectedDraftRevision:number;idempotencyKey:string;content:DraftContent}`. 웹의 근거 메모는 한 번 입력하며 제출 어댑터가 모든 변경행의 CorrectionEdit.evidenceNote로 전달한다. 구형 자료의 행별 메모는 읽기 호환으로 보존한다. create는 basisId/멱등키/최초 content를 받고 완전히 빈 새 요청이면 empty 결과다.
- `CorrectionDraftDto = {draftId:string;draftRevision:number;editor:CorrectionEditorDto;content:DraftContent;createdAt:string;savedAt:string;currentPreviewId:string|null;requiresReapply:boolean}`. copied-from와 원래 시작값/제안값 참조는 서버에 보존한다.
- `CorrectionWorkSummary`는 ref/state/보고월/기준차수/수정시각/서버 생성 요약/입력수/유효 변경수/capabilities(resume,view,copy,close)를 제공한다. 숫자를 확정값처럼 변환하지 않고 초안/검증된 변경 개수를 구분한다.
- `CorrectionReviewDetail`은 summary와 저장 당시 원값·제안값·자료 식별·사유·근거·선택적 preview/확정 연결·종료 시각을 제공한다. 현재 최신값은 비교용 별도 필드이며 시작값 대신 사용하지 않는다.
- `prepareCorrectionEditor(deps:CorrectionDependencies,scopeId:string,confirmationId:string):Promise<CorrectionEditorDto>`.
- `createCorrectionDraft(deps:CorrectionDependencies,scopeId:string,cmd:{basisId:string;idempotencyKey:string;content:DraftContent}):Promise<CorrectionDraftDto|'empty'>`.
- `saveCorrectionDraft(deps:CorrectionDependencies,scopeId:string,cmd:SaveDraftCommand):Promise<CorrectionDraftDto>`; `getCorrectionDraft(repository,scopeId,draftId):Promise<CorrectionDraftDto>`.
- `listCorrectionWork(repository,scopeId,query:{reportCycle?:string;pendingOnly:boolean;cursor?:string;limit:20}):Promise<{items:readonly CorrectionWorkSummary[];nextCursor:string|null}>`. 전체 기간 또는 같은 보고회차의 전체 차수를 대상으로 고정 createdAt+kind+id 내림차순의 cursor를 사용한다. cursor에 최초 조회의 생성시각 상한을 고정하고 클라이언트는 ref로 중복 제거한다. 저장 때 바뀌는 savedAt을 cursor 정렬에 쓰지 않는다. 새 작업은 목록 새로고침으로 확인한다.
- `CorrectionMonthSummary`는 reportCycle/reportTitleMonth/latestConfirmationId/latestRevision/confirmedAt 및 미처리 전체 수·작성 중 수·대표 재개 ref를 제공한다. 자료회차 표시는 reportCycle, 보고월 표시는 보관된 reportTitleMonth를 사용한다. 첫20건만 세어 전체 건수처럼 표시하지 않는다. `listCorrectionMonths(repository,scopeId,query:{fromCycle?:string;toCycle?:string;pendingOnly:boolean;cursor?:string;limit:12}):Promise<{items:readonly CorrectionMonthSummary[];nextCursor:string|null}>`는 보고월 내림차순으로 월별 head를 한 번씩 반환한다. 전체 기간도 페이지를 끝까지 조회할 수 있다.
- `getCorrectionReviewDetail(repository,scopeId,ref:CorrectionWorkRef):Promise<CorrectionReviewDetail>`은 읽기 전용이다. `closeCorrectionWork(deps,scopeId,cmd:{ref:CorrectionWorkRef;expectedDraftRevision:number|null;idempotencyKey:string}):Promise<CorrectionWorkSummary>`는 명시적 동작이다.
- `copyClosedCorrectionWork(deps,scopeId,cmd:{ref:CorrectionWorkRef;idempotencyKey:string}):Promise<CorrectionDraftDto|{kind:'no-change'}>`. 수동 종료 원본만 복사하고 원래 기록을 다시 열어 쓰지 않는다.
- `reapplyCorrectionDraft(deps,scopeId,cmd:{draftId:string;expectedDraftRevision:number;expectedLatestConfirmationId:string;idempotencyKey:string}):Promise<CorrectionDraftDto|{kind:'no-change'}>`. 현재 비교가 가리킨 최신 head가 같은지 확인하고 저장된 제안을 의미가 같은 최신 행으로 명시 재적용한다.
- `previewCorrectionDraft(deps,scopeId,cmd:{draftId:string;expectedDraftRevision:number}):Promise<CorrectionEditResult>` → invalid(errors)/no-change/preview(previewId,previewHash,draftRevision). 브라우저 미저장 patch로 검토하지 않는다.
- `confirmCorrection(deps:CorrectionDependencies,scopeId:string,cmd:CorrectionConfirmCommand):Promise<ConfirmationResult>`는 기존 previewId/previewHash/expectedBaseRevision/idempotencyKey/reason wire를 유지한다. `CorrectionDependencies`는 현행 ReportCorrectionDependencies에서 workbookCodec를 뺀 공통 재생 의존성이며 legacy adapter만 codec를 가진다.
- Repository의 기존 getCorrectionPreview/stageCorrection/commitCorrection를 중립 union/선택적 draft linkage로 확장하고 draft/create/save/get/list/detail/resolve/copy에 대응하는 port를 추가한다. 구형 draft linkage가 없는 preview에는 기존 hash·멱등 규칙을 적용한다. 웹 확정 사유는 검증된 사유와 동일해야 한다.

**HTTP 계약:**

| 경로 | 계약 |
|---|---|
| `POST /api/report-history/editor` | action:open(confirmationId), preview(draftId,expectedDraftRevision). 허용 필드 외 거부 |
| `POST /api/report-history/drafts` | action:create(basisId,key,content), save(draftId,expectedDraftRevision,key,content). key는 idempotencyKey |
| `GET /api/report-history/drafts?draftId=...` | 기존 초안 재개. 같은 ID/내용/저장버전을 반환하고 새 작업을 만들지 않음 |
| `GET /api/report-history/reviews` | refKind/refId로 읽기 전용 detail, 또는 reportCycle?/pendingOnly/cursor?/limit=20으로 목록. detail/목록 쿼리 혼용 거부 |
| `GET /api/report-history/reviews?view=months` | fromCycle?/toCycle?/pendingOnly/cursor?/limit=12로 월별 head와 전체 미처리 수 조회. detail/수정안 목록 쿼리와 혼용 거부 |
| `POST /api/report-history/reviews` | action:close(ref,expectedDraftRevision,key), copy(ref,key), reapply(draftId,expectedDraftRevision,expectedLatestConfirmationId,key) |
| `POST /api/report-history/corrections` | 기존 명시적 확정 명령. 기존 일반 confirmations 경로 우회 금지 |
| `/api/report-history/exchange` | 생성/가져오기/다운로드410 EXCHANGE_RETIRED. 구형 preview는 reviews 조회와 corrections 확정으로 호환 |

모든 조회 no-store, 서버가 scope 선택, 기존 loopback/Host/Origin 검사를 유지한다. 잘못된 요청/값/버전422, 없음/타scope404, 충돌409, 크기413, 저장장애503+Retry-After다. JSON POST는 Content-Length 유무와 관계없이 실제 스트림6MiB, 최대10000행, 행ID/숫자문자열/사유/근거 각2000자 상한을 적용한다. 초안은 숫자 문법만 느슨하게 보관하고 행 식별·허용 동작·타입·크기 경계는 엄격히 검사한다. 원장 직접수정용 범용 PATCH/PUT나 multipart 우회는 만들지 않는다.

### 7.4 Astryx 구성 계약

공식 안내 `https://astryx.atmeta.com/docs/getting-started`와 설치 CLI의 getting-started/build/layout/Table/AlertDialog 문서를 확인했다. 웹 페이지는 검색 도구에서 접근 실패하여 동일 공식 패키지의 CLI 문서로 검증했다. 설치가 이미 되어 있으므로 재설치/라이브러리 교체를 계획의 전제로 두지 않는다.

| 화면 역할 | 실제 사용할 Astryx 구성 |
|---|---|
| 업무 화면 틀/고정 동작 | 기존 AppShell·Layout·LayoutHeader/Content/Footer·HStack/VStack, 기존 Theme/i18n |
| 월별 이력/수정안/비교 | Table·useTableRowExpansion·useTableStickyColumns. dense rows 유지, 고정 식별 열은 pixel helper |
| 기간/탭/검색/문자열 원값 | Selector·TabList/Tab·TextInput·TextArea·CheckboxInput |
| 상태/오류/처리 기록 | Token·Banner·Collapsible·Text/Heading |
| 명시적 동작/검토 종료 확인 | Button·AlertDialog. 종료 대상 요약 표시 |

CLI의 검색 결과는 추천일 뿐이며 이 업무에 맞지 않는 ChatToolCalls·추가 Card/대시보드는 넣지 않는다. component prop/token을 우선하며 raw div/span 레이아웃·임의 색/자체 CSS·style 덮어쓰기로 복제하지 않는다. 작은 화면에서는 공식 useMediaQuery와 슬롯 구성으로 보조 열을 접고 자료 식별을 고정 열에 보존한다. TextInput 숫자 문자열과 유효한 label/고유 접근 이름, 오류 초점, 모달 초점 복귀를 검사한다.

### W1: 공통 원자료 검증·초안/검토 상태 계약

**Files:** domain correction(.test), ports, legacy history-workbook(.test). **Consumes:** 현재 XLSX 업무 검증/원자료 허용 범위. **Produces:** §7.3 타입·normalizeCorrectionEdits·초안 입력 경계·의미 동일값/상태 규칙.

- [x] **RED 작성:** `decimal_zero_negative_precision_and_missing_are_distinct`, `unknown_duplicate_protected_row_is_rejected`, `unchanged_patch_is_noop`에서 원래 정밀도·0/음수·공란/결측·위조/중복·사유·overflow/underflow를 고정한다.
- [x] **RED 작성:** `draft_accepts_invalid_numeric_text_but_rejects_unknown_rows`는 미완성 숫자/사유 저장과 엄격한 행/크기 경계를 구분한다. `already_applied_requires_all_changes_and_semantic_identity`는 다른 월/회차/단위·부분 반영을 같은 값으로 닫지 않는다.
- [x] **RED 실행:** `npx vitest run src/domain/report-history/correction.test.ts src/infrastructure/report-history/history-workbook.test.ts --maxWorkers=4`에서 새 계약 부재의 실패를 확인한다.
- [x] **GREEN:** 파일 검사와 업무 검증을 분리하고 codec adapter를 공통 규칙에 연결한다. 새 계산·수입계 합산·반올림을 추가하지 않는다.
- [x] **QA/검토:** 같은 focused 명령과 `npx tsc --noEmit`, 기존 위험/정밀도 회귀를 확인하고 독립 검토한다.
- [x] **커밋/컨텍스트:** `refactor(history): define web correction and draft rules`. 보호51파일 diff/hash0, 근거와 W2 재개 지점을 기록한다.

### W2: 로컬 초안 자동 보관·불변 검토 호환·schema4

**Files:** ports, SQLite repository(.test). **Consumes:** W1 계약·기존 schema3 원장. **Produces:** §7.2 저장 구조와 CAS/멱등·query/detail·원자 stage/commit/resolve 저장소 port.

- [x] **RED 작성:** `schema3_upgrade_preserves_every_existing_body_hash_and_head`, `legacy_preview_retry_survives_upgrade`, `unknown_payload_is_rejected`에서 구형 전체 body/hash/ID/시각/명령 결과 보존을 고정한다.
- [x] **RED 작성:** `invalid_draft_autosaves_without_derivation_or_head_change`, `draft_revision_cas_rejects_out_of_order_and_two_tab_writes`, `editing_invalidates_current_preview_without_mutating_old_preview`, `confirm_rejects_outdated_draft_revision`, `same_patch_after_edit_requires_current_draft_preview`를 검사한다.
- [x] **RED 작성:** `close_and_confirm_are_atomic_and_idempotent`, `already_applied_resolution_is_stable_after_later_head_changes`, `work_list_spans_all_revisions_and_paginates_without_loss`, `month_counts_include_every_page_and_missing_months_are_not_filled`, `completed_detail_read_is_write_free`에서 경쟁/페이지 경계/월별 전체 수/읽기 불변을 검사한다.
- [x] **RED 작성:** `old_preview_reflection_cannot_close_edited_draft`, `closed_legacy_preview_cannot_be_newly_confirmed`, `successful_confirmation_retry_precedes_later_resolution_checks`로 최신 초안 소실·구형 종료 우회·멱등 퇴행을 막는다.
- [x] **RED 실행:** `npx vitest run src/infrastructure/report-history/sqlite-history-repository.test.ts --maxWorkers=4`에서 새 저장소 계약 실패를 확인한다.
- [x] **GREEN:** schema4와 부가3테이블·중립 payload mapping을 원자 추가하고 멱등 receipt·draft CAS·resolution과 commit 원자성을 구현한다. 기존18테이블 행/트리거를 재구성하지 않는다.
- [x] **QA/검토:** focused→타입검사, 임시 합성 DB의 migration 실패 rollback/재실행·구버전 거부·FK/integrity·두 연결 경쟁·재시작 복구와 읽기 전용 재열람 쓰기0을 확인한다.
- [x] **커밋/컨텍스트:** `feat(history): persist correction drafts and review resolutions`. 실제 업무 DB는 열어 쓰지 않고 합성 QA 증거와 W3를 기록한다.

### W3: 파일 없는 편집·재개/종료/복사·기존 계산 재생

**Files:** 신규 correction-work(.test), 기존 report-correction(.test), ports, legacy adapter. **Consumes:** W1/W2. **Produces:** §7.3의 prepare/create/save/get/list/detail/close/copy/reapply/preview/confirm 서비스.

- [x] **RED 작성:** `web_edit_replays_original_sources_and_clock_without_codec`에서 codec/원천 호출0·수입계 독립값·공표평균·완전 판독불가 복구/부분 실패·ECOS 실패 계열 생성 거부를 고정한다. `preview_changes_inputs_but_not_heads_or_other_reports`는 기존 문서/5개 계산/다른 달 보존을 확인한다.
- [x] **RED 작성:** `draft_resume_keeps_identity_and_unsaved_state_distinct`, `empty_new_draft_is_not_persisted`, `preview_uses_acknowledged_exact_draft_revision`, `closed_review_copy_preserves_source_and_requires_explicit_reapply`를 검사한다.
- [x] **RED 작성:** `editor_open_requires_latest_head_but_legacy_detail_is_readable`와 `same_current_draft_preview_retry_is_idempotent`에서 과거 차수 수정 진입과 최신 버전/저장 식별을 구분한다.
- [x] **RED 작성:** `copy_all_equal_is_no_change`, `copy_rejects_unmapped_or_changed_semantic_rows`, `copy_invalid_draft_remains_unvalidated`, `read_only_detail_preserves_baseline_and_calls_no_writers`, `reason_change_invalidates_confirmation` 및 레거시 완료/만료 안 조회와 동일 확정 재시도를 검사한다.
- [x] **RED 실행:** `npx vitest run src/application/report-history/correction-work.test.ts src/application/report-history/report-correction.test.ts --maxWorkers=4`에서 새 서비스 부재 실패를 확인한다.
- [x] **GREEN:** 기존 exportCorrectionWorkbook의 기준 구성과 validateCorrectionWorkbook의 재생/stage를 파일과 분리한다. 새 초안 업무는 correction-work가 맡고 기존 계산·documentFactory는 호출만 한다. 무변경은 파생 기록/차수0이다.
- [x] **QA/검토:** focused→타입검사, 저장 단계 실패 전체 rollback·재시작 재개·copy 원본 hash 보존·목록 전체 차수/cursor를 합성 자료로 독립 검토한다.
- [x] **커밋/컨텍스트:** `feat(history): manage browser correction work without files`. 원천/codec0·원본 불변·다음 W4를 기록한다.

### W4: JSON API·입력 경계·구형 파일 교환 종료

**Files:** editor handlers(.test), editor/drafts/reviews routes, corrections/exchange handlers·composition와 관련 테스트. **Consumes:** W3 서비스. **Produces:** §7.3 HTTP 계약.

- [x] **RED 작성:** 기준 준비→초안 저장/재개→preview→명시적 확정→readonly detail, 종료→새 복사→비교/재적용의 HTTP 흐름과 레거시 preview 호환을 검사한다.
- [x] **RED 작성:** 추가 필드/행 위조/중복·타scope·Host/Origin·422/404/409/413/503·no-store를 검사한다. `streamed_editor_body_is_bounded_without_content_length`, `exchange_is_retired_and_web_basis_is_never_encoded`를 고정한다.
- [x] **RED 실행:** `npx vitest run src/app/api/_lib/report-history-editor-handlers.test.ts src/app/api/_lib/report-history-handlers.test.ts --maxWorkers=4`에서 미구현 경로 실패를 확인한다.
- [x] **GREEN:** 엄격한 action별 DTO/bounded JSON·서버 scope·공통 오류를 연결하고 기존 corrections 명령 wire를 유지한다. 일반 확정 우회/가짜 파일 전달은 금지한다.
- [x] **QA/검토:** API focused→타입검사, 임시 합성 Next 서버에서 실제 HTTP의 응답 유실·재시도·저장 실패·닫기/확정 경쟁·서버 재시작을 확인한다. 업무 자료/키·외부 원천을 사용하지 않는다.
- [x] **커밋/컨텍스트:** `feat(history): expose browser correction work APIs`. 오류/호환/기록 파일 비노출 근거와 W5를 기록한다.

### W5: Astryx 월별 목록·편집·검토·읽기 전용/복사 화면

**Files:** 신규 editor/state/use-report-correction와 테스트, 기존 page/history-controls/confirmation-state/use-report-history와 관련 테스트. **Consumes:** W4 API. **Produces:** §7.1 UI/UX와 §7.4 공식 컴포넌트 구성.

- [x] **RED 작성:** `existing_draft_is_resumed_by_primary_action`, `new_draft_requires_explicit_action`, `summary_identifies_item_period_before_after`, `closed_detail_is_read_only_and_copy_is_separate`를 고정한다. 미처리 수·이전 차수·처리 기록과 내용 보기 상태는 서로 구분한다.
- [x] **RED 작성:** fake timer/client로 `autosave_debounces_1000ms_and_serializes_writes`, `create_before_ack_coalesces_to_one_draft`, `late_ack_advances_queue_revision_without_replacing_new_text`, `late_ack_cannot_replace_other_month`, `leave_and_preview_wait_for_ack`, `failed_save_keeps_text_and_requires_retry`를 검증한다. 보관됨은 ACK 이후다.
- [x] **RED 작성:** `edit_invalidates_preview_and_confirmation_command`, `readonly_view_never_autosaves`, `tab_filters_and_hidden_edits_survive_switch`, `copied_proposal_requires_comparison_and_revalidation`, no-change/오류/충돌 확정 불가·응답 불명 동일 명령 재시도를 고정한다.
- [x] **RED 작성:** `report_title_year_filter_preserves_source_cycle_mapping`에서2025년12월 보고서가2026년1월 자료회차로 표시·조회되고, 연도 필터가 자료회차 연도로 바뀌지 않음을 확인한다. 기존 월 함수는 수정하지 않는다.
- [x] **RED 실행:** `npx vitest run src/app/aifrm/report-correction-state.test.ts src/app/aifrm/use-report-correction.test.ts src/app/aifrm/report-correction-editor.test.tsx src/app/aifrm/report-history-controls.test.tsx --maxWorkers=4`. 단순 구현 복제 테스트 대신 순서 뒤집힌 응답·상태 전이를 검사한다.
- [x] **GREEN:** §7.4 컴포넌트/CLI에 따라 목록/요약/대표 재개/명시적 새 작성·자동 보관·에러·비교·내용 보기·종료/복사를 구현하고 엑셀 정정/ID UI만 제거한다. 추가 현황판·줄글 설명·리포트 양식 미리보기는 만들지 않는다.
- [x] **GREEN:** `useReportHistory.invalidateSelection():void`는 cache 비우기+selectionRevision 증가다. 정정 성공 시 월별 목록/현재 후보/현재 selection을 갱신하고 새 보관 확정본을 연다. 이미 열린 과거 문서에 최신 selection을 섞지 않는다.
- [x] **QA/검토:** 실제 합성 화면에서 5년치/같은사유 다수/20건 초과/연말/미처리0/0과값없음/키보드·오류초점·닫기초점복귀/712·1280px 및200% 확대/인쇄 제외를 확인한다. 고정 식별 열과 자료 식별을 유지한다. W5 실제 60개월/28안·두 탭409·실저장503·재접속·확정/복사·712/1280px 검증은 통과했다. archived 통합 회귀 보강·200%·실제 PDF 페이지 경계는 W6 최종 게이트로 이관하며 완료를 주장하지 않는다. `correction_success_refreshes_current_history_but_preserves_archived_document` 회귀와 독립 검토를 수행한다.
- [x] **커밋/컨텍스트:** `feat(ui): manage report corrections with Astryx`. 화면 증거·저장/검증/확정 구분·캐시/복구·미완료 수동 항목과 W6를 기록한다.

### W6: 보존 회귀·백업/복구·운영 안내·인수

**Files:** 기존 통합 테스트·README·이 문서·UI 진행 기록. **Consumes:** W1~W5. **Produces:** 검증된 웹 정정과 로컬 자동 보관/복구 안내.

- [x] **통합 QA:** 구형/신형 합성 원장에서 새 수정안→자동 보관→재시작/재개→검토→명시적 확정→이전/새 차수 읽기→다른 달 불변, 종료→readonly→새 복사→재검증, 같은값 자동 정리·두 탭·응답 유실·저장 명령 실패/rollback·전체테이블 온라인 백업/복원을 연결한다. 물리 디스크 고장이나 전원 차단 시험을 수행했다는 뜻이 아니다.
- [x] **자동·구조 회귀 QA:** 보호51파일 SHA-256/diff0, 3용지/5차트 영역·본문/서체/참고표·용지 안 제어부0을 확인했다. 자료가 없는 차트의 기존 산출불가 표시도 유지했다. 전체 `npm run lint` → `npm run build -- --webpack` → `npm run verify -- --maxWorkers=4` 순차 실행. 최종1068개 통과/기존2skip이며 과거896개를 재사용하지 않는다.
- [ ] **수동 최종 인수:** 실제 저장 PDF의3쪽 경계와 native200% 확대를 확인한다. 현재 Mac 잠금으로 미검수이며 사용자에게 잠금 해제를 요청했다. DOM/뷰포트/자동 테스트 통과로 대체하지 않는다.
- [x] **운영 문서:** ACK 전후 보관 의미, 실패 시 입력 보존/재시도, 기존안 재개와 새작성, 종료와 정정 확정, readonly 내용/새복사, schema4 백업/복구를 README에 반영한다. 원장 파일은 사용자 편집 대상으로 노출하지 않는다.
- [x] **인수 한계:** 구형 Excel 저장/파일선택기 QA는 종료한 기능의 과거 미완료 기록으로 유지하고 새 기능의 필수 인수로 요구하지 않는다. 실제 PDF/200% 등 유지 기능의 미검수는 이번 자동 테스트 통과와 구분해 남긴다. 기존 보호 SVG 라벨 겹침은 수정하지 않는다.
- [x] **독립 검토·커밋·컨텍스트:** 전체 변경을 독립 검토하고 필요한 수정의 RED→GREEN/재검토 후 `fix(history): complete web correction review and recovery`. 단계별 커밋·증거·한계·정확한 재개 지점을 기록한다. 외부 공개·Tunnel·인증·push·merge·배포는 이 계획 범위에 없다.

### 7.5 계획 검토·완료 기준

- 사용자에게 필요한 대상은 보고월·자료회차·적용 월/평가일·단위·수정값·사유·보관/검토/확정 상태다. 원장/스냅샷 파일·경로·내부 식별자 관리가 사용자 작업에 남으면 미완료다.
- 최근 검토의3건(대표 재개·변경 요약·처리안 readonly/새복사)을 W3~W5에, 기존 목업의 자동 보관/정리/누적 탐색/탭조건/식별열을 W1~W5에 배정했다. 확정본·계산/문서 보존은 전 단계와 W6에 적용한다.
- 이전 계획과 충돌하던 ‘초안 저장 제외’와 ‘최근20건까지만 조회’는 위 명세로 교체했다. 미완성 draft/불변 preview/명시적 confirmation/종료 event를 구분하고 copy는 자동 재적용·확정이 아니다.
- 다음 두 문장은 2026-10-26 **계획 수립 당시**의 검증 범위 기록이다. 이후 실행 결과는 W1~W6 체크리스트와 진행 기록을 따른다. 당시에는 문서·계약·요구 대응·diff와 앱 소스 변경0만 검사했고 신규 기능 TDD/DB 마이그레이션/빌드/실제 제품 UI QA를 완료했다고 보고하지 않았다. 별도 목업의 검사 결과는 제품 완료로 옮기지 않는다.
- 실행 순서는 **W1→W6, 각 단계 TDD → 독립 검토 → QA → 커밋 → 컨텍스트 기록**을 따랐다. 실패·미완료를 숨기거나 계산식/템플릿 보호 범위를 넓히지 않는다.


## 8. 확정 이력이 없는 월의 웹 원자료 직접 입력 (D1–D5)

**Goal:** 확정 이력이나 엑셀 파일 없이도 보고월을 고르고 자금자료·경제지표·금리를 웹에 입력해 자동 보관, 보고서 검토, 명시적 확정을 할 수 있게 한다.
**Architecture:** 기존 정정과 구분한 최초 입력 초안 aggregate를 추가한다. 서버가 달력·자료 식별을 고정하고 raw 문자열을 보관한다. 검토 시만 기존 Statement/원천 포트로 변환해 기존 계산기와 문서 factory를 호출한다. SQLite schema5의 부가2테이블로 CAS·멱등·원자 확정을 제공한다.
**Tech stack:** 기존 Node26.12.1/Next16/React19/SQLite/Astryx0.5.4/Vitest. 의존성 추가 없음.
**Spec:** 사용자의 ‘웹에서 월과 원자료 값을 직접 입력’, ‘자금자료·경제지표·금리를 모두 직접 입력’ 답변 및 이 절. 상세 DTO 조사 기록은 계획 workspace의 manual-entry-design-discovery.md이며 아래 판정이 우선한다.
**Execution base:** e2a1602. W1–W6 완료를 되풀이하지 않는다. 기존 수동 PDF/200% 인수 미검수는 별도로 유지한다.

### 8.1 전 단계 보존 조건과 판정

- 계산식·월 정책·엑셀 parser·리포트 템플릿·본문 글꼴·참고표·차트 및 보호51파일은 변경0. 점수/등급/계열을 직접 입력하거나 수입계/공표평균을 새로 계산하지 않는다. 기존 업로드·일반 정정·과거 확정본은 계속 동작해야 한다.
- 사용자 선택은 **보고월 t**다. 서버가 기존 addMonths로 자료회차 q=t+1을 정하고 기존 basis(q−1/q−2/q/q−1/q)를 유지한다. 생성 후 월 고정. 다른 월로 값을 몰래 이동하지 않는다.
- domain은 application/infrastructure를 import하지 않는다. catalog는 중립 ECOS 정의를 주입받고 기존 SCORING_RULES를 읽는다. normalizer는 순수 데이터형을 반환하고 D3가 StatementSnapshotDto/SourceResult Map으로 변환한다.
- raw의 빈 값·0·음수·입력 중 문자열을 구분한다. 저장은 엄격한 구조/키/길이 검증, 검토는 엄격한 유한 십진수/유효 날짜 검증이다. 빈 값0 채우기/추정/환산/rounding 없음.
- 자금자료는 q 필수, q−1/q−3 명시 선택. 각 r의 1월부터 max(그해12월,r+3)까지 원래 열 모양을 유지하며 전년 열을 발명하지 않는다. 실제 기준일 YYYY-MM-DD가 r 안에 있어야 한다. 6항목은 기존 ItemName, 단위억원. values 행은 모든 열 필수; unavailable은 사유가 있는 항목 전체 Unreadable이며 raw는 남긴다. 6행 전부 판독불가는 거부한다.
- 경제지표9종의 현재/비교 원값만 입력한다. b=q−2, yoy는 b−12 그 외 b−1로 기존 transform을 따른다. 단위·기준은 두 값이 공유하는 사용자 입력 원자료 메타데이터이며 값이 있으면 필수다. ECOS_SERIES에 없는 공식 단위 enum/기준연도를 발명하지 않는다. 기존 단위 불변 정정 정책은 유지한다.
- 금리는 관측월 q−1의 실제 평가일과 AAA1년/국고채1년 공표3사평균을 받는다. 평가사별 값은 선택 참조이며 재평균하지 않는다. 공란은 null, 날짜/rowId 중복 거부, 실제 마지막 평가일 안내. days 없음은 사유 필수다. 최대 제공 평가일 선택과 월완료 clock guard는 기존 계산기에 맡긴다.
- sourceKind ecos/kofia는 자료 종류다. 새 Derivation manual-input(draftId,draftRevision,rawInputHash,recordedAt)으로 입력 방법을 정직하게 기록한다. resultJson은 기존 결과 그대로다. 보호 buildFinancialReport 호출 뒤 공통 factory에서 출처/설명 텍스트만 직접 입력으로 투영하고 수치/월/등급/계열 불변을 검증한다. 이후 일반 정정도 같은 경로로 처리한다.
- 초기 manual 후보만 전용 확정 경로로 제한한다. manual-input을 부모로 가진 정상 manual-correction의 확정을 막지 않는다. 가짜 파일/부모/확정0차를 만들지 않는다.
- 서버 scope/Host/Origin/no-store/6MiB/UUID·목록·문자열 경계 유지. 외부 원천/API키·실제 업무 자료는 QA에 사용하지 않는다. push/merge/공개/Tunnel은 범위 밖이다.

### 8.2 계약과 저장

- 새 domain/report-history/manual-entry.ts에 catalog/raw content/오류/요약/초안/명령 DTO와 createManualEntryCatalog, createBlankManualEntryContent, validateManualEntryContent, normalizeManualEntry를 둔다. 조사 기록의 DTO를 기반으로 하되 create 명령은 `{reportTitleMonth,idempotencyKey}`다. CandidateWrite.manualEntry는 선택적 binding이며 구형 body를 다시 쓰지 않는다.
- raw cashflow는 정확한 catalog회차→enabled/asOfRaw/items→mode/values/unavailableReason, economic은 정확한9키→unitRaw/values, funding은 days(rowId/dateRaw/평균/평가사)/noDataReason, note다. 알 수 없는 키·길이 초과는 저장 때 거부한다.
- SQLite schema5는 manual_entry_draft(scope,id,report_cycle,revision,current_candidate_id,confirmation_id,body)와 manual_entry_command(scope,key,draft_id,action,request_hash,body)만 추가한다. scope+cycle unique, 기존 FK 사용, draft삭제/receipt수정삭제 금지. 기존21테이블/31트리거와 모든 body/hash/ID/head/시각 불변.
- HistoryRepository에 create/save/get/listManualEntries, getManualEntryCommand, planHistorySelection, stageManualEntry, commitManualEntry를 추가한다. selection 선택 로직은 기존 createHistorySelection과 공유하되 plan은 읽기 전용이다.
- 모든 mutation은 성공 receipt를 먼저 확인한다. 같은 key+action+semantic hash면 후속 수정/확정 이후에도 원래 ACK 반환; 다른 요청에 key 재사용409. save는 revision CAS, 미완성 raw 보존, 변경 시 검토 무효화. 생성은 동일 pending월 재개, 기존 head가 있으면 충돌이다.
- stage는 draft binding/head0/dependency head를 검증하고 evidence/input/계산2개/selection/document/candidate/review/receipt를 원자 보관한다. 같은 유효 검토의 재준비는 파생 중복0. 실패는 전부 rollback. confirm은 현재 raw+검토 binding과 head0/dependencies 확인 후 기존 confirmDecision을 사용해 revision1/head/멱등/receipt/draft 확인표시를 원자 보관한다.
- `/api/report-history/manual-entries`: GET draftId 또는 limit12/cursor의 미확정 초안 목록. POST action create/save/prepare/confirm. 엄격한 action별 필드. 404없음/타scope,409충돌,413크기,422입력,503저장장애+Retry-After1. confirm은 expectedRevision0/candidateId/documentHash/draftRevision 필요. 서버만 catalog/clock/IDs/hash/source를 만든다.
- 입력 목록은 기존 확정 이력과 별도의 간결한 ‘작성 중인 새 보고서’ Table이다. 기존 월별 head/미처리 정정 수를 섞지 않는다. 초기 empty/loading/error/필터empty를 구분하고 언제나 ‘새 보고서 직접 입력’ 진입을 제공한다.
- 실제 Astryx의 Dialog/TabList/Table/TextInput/DateInput/Selector/CheckboxInput/EmptyState/Button/Banner/Text를 사용한다. 생성 창에서 보고월 선택→고정 월 편집창의 자금자료/경제지표/조달금리 탭→1000ms 직렬 CAS 자동 보관→검토→보고서 확정. ACK만 보관됨이며 late ACK는 최신 입력을 덮지 않는다. 응답 불명은 같은 명령/key 재시도, 422/413은 새 명령 가능, 409는 명시 복구. 입력 변경 즉시 이전 검토 무효화. 닫기/검토는 저장 ACK를 기다린다.

### D1: 최초 입력 domain·catalog·검증 계약

**Files:** domain/report-history/manual-entry.ts(.test), report-history.ts(.test), application/report-history/ports.ts. **Produces:** §8.1–8.2의 순수 계약과 중립 정규화. 저장소 구현은 D2다.

- [x] RED: 보고월→q 연말, q/q−1/q−3 달력, strict keys, incomplete autosave, blank/0/음수/정밀도, whole-unavailable/all6거부, 실제 기준일,9종 비교월/단위, 금리 중복일/평균결측/noData를 고정한다.
- [x] GREEN: raw validator/normalizer와 타입 추가. 기존 계산기/인프라를 domain으로 가져오지 않는다. Derivation union/정확한 runtime guard를 추가하며 기존 계산/확정 의미는 유지한다.
- [x] 검토·QA: focused Vitest/tsc/보호51hash0·독립 검토 후 커밋 `feat(history): define manual raw entry contracts`, ledger/context 갱신.

### D2: schema5 최초 입력 초안·원자 검토/확정 저장

**Files:** ports, sqlite-history-repository.ts(.test). **Consumes:** D1. **Produces:** §8.2 저장 ports, CAS/receipts/stage/confirm/generic bypass.

- [ ] RED: schema4의21테이블 행/트리거 보존·DDL실패rollback·pending재개·receiptfirst·two-tab CAS·preview무효화·이전후보/일반우회 거부·중복prepare/더블confirm·stage부분실패전부rollback·동일월/의존head경쟁을 고정한다.
- [ ] GREEN: 부가2테이블과 검증/저장 port를 구현하고 기존 저장 private 로직을 재사용한다. 정상 후속 정정은 허용한다.
- [ ] 검토·QA: synthetic schema4→5 두 연결/백업·복구·FK/integrity/구버전거부, focused/tsc/보호0·독립 검토 후 커밋 `feat(history): persist first report drafts atomically`, context 갱신.

### D3: 직접 입력 서비스·기존 산출 연결·엄격 JSON API

**Files:** application/report-history/manual-entry.ts(.test), report-candidate/report-correction/correction-work 필요한 호환, API manual-entry-handlers(.test)/route/composition/confirmation-handlers factory. **Consumes:** D1/D2. **Produces:** create/save/get/list/prepare/confirm과 HTTP.

- [ ] RED: 실제 기존 계산 결과의 수치/등급/월/계열 동일, 네트워크/codec0, frozen clock, 단위/공표평균 보존, raw-only 입력 경계,500→503/413/422/no-store/HostOrigin, 같은 key 재시도, manual root→정상 정정 호환·정직한 출처 투영을 고정한다.
- [ ] GREEN: 순수 normalized를 기존 포트에 번역하고 history selection plan→documentFactory→원자stage로 연결한다. manual source만 구성한다. 일반 업로드 분기는 유지한다.
- [ ] 검토·QA: 실제 임시 서버 synthetic HTTP·원자 실패/재접속/검토/확정·회귀/보호0·독립 검토 후 커밋 `feat(history): calculate and confirm manually entered reports`, context 갱신.

### D4: Astryx 빈 이력 추가·3탭 편집·자동 보관·재개

**Files:** 신규 manual-entry state/hook/editor(.test), 기존 page/history-controls/history hook와 관련 테스트. **Consumes:** D3. **Produces:** §8.2 실제 화면.

- [ ] UI 전 실제 `npx astryx build`, layout 및 해당 component 문서를 확인한다. mock component 복제로 대체하지 않는다.
- [ ] RED: empty CTA/global-vs-filter/loading/error, draft 재접속,1000ms 직렬 저장/late ACK/409/422/413/unknown재시도/다른draft전환/검토확정 무효화/close drain을 검사한다.
- [ ] GREEN: 보고월 생성과 탭별 실제 원자료 입력/저장/검토/명시확정/목록갱신을 연결한다. 파일 UI·불필요한 설명·양식미리보기는 추가하지 않는다. 기존 업로드와 정정 유지.
- [ ] 검토·QA: 합성 실제 UI 최초이력0→작성/새로고침/재개→3종원자료→검토/확정, 오류초점/키보드/작은화면/필터empty/기존수정 확인. 보호0·독립 검토 후 커밋 `feat(ui): add and resume reports with manual raw data`, context 갱신.

### D5: 전체 회귀·백업/운영 적용·인수

**Files:** 통합 테스트·README·기존 계획/journal/context. **Consumes:** D1–D4. **Produces:** 검증된 실동작·로컬 서버.

- [ ] 통합: manual첫확정→일반정정, 기존파일업로드, 같은월경쟁/의존변경,23테이블온라인백업복구와4→5/구버전거부, 네트워크0/수치/기존기록 불변을 확인한다.
- [ ] 전체독립검토→필요한 RED/GREEN 수정·재검토→lint→webpack build→verify(maxWorkers4)→보호51hash0. 기존2skip과 수동 미검수는 정확히 구분한다.
- [ ] 실제 업무DB는 쓰기 전 online backup하고 schema4기록 보존을 metadata/hash로 확인한 뒤 로컬3002를 재시작한다. 합성자료를 업무DB에 넣지 않는다.
- [ ] README/plan/journal/context 기록과 최종 커밋 `test(history): verify manual entry and history compatibility`. 단계별 완료 증거 및 남은 인수를 명시한다.
